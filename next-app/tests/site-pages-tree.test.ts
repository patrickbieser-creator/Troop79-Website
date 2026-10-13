import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildPagesTree, childPath, isReservedTopLevelSlug, siblingSwap } from '../src/lib/site-pages-tree';

/** The admin Pages list is an indented tree (Plans/Content-Managed-Pages.md); these are its pure rules. */
const row = (id: number, parent_id: number | null, slug: string, sort_order: number) => ({
  id,
  parent_id,
  slug,
  sort_order,
  path: parent_id ? `/p${parent_id}/${slug}` : `/${slug}`,
  title: slug
});

describe('pages tree', () => {
  it('PagesTree_OrdersByParentThenSortOrder_WithDepth', () => {
    const rows = [
      row(1, null, 'join', 20),
      row(2, 1, 'second-child', 20),
      row(3, null, 'about', 10),
      row(4, 1, 'first-child', 10),
      row(5, 4, 'grandchild', 0),
      row(6, 3, 'history', 0)
    ];
    expect(buildPagesTree(rows).map((n) => [n.row.slug, n.depth])).toEqual([
      ['about', 0],
      ['history', 1],
      ['join', 0],
      ['first-child', 1],
      ['grandchild', 2],
      ['second-child', 1]
    ]);
  });

  it('PagesTree_BreaksSortOrderTiesById_AndKeepsOrphansReachable', () => {
    const rows = [row(9, null, 'b', 5), row(2, null, 'a', 5), row(7, 99, 'orphan', 0)];
    // A row whose parent is missing is shown at the root instead of vanishing from the admin.
    expect(buildPagesTree(rows).map((n) => [n.row.slug, n.depth])).toEqual([
      ['orphan', 0],
      ['a', 0],
      ['b', 0]
    ]);
  });

  it('ChildPath_JoinsParentPathAndSlug', () => {
    expect(childPath(null, 'history')).toBe('/history');
    expect(childPath('/about', 'history')).toBe('/about/history');
  });

  it('ReservedSlugs_AreTheCodeRoutes_ThatACatchAllMustNeverShadow', () => {
    for (const s of ['events', 'news', 'admin', 'api', 'library', 'signin', 'wreaths']) expect(isReservedTopLevelSlug(s)).toBe(true);
    expect(isReservedTopLevelSlug('history')).toBe(false);
  });

  // qa-lead W2: the list is hand-kept, so a new top-level code route that isn't on it fails here.
  // Wreath sale (Plans/Wreath-Sale.md): the store lives at /wreaths, so a page can never take that address.
  it('CatchAll_ReservesWreathsSlug', () => {
    expect(isReservedTopLevelSlug('wreaths')).toBe(true);
  });

  it('ReservedSlugs_CoverEveryTopLevelCodeRoute_OnDisk', () => {
    const app = join(__dirname, '../src/app');
    const routes = [...readdirSync(join(app, '(public)')), ...readdirSync(app)]
      .filter((n) => /^[a-z][a-z0-9-]*$/.test(n) && !['about', 'join'].includes(n))
      .filter((n) => statSync(existsSync(join(app, '(public)', n)) ? join(app, '(public)', n) : join(app, n)).isDirectory());
    expect(routes.filter((r) => !isReservedTopLevelSlug(r))).toEqual([]);
  });

  it('SiblingSwap_MovesAPageUpOrDown_AmongItsSiblingsOnly', () => {
    const rows = [row(1, null, 'a', 10), row(2, null, 'b', 20), row(3, null, 'c', 30), row(4, 1, 'kid', 10)];
    // Down: b takes c's slot and c takes b's, so the pair swaps and nothing else changes.
    expect(siblingSwap(rows, 2, 'down')).toEqual([
      { id: 2, sort_order: 30 },
      { id: 3, sort_order: 20 }
    ]);
    expect(siblingSwap(rows, 2, 'up')).toEqual([
      { id: 2, sort_order: 10 },
      { id: 1, sort_order: 20 }
    ]);
    // The ends have nowhere to go; an only child neither.
    expect(siblingSwap(rows, 1, 'up')).toBeNull();
    expect(siblingSwap(rows, 3, 'down')).toBeNull();
    expect(siblingSwap(rows, 4, 'down')).toBeNull();
  });

  it('SiblingSwap_StillSwaps_WhenSiblingsShareASortOrder', () => {
    const rows = [row(1, null, 'a', 0), row(2, null, 'b', 0)];
    const swap = siblingSwap(rows, 2, 'up');
    // Equal values can't trade places, so the swap renumbers: the mover lands first.
    expect(swap).toEqual([
      { id: 2, sort_order: 0 },
      { id: 1, sort_order: 1 }
    ]);
  });
});
