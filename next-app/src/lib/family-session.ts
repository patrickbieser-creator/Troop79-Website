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
 * ACCEPTED RISK (Plans/Event-Signup.md): this proves the bearer knows the
 * troop password — it does NOT bind the session to a household, so any holder
 * could edit another family's signup. Accepted for a ~25-family trusted troop
 * and mitigated by the entered_by/updated_by audit columns; per-family magic
 * links are the Phase 4 fix. Do not treat this cookie as identity.
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
