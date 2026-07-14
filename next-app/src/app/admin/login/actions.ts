'use server';

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEADER_COOKIE, signSession, type SessionRole } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAuthorizedAdults, matchAuthorizedAdult } from '@/lib/authorized-adults';

/** Constant-time string compare (length leak is fine for a shared secret). */
function secretMatches(input: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Shared-password auth: LEADER_PASSWORD grants the leader role,
 * SCOUT_PASSWORD (optional) grants the scout role. The matched password
 * determines the role — there is no role picker to talk your way past.
 * Per-user Supabase Auth remains the Phase 4 replacement for this.
 *
 * The leader role additionally requires the typed name to match the
 * authorized-adults pool (see lib/authorized-adults.ts) — this is what makes
 * ledger_entries.entered_by a trustworthy "who really did this" stamp rather
 * than any string someone typed. Scout logins keep free-text names; they
 * aren't part of that pool.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/admin/advancement') || '/admin/advancement';
  const back = (error: string) =>
    redirect(`/admin/login?error=${error}&next=${encodeURIComponent(next)}`);

  if (!username) back('missing-username');
  if (!password) back('missing-password');
  if (!process.env.LEADER_PASSWORD) back('not-configured');

  let role: SessionRole;
  if (secretMatches(password, process.env.LEADER_PASSWORD)) {
    role = 'leader';
  } else if (secretMatches(password, process.env.SCOUT_PASSWORD)) {
    role = 'scout';
  } else {
    back('bad-password');
    return; // unreachable — redirect throws — but keeps TS happy
  }

  let leaderName = username;
  if (role === 'leader') {
    const adults = await loadAuthorizedAdults(createAdminClient());
    const matched = matchAuthorizedAdult(adults, username);
    if (!matched) back('bad-username');
    leaderName = matched!.label;
  }

  const token = await signSession({ leader: leaderName, iat: Date.now(), role });
  const jar = await cookies();
  jar.set(LEADER_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: LEADER_COOKIE.maxAgeSeconds
  });

  // Defense-in-depth: only allow same-origin redirects.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/admin/advancement';
  redirect(safeNext);
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(LEADER_COOKIE.name);
  redirect('/admin/login');
}
