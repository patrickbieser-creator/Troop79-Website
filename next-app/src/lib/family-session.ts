/**
 * Family gate session — the shared-troop-password cookie that lets a family
 * see and submit event signups. Deliberately SEPARATE from the leader/scout
 * admin session (lib/leader-session.ts):
 *
 *   * its own cookie (`t79_family_session`), so signing out of admin doesn't
 *     sign a family out, and vice versa;
 *   * its own password (FAMILY_PASSWORD), so the family password can be
 *     printed in the Bugle and rotated without touching admin access.
 *
 * ACCEPTED RISK (Plans/Event-Signup.md), CLOSED for /profile and
 * /library/submit-proof, DELIBERATELY KEPT for Event Signup itself
 * (Plans/Family-Identity-Auth.md Phase 2, 2026-08-06): this proves the
 * bearer knows the troop password — it does NOT bind the session to a
 * household, so any holder could edit another family's signup. That risk
 * inherited into two features it was never evaluated for (D-055's
 * change_requests, then Resource Library proof submission) — both now
 * require a verified Tier 2/2-S identity session (lib/identity-session.ts)
 * instead. Event Signup keeps this cookie on purpose: a mis-signup is
 * correctable and audited (entered_by/updated_by, now also
 * entered_by_person_id/updated_by_person_id for a verified submitter), and
 * locking signup to "your own household only" would be a capability
 * regression — a parent covering a carpool, a leader signing up a family who
 * called them, etc. are all legitimate today. A verified session now skips
 * re-challenging here too (gateAudience() returns 'household' for one,
 * which satisfies hasFamilyAccess() same as this cookie does) and prefills
 * the household picker — see events/[id]/page.tsx. Do not treat THIS cookie
 * as identity; a verified session is the one that actually is.
 */

import { signToken, verifyToken } from '@/lib/signed-cookie';

const COOKIE_NAME = 't79_family_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 120; // 120 days — spans a season

export interface FamilySession {
  /** Always 'family'. Present so a leader cookie can never verify as one. */
  role: 'family';
  /** Issued-at timestamp, ms since epoch. */
  iat: number;
}

export async function signFamilySession(session: FamilySession): Promise<string> {
  return signToken(session);
}

export async function verifyFamilySession(
  token: string | undefined
): Promise<FamilySession | null> {
  const parsed = (await verifyToken(token)) as Partial<FamilySession> | null;
  if (!parsed) return null;
  // The role check matters: both cookies are signed with the same key, so
  // without it a leader token replayed into the family cookie would verify.
  if (parsed.role !== 'family' || typeof parsed.iat !== 'number') return null;
  return { role: 'family', iat: parsed.iat };
}

export const FAMILY_COOKIE = {
  name: COOKIE_NAME,
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS
};
