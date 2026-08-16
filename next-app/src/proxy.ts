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
 * Also enforces the scout/leader boundary at the edge, not just per-page:
 * legacy scout sessions may only reach the News drafting surface (see
 * SCOUT_ALLOWED_PREFIXES below). This is defense-in-depth on top of the
 * requireRole()/requireCapability() checks already in each leader-only page
 * and Server Action — it exists so a *new* page can't accidentally ship
 * readable-by-scout just because nobody remembered to add the per-page
 * check (that's exactly how the advancement/* pages leaked before this).
 * Phase C deletes the list entirely by moving the scout-facing surfaces off
 * /admin, at which point this file reduces to "credential, or bounce."
 *
 * Next 16+ uses the "proxy" file convention (renamed from "middleware").
 */
import { NextResponse, type NextRequest } from 'next/server';
import { LEADER_COOKIE, verifySession } from './lib/leader-session';
import { IDENTITY_COOKIE, verifyIdentitySession } from './lib/identity-session';

const SCOUT_ALLOWED_PREFIXES = [
  '/admin/news/articles',
  '/admin/news/media-manager',
  // The calendar admin is NOT here. It briefly was — '/admin/news/calendar'
  // had been scout-visible for as long as it lived under News — but calendar
  // entries became leader-only to edit (Patrick, 2026-08-14), so a scout has no
  // business on that screen at all. Removing the prefix is the whole enforcement
  // at this layer; every write action behind it also requires 'leader'.
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

  // A verified identity cookie gets past the edge on signature alone. Whether
  // this person holds any capability — and whether their session_epoch is
  // still current — is settled by the workspace layout, which can afford the
  // query. An identity holder with no grants therefore reaches the layout and
  // is told so, rather than being bounced to a login they already completed.
  const identity = await verifyIdentitySession(req.cookies.get(IDENTITY_COOKIE.name)?.value);
  if (identity) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/:path*']
};
