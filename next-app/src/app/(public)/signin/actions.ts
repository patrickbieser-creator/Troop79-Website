'use server';

/**
 * /signin — passwordless sign-in (Plans/Family-Identity-Auth.md Phase 1).
 * Email/phone → challenge (link + 6-digit code) → redeem into a verified
 * `t79_identity` cookie. See lib/identity-challenge.ts for the mint/verify
 * logic this just wires into forms, and lib/identity-session.ts for the
 * cookie shape.
 *
 * ENUMERATION SAFETY is enforced here, not just in the library: every path
 * through requestSignInAction redirects to the SAME `?sent=1` state whether
 * or not the contact matched anyone on the roster. Never branch this
 * response on requestChallenge()'s internal outcome.
 */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import {
  requestChallenge,
  requestChallengeForPerson,
  redeemCode,
  redeemCodeForPerson,
  redeemToken
} from '@/lib/identity-challenge';
import { FAMILY_COOKIE, signFamilySession } from '@/lib/family-session';
import { revalidatePath } from 'next/cache';
import { identityForPerson } from '@/lib/identity-challenge';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import {
  beginAuthentication,
  finishAuthentication,
  beginRegistration,
  finishRegistration,
  deletePasskey
} from '@/lib/passkeys';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON
} from '@simplewebauthn/server';
import { hasFamilyAccess } from '@/lib/family-access';
import { searchSignInCandidates, type SignInSearchResult } from '@/lib/signin-roster';
import { IDENTITY_COOKIE, signIdentitySession, sessionMaxAgeFor } from '@/lib/identity-session';
import { safeInternalPath } from '@/lib/safe-redirect';

const SIGNIN_PATH = '/signin';

function signinUrl(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)) as Record<string, string>
  ).toString();
  return qs ? `${SIGNIN_PATH}?${qs}` : SIGNIN_PATH;
}

async function setIdentityCookie(identity: {
  personId: number;
  displayName: string;
  subjectKind: 'adult' | 'scout';
  householdKey: string;
  epoch: number;
}): Promise<void> {
  const token = await signIdentitySession({
    subjectKind: identity.subjectKind,
    personId: identity.personId,
    householdKey: identity.householdKey,
    displayName: identity.displayName,
    epoch: identity.epoch,
    iat: Date.now()
  });
  const jar = await cookies();
  jar.set(IDENTITY_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: sessionMaxAgeFor(identity.subjectKind)
  });
}

/** Best-effort caller IP for the per-IP rate limit — Vercel sets
 *  x-forwarded-for at the edge; local dev has none, so that limit simply
 *  never triggers there (per-person limiting still applies everywhere).
 *  Caught missing entirely in qa-lead review 2026-08-06 — opts.ip was never
 *  populated, so MAX_PER_IP_HOUR was dead code in production. */
async function callerIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : null;
}

/** Step 1: request a challenge. ALWAYS redirects to the same `?sent=1`
 *  state — see module header. */
export async function requestSignInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const next = String(formData.get('next') ?? '');
  const keep = { email: email || undefined, next: next || undefined };

  if (!email) redirect(signinUrl({ ...keep, err: 'missing' }));

  const supabase = createAdminClient();
  await requestChallenge(supabase, email, { nextPath: next || null, ip: await callerIp() });

  redirect(signinUrl({ ...keep, sent: '1' }));
}

/** Step 2 (code path): verify the 6-digit code against the contact from step
 *  1. Wrong code redirects back to the same `?sent=1` state with an error —
 *  never a different state a guesser could distinguish from "still waiting". */
export async function verifyCodeAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const next = String(formData.get('next') ?? '');
  const keep = { email: email || undefined, next: next || undefined, sent: '1' };

  if (!email || !code) redirect(signinUrl({ ...keep, err: 'invalid' }));

  const supabase = createAdminClient();
  const result = await redeemCode(supabase, email, code);
  // Collapsed to a single external code regardless of redeemCode()'s
  // internal 'invalid' vs 'locked' reason (qa-lead review 2026-08-06): the
  // request step is already enumeration-safe, but a real roster member's
  // token eventually locks out after 5 wrong guesses while a guessed,
  // nonexistent address never does — the URL's ?err= value (not just the
  // rendered message) would otherwise let a guesser distinguish "on roster"
  // from "not" by whether five wrong codes ever flip the state. Resending
  // works the same regardless of which internal reason applies.
  if (!result.ok) redirect(signinUrl({ ...keep, err: 'invalid' }));

  await setIdentityCookie(result.identity);
  redirect(safeInternalPath(result.identity.nextPath, '/profile'));
}

/** Step 2 (link path): consumes the token and signs in. Called from the
 *  verify landing page's POST form — never on GET (see peekTokenChallenge()'s
 *  own doc for why the GET render must stay side-effect-free). */
export async function confirmTokenAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!token) redirect(SIGNIN_PATH);

  const supabase = createAdminClient();
  const identity = await redeemToken(supabase, token);
  if (!identity) redirect(`/signin/verify?token=${encodeURIComponent(token)}&err=1`);

  await setIdentityCookie(identity);
  redirect(safeInternalPath(identity.nextPath, '/profile'));
}


/**
 * The troop password, in its NEW job (Plans/Unified-Identity-And-Capabilities.md
 * Phase D, decision 3).
 *
 * It no longer grants access to anything. It unlocks the "find yourself"
 * roster on /signin and nothing else — the output of that flow is still a
 * bound, revocable, per-person identity session. Families keep the one-string
 * simplicity they already have; what changes is that knowing the string stops
 * BEING access and starts being a way to reach the list of names.
 */
export async function unlockRosterAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '');
  const keep = { next: next || undefined };

  const expected = process.env.FAMILY_PASSWORD;
  if (!expected) redirect(signinUrl({ ...keep, err: 'not-configured' }));
  if (password !== expected) redirect(signinUrl({ ...keep, err: 'bad-password' }));

  const token = await signFamilySession({ role: 'family', iat: Date.now() });
  const jar = await cookies();
  jar.set(FAMILY_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FAMILY_COOKIE.maxAgeSeconds
  });
  // `pick` is no longer read by anything (page.tsx, 2026-08-17) — the picker
  // renders because hasFamilyAccess() now sees the cookie just set above.
  // Left the redirect target otherwise unchanged.
  redirect(signinUrl(keep));
}

/**
 * Start a challenge for a person picked off the roster.
 *
 * NOT enumeration-safe, and it does not need to be: the caller has already
 * cleared the troop-password gate and chosen a name from a list we showed
 * them, so "does this person exist" is not a secret at this point. Saying
 * plainly "we have no address for you, ask a leader" is worth more here than
 * a uniform response that leaves someone staring at a screen wondering.
 *
 * The person id is the input — never an email. A scout can share a parent's
 * address, and resolving by address would sign the scout in as the parent
 * (see requestChallengeForPerson's header).
 *
 * GATED IN ITS OWN RIGHT, same reasoning as searchRosterAction above — a
 * Server Action is callable directly, independent of what the rendering page
 * checked. This was missing entirely until qa-lead's review of the `pick=1`
 * bypass fix (2026-08-17) traced this action and found it: any personId
 * could be POSTed here with NO password, ever, and it would still send a
 * real one-time code — worse than the bug being fixed, since it needed no
 * forged URL at all, just direct knowledge of this action's name.
 */
export async function requestForPersonAction(formData: FormData): Promise<void> {
  const next = String(formData.get('next') ?? '');
  const keep = { next: next || undefined };
  if (!(await hasFamilyAccess())) redirect(signinUrl(keep));

  const personId = Number(formData.get('personId'));
  if (!Number.isInteger(personId) || personId <= 0) {
    redirect(signinUrl({ ...keep, err: 'invalid' }));
  }

  const supabase = createAdminClient();
  const result = await requestChallengeForPerson(supabase, personId, {
    nextPath: next || null,
    ip: await callerIp()
  });

  if (!result.sent) {
    // Distinct reasons, distinct advice. Telling a rate-limited person "we
    // have no address for you" would send them to a leader for a problem that
    // fixes itself in a few minutes.
    redirect(signinUrl({ ...keep, err: result.reason, person: String(personId) }));
  }
  redirect(signinUrl({ ...keep, sent: '1', person: String(personId), masked: result.masked }));
}

/**
 * Verify a code that was sent via the name picker. Keyed on the person we
 * already identified, not on an address — see redeemCodeForPerson.
 *
 * Keeps the collapsed 'invalid' error of the email path: the picker is not
 * enumeration-safe by design, but the number of code guesses someone gets is
 * still worth not leaking.
 *
 * DELIBERATELY NOT gated on hasFamilyAccess(), unlike requestForPersonAction
 * above (qa-lead review, 2026-08-17) — redeeming a code requires possessing
 * the actual 6-digit secret (hash-compared, MAX_WRONG_ATTEMPTS-limited,
 * single-use, 15-minute TTL), which is real authentication in its own right.
 * Adding the gate here would risk locking out someone whose FAMILY_COOKIE
 * lapsed between requesting a code and typing it in — a real, foreseeable
 * case now that requestForPersonAction refuses to send a code at all without
 * the gate, so reaching this form already implies the gate was satisfied at
 * request time.
 */
export async function verifyCodeForPersonAction(formData: FormData): Promise<void> {
  const personId = Number(formData.get('personId'));
  const code = String(formData.get('code') ?? '').trim();
  const next = String(formData.get('next') ?? '');
  const masked = String(formData.get('masked') ?? '');
  const keep = {
    next: next || undefined,
    sent: '1',
    person: Number.isInteger(personId) ? String(personId) : undefined,
    masked: masked || undefined
  };

  if (!Number.isInteger(personId) || personId <= 0 || !code) {
    redirect(signinUrl({ ...keep, err: 'invalid' }));
  }

  const supabase = createAdminClient();
  const result = await redeemCodeForPerson(supabase, personId, code);
  if (!result.ok) redirect(signinUrl({ ...keep, err: 'invalid' }));

  await setIdentityCookie(result.identity);
  redirect(safeInternalPath(result.identity.nextPath, '/profile'));
}

/**
 * Type-ahead search over the roster.
 *
 * GATED IN ITS OWN RIGHT. This is a second door onto the same data as the
 * /signin page, and a Server Action is callable directly — checking the gate
 * only when rendering the page would leave the roster readable by anyone who
 * posts to this endpoint. hasFamilyAccess() covers the troop-password cookie
 * and every stronger session.
 *
 * Returns nothing below the two-character floor; see lib/signin-roster.ts for
 * why the roster is searchable rather than browsable.
 */
export async function searchRosterAction(query: string): Promise<SignInSearchResult> {
  if (!(await hasFamilyAccess())) return { candidates: [], truncated: false };
  return searchSignInCandidates(query);
}

/* ── Passkeys (Family-Identity-Auth.md Phase 4) ───────────────────────────
 *
 * Two ceremonies, four actions. Both halves of each ceremony are server
 * actions because the challenge must be minted, remembered and verified
 * server-side — a challenge the client chose proves nothing.
 *
 * SIGNING OUT DOES NOT REMOVE A PASSKEY. Logging out clears the session
 * cookie; the credential stays registered on the device, so the next visit is
 * one tap. Signing in as somebody else — a second parent on a shared iPad —
 * means using the code path instead, which is why both routes stay on the
 * page permanently rather than the passkey replacing the link.
 */

export async function passkeyAuthOptionsAction(): Promise<string | null> {
  const options = await beginAuthentication(createAdminClient());
  return options ? JSON.stringify(options) : null;
}

export async function passkeyAuthVerifyAction(
  responseJson: string,
  next: string
): Promise<{ ok: boolean; error?: string; redirectTo?: string }> {
  const supabase = createAdminClient();
  let parsed: AuthenticationResponseJSON;
  try {
    parsed = JSON.parse(responseJson) as AuthenticationResponseJSON;
  } catch {
    return { ok: false, error: 'That sign-in was malformed.' };
  }

  const result = await finishAuthentication(supabase, parsed);
  if (!result.ok) return { ok: false, error: result.error };

  // Re-resolve identity from the person id, exactly as a redeemed code does:
  // the credential proves WHO, never what they are still entitled to.
  const identity = await identityForPerson(supabase, result.personId, next || null);
  if (!identity) {
    return { ok: false, error: 'That account is no longer active — ask a leader.' };
  }

  await setIdentityCookie(identity);
  return { ok: true, redirectTo: safeInternalPath(identity.nextPath, '/member') };
}

/** Adults only — a scout registering a passkey on a shared school Chromebook
 *  is a foreseeable mess, so Tier 2-S stays on emailed codes. */
async function requireAdultForPasskey() {
  const session = await getIdentitySessionIfValid();
  if (!session) throw new Error('Please sign in first.');
  if (session.subjectKind !== 'adult') {
    throw new Error('Passkeys are for parents and leaders — scouts sign in with a code.');
  }
  if (!(await isEpochCurrent(createAdminClient(), session))) {
    throw new Error('Your sign-in has been revoked — please sign in again.');
  }
  return session;
}

export async function passkeyRegisterOptionsAction(): Promise<string | null> {
  const session = await requireAdultForPasskey();
  const options = await beginRegistration(createAdminClient(), {
    personId: session.personId,
    displayName: session.displayName
  });
  return options ? JSON.stringify(options) : null;
}

export async function passkeyRegisterVerifyAction(
  responseJson: string,
  nickname: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdultForPasskey();
  let parsed: RegistrationResponseJSON;
  try {
    parsed = JSON.parse(responseJson) as RegistrationResponseJSON;
  } catch {
    return { ok: false, error: 'That registration was malformed.' };
  }
  const result = await finishRegistration(
    createAdminClient(),
    session.personId,
    parsed,
    nickname || null
  );
  revalidatePath('/member');
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function deletePasskeyAction(formData: FormData): Promise<void> {
  const session = await requireAdultForPasskey();
  const id = Number(formData.get('credentialId'));
  if (!Number.isInteger(id)) return;
  await deletePasskey(createAdminClient(), session.personId, id);
  revalidatePath('/member');
}
