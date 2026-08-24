/**
 * Roll Call list tabs (Patrick, 2026-08-24): "create two tabs to separate the
 * list. Current, sorted by today on top, and past, sorted by most recent on
 * top … the year filter is aware of the dates available in each view and
 * doesn't offer previous years in the Current tab and vice versa."
 *
 * Pure helpers so the split, the per-tab natural order and the per-tab year
 * list are tested without rendering. `today` is the CENTRAL calendar day
 * (lib/dates centralToday) — the server runs in UTC, where "today" flips at
 * 7 PM Milwaukee time.
 */

export type RollCallTab = 'current' | 'past';
export type DateDir = 'asc' | 'desc';

export function splitByToday<T extends { entryDate: string }>(rows: T[], today: string): { current: T[]; past: T[] } {
  const current: T[] = [];
  const past: T[] = [];
  for (const r of rows) (r.entryDate >= today ? current : past).push(r);
  return { current, past };
}

/** Current: soonest first, so today sits on top. Past: most recent first. */
export function naturalDir(tab: RollCallTab): DateDir {
  return tab === 'current' ? 'asc' : 'desc';
}

export function orderByDate<T extends { entryDate: string }>(rows: T[], dir: DateDir): T[] {
  const sorted = [...rows].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return dir === 'asc' ? sorted : sorted.reverse();
}

/** Distinct years present in these rows, newest first — the year filter's options. */
export function yearsOf(rows: { entryDate: string }[]): string[] {
  return [...new Set(rows.map((r) => r.entryDate.slice(0, 4)))].sort().reverse();
}
