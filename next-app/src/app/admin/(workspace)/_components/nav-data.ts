/**
 * The admin navigation DATA — one source for the section bar + tabs (section-nav.tsx) and the Home card grid (admin-hub).
 * Since Plans/Admin-Portal-Nav.md phase 1, SECTIONS is derived from the feature registry (feature-registry.ts); edit
 * an item there, not here.
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
import { NEVER_IMPLIED_BY_FULL_ADMIN, featureByKey, hrefPath } from './feature-registry';

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
  /**
   * Shown only to an admin on the health viewers list (Health Forms, Plans/Admin-Health-Forms.md). That list is not a
   * capability, so this is never implied by full admin; the layout passes `healthViewer`. Pages still gate themselves.
   */
  healthViewersOnly?: boolean;
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

/**
 * One item of today's section bar / Home grid: a registry key plus the placement flags only the old nav knows, and the
 * label or description it showed when the registry's newer wording differs. Retired with the section bar (phase 3)
 * and the Home grid (phase 6) of Plans/Admin-Portal-Nav.md.
 */
interface LegacyEntry {
  key: string;
  /** Today's label when the registry's differs ("Ledger", not "Advancement Ledger"). */
  label?: string;
  /** null: today's item has no description (the quiet tools row). */
  description?: string | null;
  exact?: boolean;
  folder?: string;
  folderLanding?: string;
  navHidden?: boolean;
}

interface LegacySection extends Omit<NavSection, 'items'> {
  entries: LegacyEntry[];
}

const REPORT = { folder: 'Reports', navHidden: true } as const;

/** Today's sections, in order, as registry keys. The guard test pins the derived result to tests/fixtures. */
const LEGACY_SECTIONS: LegacySection[] = [
  { title: 'Overview', barLabel: 'Home', entries: [{ key: 'home', exact: true }] },
  {
    title: 'Advancement',
    tint: 'moss',
    entries: [
      { key: 'advancement.fast-entry' },
      { key: 'advancement.ledger', label: 'Ledger' },
      { key: 'advancement.records' },
      { key: 'advancement.approvals' }
    ]
  },
  {
    title: 'Calendar & Content',
    tint: 'sky',
    entries: [
      { key: 'content.calendar' },
      { key: 'content.news', label: 'News' },
      { key: 'content.pages' },
      { key: 'content.media' },
      { key: 'content.photo-albums' },
      { key: 'content.library' },
      { key: 'content.menu-monster' }
    ]
  },
  {
    title: 'Money',
    tint: 'wheat',
    entries: [
      { key: 'money.ledger' },
      { key: 'money.reimbursements' },
      { key: 'money.wreaths', label: 'Wreath Sale' },
      { key: 'money.scout-accounts' }
    ]
  },
  {
    title: 'Reports',
    tint: 'clay',
    entries: [
      { key: 'reports.index', folderLanding: 'Reports' },
      { key: 'advancement.audits', ...REPORT },
      { key: 'advancement.report', ...REPORT },
      { key: 'advancement.court-of-honor', ...REPORT },
      { key: 'advancement.scoutbook-export', ...REPORT },
      { key: 'meetings.attendance', ...REPORT },
      { key: 'money.bucket-report', ...REPORT },
      { key: 'money.ledger-audit', ...REPORT }
    ]
  },
  {
    title: 'People & Setup',
    barLabel: 'People',
    tint: 'stone',
    entries: [{ key: 'people.roster' }, { key: 'people.health-forms' }, { key: 'people.access' }]
  },
  {
    title: 'Troop admin tools',
    barLabel: 'Tools',
    quiet: true,
    entries: [
      { key: 'setup.lookups', label: 'Lookups & Admin', description: null },
      { key: 'setup.bsa-roster', label: 'BSA Roster', description: null },
      { key: 'setup.emailoctopus', label: 'EmailOctopus Sync', description: null },
      { key: 'setup.audit-trail', description: null },
      { key: 'setup.utilities', description: null },
      { key: 'setup.styleguides', navHidden: true }
    ]
  }
];

function legacyItem(e: LegacyEntry): NavItem {
  const f = featureByKey(e.key);
  if (!f) throw new Error(`nav-data: no registry feature '${e.key}'`);
  const description = e.description === null ? undefined : (e.description ?? f.description);
  const item: NavItem = { label: e.label ?? f.label, href: f.href, matchPath: hrefPath(f.href) };
  if (description) item.description = description;
  if (f.capability) item.capability = f.capability;
  if (f.everyone) item.everyone = true;
  if (e.exact) item.exact = true;
  if (e.folder) item.folder = e.folder;
  if (e.folderLanding) item.folderLanding = e.folderLanding;
  if (e.navHidden) item.navHidden = true;
  if (f.seasonal) item.seasonal = true;
  if (f.healthViewersOnly) item.healthViewersOnly = true;
  return item;
}

/** Today's section bar, tabs and Home card grid, derived from the feature registry. */
export const SECTIONS: NavSection[] = LEGACY_SECTIONS.map(({ entries, ...section }) => ({
  ...section,
  items: entries.map(legacyItem)
}));


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
  opts: { fullAdmin: boolean; capabilities: ReadonlySet<Capability>; healthViewer?: boolean }
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
  opts: { fullAdmin: boolean; capabilities: ReadonlySet<Capability>; healthViewer?: boolean }
) {
  // The health viewers list is not a capability: it decides the Health Forms item alone, whatever else is held.
  const health = (i: NavItem) => (i.healthViewersOnly ? opts.healthViewer === true : null);
  if (opts.fullAdmin) {
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) =>
            health(i) ??
            (i.everyone ||
            i.folderLanding != null ||
            i.capability == null ||
            !NEVER_IMPLIED_BY_FULL_ADMIN.has(i.capability) ||
            opts.capabilities.has(i.capability))
        )
      }))
      .filter((s) => s.items.length > 0);
  }
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter(
        (i) => health(i) ?? (i.everyone || i.folderLanding != null || (i.capability != null && opts.capabilities.has(i.capability)))
      )
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
