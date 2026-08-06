/**
 * "Is any session cookie set" for the public nav's Log Out button
 * (site-logout-button.tsx). Deliberately a Route Handler fetched client-side
 * rather than a cookies() read inside SiteNav itself — SiteNav wraps EVERY
 * public page via (public)/layout.tsx, and Next bails a whole route out of
 * static/ISR generation the moment anything in its render tree calls
 * cookies()/headers(). That broke /about, /events, /join, /meeting-plan,
 * /meetings, and /photos (the last two losing their 30-minute ISR caching)
 * the first time this was tried (caught in build output, 2026-08-06) — see
 * D-040 for why this codebase already treats "accidentally-dynamic-content-
 * rendered-as-static" as a bug class, but the fix there was the opposite
 * direction (force dynamic where content needs to be fresh); here the goal
 * is the reverse — keep genuinely static pages static while a small,
 * independent, always-dynamic endpoint carries the one bit of session state
 * the UI needs.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { FAMILY_COOKIE, verifyFamilySession } from '@/lib/family-session';

export async function GET() {
  const jar = await cookies();
  const [leaderSession, familySession] = await Promise.all([
    verifySession(jar.get(LEADER_COOKIE.name)?.value),
    verifyFamilySession(jar.get(FAMILY_COOKIE.name)?.value)
  ]);
  return NextResponse.json(
    { loggedIn: !!leaderSession || !!familySession },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
