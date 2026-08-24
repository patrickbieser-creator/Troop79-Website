import { describe, it, expect } from 'vitest';
import { buildAttendanceReport, sortReportRows } from '../src/lib/attendance-report';

/**
 * Attendance Report — Scouts and Adults tabs (Patrick, 2026-08-24: "the
 * attendance report under roll call should have a tab for scouts and
 * adults"). One pure builder serves both: a roster, the (person, date)
 * presence pairs, and the set of dates roll call was taken on.
 */
const roster = [
  { id: 'a', name: 'Alex', group: 'Hawks' },
  { id: 'b', name: 'Blake', group: 'Hawks' },
  { id: 'c', name: 'Casey', group: null }
];

const pairs = [
  { id: 'a', date: '2026-08-02' },
  { id: 'a', date: '2026-08-09' },
  { id: 'a', date: '2026-08-09' }, // duplicate row must not count twice
  { id: 'b', date: '2026-08-02' },
  { id: 'zz', date: '2026-08-16' } // someone no longer on the roster
];

describe('buildAttendanceReport', () => {
  it('Held_IsTheDistinctDatesInTheHeldSet_NotThePairCount', () => {
    const report = buildAttendanceReport(roster, pairs, new Set(['2026-08-02', '2026-08-09', '2026-08-16']));
    expect(report.held).toBe(3);
  });

  it('Attended_CountsDistinctDates_AndOnlyDatesInTheHeldSet', () => {
    const report = buildAttendanceReport(roster, pairs, new Set(['2026-08-02', '2026-08-09']));
    const alex = report.rows.find((r) => r.id === 'a')!;
    expect(alex.attended).toBe(2);
    expect(alex.pct).toBe(1);
  });

  it('EveryRosterMember_GetsARow_EvenWithNoAttendance', () => {
    const report = buildAttendanceReport(roster, pairs, new Set(['2026-08-02']));
    const casey = report.rows.find((r) => r.id === 'c')!;
    expect(casey).toEqual({ id: 'c', name: 'Casey', group: null, attended: 0, pct: 0 });
  });

  it('PeopleOffTheRoster_AreLeftOut', () => {
    const report = buildAttendanceReport(roster, pairs, new Set(['2026-08-16']));
    expect(report.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('Pct_IsZero_WhenNothingWasHeld', () => {
    const report = buildAttendanceReport(roster, [], new Set());
    expect(report.held).toBe(0);
    expect(report.rows.every((r) => r.pct === 0)).toBe(true);
  });
});

describe('sortReportRows', () => {
  const rows = buildAttendanceReport(roster, pairs, new Set(['2026-08-02', '2026-08-09'])).rows;

  it('DefaultsToPercentDescending_ThenName', () => {
    expect(sortReportRows(rows, 'pct').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('ByName_IsAlphabetical', () => {
    expect(sortReportRows([...rows].reverse(), 'name').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('ByAttended_IsCountDescending_ThenName', () => {
    expect(sortReportRows(rows, 'attended').map((r) => r.attended)).toEqual([2, 1, 0]);
  });
});
