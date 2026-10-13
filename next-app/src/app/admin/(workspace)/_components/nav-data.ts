/**
 * The admin navigation DATA — one source for the rail (sub-nav.tsx) and the Home card grid (admin-home).
 * A plain module on purpose: sub-nav.tsx is 'use client', and a const exported from a client file reaches
 * server components as a client reference (see next-app AGENTS / memory "Client-module constants").
 *
 * Plans/Admin-Home-And-Nav.md Wave 2: regrouped by job (Advancement · Calendar & Content · Money · People & Setup ·
 * Troop admin tools). The rail renders these sections as they are; the Home grid renders the same visible sections
 * through hubGroups().
 */
import { CAPABILITIES, type Capability } from '@/lib/capabilities';

export interface NavItem {
  label: string;
  href?: string;
  matchPath?: string;
  disabled?: boolean;
  /** One line for the Home card. Tools-group items have none (they render as plain links). */
  description?: string;
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
  /**
   * Offered to every leader regardless of capability (Home only — it is the
   * inbox, which each person sees filtered to what they hold). The layout has
   * already turned away anyone with no capability at all.
   */
  everyone?: boolean;
  /** matchPath must equal the pathname rather than prefix it (Home at /admin). */
  exact?: boolean;
  /** Extra path prefixes that light this item up (the dashboard URL is Home too). */
  alsoMatches?: string[];
  /**
   * Folds this item into ONE Home card named by `folder` (Reports). The card shows the members as quiet links, and
   * the folder's landing page (folderLanding) lists them with a description each.
   */
  folder?: string;
  /**
   * This item IS the landing page of the folder of that name (Reports -> /admin/reports). It carries no capability of
   * its own: it is visible exactly when at least one member of the folder is. The Home card's title links to it, and
   * it is not listed among the folder's own links. Its rail entry lights up on any member's page (railActiveMatchPathFor).
   */
  folderLanding?: string;
  /**
   * Left off the rail: a folder member the landing page collects (Reports) or a tool reachable from the Troop admin
   * tools card only (Styleguides).
   */
  railHidden?: boolean;
  /** Seasonal (Wreath Sale): first in its group while its season is open, last and greyed otherwise. */
  seasonal?: boolean;
}

export interface NavSection {
  title: string;
  /** Rendered quietly and last on Home: one card listing the items as links, no descriptions. */
  quiet?: boolean;
  items: NavItem[];
}

/** The one-line description of a folder card (the items it folds carry their own). */
export const FOLDER_DESCRIPTIONS: Record<string, string> = {
  Reports: 'Audits, weekly report, Court of Honor, exports'
};

export const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        // Home = the old Dashboard, extended (Plans/Admin-Home-And-Nav.md Wave 1):
        // "Needs you today" first, then the advancement overview for those who
        // hold advancement.write. /admin/advancement/dashboard still renders the
        // same page, so old links and bookmarks keep working.
        label: 'Home',
        href: '/admin',
        matchPath: '/admin',
        exact: true,
        alsoMatches: ['/admin/advancement/dashboard'],
        everyone: true
      }
    ]
  },
  {
    title: 'Advancement',
    items: [
      {
        label: 'Fast Entry',
        href: '/admin/advancement/fast-entry',
        matchPath: '/admin/advancement/fast-entry',
        description: 'Sign off requirements for many scouts at once',
        capability: 'advancement.write'
      },
      // "Event Management" (the /admin/rosters chase-list) retired 2026-08-25
      // (Patrick: "remove the event management from the admin") — the
      // Calendar carries signup status and the Going count; an event's
      // Roster / Money / Snapshot / assignments open from its Signup tab.
      {
        label: 'Ledger',
        href: '/admin/advancement/ledger',
        matchPath: '/admin/advancement/ledger',
        description: 'Every requirement, rank and badge on record',
        capability: 'advancement.write'
      },
      {
        label: 'Submit & Present',
        href: '/admin/advancement/records',
        matchPath: '/admin/advancement/records',
        description: 'Council submissions and awards to hand out',
        capability: 'advancement.write'
      },
      {
        label: 'MB Progress',
        href: '/admin/advancement/mb-progress',
        matchPath: '/admin/advancement/mb-progress',
        description: 'Partial merit badges and their counselors',
        capability: 'advancement.write'
      },
      {
        label: 'Meeting Plan',
        href: '/admin/advancement/meeting-plan',
        matchPath: '/admin/advancement/meeting-plan',
        description: 'Sunday meeting plan from who needs what',
        capability: 'meeting_plan.use'
      },
      // "Roll Call & Agendas" retired 2026-08-24 (Patrick): the Calendar list
      // carries every entry's agenda / signup / roll-call state as letter pills
      // that open the layer's screen. The Roll Call SHEET keeps its own route
      // under the entry — taking attendance is still a data-entry session.
      {
        label: 'Has/Needs',
        href: '/admin/advancement/has-needs',
        matchPath: '/admin/advancement/has-needs',
        description: 'Who still needs a requirement',
        capability: 'advancement.write'
      },
      // Reports: ONE "Reports" entry in the rail and ONE card on Home, both landing on /admin/reports, which lists every
      // member of the folder below (reportEntries). A new report is one item here with folder: 'Reports' + railHidden.
      {
        label: 'Reports',
        href: '/admin/reports',
        matchPath: '/admin/reports',
        folderLanding: 'Reports'
        // Lit on any member's page: railActiveMatchPathFor() maps a folder member to its landing.
      },
      {
        label: 'Audits',
        href: '/admin/advancement/audits',
        matchPath: '/admin/advancement/audits',
        description: 'Data-quality checks that flag ledger records that look wrong',
        folder: 'Reports',
        railHidden: true,
        capability: 'advancement.write'
      },
      {
        label: 'Advancement Report',
        href: '/admin/advancement/report',
        matchPath: '/admin/advancement/report',
        description: 'What got signed off in a date range, for the Bugle and the public site',
        folder: 'Reports',
        railHidden: true,
        capability: 'advancement.write'
      },
      {
        label: 'Court of Honor',
        href: '/admin/advancement/court-of-honor',
        matchPath: '/admin/advancement/court-of-honor',
        description: 'Ranks, merit badges and awards earned in a date range',
        folder: 'Reports',
        railHidden: true,
        capability: 'advancement.write'
      },
      {
        label: 'Scoutbook Export',
        href: '/admin/advancement/scoutbook-export',
        matchPath: '/admin/advancement/scoutbook-export',
        description: "Awards in a date range, formatted for Scoutbook's bulk upload",
        folder: 'Reports',
        railHidden: true,
        capability: 'advancement.write'
      },
      {
        // Was an Actions ▾ option on the retired Roll Call list (2026-08-24);
        // it is a report, so it lives with the reports — last, stand-alone.
        label: 'Attendance Report',
        href: '/admin/advancement/meetings/report',
        matchPath: '/admin/advancement/meetings/report',
        description: 'Meeting attendance per scout and per adult',
        folder: 'Reports',
        railHidden: true,
        capability: 'advancement.write'
      }
    ]
  },
  {
    title: 'Calendar & Content',
    items: [
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
      {
        label: 'Calendar',
        href: '/admin/calendar',
        matchPath: '/admin/calendar',
        description: 'Meetings, campouts, sign-ups and roll call',
        capability: 'calendar.write'
      },
      {
        label: 'News',
        href: '/admin/news/articles',
        matchPath: '/admin/news/articles',
        description: 'Articles and the weekly Bugle',
        capability: 'news.write'
      },
      {
        // The words of Join, About and any child page (Plans/Content-Managed-Pages.md): edited here, same editor as News.
        label: 'Pages',
        href: '/admin/news/pages',
        matchPath: '/admin/news/pages',
        description: 'Join, About and other site pages',
        capability: 'news.write'
      },
      {
        label: 'Media Manager',
        href: '/admin/news/media-manager',
        matchPath: '/admin/news/media-manager',
        description: 'Images and video on the CDN',
        capability: 'news.write'
      },
      {
        label: 'Photo Albums',
        href: '/admin/news/photo-albums',
        matchPath: '/admin/news/photo-albums',
        description: 'Gallery links for events',
        capability: 'news.write'
      },
      {
        label: 'Resource Library',
        href: '/admin/library',
        matchPath: '/admin/library',
        description: 'Study guides, proof submissions, the queue',
        capability: 'library.moderate'
      },
      {
        // The Cooking MB planner's catalog (Plans/Menu-Monster-Leader-Tools.md):
        // a Library shelf's content, so the Librarian's capability.
        label: 'Menu Monster',
        href: '/admin/library/menu-monster',
        matchPath: '/admin/library/menu-monster',
        description: 'Recipes, ingredients and prices for patrol cooking',
        capability: 'library.moderate'
      }
    ]
  },
  {
    title: 'Money',
    items: [
      {
        // Ships dark in Phase 1 (Plans/Troop-Finances.md) — read-only ledger
        // only, no write UI yet. Gated on finance.manage for nav visibility;
        // the page itself also accepts finance.view (nobody holds it at
        // launch, so this is a distinction without a difference for now —
        // see the page's requireAnyOf call, which is the real boundary).
        // "Financial Ledger", not bare "Ledger" (Patrick, 2026-08-21) — the
        // Advancement section has its own Ledger; the qualifier disambiguates.
        label: 'Financial Ledger',
        href: '/admin/finance',
        matchPath: '/admin/finance',
        description: 'Every dollar in and out of the troop account',
        capability: 'finance.manage'
      },
      {
        // Phase 4 — approve/deny/pay queue. Same finance.manage gate.
        label: 'Reimbursements',
        href: '/admin/finance/reimbursements',
        matchPath: '/admin/finance/reimbursements',
        description: 'Approve, deny and pay back receipts',
        capability: 'finance.manage'
      },
      {
        // Phase 6 — read-only, so also reachable by finance.view; nav
        // visibility still keys off finance.manage like the rest of this
        // section (nobody holds finance.view at launch — see Ledger's note).
        label: 'Activity Report',
        href: '/admin/finance/report',
        matchPath: '/admin/finance/report',
        description: 'Income and spending by event and kind',
        capability: 'finance.manage'
      },
      {
        // Plans/Ledger-Audit.md (2026-09-29). The page's route stays under
        // /admin/utilities (Patrick asked for it there), but it BELONGS to Money:
        // treasurers work from this section. Membership is explicit — activeSectionTitleFor()
        // answers from the section an item sits in, never from the URL prefix, so
        // Utilities does not light up on this page. Read-only; finance.view reaches
        // it as well, nav keys off finance.manage like the rest of this section.
        label: 'Ledger Audit',
        href: '/admin/utilities/ledger-audit',
        matchPath: '/admin/utilities/ledger-audit',
        description: 'Match the ledger to the bank statement',
        capability: 'finance.manage'
      },
      {
        // Plans/Wreath-Sale.md Release A — settings, items, sellers, orders and the Rose order for the
        // annual wreath sale. finance.manage on the page and on every action. Seasonal: first in
        // Money while the sale is open, last and greyed otherwise (hubGroups).
        label: 'Wreath Sale',
        href: '/admin/finance/wreaths',
        matchPath: '/admin/finance/wreaths',
        description: 'Orders, sellers and the Rose order',
        seasonal: true,
        capability: 'finance.manage'
      }
    ]
  },
  {
    title: 'People & Setup',
    items: [
      {
        label: 'Roster',
        href: '/admin/advancement/roster',
        matchPath: '/admin/advancement/roster',
        description: 'Scouts, adults and households',
        capability: 'roster.manage'
      },
      {
        label: 'Access',
        href: '/admin/access',
        matchPath: '/admin/access',
        description: 'Who can use which admin tools',
        capability: 'roster.manage'
      }
    ]
  },
  {
    title: 'Troop admin tools',
    quiet: true,
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
        // Content changes only (news/calendar/roster/library) — advancement
        // and finance have their own ledgers. roster.manage because the
        // trail names people (Patrick, 2026-08-30).
        label: 'Audit Trail',
        href: '/admin/audit',
        matchPath: '/admin/audit',
        capability: 'roster.manage'
      },
      {
        label: 'Utilities',
        href: '/admin/utilities',
        matchPath: '/admin/utilities',
        capability: 'news.write'
      },
      {
        // Returns here ONLY (Wave 2): a link in the tools card, not a rail item. No capability, so it is
        // offered to full admins alone (capability-less item semantics, below).
        label: 'Styleguides',
        href: '/admin/styleguide',
        matchPath: '/admin/styleguide',
        railHidden: true
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
  sections: NavSection[],
  opts: { fullAdmin: boolean; capabilities: ReadonlySet<Capability> }
) {
  return pruneEmptyLandings(filterByCapability(sections, opts));
}

/** A folder's landing page is offered only while at least one member of that folder is. */
function pruneEmptyLandings<S extends { items: NavItem[] }>(sections: S[]): S[] {
  const live = new Set(sections.flatMap((s) => s.items).flatMap((i) => (i.folder ? [i.folder] : [])));
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.folderLanding || live.has(i.folderLanding)) }))
    .filter((s) => s.items.length > 0);
}

function filterByCapability(
  sections: NavSection[],
  opts: { fullAdmin: boolean; capabilities: ReadonlySet<Capability> }
) {
  if (opts.fullAdmin) {
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) =>
            i.everyone ||
            i.folderLanding != null ||
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
      items: s.items.filter((i) => i.everyone || i.folderLanding != null || (i.capability != null && opts.capabilities.has(i.capability)))
    }))
    .filter((s) => s.items.length > 0);
}

/**
 * Which single item's matchPath is "active" for the current pathname — the
 * LONGEST matchPath the path starts with, never every prefix match. Split
 * out for testability, same reason as visibleNavSections above.
 *
 * A section root's matchPath is often itself a prefix of a sibling's — e.g.
 * Finance's "Financial Ledger" -> /admin/finance, "Activity Report" ->
 * /admin/finance/report. `pathname.startsWith(item.matchPath)` alone would
 * match BOTH on /admin/finance/report and light up two nav items at once
 * (screenshot, 2026-08-20). Longest-match-wins picks the more specific one.
 */
export function activeMatchPathFor(
  sections: {
    items: { disabled?: boolean; matchPath?: string; exact?: boolean; alsoMatches?: string[] }[];
  }[],
  pathname: string
): string | null {
  let active: string | null = null;
  let activeLen = -1;
  for (const section of sections) {
    for (const item of section.items) {
      if (item.disabled || !item.matchPath) continue;
      const candidates = [
        ...(item.exact ? (pathname === item.matchPath ? [item.matchPath] : []) : pathname.startsWith(item.matchPath) ? [item.matchPath] : []),
        ...(item.alsoMatches ?? []).filter((p) => pathname.startsWith(p))
      ];
      for (const c of candidates) {
        if (c.length > activeLen) {
          active = item.matchPath;
          activeLen = c.length;
        }
      }
    }
  }
  return active;
}


/** Same "full admin" test the workspace layout has always applied; Home needs it for the card grid. */
export function isFullAdmin(actor: { legacyRole: unknown; capabilities: ReadonlySet<Capability> }): boolean {
  return actor.legacyRole !== null || CAPABILITIES.every((c) => actor.capabilities.has(c));
}

/** The rail's view of the (already visible) sections: everything except items marked railHidden (Styleguides). */
export function railSections<S extends { items: NavItem[] }>(sections: S[]): S[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.railHidden) }))
    .filter((s) => s.items.length > 0);
}

/**
 * The title of the section the current page belongs to — by the section an item SITS IN (explicit membership),
 * never by URL prefix. Ledger Audit's route is under /admin/utilities, but it sits in Money, so Money is the answer.
 */
export function activeSectionTitleFor(
  sections: { title: string; items: { disabled?: boolean; matchPath?: string; exact?: boolean; alsoMatches?: string[] }[] }[],
  pathname: string
): string | null {
  const active = activeMatchPathFor(sections, pathname);
  if (active == null) return null;
  return sections.find((s) => s.items.some((i) => i.matchPath === active))?.title ?? null;
}

/**
 * The rail's active item. Folder members (the reports) are off the rail, so a member's page lights its folder's landing
 * entry (Reports) — by explicit membership in the folder, never by URL prefix. Pass the VISIBLE sections before
 * railSections() drops the hidden members.
 */
export function railActiveMatchPathFor(
  sections: { items: NavItem[] }[],
  pathname: string
): string | null {
  const active = activeMatchPathFor(sections, pathname);
  if (active == null) return null;
  const items = sections.flatMap((s) => s.items);
  const folder = items.find((i) => i.matchPath === active)?.folder;
  if (!folder) return active;
  return items.find((i) => i.folderLanding === folder)?.matchPath ?? active;
}

export interface FolderEntry {
  label: string;
  href: string;
  description?: string;
}

/** Every visible member of a folder, in nav order — the landing page's list (Reports). Built, never hand-kept. */
export function folderEntries(visible: { items: NavItem[] }[], folder: string): FolderEntry[] {
  return visible
    .flatMap((s) => s.items)
    .filter((i) => i.folder === folder && i.href && !i.disabled)
    .map((i) => ({ label: i.label, href: i.href!, description: i.description }));
}

export interface HubCard {
  key: string;
  title: string;
  description?: string;
  /** Where the title goes. A folder card: its landing page (Reports); the tools card: the first link. */
  href: string;
  /** Quiet links inside the card (Reports' five reports; the tools). */
  links?: { label: string; href: string }[];
  /** Seasonal card: 'open' = in season, 'off' = greyed and last. */
  season?: 'open' | 'off';
}

export interface HubGroup {
  title: string;
  quiet: boolean;
  cards: HubCard[];
}

/**
 * The Home card grid, built from the SAME visible sections the rail renders — never a second hand-kept list.
 * Home itself is skipped (it is the page). A folder (Reports) collapses its items into one card at the position of
 * its first item. The quiet group is one card listing its tools as links. A seasonal card goes first in its group
 * while `wreathOpen`, otherwise last and greyed. A group with no cards is absent.
 */
export function hubGroups(
  visible: { title: string; quiet?: boolean; items: NavItem[] }[],
  opts: { wreathOpen: boolean }
): HubGroup[] {
  const groups: HubGroup[] = [];
  for (const section of visible) {
    const items = section.items.filter((i) => !i.everyone && i.href && !i.disabled);
    if (items.length === 0) continue;

    if (section.quiet) {
      groups.push({
        title: section.title,
        quiet: true,
        cards: [
          {
            key: section.title,
            title: section.title,
            href: items[0].href!,
            links: items.map((i) => ({ label: i.label, href: i.href! }))
          }
        ]
      });
      continue;
    }

    let cards: HubCard[] = [];
    for (const item of items) {
      if (item.folderLanding) {
        // The landing is the folder card's title link; it is not one of the card's own links.
        const existing = cards.find((c) => c.key === `folder:${item.folderLanding}`);
        if (existing) existing.href = item.href!;
        else
          cards.push({
            key: `folder:${item.folderLanding}`,
            title: item.folderLanding,
            description: FOLDER_DESCRIPTIONS[item.folderLanding],
            href: item.href!,
            links: []
          });
        continue;
      }
      if (item.folder) {
        const existing = cards.find((c) => c.key === `folder:${item.folder}`);
        const link = { label: item.label, href: item.href! };
        if (existing) existing.links!.push(link);
        else
          cards.push({
            key: `folder:${item.folder}`,
            title: item.folder,
            description: FOLDER_DESCRIPTIONS[item.folder],
            href: item.href!,
            links: [link]
          });
        continue;
      }
      const card: HubCard = { key: item.href!, title: item.label, description: item.description, href: item.href! };
      if (item.seasonal) card.season = opts.wreathOpen ? 'open' : 'off';
      cards.push(card);
    }
    const seasonal = cards.filter((c) => c.season);
    const rest = cards.filter((c) => !c.season);
    cards = opts.wreathOpen ? [...seasonal, ...rest] : [...rest, ...seasonal];
    groups.push({ title: section.title, quiet: false, cards });
  }
  return groups;
}
