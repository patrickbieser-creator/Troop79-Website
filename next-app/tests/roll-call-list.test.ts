import { describe, it, expect } from 'vitest';
import { splitByToday, orderByDate, yearsOf, naturalDir } from '../src/lib/roll-call-list';

/**
 * Roll Call list tabs (Patrick, 2026-08-24): "Current, sorted by today on top,
 * and past, sorted by most recent on top … the year filter is aware of the
 * dates available in each view."
 */
const rows = [
  { entryDate: '2026-09-06', title: 'Next meeting' },
  { entryDate: '2026-08-24', title: 'Today' },
  { entryDate: '2026-08-23', title: 'Yesterday' },
  { entryDate: '2025-12-14', title: 'Last winter' },
  { entryDate: '2027-01-10', title: 'Far out' }
];
const TODAY = '2026-08-24';

describe('splitByToday — Current is today and later, Past is before today', () => {
  it('TodayLandsInCurrent_YesterdayInPast', () => {
    const { current, past } = splitByToday(rows, TODAY);
    expect(current.map((r) => r.title).sort()).toEqual(['Far out', 'Next meeting', 'Today']);
    expect(past.map((r) => r.title).sort()).toEqual(['Last winter', 'Yesterday']);
  });
});

describe('orderByDate — Current soonest first (today on top), Past most recent first', () => {
  it('CurrentAscending_TodayOnTop', () => {
    const { current } = splitByToday(rows, TODAY);
    expect(orderByDate(current, naturalDir('current')).map((r) => r.title)).toEqual(['Today', 'Next meeting', 'Far out']);
  });
  it('PastDescending_MostRecentOnTop', () => {
    const { past } = splitByToday(rows, TODAY);
    expect(orderByDate(past, naturalDir('past')).map((r) => r.title)).toEqual(['Yesterday', 'Last winter']);
  });
  it('DoesNotMutateItsInput', () => {
    const copy = [...rows];
    orderByDate(rows, 'asc');
    expect(rows).toEqual(copy);
  });
});

describe('yearsOf — the year filter only offers what the view contains', () => {
  it('CurrentOffersOnlyPresentAndFutureYears_PastOnlyPastOnes', () => {
    const { current, past } = splitByToday(rows, TODAY);
    expect(yearsOf(current)).toEqual(['2027', '2026']);
    expect(yearsOf(past)).toEqual(['2026', '2025']);
  });
});
