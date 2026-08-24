/**
 * Attendance Report — pure builder shared by the Scouts and Adults tabs
 * (Patrick, 2026-08-24: "the attendance report under roll call should have a
 * tab for scouts and adults").
 *
 * The two tabs read different sources — scouts from `ledger_active` rows of
 * kind `meeting_attendance` (which is also where imported history lives),
 * adults from `event_attendance` on meeting-credit entries — but the arithmetic
 * is the same: per person, distinct dates present out of the dates roll call
 * was taken. Keeping it here means one tested shape and a report page that is
 * only loading and rendering.
 */

export type ReportSortKey = 'pct' | 'name' | 'attended';

export interface ReportPerson {
  id: string;
  name: string;
  /** Patrol for a scout; Leader / Adult for a grown-up. Null renders as —. */
  group: string | null;
}

export interface ReportRow extends ReportPerson {
  attended: number;
  pct: number;
}

export interface AttendanceReport {
  /** Dates roll call was taken on — the percentage's denominator. */
  held: number;
  rows: ReportRow[];
}

/**
 * @param roster   who gets a row — every member listed, attended or not
 * @param pairs    (person, date) presence facts; duplicates are harmless
 * @param heldDates the dates that count — a pair on any other date is ignored,
 *                 so a stray row can never push someone past 100%
 */
export function buildAttendanceReport(
  roster: ReportPerson[],
  pairs: { id: string; date: string }[],
  heldDates: Set<string>
): AttendanceReport {
  const perPerson = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!heldDates.has(p.date)) continue;
    if (!perPerson.has(p.id)) perPerson.set(p.id, new Set());
    perPerson.get(p.id)!.add(p.date);
  }
  const held = heldDates.size;
  const rows = roster.map((person) => {
    const attended = perPerson.get(person.id)?.size ?? 0;
    return { ...person, attended, pct: held > 0 ? attended / held : 0 };
  });
  return { held, rows };
}

export function sortReportRows(rows: ReportRow[], sort: ReportSortKey): ReportRow[] {
  return [...rows].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'attended') return b.attended - a.attended || a.name.localeCompare(b.name);
    return b.pct - a.pct || a.name.localeCompare(b.name);
  });
}
