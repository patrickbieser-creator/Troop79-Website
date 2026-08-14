import { describe, it, expect } from 'vitest';
import { splitByTab, lastDay } from '@/lib/calendar-tabs';

/**
 * The admin calendar list's Upcoming / Past tabs are RETAINED BEHAVIOR across
 * the calendar unification (Patrick, 2026-08-14), not incidental UI. Three
 * rules are easy to lose in a rewrite and easy to get subtly wrong, so they are
 * pinned here:
 *
 *   * a multi-day entry stays upcoming until its LAST day passes;
 *   * today counts as upcoming, not past;
 *   * Past reads newest-first, because the recent thing is what you clone.
 *
 * Meetings now flow through this same split — the merge's visible effect on
 * this screen is that both tab counts jump.
 */

const TODAY = '2026-08-14';

// Ascending by date, as the page loads them.
const rows = [
  { id: 1, entry_date: '2026-08-01', end_date: null },
  { id: 2, entry_date: '2026-08-10', end_date: '2026-08-16' }, // spans today
  { id: 3, entry_date: '2026-08-13', end_date: null },
  { id: 4, entry_date: '2026-08-14', end_date: null }, // today
  { id: 5, entry_date: '2026-08-20', end_date: null }
];

describe('calendar tab split', () => {
  it('EntryList_CountsAnEntryAsUpcoming_WhenItIsToday', () => {
    const { upcoming, past } = splitByTab(rows, TODAY);
    expect(upcoming.map((r) => r.id)).toContain(4);
    expect(past.map((r) => r.id)).not.toContain(4);
  });

  it('EntryList_CountsAMultiDayEntryAsUpcoming_UntilItsLastDayPasses', () => {
    // Started four days ago, ends in two — a campout mid-weekend is not "past".
    const { upcoming } = splitByTab(rows, TODAY);
    expect(upcoming.map((r) => r.id)).toContain(2);
    expect(lastDay(rows[1])).toBe('2026-08-16');
  });

  it('EntryList_OrdersPastNewestFirst_WhenThePastTabIsSelected', () => {
    const { past } = splitByTab(rows, TODAY);
    expect(past.map((r) => r.id)).toEqual([3, 1]);
  });

  it('EntryList_SplitsEveryRow_IntoExactlyOneTab', () => {
    const { upcoming, past } = splitByTab(rows, TODAY);
    expect(upcoming.length + past.length).toBe(rows.length);
  });

  it('LastDay_UsesEntryDate_WhenThereIsNoEndDate', () => {
    expect(lastDay({ entry_date: '2026-08-14', end_date: null })).toBe('2026-08-14');
  });
});
