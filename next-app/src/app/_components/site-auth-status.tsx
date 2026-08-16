'use client';

/**
 * Utility-bar login/logout control — replaces what used to be four separate,
 * always-visible items (Profile, Sign In, Members Login, Log Out) with one
 * that reflects actual session state (Patrick, 2026-08-06: "Profile should
 * not show up unless you're logged in... Logout should not appear unless
 * you're logged in. Consolidate all logins under member login. Having two
 * sign ins is confusing.").
 *
 * Logged out: a single "Member Login" link → /signin. (Leaders/scouts still
 * reach the shared-password login from a link on that page — see
 * signin/page.tsx — rather than a second nav entry point.)
 * Logged in: "Signed in as {label} · {Level}" (or just "· {Level}" when the
 * session carries no display name — the unverified family cookie), a
 * Profile link only for a verified adult (Tier 2 — the only audience
 * /profile is built for), and Log Out.
 *
 * Checks via a client-side fetch to /api/session-status rather than a
 * server-side cookies() read, so SiteNav (wrapping every public page)
 * doesn't force every one of them out of static/ISR rendering — see that
 * route's comment for the full story (caught in build output, 2026-08-06).
 * Same "starts blank, fills in after mount" shape as UtilityDate in this
 * same directory, for the same reason (server/client render must match).
 *
 * Re-checks on pathname change, window focus, AND a short poll — NOT just
 * on mount. A login form (e.g. /signin, /admin/login) redirects back to a
 * DIFFERENT path in the common case, but /profile's own flow can redirect to
 * the SAME path, and Next.js Server Actions only refresh the current
 * route's SERVER-rendered output — client components positioned inside an
 * unchanged shared layout (this one) are never remounted, so a mount-only
 * effect would miss that exact case (caught live testing the family flow,
 * 2026-08-06: logging in on /profile never made the old Log Out button
 * appear). The poll is the real backstop, since that's the only signal that
 * survives a same-URL redirect. (Deliberately NOT useSearchParams() here —
 * that hook requires a <Suspense> boundary or it fails the same
 * static-generation bail-out this component exists to avoid; pathname-only
 * is a fine trigger since the poll covers everything pathname can't.)
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logOutEverywhereAction } from './site-nav-actions';
import type { SessionStatus } from '@/app/api/session-status/route';

const POLL_MS = 4000;
const LINK_STYLE = {
  fontFamily: 'var(--font-ui)',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--navy)',
  letterSpacing: '.03em'
} as const;

export function SiteAuthStatus() {
  const pathname = usePathname();
  const [status, setStatus] = useState<SessionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    function check() {
      fetch('/api/session-status', { cache: 'no-store' })
        .then((res) => res.json())
        .then((data: SessionStatus) => {
          if (!cancelled) setStatus(data);
        })
        .catch(() => {
          // Network hiccup — leave the current state alone; the next poll
          // or trigger will catch up.
        });
    }
    check();
    const interval = setInterval(check, POLL_MS);
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, [pathname]);

  // Starts blank (status === null) and while logged out — nothing to render
  // until we know a session exists, same as the old Log Out button's shape.
  if (!status?.loggedIn) {
    return (
      <Link href="/signin" style={LINK_STYLE}>
        Member Login
      </Link>
    );
  }

  return (
    <>
      <span style={{ ...LINK_STYLE, fontWeight: 400, color: 'var(--text-meta)' }}>
        {status.label ? (
          <>
            Signed in as <strong style={{ color: 'var(--navy)' }}>{status.label}</strong>
          </>
        ) : (
          'Signed in'
        )}{' '}
        &middot; {status.level}
      </span>
      {status.canSubmitStory && (
        <Link href="/news/submit" style={LINK_STYLE}>
          Submit a Story
        </Link>
      )}
      {status.canViewProfile && (
        <Link href="/profile" style={LINK_STYLE}>
          Profile
        </Link>
      )}
      <form action={logOutEverywhereAction}>
        <input type="hidden" name="next" value={pathname} />
        <button
          type="submit"
          style={{
            ...LINK_STYLE,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 2
          }}
        >
          Log Out
        </button>
      </form>
    </>
  );
}
