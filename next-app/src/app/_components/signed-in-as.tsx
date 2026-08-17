'use client';

/**
 * "Signed in as Patrick B. · Family" in the utility bar.
 *
 * No sign-in link and no sign-out button (Patrick, 2026-08-16) — both moved
 * to /member, the site's single front door for authentication. What stays is
 * the one thing a person still wants from the top of the page: confirmation
 * of who the site thinks they are, and therefore whose information they are
 * looking at.
 *
 * The name itself links to /member, which is where you go to act on any of
 * that — including signing out. Linking the name rather than adding a
 * separate control keeps the bar to one item while making the obvious click
 * do the obvious thing.
 *
 * Renders nothing at all when signed out. A "you are not signed in" notice on
 * every public page would be noise for the visitors those pages exist for.
 */

import Link from 'next/link';
import { useSessionStatus } from './use-session-status';

export function SignedInAs() {
  const status = useSessionStatus();
  if (!status?.loggedIn) return null;

  return (
    <Link
      href="/member"
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 11,
        letterSpacing: '.04em',
        color: 'var(--text-meta)',
        textDecoration: 'none'
      }}
    >
      {status.label ? (
        <>
          Signed in as <strong style={{ color: 'var(--navy)' }}>{status.label}</strong>
        </>
      ) : (
        'Signed in'
      )}
      {status.level ? <> &middot; {status.level}</> : null}
    </Link>
  );
}
