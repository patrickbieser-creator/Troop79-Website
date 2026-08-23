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
 * The only category any code branches on. Stored in the DB as a stable handle
 * so a rename can never silently break the Meetings system the way a name
 * comparison did. ('no_meeting' retired 2026-08-23 — a week with no meeting is
 * a Troop Meeting titled "No Troop Meeting"; nothing branches on it.)
 */
export type CategoryBehavior = 'meeting';

/**
 * Which editor panel set and public renderer a category uses (Calendar
 * unification). A CLOSED set the code branches on, pointed at by the OPEN set
 * of categories Patrick manages — the same split as `behavior`, one level up.
 *
 * Presentation and composition ONLY. A template never gates which layer tables
 * may attach to an entry, so a small event that grows into a big one needs no
 * conversion and no migration — which is what D-081 actually rejected about
 * typed events.
 */
export type CategoryTemplate = 'meeting' | 'activity' | 'announcement';

export const CATEGORY_TEMPLATES: CategoryTemplate[] = ['meeting', 'activity', 'announcement'];

/** The widest template (story + optional signup) — what an unassigned or
 *  unrecognized category renders as. Same posture as FALLBACK_CATEGORY_COLOR:
 *  degrade to the most permissive thing rather than throwing. */
export const FALLBACK_CATEGORY_TEMPLATE: CategoryTemplate = 'activity';

export const TEMPLATE_LABELS: Record<CategoryTemplate, string> = {
  meeting: 'Meeting (agenda)',
  activity: 'Activity (story + signup)',
  announcement: 'Announcement (story only)'
};

export interface CalendarCategoryRow {
  label: string;
  color: string;
  sort_order: number;
  behavior: CategoryBehavior | null;
  template: CategoryTemplate | null;
  /** What Roll Call writes to the ledger for this category, and whether its
   *  entries count toward the "N troop activities" in 1a. Interpreted by
   *  `lib/attendance-shared.ts`; carried here so one category load serves
   *  every consumer. */
  credit_kind: string | null;
  credit_unit: string | null;
  counts_as_activity: boolean;
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
 * The template a category renders through. Tolerant of unknown labels and of a
 * category whose template was never assigned — both fall back to 'activity'.
 */
export function templateOf(rows: CalendarCategoryRow[], category: string): CategoryTemplate {
  return rows.find((r) => r.label === category)?.template ?? FALLBACK_CATEGORY_TEMPLATE;
}

/** True when this category's entries carry an agenda layer. */
export function usesAgenda(rows: CalendarCategoryRow[], category: string): boolean {
  return templateOf(rows, category) === 'meeting';
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
