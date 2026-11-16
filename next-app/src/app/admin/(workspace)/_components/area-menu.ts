/**
 * The rail and its area menus, as data (Plans/Admin-Portal-Nav.md phase 3). Built from the VISIBLE features
 * (visibleFeatures), never a hand-kept list. A plain module so the server layout, the client rail and the tests share
 * it.
 *
 * Each group opens one menu, one level deep, in four columns: Do · Screens · Reports · Setup. Reports groups every
 * report by subject; Setup is Do · Lists · Reports · Workspace.
 */
import { FEATURES, featuresIn, hrefPath, type Area, type Feature, type FeatureKind } from './feature-registry';

export const AREA_LABELS: Record<Area, string> = {
  home: 'Home',
  meetings: 'Meetings',
  advancement: 'Advancement',
  content: 'Website Content',
  money: 'Money',
  people: 'People',
  reports: 'Reports',
  setup: 'Setup'
};

/** The rail's menu groups between Home and the pins, in order (decision 1). Setup sits under the pins. */
export const RAIL_GROUPS: readonly Area[] = ['meetings', 'advancement', 'content', 'money', 'people', 'reports'];

/** Setup's Workspace column: the tools about the workspace itself rather than a list it keeps. */
const WORKSPACE_KEYS: ReadonlySet<string> = new Set(['people.access', 'setup.styleguides', 'setup.utilities']);

export interface MenuItem {
  key: string;
  label: string;
  description?: string;
  href: string;
  /** Wreath Sale: 'open' leads its column, 'off' is last and greyed. */
  season?: 'open' | 'off';
}

export interface MenuColumn {
  title: string;
  items: MenuItem[];
}

export interface AreaMenu {
  area: Area;
  title: string;
  /** The group's home: its first primary screen ("Open Financial Ledger →"). Null when the person can open none. */
  homeHref: string | null;
  /** That screen's name, for the link's text: "Financial Ledger", or "all reports" for Reports. */
  homeLabel: string | null;
  columns: MenuColumn[];
}

const KIND_COLUMNS: [FeatureKind, string][] = [
  ['action', 'Do'],
  ['screen', 'Screens'],
  ['report', 'Reports'],
  ['setup', 'Setup']
];

const REPORT_SUBJECTS: [string, Area[]][] = [
  ['Advancement', ['advancement']],
  ['Meetings and people', ['meetings', 'people']],
  ['Money', ['money']],
  ['Site', ['reports', 'setup', 'content', 'home']]
];

function toItem(f: Feature, wreathOpen: boolean): MenuItem {
  const item: MenuItem = { key: f.key, label: f.label, href: f.href };
  if (f.description) item.description = f.description;
  if (f.seasonal) item.season = wreathOpen ? 'open' : 'off';
  return item;
}

/** Primary first, then registry order; an in-season item leads, an out-of-season one goes last. */
function ordered(features: Feature[], wreathOpen: boolean): MenuItem[] {
  const rank = (f: Feature) => (f.seasonal ? (wreathOpen ? 0 : 3) : f.tier === 'primary' ? 1 : 2);
  return features
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => toItem(f, wreathOpen));
}

function homeFor(visible: Feature[], area: Area): { href: string; label: string } | null {
  if (area === 'reports') {
    const landing = visible.find((f) => f.key === 'reports.index');
    return landing ? { href: landing.href, label: 'all reports' } : null;
  }
  const own = visible.filter((f) => f.area === area);
  const pick =
    own.find((f) => f.kind === 'screen' && f.tier === 'primary') ??
    own.find((f) => f.kind === 'screen') ??
    own.find((f) => f.kind === 'setup') ??
    own[0];
  return pick ? { href: pick.href, label: pick.label } : null;
}

/** One group's menu for this person. `visible` is visibleFeatures(...) for them. */
export function areaMenu(visible: Feature[], area: Area, opts: { wreathOpen: boolean }): AreaMenu {
  const listed = featuresIn(visible, area).filter((f) => f.landing == null);
  let columns: MenuColumn[];
  if (area === 'reports') {
    const reports = listed.filter((f) => f.kind === 'report');
    columns = REPORT_SUBJECTS.map(([title, areas]) => ({
      title,
      items: ordered(
        reports.filter((f) => areas.includes(f.area)),
        opts.wreathOpen
      )
    })).filter((c) => c.items.length > 0);
  } else if (area === 'setup') {
    const workspace = listed.filter((f) => WORKSPACE_KEYS.has(f.key));
    const rest = listed.filter((f) => !WORKSPACE_KEYS.has(f.key));
    columns = [
      { title: 'Do', items: ordered(rest.filter((f) => f.kind === 'action'), opts.wreathOpen) },
      { title: 'Lists', items: ordered(rest.filter((f) => f.kind === 'setup' || f.kind === 'screen'), opts.wreathOpen) },
      { title: 'Reports', items: ordered(rest.filter((f) => f.kind === 'report'), opts.wreathOpen) },
      { title: 'Workspace', items: ordered(workspace, opts.wreathOpen) }
    ];
  } else {
    columns = KIND_COLUMNS.map(([kind, title]) => ({
      title,
      items: ordered(
        listed.filter((f) => f.kind === kind),
        opts.wreathOpen
      )
    }));
  }
  const home = homeFor(visible, area);
  return { area, title: AREA_LABELS[area], homeHref: home?.href ?? null, homeLabel: home?.label ?? null, columns };
}

export function menuItemCount(menu: AreaMenu): number {
  return menu.columns.reduce((n, c) => n + c.items.length, 0);
}

export interface RailModel {
  /** Rail groups above the pins that have at least one item for this person, in rail order. */
  groups: AreaMenu[];
  pins: MenuItem[];
  /** Setup's menu, or null when it is empty for this person. */
  setup: AreaMenu | null;
}

/** Everything the rail renders. Pins keep their saved order; a pin the person can no longer open is skipped. */
export function railModel(visible: Feature[], pinKeys: readonly string[], opts: { wreathOpen: boolean }): RailModel {
  const groups = RAIL_GROUPS.map((a) => areaMenu(visible, a, opts)).filter((m) => menuItemCount(m) > 0);
  const setupMenu = areaMenu(visible, 'setup', opts);
  const byKey = new Map(visible.map((f) => [f.key, f]));
  const pins = pinKeys.flatMap((k) => {
    const f = byKey.get(k);
    return f ? [toItem(f, opts.wreathOpen)] : [];
  });
  return { groups, pins, setup: menuItemCount(setupMenu) > 0 ? setupMenu : null };
}

/** Pages that belong to no group: the rail lights nothing on them. */
const NO_GROUP_PATHS: readonly string[] = ['/admin/everything', '/admin/pins'];

/**
 * The group the current page belongs to, by explicit registry membership (the longest registered route the path sits
 * under, and that feature's own area), never by a URL prefix rule: Ledger Audit's route is under /admin/utilities but
 * it belongs to Money. Home lights only on /admin itself. Planner links never light a group: they leave the workspace.
 */
export function activeAreaFor(pathname: string, features: readonly Feature[] = FEATURES): Area | null {
  if (pathname === '/admin') return 'home';
  if (NO_GROUP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  let best: Feature | null = null;
  let bestLen = -1;
  for (const f of features) {
    if (f.planner || f.key === 'home') continue;
    const p = hrefPath(f.href);
    if ((pathname === p || pathname.startsWith(`${p}/`)) && p.length > bestLen) {
      // Several features share a route (a screen and the tasks that deep-link into it): the first registered wins,
      // which is the screen's own area.
      best = f;
      bestLen = p.length;
    }
  }
  return best?.area ?? null;
}

/** "Needs you today" rows → the group whose rail entry carries their count. Informational rows count nowhere. */
export const ATTENTION_AREA: Readonly<Record<string, Area>> = {
  'profile-updates': 'people',
  'new-members': 'people',
  'library-submissions': 'content',
  'proof-submissions': 'advancement',
  reimbursements: 'money',
  'wreath-orders': 'money',
  'news-pending': 'content',
  'teaching-skill-changes': 'meetings'
};

/** The count on each rail group: the sum of that area's attention rows, from the same source as Needs you today. */
export function areaCounts(rows: readonly { key: string; count: number; informational?: boolean }[]): Partial<Record<Area, number>> {
  const out: Partial<Record<Area, number>> = {};
  for (const r of rows) {
    const area = ATTENTION_AREA[r.key];
    if (!area || r.informational || r.count <= 0) continue;
    out[area] = (out[area] ?? 0) + r.count;
  }
  return out;
}
