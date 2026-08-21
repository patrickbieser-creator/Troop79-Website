'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './site-nav.module.css';

const LINKS: { href: string; label: string }[] = [
  // Meetings lost its own tab in the calendar unification: a meeting is a
  // calendar entry now, reached at /events/[id] like everything else on a date.
  { href: '/', label: 'Home' },
  { href: '/news', label: 'News & Events' },
  { href: '/events', label: 'Calendar' },
  { href: '/photos', label: 'Photos' },
  { href: '/advancement', label: 'Advancement' },
  { href: '/library', label: 'Library' },
  { href: '/about', label: 'About' },
  // ALWAYS shown, signed in or not (Patrick, 2026-08-16). /member is the
  // site's front door for signing in — it dead-ends in a sign-in prompt for a
  // visitor, which is exactly what makes it discoverable. A link that only
  // appears once you are already signed in cannot be how you sign in.
  { href: '/member', label: 'Members' }
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    // All styling lives in site-nav.module.css; the active state is styled
    // via .link[aria-current='page'], so the a11y attribute is the only hook.
    <ul className={styles.links}>
      {LINKS.map((l) => {
        const active =
          l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={styles.link}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
