/**
 * The admin navigation DATA — one source for the section bar + tabs (section-nav.tsx) and the Home card grid (admin-hub).
 * A plain module on purpose: section-nav.tsx is 'use client', and a const exported from a client file reaches
 * server components as a client reference (see next-app AGENTS / memory "Client-module constants").
 *
 * Plans/Admin-Home-And-Nav.md Wave 2: regrouped by job (Advancement · Calendar & Content · Money · People & Setup ·
 * Troop admin tools). Wave 3: the section bar names these sections and each section's items are its tabs
 * (sectionNav()); the Home grid renders the same visible sections through hubGroups().
 * 2026-10-13 (Patrick): Reports is its own section holding every report, whatever it reports on; the old dashboard is
 * the first Advancement card; each section carries an earth-tone tint for its Home group.
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
  /** Extra path prefixes that light this item up. */
  alsoMatches?: string[];
  /**
   * Marks this item as a member of the folder named `folder` (Reports): the folder's landing page lists it with its
   * description, and on Home it is an ordinary card in its section.
   */
  folder?: string;
  /**
   * This item IS the landing page of the folder of that name (Reports -> /admin/reports). It carries no capability of
   * its own: it is visible exactly when at least one member of the folder is. It is the section bar's entry for the
   * folder and has no Home card of its own (the members are the cards). It lights up on any member's page
   * (navActiveMatchPathFor).
   */
  folderLanding?: string;
  /**
   * Left off the section bar and tabs: a folder member only its landing page collects (the reports sit behind the
   * single Reports bar entry), or a tool reachable from the Troop admin tools row only (Styleguides). A hidden folder
   * member lights its folder's landing entry. Every folder member must carry it (tested).
   */
  navHidden?: boolean;
  /** Seasonal (Wreath Sale): first in its group while its season is open, last and greyed otherwise. */
  seasonal?: boolean;
}

/** The earth tone a section's Home group wears (admin.css --admin-tint-*). The quiet tools group has none. */
export type NavTint = 'moss' | 'sky' | 'wheat' | 'clay' | 'stone';

export interface NavSection {
  title: string;
  /** Pale card background + stronger left edge + darker heading, per section (Patrick, 2026-10-13). */
  tint?: NavTint;
  /** The (shorter) name on the section bar when it differs from the title: "Home", "People", "Tools". */
  barLabel?: string;
  /** Rendered quietly and last on Home: one card listing the items as links, no descriptions. */
  quiet?: boolean;
  items: NavItem[];
}

export const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    barLabel: 'Home',
    items: [
      {
        // Home = "Needs you today" plus the card grid. The old Dashboard (the advancement overview) is its own page,
        // the first Advancement card, at /admin/advancement/dashboard.
        label: 'Home',
        href: '/admin',
        matchPath: '/admin',
        exact: true,
        everyone: true
      }
    ]
  },
  {
    title: 'Advancement',
    tint: 'moss',
    items: [
      {
        // The old Home overview (stats, recent ledger activity, likely-ready scouts, logins) on its own page.
        // First, so the Advancement bar entry opens it.
        label: 'Dashboard',
        href: '/admin/advancement/dashboard',
        matchPath: '/admin/advancement/dashboard',
        description: 'Active scouts, ledger, Court of Honor candidates and recent sign-ins',
        capability: 'advancement.write'
      },
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
      }
    ]
  },
  {
    title: 'Calendar & Content',
    tint: 'sky',
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
    tint: 'wheat',
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
    title: 'Reports',
    tint: 'clay',
    items: [
      // ONE Reports entry on the section bar (the landing) and one Home card per report (Patrick, 2026-10-13): every
      // report sits here whatever it reports on. A new report is one item with folder: 'Reports' and navHidden: true.
      {
        label: 'Reports',
        href: '/admin/reports',
        matchPath: '/admin/reports',
        folderLanding: 'Reports'
      },
      {
        label: 'Audits',
        href: '/admin/advancement/audits',
        matchPath: '/admin/advancement/audits',
        description: 'Data-quality checks that flag ledger records that look wrong',
        folder: 'Reports',
        navHidden: true,
        capability: 'advancement.write'
      },
      {
        label: 'Advancement Report',
        href: '/admin/advancement/report',
        matchPath: '/admin/advancement/report',
        description: 'What got signed off in a date range, for the Bugle and the public site',
        folder: 'Reports',
        navHidden: true,
        capability: 'advancement.write'
      },
      {
        label: 'Court of Honor',
        href: '/admin/advancement/court-of-honor',
        matchPath: '/admin/advancement/court-of-honor',
        description: 'Ranks, merit badges and awards earned in a date range',
        folder: 'Reports',
        navHidden: true,
        capability: 'advancement.write'
      },
      {
        label: 'Scoutbook Export',
        href: '/admin/advancement/scoutbook-export',
        matchPath: '/admin/advancement/scoutbook-export',
        description: "Awards in a date range, formatted for Scoutbook's bulk upload",
        folder: 'Reports',
        navHidden: true,
        capability: 'advancement.write'
      },
      {
        // Was an Actions ▾ option on the retired Roll Call list (2026-08-24);
        // it is a report, so it lives with the reports.
        label: 'Attendance Report',
        href: '/admin/advancement/meetings/report',
        matchPath: '/admin/advancement/meetings/report',
        description: 'Meeting attendance per scout and per adult',
        folder: 'Reports',
        navHidden: true,
        capability: 'advancement.write'
      },
      {
        // Phase 6 — read-only, so also reachable by finance.view; nav
        // visibility still keys off finance.manage (nobody holds finance.view at launch).
        label: 'Bucket Report',
        href: '/admin/finance/report',
        matchPath: '/admin/finance/report',
        description: 'Income and spending by bucket',
        folder: 'Reports',
        navHidden: true,
        capability: 'finance.manage'
      },
      {
        // Plans/Ledger-Audit.md (2026-09-29). The page's route stays under
        // /admin/utilities (Patrick asked for it there), but it BELONGS to Reports:
        // membership is explicit — activeSectionTitleFor() answers from the section an
        // item sits in, never from the URL prefix, so Utilities does not light up on this
        // page. Read-only; finance.view reaches it as well, nav keys off finance.manage.
        label: 'Ledger Audit',
        href: '/admin/utilities/ledger-audit',
        matchPath: '/admin/utilities/ledger-audit',
        description: 'Match the ledger to the bank statement',
        folder: 'Reports',
        navHidden: true,
        capability: 'finance.manage'
      }
    ]
  },
  {
    title: 'People & Setup',
    barLabel: 'People',
    tint: 'stone',
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
    barLabel: 'Tools',
    quiet: true,
    items: [
      {
        label: 'Lookups & Admin',
        href: '/admin/advancement/lookups',
        matchPath: '/admin/advancement/lookups',
        capability: 'roster.manage'
      },
      {
        // The my.scouting.org Roster Report: differences + registration dates (2026-10-20).
        label: 'BSA Roster',
        href: '/admin/advancement/bsa-roster',
        matchPath: '/admin/advancement/bsa-roster',
        capability: 'roster.manage'
      },
      {
        // People → the troop's EmailOctopus list (2026-10-20).
        label: 'EmailOctopus Sync',
        href: '/admin/newsletter',
        matchPath: '/admin/newsletter',
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
        // A link in the Home tools row ONLY, not a tab. No capability, so it is offered to full admins alone
        // (capability-less item semantics, below).
        label: 'Styleguides',
        href: '/admin/styleguide',
        matchPath: '/admin/styleguide',
        navHidden: true
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

/** The bar's and tabs' view of the (already visible) sections: everything except items marked navHidden. */
export function navSections<S extends { items: NavItem[] }>(sections: S[]): S[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.navHidden && !i.disabled && i.href) }))
    .filter((s) => s.items.length > 0);
}

/**
 * The title of the section the current page belongs to — by the section an item SITS IN (explicit membership),
 * never by URL prefix. Ledger Audit's route is under /admin/utilities, but it sits in Reports, so Reports is the answer.
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
 * The active tab. A tab lights itself; a navHidden folder member (a report) lights its folder's landing entry (Reports)
 * - by explicit membership in the folder, never by URL prefix. Pass the VISIBLE sections before navSections() drops the
 * hidden members.
 */
export function navActiveMatchPathFor(
  sections: { items: NavItem[] }[],
  pathname: string
): string | null {
  const active = activeMatchPathFor(sections, pathname);
  if (active == null) return null;
  const items = sections.flatMap((s) => s.items);
  const item = items.find((i) => i.matchPath === active);
  if (!item?.folder || !item.navHidden) return active;
  const folder = item.folder;
  return items.find((i) => i.folderLanding === folder)?.matchPath ?? active;
}

export interface BarEntry {
  /** The section title (stable key; the bar's label may be shorter). */
  key: string;
  label: string;
  /** Its first tab: where the bar entry goes. */
  href: string;
  active: boolean;
}

export interface TabEntry {
  /** The item's matchPath - compared with SectionNavModel.activeKey. */
  key: string;
  label: string;
  href: string;
}

export interface SectionNavModel {
  bar: BarEntry[];
  /** The active section's tabs; null when it has fewer than two (a lone item needs no strip) or no section is active. */
  tabs: TabEntry[] | null;
  activeKey: string | null;
}

/**
 * Everything the section bar and tab strip render, from the VISIBLE sections and the pathname. A section with no
 * visible tab is absent; the active section is the one an item sits in (explicit membership), so Ledger Audit
 * lights Reports though its URL is under /admin/utilities.
 */
export function sectionNav(visible: NavSection[], pathname: string): SectionNavModel {
  const secs = navSections(visible);
  const activeTitle = activeSectionTitleFor(visible, pathname);
  const bar = secs.map((s) => ({
    key: s.title,
    label: s.barLabel ?? s.title,
    href: s.items[0].href!,
    active: s.title === activeTitle
  }));
  const current = secs.find((s) => s.title === activeTitle);
  const tabs =
    current && current.items.length > 1
      ? current.items.map((i) => ({ key: i.matchPath ?? i.href!, label: i.label, href: i.href! }))
      : null;
  return { bar, tabs, activeKey: navActiveMatchPathFor(visible, pathname) };
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
  /** Where the title goes. The tools card: the first link. */
  href: string;
  /** The quiet tools card only: its tools as plain links. */
  links?: { label: string; href: string }[];
  /** Seasonal card: 'open' = in season, 'off' = greyed and last. */
  season?: 'open' | 'off';
}

export interface HubGroup {
  title: string;
  quiet: boolean;
  /** The group's earth tone; absent on the quiet tools group. */
  tint?: NavTint;
  cards: HubCard[];
}

/**
 * The Home card grid, built from the SAME visible sections the bar renders — never a second hand-kept list.
 * Home itself is skipped (it is the page). A folder landing (Reports) is the section bar's entry and makes no card;
 * its members are ordinary cards. The quiet group is one card listing its tools as links. A seasonal card goes first
 * in its group while `wreathOpen`, otherwise last and greyed. A group with no cards is absent.
 */
export function hubGroups(
  visible: { title: string; tint?: NavTint; quiet?: boolean; items: NavItem[] }[],
  opts: { wreathOpen: boolean }
): HubGroup[] {
  const groups: HubGroup[] = [];
  for (const section of visible) {
    const items = section.items.filter((i) => !i.everyone && !i.folderLanding && i.href && !i.disabled);
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

    let cards: HubCard[] = items.map((item) => {
      const card: HubCard = { key: item.href!, title: item.label, description: item.description, href: item.href! };
      if (item.seasonal) card.season = opts.wreathOpen ? 'open' : 'off';
      return card;
    });
    const seasonal = cards.filter((c) => c.season);
    const rest = cards.filter((c) => !c.season);
    cards = opts.wreathOpen ? [...seasonal, ...rest] : [...rest, ...seasonal];
    groups.push({ title: section.title, quiet: false, tint: section.tint, cards });
  }
  return groups;
}
