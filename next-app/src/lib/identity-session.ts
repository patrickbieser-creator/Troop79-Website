/**
 * Verified per-person identity — a FOURTH session type on signed-cookie.ts,
 * alongside leader/family/profile-household (Plans/Family-Identity-Auth.md
 * Phase 1). Set only by redeeming a login_tokens challenge
 * (lib/identity-challenge.ts) — never self-asserted like
 * lib/profile-household-session.ts's cookie, which this one supersedes as
 * the trust source for anything that writes real data on a family's behalf.
 *
 * Two things are load-bearing about this payload, for two different reasons:
 *
 *   - `role: 'identity'` — same reason family-session.ts's `role: 'family'`
 *     is load-bearing: every cookie type here shares LEADER_SESSION_SECRET,
 *     so without a discriminator a leader token replayed into this cookie
 *     would verify. verifyIdentitySession() rejects anything that isn't
 *     exactly 'identity'.
 *   - `subjectKind: 'adult' | 'scout'` — the ONLY thing separating Tier 2-S
 *     (proof submission as yourself, nothing else) from Tier 2 (a household's
 *     full self-service surface). verifyIdentitySession() rejects anything
 *     that isn't exactly one of these two literals rather than trusting it
 *     where it's read — the same defense-in-depth reasoning proxy.ts already
 *     applies to SCOUT_ALLOWED_PREFIXES ("that's exactly how the
 *     advancement/* pages leaked before this").
 *
 * EPOCH CHECKS COST A QUERY, SO THEY ARE SPENT DELIBERATELY.
 * verifyIdentitySession() is pure crypto by default — same cost profile as
 * gateAudience() today. The session_epoch comparison (the actual revocation
 * check) is a SEPARATE call (isEpochCurrent()), run only on (a) Tier 2 page
 * loads and (b) every Server Action that writes. A revoked session may
 * therefore still render one cached read; it can never write. That tradeoff
 * is the whole reason session_epoch beats a sessions table, and callers must
 * call isEpochCurrent() themselves wherever it matters — verifying the
 * signature alone does NOT mean the session hasn't been revoked.
 */

import { signToken, verifyToken } from '@/lib/signed-cookie';
import type { SupabaseClient } from '@supabase/supabase-js';

export type IdentitySubjectKind = 'adult' | 'scout';

export interface IdentitySession {
  role: 'identity';
  subjectKind: IdentitySubjectKind;
  /** people.id — the real, verified identity. */
  personId: number;
  /** households.Household['key'] (households.ts) — same key space as the
   *  rest of the app's household pickers. */
  householdKey: string;
  /** Display name at verification time — cosmetic only ("Signed in as Dana
   *  R."); re-resolve from the DB for anything that matters. */
  displayName: string;
  /** session_epoch at issuance — compared against the live value by
   *  isEpochCurrent(), not here. */
  epoch: number;
  /** Issued-at timestamp, ms since epoch. */
  iat: number;
}

const COOKIE_NAME = 't79_identity';
const ADULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 120; // 120 days
/**
 * Scouts get 30 days, not 120 (Open Question 5, resolved 2026-08-16).
 *
 * A scout signs in from a shared school Chromebook far more often than a
 * parent signs in from a shared anything. The grant behind a scout session is
 * also narrower — no PII, no household demographics — so the cost of asking
 * them to re-verify is small, and at 94% scout phone coverage it is a
 * 20-second text. Revocation remains the real safety lever (D-005); this just
 * shortens the window for the population most likely to leave a session
 * behind on someone else's machine.
 */
const SCOUT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function sessionMaxAgeFor(subjectKind: IdentitySubjectKind): number {
  return subjectKind === 'scout' ? SCOUT_MAX_AGE_SECONDS : ADULT_MAX_AGE_SECONDS;
}

export const IDENTITY_COOKIE = {
  name: COOKIE_NAME,
  /** Adult default. Use sessionMaxAgeFor() when issuing — a scout gets less. */
  maxAgeSeconds: ADULT_MAX_AGE_SECONDS
};

export async function signIdentitySession(session: Omit<IdentitySession, 'role'>): Promise<string> {
  return signToken({ role: 'identity', ...session });
}

export async function verifyIdentitySession(token: string | undefined): Promise<IdentitySession | null> {
  const parsed = (await verifyToken(token)) as Partial<IdentitySession> | null;
  if (!parsed) return null;
  if (
    parsed.role !== 'identity' ||
    (parsed.subjectKind !== 'adult' && parsed.subjectKind !== 'scout') ||
    typeof parsed.personId !== 'number' ||
    typeof parsed.householdKey !== 'string' ||
    typeof parsed.displayName !== 'string' ||
    typeof parsed.epoch !== 'number' ||
    typeof parsed.iat !== 'number'
  ) {
    return null;
  }
  return {
    role: 'identity',
    subjectKind: parsed.subjectKind,
    personId: parsed.personId,
    householdKey: parsed.householdKey,
    displayName: parsed.displayName,
    epoch: parsed.epoch,
    iat: parsed.iat
  };
}

/**
 * The actual revocation check — a live DB read, spent only where it matters
 * (see module header). A leader bumping session_epoch (roster deactivation,
 * or the explicit revoke in Phase 3) takes effect here, not at signature
 * verification, which never changes for an already-issued token.
 */
export async function isEpochCurrent(supabase: SupabaseClient, session: IdentitySession): Promise<boolean> {
  const { data } = await supabase
    .from('people')
    .select('session_epoch')
    .eq('id', session.personId)
    .maybeSingle();
  if (!data) return false;
  return (data as { session_epoch: number }).session_epoch === session.epoch;
}

/**
 * Which household key a gated page should treat as "selected" — Event
 * Signup's verified-visitor prefill (Plans/Family-Identity-Auth.md Phase 2,
 * decision "(b) Prefill", adopted over "(c) Lock" — locking was rejected as
 * a capability regression: a parent covering a carpool, a leader signing up
 * a family who called them, etc. all stay legitimate).
 *
 * `paramValue === undefined` means the URL never named a household at all
 * (a first visit) — a verified session's own household prefills. Anything
 * else, INCLUDING an explicit empty string, means a household was already
 * named or deliberately cleared (Event Signup's "Not you? Change" link sets
 * `?household=` empty on purpose) — the prefill must never win that back,
 * or "switching" would silently stop being possible.
 */
export function resolveEffectiveHouseholdKey(
  paramValue: string | undefined,
  verifiedHouseholdKey: string | null
): string | undefined {
  if (paramValue !== undefined) return paramValue || undefined;
  return verifiedHouseholdKey ?? undefined;
}
