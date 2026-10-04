/**
 * Scout Workspace Phase 3 — who may open a menu, and what a non-owner gets
 * (Plans/Menu-Monster-Scout-Workspace.md, "Phase 3 design" › Review outcome).
 * Pure, so the rules are tested once and every page and list calls the same
 * functions.
 *
 * Order (one place, tech-lead + troop79-specialist review 2026-10-03):
 *   owner          the scout who owns it — edits.
 *   admin          any adult holding an admin capability — every menu, read-only,
 *                  plus the review note and Hide from the shelf.
 *   parent         an ADULT identity whose family scope (resolveFamilyScope:
 *                  parent_of / guardian_of, read at request time) includes the
 *                  owner — read-only, shared or not. A scout identity's scope is
 *                  only themselves, so a sibling never reads an unshared menu.
 *   crew           any other signed-in SCOUT, when the menu is linked to an outing
 *                  (Patrick, 2026-10-03: whoever shops and packs is fluid — "any
 *                  signed-in scout can record, for menus linked to an outing"). The
 *                  menu reads read-only, shared or not; the crew writes only the
 *                  Gear tab's Packed ticks and what was bought. No review note.
 *   shared         anyone else, signed in or not — only while the menu is shared
 *                  and its outing, if it has one, is published.
 * A leader who is also a parent stays `admin` (a superset).
 */

import { sanitizeMenu, type Menu } from './menus';
import type { Catalog } from './types';

export type MenuAccess = 'owner' | 'admin' | 'parent' | 'crew' | 'shared';

export interface AccessViewer {
  kind: 'scout' | 'leader' | 'parent' | 'anon';
  personId: number | null;
  /** For a parent: themselves and the children in their family scope. */
  familyIds: readonly number[];
}

export interface AccessTarget {
  ownerPersonId: number;
  sharedAt: string | null;
  /** null = no outing linked; false = linked to an entry that is not published. */
  entryPublished: boolean | null;
}

export function menuAccess(viewer: AccessViewer, menu: AccessTarget): MenuAccess | null {
  if (viewer.kind === 'scout' && viewer.personId === menu.ownerPersonId) return 'owner';
  if (viewer.kind === 'leader') return 'admin';
  if (viewer.kind === 'parent' && viewer.familyIds.includes(menu.ownerPersonId)) return 'parent';
  // entryPublished is null only when no outing is linked.
  if (viewer.kind === 'scout' && viewer.personId != null && menu.entryPublished != null) return 'crew';
  return isPublic(menu) ? 'shared' : null;
}

/** Who may tick gear as packed and record what was bought: the owner, the outing's crew, and leaders helping. */
export const canRecord = (access: MenuAccess | null): boolean => access === 'owner' || access === 'crew' || access === 'admin';

/** Shared, and not tied to an unpublished outing. A direct link works as long as this holds (no 120-day cut). */
export const isPublic = (menu: Pick<AccessTarget, 'sharedAt' | 'entryPublished'>): boolean => menu.sharedAt != null && menu.entryPublished !== false;

/** Shared menus stay on the shelf this many days after their outing (Decision 15), or after sharing when there is none. */
export const SHELF_DAYS = 120;

export interface ShelfEntry {
  status: string;
  entryDate: string;
  endDate: string | null;
}

/** 'YYYY-MM-DD' minus n days (calendar arithmetic, UTC-safe). */
export function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether a shared menu belongs on the Menu Monster shelf today. The SQL list
 * (listSharedMenusWith) applies the same rule in the query; this is the spec.
 * A sharedAt instant is compared by its UTC date — a day either way at the
 * window's far edge is immaterial.
 */
export function onShelf(sharedAt: string | null, entry: ShelfEntry | null, today: string): boolean {
  if (sharedAt == null) return false;
  const cutoff = daysBefore(today, SHELF_DAYS);
  if (entry == null) return sharedAt.slice(0, 10) >= cutoff;
  return entry.status === 'published' && (entry.endDate ?? entry.entryDate) >= cutoff;
}

/**
 * What a viewer may see of a menu. The owner gets it as stored. Everyone else
 * gets it re-sanitized against the PUBLIC catalog, so the owner's unshared
 * draft recipes (and their edits and shopping choices) drop out —
 * `hiddenRecipes` counts them for the "aren't shared yet" line. A `shared`
 * viewer also loses what the scout paid (an allowlist: everything not rebuilt
 * by sanitizeMenu is cleared here); the owner's unrevealed typed-in
 * ingredients drop out with the public catalog like their drafts.
 */
export function redactMenu(menu: Menu, access: MenuAccess, publicCatalog: Catalog): { menu: Menu; hiddenRecipes: number } {
  if (access === 'owner') return { menu, hiddenRecipes: 0 };
  const clean = sanitizeMenu(menu, publicCatalog);
  const count = (m: Menu) => m.meals.reduce((n, meal) => n + meal.recipeIds.length, 0);
  const hiddenRecipes = count(menu) - count(clean);
  if (access === 'shared') return { menu: { ...clean, actuals: {} }, hiddenRecipes };
  return { menu: clean, hiddenRecipes };
}
