'use client';

/**
 * Utility-bar "Log Out" — self-hides when nothing's logged in. Checks via a
 * client-side fetch to /api/session-status rather than a server-side
 * cookies() read, so SiteNav (wrapping every public page) doesn't force
 * every one of them out of static/ISR rendering — see that route's comment
 * for the full story (caught in build output, 2026-08-06). Same "starts
 * blank, fills in after mount" shape as UtilityDate in this same file's
 * sibling component, for the same reason (server/client render must match).
 *
 * Re-checks on pathname change, window focus, AND a short poll — NOT just
 * on mount. A login form (e.g. /profile's password gate) redirects back to
 * the SAME path, and Next.js Server Actions only refresh the current
 * route's SERVER-rendered output — client components positioned inside an
 * unchanged shared layout (this one) are never remounted, so a mount-only
 * effect would miss that exact case (caught live testing the family flow,
 * 2026-08-06: logging in on /profile never made this button appear). The
 * poll is the real backstop, since that's the only signal that survives a
 * same-URL redirect. (Deliberately NOT useSearchParams() here — that hook
 * requires a <Suspense> boundary or it fails the same static-generation
 * bail-out this component exists to avoid; pathname-only is a fine trigger
 * since the poll covers everything pathname can't.)
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { logOutEverywhereAction } from './site-nav-actions';

const POLL_MS = 4000;

export function SiteLogoutButton() {
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function check() {
      fetch('/api/session-status', { cache: 'no-store' })
        .then((res) => res.json())
        .then((data: { loggedIn?: boolean }) => {
          if (!cancelled) setLoggedIn(!!data.loggedIn);
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

  if (!loggedIn) return null;

  return (
    <form action={logOutEverywhereAction}>
      <input type="hidden" name="next" value={pathname} />
      <button
        type="submit"
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--navy)',
          letterSpacing: '.03em',
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
  );
}
