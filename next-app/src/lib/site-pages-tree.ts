/**
 * Content-managed pages — the pure half (Plans/Content-Managed-Pages.md): the row shape, the admin tree order,
 * path building and sibling reordering. No server imports, so the client-side editor and list can use it too.
 */

export type SitePageStatus = 'draft' | 'published';

export interface SitePage {
  id: number;
  parent_id: number | null;
  slug: string;
  /** The public URL, parent path + '/' + slug. Unique. */
  path: string;
  /** The admin name; on the page it is the section label above the headline. */
  title: string;
  headline: string;
  lede: string;
  body_md: string;
  sidebar_md: string;
  meta_description: string;
  status: SitePageStatus;
  sort_order: number;
  /** Reserved for the phase-3 site nav; no UI reads or writes it yet. */
  show_in_nav: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export const SITE_PAGE_COLUMNS =
  'id, parent_id, slug, path, title, headline, lede, body_md, sidebar_md, meta_description, status, sort_order, show_in_nav, created_at, updated_at, updated_by';

type TreeRow = { id: number; parent_id: number | null; sort_order: number };

/**
 * Parent-then-children order with depth, for the indented admin list: siblings by `sort_order` then id, each
 * page's whole subtree directly under it. A row whose parent is missing is shown at the root instead of
 * disappearing from the admin.
 */
export function buildPagesTree<T extends TreeRow>(rows: T[]): { row: T; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<number | null, T[]>();
  for (const r of rows) {
    const key = r.parent_id !== null && ids.has(r.parent_id) ? r.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const out: { row: T; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    const kids = [...(byParent.get(parent) ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    for (const k of kids) {
      out.push({ row: k, depth });
      walk(k.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** A page's path: its parent's path plus its slug ('/about' + 'history' → '/about/history'). */
export function childPath(parentPath: string | null, slug: string): string {
  return `${parentPath ?? ''}/${slug}`;
}

/**
 * First path segments that belong to code routes. The catch-all serves any other published row, so a top-level
 * page named like one of these would be shadowed (or shadow) a real screen — refuse it at create time.
 * `about` and `join` are deliberately absent: they are pages, and their rows already own those paths.
 */
const RESERVED_TOP_LEVEL = new Set([
  'admin',
  'advancement',
  'api',
  'calendar',
  'category',
  'events',
  'favicon',
  'i',
  'library',
  'meeting-plan',
  'member',
  'news',
  'photos',
  'profile',
  'robots',
  'scouts',
  'session-status',
  'signin',
  'sitemap',
  'wreaths'
]);

export function isReservedTopLevelSlug(slug: string): boolean {
  return RESERVED_TOP_LEVEL.has(slug);
}

/**
 * Moving a page up or down swaps places with its neighbour among the SAME parent's children. Returns the two
 * sort_order writes, or null when it is already at that end. Equal sort orders can't trade places, so a tie is
 * broken by renumbering the pair (the mover lands on the requested side).
 */
export function siblingSwap<T extends TreeRow>(
  rows: T[],
  id: number,
  direction: 'up' | 'down'
): { id: number; sort_order: number }[] | null {
  const me = rows.find((r) => r.id === id);
  if (!me) return null;
  const siblings = rows
    .filter((r) => r.parent_id === me.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const at = siblings.findIndex((r) => r.id === id);
  const other = siblings[direction === 'up' ? at - 1 : at + 1];
  if (!other) return null;
  if (me.sort_order === other.sort_order) {
    return direction === 'up'
      ? [
          { id: me.id, sort_order: other.sort_order },
          { id: other.id, sort_order: other.sort_order + 1 }
        ]
      : [
          { id: me.id, sort_order: other.sort_order + 1 },
          { id: other.id, sort_order: other.sort_order }
        ];
  }
  return [
    { id: me.id, sort_order: other.sort_order },
    { id: other.id, sort_order: me.sort_order }
  ];
}
