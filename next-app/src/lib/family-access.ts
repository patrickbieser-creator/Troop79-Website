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

import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { FAMILY_COOKIE, verifyFamilySession } from '@/lib/family-session';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { IDENTITY_COOKIE, isEpochCurrent, verifyIdentitySession, type IdentitySession } from '@/lib/identity-session';

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
export async function gateAudience(): Promise<GateAudience | null> {
  const jar = await cookies();
  const admin = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (admin) return admin.role;
  const identity = await verifyIdentitySession(jar.get(IDENTITY_COOKIE.name)?.value);
  if (identity) return 'household';
  const family = await verifyFamilySession(jar.get(FAMILY_COOKIE.name)?.value);
  return family ? 'family' : null;
}

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

/** True when the family password isn't configured on this server — the gate
 *  renders an explanatory message instead of an unusable form. */
export function familyGateConfigured(): boolean {
  return !!process.env.FAMILY_PASSWORD;
}

/** The full verified identity session, if the request carries one and its
 *  signature checks out — signature only, no epoch/revocation read (see
 *  gateAudience()'s cost-profile note). Null for every other audience,
 *  including an unsigned/expired/tampered identity cookie. */
export async function getIdentitySessionIfValid(): Promise<IdentitySession | null> {
  const jar = await cookies();
  return verifyIdentitySession(jar.get(IDENTITY_COOKIE.name)?.value);
}

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
