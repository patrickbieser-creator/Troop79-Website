'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IS_DEV_DB } from '@/lib/dev-db';
import type { SessionRole } from '@/lib/leader-session';
import styles from '../admin.module.css';

interface NavItem {
  label: string;
  href?: string;
  matchPath?: string;
  disabled?: boolean;
  /** Scout-role sessions can only reach the News drafting surface — see
   *  SCOUT_ALLOWED_PREFIXES in proxy.ts, which this list must stay in sync
   *  with. Everything else defaults to leader-only. */
  scoutVisible?: boolean;
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
      {
        label: 'Event Rosters',
        href: '/admin/rosters',
        matchPath: '/admin/rosters'
      }
    ]
  },
  {
    title: 'Planning',
    items: [
      {
        label: 'Meeting Plan',
        href: '/admin/advancement/meeting-plan',
        matchPath: '/admin/advancement/meeting-plan'
      },
      {
        label: 'Meetings',
        href: '/admin/advancement/meetings',
        matchPath: '/admin/advancement/meetings'
      },
      {
        label: 'Has/Needs Tool',
        href: '/admin/advancement/has-needs',
        matchPath: '/admin/advancement/has-needs',
        scoutVisible: true
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
        label: 'Submit & Present',
        href: '/admin/advancement/records',
        matchPath: '/admin/advancement/records'
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
      {
        label: 'Roster',
        href: '/admin/advancement/roster',
        matchPath: '/admin/advancement/roster'
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
        matchPath: '/admin/news/articles',
        scoutVisible: true
      },
      {
        label: 'Media Manager',
        href: '/admin/news/media-manager',
        matchPath: '/admin/news/media-manager',
        scoutVisible: true
      },
      {
        label: 'Calendar',
        href: '/admin/news/calendar',
        matchPath: '/admin/news/calendar',
        scoutVisible: true
      },
      {
        label: 'Event Signups',
        href: '/admin/events',
        matchPath: '/admin/events'
      },
      {
        label: 'Photo Albums',
        href: '/admin/news/photo-albums',
        matchPath: '/admin/news/photo-albums',
        scoutVisible: true
      }
    ]
  },
  {
    title: 'Output',
    items: [
      {
        label: 'Scoutbook Export',
        href: '/admin/advancement/scoutbook-export',
        matchPath: '/admin/advancement/scoutbook-export'
      }
    ]
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
        matchPath: '/admin/utilities',
        scoutVisible: true
      }
    ]
  }
];

export function SubNav({ role }: { role: SessionRole }) {
  const pathname = usePathname();
  const visibleSections =
    role === 'leader'
      ? SECTIONS
      : SECTIONS.map((section) => ({
          ...section,
          items: section.items.filter((item) => item.scoutVisible)
        })).filter((section) => section.items.length > 0);

  return (
    <nav
      className={`${styles.subNav} ${IS_DEV_DB ? styles.subNavDevDb : ''}`}
      aria-label="Leader Workspace navigation"
    >
      {visibleSections.map((section) => (
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
