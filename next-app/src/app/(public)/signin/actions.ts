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
import { requestChallenge, redeemCode, redeemToken } from '@/lib/identity-challenge';
import { IDENTITY_COOKIE, signIdentitySession } from '@/lib/identity-session';
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
    maxAge: IDENTITY_COOKIE.maxAgeSeconds
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
