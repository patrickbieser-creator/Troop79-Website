'use server';

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEADER_COOKIE, signSession } from '@/lib/leader-session';
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
 * Shared-password auth: LEADER_PASSWORD, and nothing else.
 *
 * SCOUT_PASSWORD was removed 2026-08-16
 * (Plans/Unified-Identity-And-Capabilities.md Phase C). No scout ever used it,
 * and keeping it was actively costly: the Phase B1 shim had to map a scout
 * session to `news.write`, which meant every News guard had to stay on
 * requireRole() or a shared-password holder would gain publish and delete.
 * Scouts contributing news is being rebuilt properly — verified identity, on
 * the public side, landing in review.
 *
 * Login requires the typed name to match the authorized-adults pool (see
 * lib/authorized-adults.ts) — this is what makes ledger_entries.entered_by a
 * trustworthy "who really did this" stamp rather than any string someone typed.
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

  if (!secretMatches(password, process.env.LEADER_PASSWORD)) {
    back('bad-password');
    return; // unreachable — redirect throws — but keeps TS happy
  }

  const adults = await loadAuthorizedAdults(createAdminClient());
  const matched = matchAuthorizedAdult(adults, username);
  if (!matched) back('bad-username');
  const leaderName = matched!.label;

  const token = await signSession({ leader: leaderName, iat: Date.now(), role: 'leader' });
  const jar = await cookies();
  jar.set(LEADER_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: LEADER_COOKIE.maxAgeSeconds
  });

  const roleDefault = '/admin/advancement';

  // Defense-in-depth: only allow same-origin redirects. A startsWith('/')
  // check used to live here, which "/\evil.com" defeats — see lib/safe-redirect.ts.
  //
  // An explicit `next` isn't checked for capability-appropriateness here —
  // that's left to the page's own guard, which re-checks on the
  // very next request and redirects a scout session away from anything
  // very next request, before the page renders anything.
  redirect(safeInternalPath(next ?? roleDefault, roleDefault));
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(LEADER_COOKIE.name);
  redirect('/admin/login');
}
