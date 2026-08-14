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
        // Roll Call deliberately keeps its own route: taking attendance is a
        // data-entry session, not editing, so it does not fold into the
        // Calendar workbench. Meetings are CREATED on the calendar entry.
        label: 'Roll Call & Agendas',
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
      // Ordered by what a content editor reaches for, not by URL shape: the two
      // places things are published (News, Calendar), then the library, then the
      // two asset managers that support them.
      {
        label: 'News',
        href: '/admin/news/articles',
        matchPath: '/admin/news/articles',
        scoutVisible: true
      },
      {
        /*
         * One Calendar destination, replacing the Events / Event Signups /
         * Meetings triple that all described the same act — "something happens
         * on a date". Signup building and agenda editing are panels on the
         * entry now, reached from the workbench at /admin/calendar/[entryId].
         *
         * Leader-only. Calendar entries are not a scout drafting surface the
         * way News posts are (Patrick, 2026-08-14) — so unlike the Events screen
         * this replaced, it carries no scoutVisible flag, and the matching
         * prefix is absent from SCOUT_ALLOWED_PREFIXES in proxy.ts. Those two
         * must stay in sync.
         */
        label: 'Calendar',
        href: '/admin/calendar',
        matchPath: '/admin/calendar'
      },
      {
        label: 'Resource Library',
        href: '/admin/library',
        matchPath: '/admin/library'
      },
      {
        label: 'Media Manager',
        href: '/admin/news/media-manager',
        matchPath: '/admin/news/media-manager',
        scoutVisible: true
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
        label: 'Roster Import',
        href: '/admin/advancement/roster-import',
        matchPath: '/admin/advancement/roster-import'
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
