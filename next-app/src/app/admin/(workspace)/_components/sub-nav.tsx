'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IS_DEV_DB } from '@/lib/dev-db';
import type { Capability } from '@/lib/capabilities';
import styles from '../admin.module.css';

interface NavItem {
  label: string;
  href?: string;
  matchPath?: string;
  disabled?: boolean;
  /**
   * The capability this surface's pages require. Must match the
   * requireCapability() call in the page and its actions — this list is a
   * convenience for the reader, not the security boundary.
   *
   * Every live item now has one (Phase B2 completed 2026-08-16). Absent means
   * a partially-granted person will not see the item, which is the right
   * default for anything unbuilt or unconverted: better a missing link than
   * one that throws.
   */
  capability?: Capability;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      {
        label: 'Dashboard',
        href: '/admin/advancement/dashboard',
        matchPath: '/admin/advancement/dashboard',
        capability: 'advancement.write'
      }
    ]
  },
  {
    title: 'Entry',
    items: [
      {
        label: 'Fast Entry',
        href: '/admin/advancement/fast-entry',
        matchPath: '/admin/advancement/fast-entry',
        capability: 'advancement.write'
      },
      {
        label: 'Event Rosters',
        href: '/admin/rosters',
        matchPath: '/admin/rosters',
        capability: 'calendar.write'
      }
    ]
  },
  {
    title: 'Planning',
    items: [
      {
        label: 'Meeting Plan',
        href: '/admin/advancement/meeting-plan',
        matchPath: '/admin/advancement/meeting-plan',
        capability: 'meeting_plan.use'
      },
      {
        // Roll Call deliberately keeps its own route: taking attendance is a
        // data-entry session, not editing, so it does not fold into the
        // Calendar workbench. Meetings are CREATED on the calendar entry.
        label: 'Roll Call & Agendas',
        href: '/admin/advancement/meetings',
        matchPath: '/admin/advancement/meetings',
        capability: 'advancement.write'
      },
      {
        label: 'Has/Needs Tool',
        href: '/admin/advancement/has-needs',
        matchPath: '/admin/advancement/has-needs',
        capability: 'advancement.write'
      }
    ]
  },
  {
    title: 'Records',
    items: [
      {
        label: 'Universal Ledger',
        href: '/admin/advancement/ledger',
        matchPath: '/admin/advancement/ledger',
        capability: 'advancement.write'
      },
      {
        label: 'Submit & Present',
        href: '/admin/advancement/records',
        matchPath: '/admin/advancement/records',
        capability: 'advancement.write'
      },
      {
        label: 'MB Progress',
        href: '/admin/advancement/mb-progress',
        matchPath: '/admin/advancement/mb-progress',
        capability: 'advancement.write'
      },
      {
        label: 'Audits',
        href: '/admin/advancement/audits',
        matchPath: '/admin/advancement/audits',
        capability: 'advancement.write'
      },
      {
        label: 'Weekly Advancement Report',
        href: '/admin/advancement/report',
        matchPath: '/admin/advancement/report',
        capability: 'advancement.write'
      },
      {
        label: 'Roster',
        href: '/admin/advancement/roster',
        matchPath: '/admin/advancement/roster',
        capability: 'roster.manage'
      },
      {
        label: 'Court of Honor',
        href: '/admin/advancement/court-of-honor',
        matchPath: '/admin/advancement/court-of-honor',
        capability: 'advancement.write'
      }
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
        capability: 'news.write'
      },
      {
        /*
         * One Calendar destination, replacing the Events / Event Signups /
         * Meetings triple that all described the same act — "something happens
         * on a date". Signup building and agenda editing are panels on the
         * entry now, reached from the workbench at /admin/calendar/[entryId].
         *
         * Gated on calendar.write. Editing calendar entries was made
         * leader-only in 2026-08-14; the shared-password scout tier that
         * distinction was drawn against no longer exists at all (Phase C).
         */
        label: 'Calendar',
        href: '/admin/calendar',
        matchPath: '/admin/calendar',
        capability: 'calendar.write'
      },
      {
        label: 'Resource Library',
        href: '/admin/library',
        matchPath: '/admin/library',
        capability: 'library.moderate'
      },
      {
        label: 'Media Manager',
        href: '/admin/news/media-manager',
        matchPath: '/admin/news/media-manager',
        capability: 'news.write'
      },
      {
        label: 'Photo Albums',
        href: '/admin/news/photo-albums',
        matchPath: '/admin/news/photo-albums',
        capability: 'news.write'
      }
    ]
  },
  {
    title: 'Finance',
    items: [
      {
        // Ships dark in Phase 1 (Plans/Troop-Finances.md) — read-only ledger
        // only, no write UI yet. Gated on finance.manage for nav visibility;
        // the page itself also accepts finance.view (nobody holds it at
        // launch, so this is a distinction without a difference for now —
        // see the page's requireAnyOf call, which is the real boundary).
        label: 'Ledger',
        href: '/admin/finance',
        matchPath: '/admin/finance',
        capability: 'finance.manage'
      },
      {
        // Phase 4 — approve/deny/pay queue. Same finance.manage gate.
        label: 'Reimbursements',
        href: '/admin/finance/reimbursements',
        matchPath: '/admin/finance/reimbursements',
        capability: 'finance.manage'
      },
      {
        // Phase 6 — read-only, so also reachable by finance.view; nav
        // visibility still keys off finance.manage like the rest of this
        // section (nobody holds finance.view at launch — see Ledger's note).
        label: 'Activity Report',
        href: '/admin/finance/report',
        matchPath: '/admin/finance/report',
        capability: 'finance.manage'
      }
    ]
  },
  {
    title: 'Output',
    items: [
      {
        label: 'Scoutbook Export',
        href: '/admin/advancement/scoutbook-export',
        matchPath: '/admin/advancement/scoutbook-export',
        capability: 'advancement.write'
      }
    ]
  },
  {
    title: 'Setup',
    items: [
      {
        label: 'Lookups & Admin',
        href: '/admin/advancement/lookups',
        matchPath: '/admin/advancement/lookups',
        capability: 'roster.manage'
      },
      {
        label: 'Roster Import',
        href: '/admin/advancement/roster-import',
        matchPath: '/admin/advancement/roster-import',
        capability: 'roster.manage'
      },
      {
        label: 'Access & Permissions',
        href: '/admin/access',
        matchPath: '/admin/access',
        capability: 'roster.manage'
      },
      {
        label: 'Utilities',
        href: '/admin/utilities',
        matchPath: '/admin/utilities',
        capability: 'news.write'
      }
    ]
  }
];

/**
 * finance.manage / finance.view never come "for free" with fullAdmin, even
 * though every other capability does (qa-lead, 2026-08-18, pre-production
 * BLOCK finding, same root cause as admin-actor.ts's LEGACY_EXCLUDED — a
 * legacy LEADER_PASSWORD session was never granted these, so showing the
 * link is a dead end that throws when clicked, not a real capability). Kept
 * as its own list rather than reusing admin-actor.ts's, deliberately: this
 * one drives nav VISIBILITY, that one drives the actual grant — a future
 * capability could reasonably need different treatment in each.
 */
const NEVER_IMPLIED_BY_FULL_ADMIN: ReadonlySet<Capability> = new Set(['finance.manage', 'finance.view']);

/**
 * Which nav items this actor should see.
 *
 * `fullAdmin` covers both a legacy LEADER_PASSWORD session and an identity
 * actor holding every capability — they see everything, including the
 * disabled "Soon" placeholders that carry no capability of their own.
 * Exception: NEVER_IMPLIED_BY_FULL_ADMIN items still need the actor's real
 * capability set even under fullAdmin.
 *
 * Everyone else sees exactly the items whose capability they hold. This is
 * NOT the security boundary — each page's requireCapability() is; the nav
 * just stops offering links that would refuse.
 */
export function visibleNavSections(
  sections: typeof SECTIONS,
  opts: { fullAdmin: boolean; capabilities: ReadonlySet<Capability> }
) {
  if (opts.fullAdmin) {
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) =>
            i.capability == null ||
            !NEVER_IMPLIED_BY_FULL_ADMIN.has(i.capability) ||
            opts.capabilities.has(i.capability)
        )
      }))
      .filter((s) => s.items.length > 0);
  }
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => i.capability != null && opts.capabilities.has(i.capability))
    }))
    .filter((s) => s.items.length > 0);
}

export function SubNav({
  fullAdmin,
  capabilities
}: {
  fullAdmin: boolean;
  capabilities: Capability[];
}) {
  const pathname = usePathname();
  const visibleSections = visibleNavSections(SECTIONS, {
    fullAdmin,
    capabilities: new Set(capabilities)
  });

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
