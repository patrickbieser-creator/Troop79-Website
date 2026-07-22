'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
    <ul
      style={{
        display: 'flex',
        listStyle: 'none',
        gap: 0,
        margin: 0,
        padding: 0
      }}
    >
      {LINKS.map((l) => {
        const active =
          l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'block',
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
                fontWeight: 600,
                color: active ? 'var(--navy)' : 'var(--text-head)',
                padding: '14px 16px',
                borderBottom: `3px solid ${active ? 'var(--navy)' : 'transparent'}`,
                letterSpacing: '.02em',
                transition: 'color .18s ease, border-color .18s ease'
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
