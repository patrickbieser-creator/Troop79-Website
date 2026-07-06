/**
 * Server Action auth guard. Reads the stub session cookie and throws unless
 * its role is in `allowed` — same "throw if not authenticated" shape as the
 * `ensureLeader()` helper duplicated across advancement/*\/actions.ts, but
 * role-aware for features (like News) that scouts can partially access.
 *
 * Kept separate from lib/leader-session.ts, which stays framework-agnostic
 * (used by proxy.ts, the Edge middleware) — this helper needs next/headers'
 * cookies(), which only works in the Node/Server Action runtime.
 */

import { cookies } from 'next/headers';
import { LEADER_COOKIE, verifySession, type LeaderSession, type SessionRole } from '@/lib/leader-session';

export async function requireRole(allowed: SessionRole[]): Promise<LeaderSession> {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session) throw new Error('Not authenticated');
  if (!allowed.includes(session.role)) {
    throw new Error(`This action requires ${allowed.join(' or ')} access.`);
  }
  return session;
}
