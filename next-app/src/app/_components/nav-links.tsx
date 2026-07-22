'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './site-nav.module.css';

const LINKS: { href: string; label: string }[] = [
  { href: '/', label: 'Home' },
  { href: '/meetings', label: 'Meetings' },
  { href: '/events', label: 'Calendar' },
  { href: '/photos', label: 'Photos' },
  { href: '/advancement', label: 'Advancement' },
  { href: '/library', label: 'Library' },
  { href: '/about', label: 'About' }
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    // Layout + responsive sizing live in site-nav.module.css (the strip
    // scrolls sideways on phones); only the active-state colors stay inline.
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
              style={{
                color: active ? 'var(--navy)' : 'var(--text-head)',
                borderBottom: `3px solid ${active ? 'var(--navy)' : 'transparent'}`
              }}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
