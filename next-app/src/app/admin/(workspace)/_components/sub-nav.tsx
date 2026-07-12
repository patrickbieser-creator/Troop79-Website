'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '../admin.module.css';

interface NavItem {
  label: string;
  href?: string;
  matchPath?: string;
  disabled?: boolean;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      {
        label: 'Dashboard',
        href: '/admin/advancement/dashboard',
        matchPath: '/admin/advancement/dashboard'
      }
    ]
  },
  {
    title: 'Entry',
    items: [
      {
        label: 'Fast Entry',
        href: '/admin/advancement/fast-entry',
        matchPath: '/admin/advancement/fast-entry'
      },
      { label: 'Event Roster', disabled: true }
    ]
  },
  {
    title: 'Planning',
    items: [
      {
        label: 'Meeting Plan',
        href: '/admin/advancement/meeting-plan',
        matchPath: '/admin/advancement/meeting-plan'
      }
    ]
  },
  {
    title: 'Records',
    items: [
      {
        label: 'Universal Ledger',
        href: '/admin/advancement/ledger',
        matchPath: '/admin/advancement/ledger'
      },
      {
        label: 'MB Progress',
        href: '/admin/advancement/mb-progress',
        matchPath: '/admin/advancement/mb-progress'
      },
      {
        label: 'Audits',
        href: '/admin/advancement/audits',
        matchPath: '/admin/advancement/audits'
      },
      { label: 'Court of Honor', disabled: true }
    ]
  },
  {
    title: 'News & Events',
    items: [
      {
        label: 'Articles',
        href: '/admin/news/articles',
        matchPath: '/admin/news/articles'
      },
      {
        label: 'Tags',
        href: '/admin/news/tags',
        matchPath: '/admin/news/tags'
      },
      {
        label: 'Media Manager',
        href: '/admin/news/media-manager',
        matchPath: '/admin/news/media-manager'
      },
      {
        label: 'Calendar',
        href: '/admin/news/calendar',
        matchPath: '/admin/news/calendar'
      }
    ]
  },
  {
    title: 'Output',
    items: [{ label: 'Scoutbook Export', disabled: true }]
  },
  {
    title: 'Setup',
    items: [
      {
        label: 'Lookups & Admin',
        href: '/admin/advancement/lookups',
        matchPath: '/admin/advancement/lookups'
      },
      {
        label: 'Utilities',
        href: '/admin/utilities',
        matchPath: '/admin/utilities'
      }
    ]
  }
];

export function SubNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.subNav} aria-label="Leader Workspace navigation">
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <div className={styles.subNavSection}>{section.title}</div>
          {section.items.map((item) =>
            item.disabled ? (
              <button
                key={item.label}
                type="button"
                className={`${styles.subNavBtn} ${styles.subNavBtnDisabled}`}
                disabled
              >
                {item.label}
                <span className={styles.soonTag}>Soon</span>
              </button>
            ) : (
              <Link
                key={item.label}
                href={item.href!}
                className={`${styles.subNavBtn} ${
                  pathname.startsWith(item.matchPath!) ? styles.subNavBtnActive : ''
                }`}
              >
                {item.label}
              </Link>
            )
          )}
        </div>
      ))}
    </nav>
  );
}
