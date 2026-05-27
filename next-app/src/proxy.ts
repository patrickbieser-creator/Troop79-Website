/**
 * Gates /admin/* behind the stub leader-session cookie. Unauthenticated
 * requests are redirected to /admin/login with the original path preserved
 * as ?next=.
 *
 * Real Supabase Auth slots in here later: replace the verifySession() check
 * with a call to supabase.auth.getUser() (via @supabase/ssr in the edge
 * runtime) and require a 'leader' role/claim.
 *
 * Next 16+ uses the "proxy" file convention (renamed from "middleware").
 */
import { NextResponse, type NextRequest } from 'next/server';
import { LEADER_COOKIE, verifySession } from './lib/leader-session';

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // /admin/login itself is always reachable.
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return NextResponse.next();
  }

  const token = req.cookies.get(LEADER_COOKIE.name)?.value;
  const session = await verifySession(token);
  if (session) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/:path*']
};
