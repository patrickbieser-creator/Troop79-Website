/**
 * "May this request see gated signup content?" — the single check every
 * signup surface uses, so the rule lives in one place.
 *
 * A logged-in leader or scout passes without needing the family password:
 * they already cleared a stronger gate, and a leader hitting an event page
 * shouldn't be asked for a second password to see a roster they administer.
 * A verified identity cookie (Plans/Family-Identity-Auth.md Phase 1) passes
 * the same way, for the same reason — it's a strictly stronger proof than
 * the shared troop password.
 *
 * Needs next/headers, so it's server-only — keep it out of lib/family-session.ts,
 * which stays framework-agnostic for the Edge middleware.
 */

import { cache } from 'react';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { FAMILY_COOKIE, verifyFamilySession } from '@/lib/family-session';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { IDENTITY_COOKIE, isEpochCurrent, verifyIdentitySession, type IdentitySession } from '@/lib/identity-session';
import { hasCapability } from '@/lib/capabilities';

export type GateAudience = 'family' | 'leader' | 'scout' | 'household';

/**
 * Which credential (if any) this request carries. Null = not gated in.
 *
 * A verified identity cookie (adult OR scout subjectKind) collapses to
 * 'household' here — that's the coarse "may this request see gated content"
 * answer every existing signup surface already asks. The adult/scout
 * distinction that actually matters for Tier 2 vs Tier 2-S writes is a
 * SEPARATE, more expensive check (requireHouseholdIdentity() /
 * requireVerifiedScoutIdentity() below) — see identity-session.ts's header
 * for why the epoch/revocation cost is spent there, not here. This function
 * stays pure crypto, same cost profile as before.
 */
export const gateAudience = cache(async function gateAudience(): Promise<GateAudience | null> {
  const jar = await cookies();
  const admin = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (admin) return admin.role;
  const identity = await verifyIdentitySession(jar.get(IDENTITY_COOKIE.name)?.value);
  if (identity) return 'household';
  const family = await verifyFamilySession(jar.get(FAMILY_COOKIE.name)?.value);
  return family ? 'family' : null;
});

export async function hasFamilyAccess(): Promise<boolean> {
  return (await gateAudience()) !== null;
}

/**
 * Server Action guard for anything that writes signup data. Mirrors
 * requireRole()'s throw-if-not-authenticated shape.
 *
 * Its only callers today (Event Signup's submit/cancel actions) are both
 * writes, so this is exactly the "Server Action that writes" spend point
 * identity-session.ts's header describes — a 'household' audience here also
 * gets the epoch/revocation check, same as requireHouseholdIdentity() and
 * requireVerifiedScoutIdentity() do for their own surfaces. Caught missing
 * in qa-lead review 2026-08-06: a revoked identity session kept full Event
 * Signup write access indefinitely, because gateAudience() alone (signature
 * only, by design) was the only thing gating it.
 */
export async function requireFamilyAccess(): Promise<GateAudience> {
  const audience = await gateAudience();
  if (!audience) throw new Error('Not authenticated');
  if (audience === 'household') {
    const session = await getIdentitySessionIfValid();
    if (!session || !(await isEpochCurrent(createAdminClient(), session))) {
      throw new Error('Your sign-in has been revoked — please sign in again.');
    }
  }
  return audience;
}

/**
 * Verified Signup (Plans/Verified-Signup.md, Patrick 2026-08-26): who may
 * WRITE a signup. The troop password is first base — it still opens the
 * event page and /signin — but signing a family up, cancelling, or claiming a
 * job needs a verified ADULT identity or a leader session.
 *
 *   'ok'      — leader session, or verified adult identity
 *   'sign-in' — troop password only (or the retired shared scout role): must
 *               go through /signin first
 *   'parent'  — verified SCOUT identity: a parent has to sign in (Phase B
 *               will let the scout ask them from here)
 *   'anon'    — nothing cleared the gate at all
 *
 * Pure so the rule is testable without a cookie; the guard below wraps it.
 */
export type SignupWriteVerdict = 'ok' | 'sign-in' | 'parent' | 'anon';

export function verifiedSignupVerdict(
  audience: GateAudience | null,
  subjectKind: 'adult' | 'scout' | null
): SignupWriteVerdict {
  if (audience === null) return 'anon';
  if (audience === 'leader') return 'ok';
  if (audience === 'household') return subjectKind === 'adult' ? 'ok' : 'parent';
  return 'sign-in';
}

/**
 * The Server Action guard for every signup write. Same throw-if-not shape as
 * requireFamilyAccess(), which it replaces on those actions — and, like it,
 * spends the epoch/revocation read on the verified path.
 */
export async function requireVerifiedSignupAccess(): Promise<GateAudience> {
  const audience = await gateAudience();
  const session = audience === 'household' ? await getIdentitySessionIfValid() : null;
  return decideVerifiedSignupAccess(audience, session, (s) => isEpochCurrent(createAdminClient(), s));
}

/**
 * The guard's decision with its inputs injected — the cookie read and the
 * epoch DB read are the only things the wrapper above adds — so the
 * throw-or-pass behaviour is testable directly (qa-lead, 2026-08-26: the
 * revoked-session case is exactly the class of defect caught once before).
 */
export async function decideVerifiedSignupAccess(
  audience: GateAudience | null,
  session: IdentitySession | null,
  epochCurrent: (s: IdentitySession) => Promise<boolean>
): Promise<GateAudience> {
  const verdict = verifiedSignupVerdict(audience, session?.subjectKind ?? null);
  if (verdict === 'anon' || verdict === 'sign-in') throw new Error('Please sign in to sign up.');
  if (verdict === 'parent') throw new Error('A parent needs to sign in to do this.');
  if (audience === 'household') {
    if (!session || !(await epochCurrent(session))) {
      throw new Error('Your sign-in has been revoked — please sign in again.');
    }
  }
  return audience as GateAudience;
}

/**
 * Household scope (Patrick, 2026-08-27: "remove Change household entirely
 * except for superusers"). A verified adult signs up THEIR OWN household —
 * the `?household=` param and the posted householdKey are requests, never
 * authority. A superuser — a leader session, or a verified adult holding
 * `roster.manage` (the capability that already means "acts for other
 * families": send sign-in link, revoke, merge) — keeps the picker for the
 * phone-call case. Supersedes Family-Identity-Auth Phase 2's "(b) prefill"
 * over "(c) lock" for everyone else; the carpool/guardian case is now "text
 * a leader".
 *
 * Pure so the rule is testable without a cookie; the async wrappers below
 * add only the cookie and the capability read.
 */
export function householdSwitchAllowed(audience: GateAudience | null, holdsRosterManage: boolean): boolean {
  if (audience === 'leader') return true;
  return audience === 'household' && holdsRosterManage;
}

export function resolveWritableHouseholdKey(input: {
  requested: string;
  sessionHouseholdKey: string | null;
  canSwitch: boolean;
}): string {
  if (input.canSwitch) {
    if (!input.requested) throw new Error('Choose a household first.');
    return input.requested;
  }
  if (!input.sessionHouseholdKey) {
    throw new Error('There is no household on record for you yet — ask a leader to add you to one.');
  }
  if (input.requested && input.requested !== input.sessionHouseholdKey) {
    throw new Error('You can only sign up your own household.');
  }
  return input.sessionHouseholdKey;
}

/** May this request pick a household other than its own? One capability
 *  read at most; a leader session answers without it. */
export async function canSwitchHousehold(
  audience: GateAudience | null,
  session: IdentitySession | null
): Promise<boolean> {
  if (audience === 'leader') return true;
  if (audience !== 'household' || !session || session.subjectKind !== 'adult') return false;
  return hasCapability(createAdminClient(), session.personId, 'roster.manage', session.epoch);
}

/** The Server Action half: which household this write may touch. Call AFTER
 *  requireVerifiedSignupAccess() — that guard settles who may write at all;
 *  this settles for whom. Throws with a message fit to show. */
export async function requireWritableHouseholdKey(requested: string, audience: GateAudience): Promise<string> {
  const session = audience === 'household' ? await getIdentitySessionIfValid() : null;
  const canSwitch = await canSwitchHousehold(audience, session);
  return resolveWritableHouseholdKey({
    requested,
    sessionHouseholdKey: session?.householdKey ?? null,
    canSwitch
  });
}

/** True when the family password isn't configured on this server — the gate
 *  renders an explanatory message instead of an unusable form. */
export function familyGateConfigured(): boolean {
  return !!process.env.FAMILY_PASSWORD;
}

/** The full verified identity session, if the request carries one and its
 *  signature checks out — signature only, no epoch/revocation read (see
 *  gateAudience()'s cost-profile note). Null for every other audience,
 *  including an unsigned/expired/tampered identity cookie. */
export const getIdentitySessionIfValid = cache(async function getIdentitySessionIfValid(): Promise<IdentitySession | null> {
  const jar = await cookies();
  return verifyIdentitySession(jar.get(IDENTITY_COOKIE.name)?.value);
});

/**
 * Tier 2 guard (adult-only) — verified identity, subjectKind === 'adult',
 * AND session_epoch still current. This is where the epoch DB read actually
 * happens; call it from every Server Action that writes under Tier 2
 * (/profile edits) and from Tier 2 page loads, not from gateAudience().
 * Throws — same shape as requireFamilyAccess()/requireRole().
 */
export async function requireHouseholdIdentity(): Promise<IdentitySession> {
  const session = await getIdentitySessionIfValid();
  if (!session) throw new Error('Not authenticated');
  if (session.subjectKind !== 'adult') {
    throw new Error('This action requires a verified adult session.');
  }
  if (!(await isEpochCurrent(createAdminClient(), session))) {
    throw new Error('Your sign-in has been revoked — please sign in again.');
  }
  return session;
}

/**
 * Tier 2-S guard (scout-only) — the narrower grant a verified scout gets:
 * proof submission as themselves, nothing else. Same epoch spend as
 * requireHouseholdIdentity(), mirrored rather than shared so a future change
 * to one tier's rule can't silently affect the other.
 */
export async function requireVerifiedScoutIdentity(): Promise<IdentitySession> {
  const session = await getIdentitySessionIfValid();
  if (!session) throw new Error('Not authenticated');
  if (session.subjectKind !== 'scout') {
    throw new Error('This action requires a verified scout session.');
  }
  if (!(await isEpochCurrent(createAdminClient(), session))) {
    throw new Error('Your sign-in has been revoked — please sign in again.');
  }
  return session;
}
