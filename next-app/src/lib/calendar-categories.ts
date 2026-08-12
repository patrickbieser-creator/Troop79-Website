/**
 * Calendar category vocabulary (D-082) — pure helpers only.
 *
 * Categories moved out of a hardcoded CHECK/TS-union pair and into the
 * `calendar_categories` table so Patrick can add, rename, recolor and reorder
 * them without a deploy. That means every consumer needs the rows passed IN
 * (server components load them; client components receive them as props) —
 * there is no module-level map to reach for any more.
 *
 * This file deliberately imports nothing: like `calendar-shared.ts`, it is
 * imported by Client Components, so it must not pull in the server-only
 * Supabase client. The loader lives in `lib/calendar.ts`.
 */

/**
 * The only two categories any code branches on. Stored in the DB as a stable
 * handle so a rename ("No Meeting" → "No Meeting (Holiday)") can never
 * silently break the Meetings system the way a name comparison did.
 */
export type CategoryBehavior = 'meeting' | 'no_meeting';

export interface CalendarCategoryRow {
  label: string;
  color: string;
  sort_order: number;
  behavior: CategoryBehavior | null;
}

/**
 * Swatch for a category this render doesn't know about — a row written by hand,
 * or a category added by another leader between a page's category load and its
 * entry load. Callers feed colors to hexToRgba(), which throws on undefined; a
 * neutral swatch is a far better failure than a blank /events.
 */
export const FALLBACK_CATEGORY_COLOR = '#a0978a';

export type CategoryColorMap = Record<string, string>;

export function categoryColorMap(rows: CalendarCategoryRow[]): CategoryColorMap {
  const map: CategoryColorMap = {};
  for (const row of rows) map[row.label] = row.color;
  return map;
}

export function colorFor(map: CategoryColorMap, category: string): string {
  return map[category] ?? FALLBACK_CATEGORY_COLOR;
}

/** Display order for legends, filter chips and every category <select>. */
export function sortedCategoryLabels(rows: CalendarCategoryRow[]): string[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order).map((r) => r.label);
}

/** The behavior a category carries, or null — tolerant of unknown labels. */
export function behaviorOf(rows: CalendarCategoryRow[], category: string): CategoryBehavior | null {
  return rows.find((r) => r.label === category)?.behavior ?? null;
}

/**
 * Current labels for the given behaviors, for queries that used to hardcode
 * category names (`lib/meetings.ts`, the rosters/events screens).
 */
export function labelsForBehavior(
  rows: CalendarCategoryRow[],
  ...behaviors: CategoryBehavior[]
): string[] {
  return rows.filter((r) => r.behavior !== null && behaviors.includes(r.behavior)).map((r) => r.label);
}
