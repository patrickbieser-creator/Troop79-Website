'use server';

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEADER_COOKIE, signSession, type SessionRole } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAuthorizedAdults, matchAuthorizedAdult } from '@/lib/authorized-adults';
import { safeInternalPath } from '@/lib/safe-redirect';

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
  // Only trust an explicit `next` (set by the proxy redirect when a protected
  // page bounced someone to login) — the fallback below depends on role,
  // which isn't known yet, so it's applied after the password match.
  const requestedNext = formData.get('next');
  const next = typeof requestedNext === 'string' && requestedNext ? requestedNext : null;
  const back = (error: string) =>
    redirect(`/admin/login?error=${error}&next=${encodeURIComponent(next ?? '/admin/advancement')}`);

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

  // Default landing differs by role — /admin/advancement is leader-only, so a
  // scout with no explicit `next` (the common case: visiting /admin/login
  // directly) would otherwise land straight on an access-denied error.
  const roleDefault = role === 'scout' ? '/admin/news/articles' : '/admin/advancement';

  // Defense-in-depth: only allow same-origin redirects. A startsWith('/')
  // check used to live here, which "/\evil.com" defeats — see lib/safe-redirect.ts.
  //
  // An explicit `next` isn't checked for role-appropriateness here (e.g. a
  // scout bounced from /admin/advancement/ledger keeps that as its target) —
  // that's intentionally left to proxy.ts, which re-validates role on the
  // very next request and redirects a scout session away from anything
  // outside SCOUT_ALLOWED_PREFIXES before the page ever renders.
  redirect(safeInternalPath(next ?? roleDefault, roleDefault));
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(LEADER_COOKIE.name);
  redirect('/admin/login');
}
