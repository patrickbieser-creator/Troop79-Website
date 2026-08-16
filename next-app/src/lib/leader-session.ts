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

/**
 * Only 'leader' remains. The 'scout' role and SCOUT_PASSWORD were retired
 * 2026-08-16 (Plans/Unified-Identity-And-Capabilities.md Phase C) — the path
 * had never been used by a single scout, and keeping it forced every News
 * guard to stay on requireRole() to avoid the shim handing a shared-password
 * session publish rights. Scouts contributing news is not being dropped; it
 * is being rebuilt on verified identity, on the public side.
 */
export type SessionRole = 'leader';

export interface LeaderSession {
  /** Username they typed at login (e.g. 'pbieser'). Used for display only. */
  leader: string;
  /** Issued-at timestamp, ms since epoch. */
  iat: number;
  /** Always 'leader'. Retained as a field so existing cookies still parse. */
  role: SessionRole;
}

export async function signSession(session: LeaderSession): Promise<string> {
  return signToken(session);
}

export async function verifySession(token: string | undefined): Promise<LeaderSession | null> {
  const parsed = (await verifyToken(token)) as Partial<LeaderSession> | null;
  if (!parsed) return null;
  if (typeof parsed.leader !== 'string' || typeof parsed.iat !== 'number') return null;
  // An outstanding scout-role cookie is REJECTED, not silently upgraded to
  // 'leader' — that would turn retiring the role into a privilege escalation
  // for anyone still holding one. They get signed out instead. (Nobody does:
  // the scout login was never used, Patrick 2026-08-16.)
  // Compared as a string on purpose: SessionRole no longer contains 'scout',
  // so a typed comparison is a compile error rather than the runtime check
  // this needs to be.
  if ((parsed.role as string | undefined) === 'scout') return null;
  // Cookies signed before `role` existed default to 'leader' — their only
  // possible role at the time — so existing sessions keep working.
  return { leader: parsed.leader, iat: parsed.iat, role: 'leader' };
}

export const LEADER_COOKIE = {
  name: COOKIE_NAME,
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS
};
