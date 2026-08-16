/**
 * Gates /admin/* behind either admin credential. Unauthenticated requests are
 * redirected to /admin/login with the original path preserved as ?next=.
 *
 * TWO COOKIES REACH HERE (Plans/Unified-Identity-And-Capabilities.md Phase B):
 * the legacy `t79_leader_session`, and `t79_identity` for a verified person
 * who holds capabilities. This file checks SIGNATURES ONLY — it runs in the
 * Edge runtime on every /admin request, and the capability lookup is a
 * database read. That read happens once per page load in the workspace
 * layout instead, which is where an identity session holding zero
 * capabilities is actually turned away.
 *
 * So the contract is deliberately split:
 *   - proxy (here):  "does this request carry a credential at all?"  — crypto
 *   - layout:        "does this person hold any capability?"          — one query
 *   - page/action:   "does this person hold THIS capability?"         — same query
 *
 * SCOUT_ALLOWED_PREFIXES IS GONE (Phase C, 2026-08-16). It was an
 * allowlist of paths a shared-password scout session could reach — a
 * deny-by-omission list whose own comment recorded that the advancement/*
 * pages had once leaked through it. No scout ever used that login, and
 * keeping it forced every News guard to stay on requireRole(). Deleting the
 * role deleted the bug class with it: this file no longer has a partial-access
 * tier to enforce, and per-page capability checks are the only authority.
 *
 * Next 16+ uses the "proxy" file convention (renamed from "middleware").
 */
import { NextResponse, type NextRequest } from 'next/server';
import { LEADER_COOKIE, verifySession } from './lib/leader-session';
import { IDENTITY_COOKIE, verifyIdentitySession } from './lib/identity-session';

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // /admin/login itself is always reachable.
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return NextResponse.next();
  }

  if (await verifySession(req.cookies.get(LEADER_COOKIE.name)?.value)) {
    return NextResponse.next();
  }

  // A verified identity cookie gets past the edge on signature alone. Whether
  // this person holds any capability — and whether their session_epoch is
  // still current — is settled by the workspace layout, which can afford the
  // query. An identity holder with no grants therefore reaches the layout and
  // is told so, rather than being bounced to a login they already completed.
  if (await verifyIdentitySession(req.cookies.get(IDENTITY_COOKIE.name)?.value)) {
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
