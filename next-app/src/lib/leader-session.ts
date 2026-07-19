/**
 * Stub "leader session" — a signed cookie that proves the bearer logged in
 * via /admin/login. NOT real authentication.
 *
 * Designed so we can swap in real Supabase Auth later without touching the
 * admin pages: replace this module + the login route, leave everything else.
 *
 * The HMAC/base64url machinery lives in lib/signed-cookie.ts, shared with
 * lib/family-session.ts. This module's public API is unchanged.
 */

import { signToken, verifyToken } from '@/lib/signed-cookie';

const COOKIE_NAME = 't79_leader_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type SessionRole = 'leader' | 'scout';

export interface LeaderSession {
  /** Username they typed at login (e.g. 'pbieser'). Used for display only. */
  leader: string;
  /** Issued-at timestamp, ms since epoch. */
  iat: number;
  /**
   * 'leader' | 'scout'. Missing on cookies issued before this field existed —
   * verifySession() defaults those to 'leader' so already-signed-in leaders
   * aren't logged out.
   */
  role: SessionRole;
}

export async function signSession(session: LeaderSession): Promise<string> {
  return signToken(session);
}

export async function verifySession(token: string | undefined): Promise<LeaderSession | null> {
  const parsed = (await verifyToken(token)) as Partial<LeaderSession> | null;
  if (!parsed) return null;
  if (typeof parsed.leader !== 'string' || typeof parsed.iat !== 'number') return null;
  // Cookies signed before `role` existed default to 'leader' (their only
  // possible role at the time) so existing sessions keep working.
  const role: SessionRole = parsed.role === 'scout' ? 'scout' : 'leader';
  return { leader: parsed.leader, iat: parsed.iat, role };
}

export const LEADER_COOKIE = {
  name: COOKIE_NAME,
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS
};
