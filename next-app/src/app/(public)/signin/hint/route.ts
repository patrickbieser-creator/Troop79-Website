/**
 * /signin/hint — the intake for the Bugle's "Register Now" link
 * (Plans/Bugle-Register-Now-Links.md, decisions B1/B2/B5/B7).
 *
 *   GET /signin/hint?for=<recipient address>&next=/events/123/signup
 *
 * Reads the merged address ONCE, resolves it to the people it belongs to,
 * stores that result in the short-lived signed hint cookie, and 303s to the
 * clean `next` URL — so the address is in browser history and the request
 * log for exactly one hop, never in a rendered page.
 *
 * THIS GET SETS NO SESSION. Mail scanners and the newsletter's click tracker
 * prefetch links; the only cookie this can set is the hint, which grants
 * nothing but a shortcut to "Email me a code". The guard test
 * (tests/signin-hint-guards.test.ts) pins that.
 *
 * A signed-in adult or a leader is simply sent on (B5: proceed as the
 * session holder — dad's session, mom's newsletter on the shared iPad). A
 * scout session does NOT short-circuit: the newsletter went to the parent,
 * and the event page will offer the parent's sign-in over the scout's.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { safeInternalPath } from '@/lib/safe-redirect';
import { IDENTITY_COOKIE, verifyIdentitySession } from '@/lib/identity-session';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { recordLoginEvent } from '@/lib/login-events';
import {
  HINT_COOKIE,
  buildSignInHint,
  hintCookieOptions,
  hintRateLimitExceeded,
  normaliseHintAddress,
  signSignInHint
} from '@/lib/signin-hint';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const next = safeInternalPath(params.get('next'), '/signin');
  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), 303);

  const [leader, identity] = await Promise.all([
    verifySession(req.cookies.get(LEADER_COOKIE.name)?.value),
    verifyIdentitySession(req.cookies.get(IDENTITY_COOKIE.name)?.value)
  ]);
  if (leader || identity?.subjectKind === 'adult') return res;

  const address = normaliseHintAddress(params.get('for'));
  if (!address) return res;

  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : null;
  const supabase = createAdminClient();

  // Over the cap the hint is silently ignored — the page renders exactly as
  // it would for a plain link, so the limiter itself is not an oracle.
  if (await hintRateLimitExceeded(supabase, ip)) return res;

  const hint = await buildSignInHint(supabase, address);
  if (!hint) {
    // The row the limiter counts and the failed-logins list shows. Never
    // throws (recordLoginEvent swallows), never changes the redirect.
    await recordLoginEvent(supabase, {
      personId: null,
      method: 'hint',
      success: false,
      failureReason: 'hint-unknown',
      userAgent: req.headers.get('user-agent'),
      ip
    });
    return res;
  }

  res.cookies.set(HINT_COOKIE.name, await signSignInHint(hint), hintCookieOptions());
  return res;
}
