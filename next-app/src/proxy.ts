/**
 * Gates /admin/* behind the stub leader-session cookie. Unauthenticated
 * requests are redirected to /admin/login with the original path preserved
 * as ?next=.
 *
 * Also enforces the scout/leader boundary at the edge, not just per-page:
 * scout sessions may only reach the News drafting surface (see
 * SCOUT_ALLOWED_PREFIXES below). This is defense-in-depth on top of the
 * requireRole()/ensureLeader() checks already in each leader-only page and
 * Server Action — it exists so a *new* page can't accidentally ship
 * readable-by-scout just because nobody remembered to add the per-page
 * check (that's exactly how the advancement/* pages leaked before this).
 *
 * Real Supabase Auth slots in here later: replace the verifySession() check
 * with a call to supabase.auth.getUser() (via @supabase/ssr in the edge
 * runtime) and require a 'leader' role/claim.
 *
 * Next 16+ uses the "proxy" file convention (renamed from "middleware").
 */
import { NextResponse, type NextRequest } from 'next/server';
import { LEADER_COOKIE, verifySession } from './lib/leader-session';

const SCOUT_ALLOWED_PREFIXES = [
  '/admin/news/articles',
  '/admin/news/media-manager',
  '/admin/news/calendar',
  '/admin/news/photo-albums',
  '/admin/utilities',
  '/admin/advancement/has-needs'
];
const SCOUT_LANDING = '/admin/news/articles';

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // /admin/login itself is always reachable.
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return NextResponse.next();
  }

  const token = req.cookies.get(LEADER_COOKIE.name)?.value;
  const session = await verifySession(token);
  if (session) {
    if (session.role === 'scout' && !SCOUT_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))) {
      const scoutUrl = req.nextUrl.clone();
      scoutUrl.pathname = SCOUT_LANDING;
      scoutUrl.search = '';
      return NextResponse.redirect(scoutUrl);
    }
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/:path*']
};
