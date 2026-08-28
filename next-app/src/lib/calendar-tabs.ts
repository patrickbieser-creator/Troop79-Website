/**
 * Upcoming / Past split for the admin calendar list — pure, so the three rules
 * that are easy to lose in a rewrite can be tested directly.
 *
 * Extracted during the calendar unification (Patrick: "the plan should retain
 * the tabbed upcoming and past currently in the events"). The tabs are retained
 * BEHAVIOR, not incidental UI, and meetings now appear in them alongside
 * everything else on a date.
 *
 * No imports: this is used by a Client Component.
 */

export interface DatedRow {
  entry_date: string;
  end_date: string | null;
}

/** The entry's last calendar day. A multi-day event counts as upcoming until
 *  its LAST day has passed — a Friday-to-Sunday campout is not "past" on
 *  Saturday. */
export function lastDay(row: DatedRow): string {
  return row.end_date ?? row.entry_date;
}

export function isUpcoming(row: DatedRow, today: string): boolean {
  return lastDay(row) >= today;
}

/**
 * Splits rows given ASCENDING by date.
 *
 * Past is reversed to newest-first: the most recent thing is what you are
 * usually looking for when you go back, and it is what you are usually cloning.
 */
export function splitByTab<T extends DatedRow>(rows: T[], today: string): { upcoming: T[]; past: T[] } {
  return {
    upcoming: rows.filter((r) => isUpcoming(r, today)),
    past: rows.filter((r) => !isUpcoming(r, today)).slice().reverse()
  };
}

/**
 * The admin Calendar list's default server-side read window (Patrick,
 * 2026-08-27 perf pass, item 14): `entry_date >= rollingWindowStart(today)`
 * loads a year of history instead of every entry ever, with `?past=all`
 * (page.tsx) as the escape hatch. Noon-UTC arithmetic, same trick as
 * nextSunday in lib/dates.ts, so a UTC-midnight `setUTCFullYear` never lands
 * on the wrong side of a DST boundary.
 */
export function rollingWindowStart(today: string, yearsBack = 1): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - yearsBack);
  return d.toISOString().slice(0, 10);
}
