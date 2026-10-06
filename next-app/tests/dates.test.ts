import { describe, it, expect } from 'vitest';
import { centralToday, centralToInstant, instantToCentral, isoDate, nextSunday } from '../src/lib/dates';

/**
 * lib/dates is "what day is it" only (2026-08-24 — the two display formatters
 * moved to lib/format-date). These pin the Central-time contract that the
 * date display standard leans on.
 */
describe('centralToday', () => {
  it('CentralToday_IsAnIsoCalendarDay', () => {
    expect(centralToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isoDate', () => {
  it('IsoDate_UsesLocalFields_NotUtc', () => {
    const d = new Date(2026, 6, 12, 23, 30); // local 11:30 PM Jul 12 — UTC may already be Jul 13
    expect(isoDate(d)).toBe('2026-07-12');
  });
});

describe('nextSunday', () => {
  it('NextSunday_IsTodayWhenTodayIsSunday', () => {
    expect(nextSunday('2026-07-12')).toBe('2026-07-12'); // a Sunday
  });

  it('NextSunday_RollsForwardFromAWeekday', () => {
    expect(nextSunday('2026-07-08')).toBe('2026-07-12'); // Wednesday → Sunday
  });

  it('NextSunday_CrossesAMonthBoundary', () => {
    expect(nextSunday('2026-07-27')).toBe('2026-08-02');
  });
});

describe('centralToInstant / instantToCentral', () => {
  it('CentralToInstant_IsDstCorrect', () => {
    expect(centralToInstant('2026-10-24', '09:00')).toBe('2026-10-24T14:00:00.000Z'); // CDT
    expect(centralToInstant('2026-11-07', '16:00')).toBe('2026-11-07T22:00:00.000Z'); // CST
  });

  it('CentralToInstant_IsEmpty_WhenAHalfIsMissing', () => {
    expect(centralToInstant('', '09:00')).toBe('');
    expect(centralToInstant('2026-10-24', '')).toBe('');
  });

  it('InstantToCentral_RoundTripsThePickerValues', () => {
    expect(instantToCentral('2026-10-24T14:00:00+00:00')).toEqual({ date: '2026-10-24', time: '09:00' });
    expect(instantToCentral('2026-10-24T03:30:00Z')).toEqual({ date: '2026-10-23', time: '22:30' });
    expect(instantToCentral(null)).toEqual({ date: '', time: '' });
  });
});
