import { describe, it, expect } from 'vitest';
import { parseTypedDate, formatDateDisplay, toISODate, isValidISODate } from '../src/lib/date-entry';

/**
 * Free-typed date entry for the public DateField (Patrick, 2026-08-21:
 * "far more flexible and accommodating and state-of-the-art" than the
 * native <input type="date"> the profile editors reverted to in Phase C).
 * An explicit grammar — never `Date.parse`, which differs across engines
 * and silently accepts garbage. Every form a family member might plausibly
 * type lands on the same ISO day; anything else is rejected (null) so the
 * field can show an inline hint instead of inventing a date.
 *
 * `today` is injected so the no-year forms are deterministic in tests.
 */
const TODAY = new Date(2026, 7, 21); // 2026-08-21 (local)

describe('parseTypedDate (pure)', () => {
  it('ParsesIso_AndIsoWithSlashOrDotSeparators', () => {
    expect(parseTypedDate('2026-07-25', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('2026/07/25', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('2026.7.5', TODAY)).toBe('2026-07-05');
  });

  it('ParsesUsSlashDashDot_WithFourDigitYear', () => {
    expect(parseTypedDate('7/25/2026', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('07-25-2026', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('7.25.2026', TODAY)).toBe('2026-07-25');
  });

  it('ParsesTwoDigitYears_WithA1950Pivot_SoBirthdatesLandInTheRightCentury', () => {
    expect(parseTypedDate('7/4/12', TODAY)).toBe('2012-07-04');
    expect(parseTypedDate('6/30/82', TODAY)).toBe('1982-06-30');
    expect(parseTypedDate('1/1/49', TODAY)).toBe('2049-01-01');
    expect(parseTypedDate('1/1/50', TODAY)).toBe('1950-01-01');
  });

  it('ParsesMonthAndDayOnly_AsTheCurrentYear', () => {
    expect(parseTypedDate('7/25', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('12-1', TODAY)).toBe('2026-12-01');
  });

  it('ParsesMonthNames_LongOrShort_EitherOrder_WithOrWithoutYearAndComma', () => {
    expect(parseTypedDate('Jul 25, 2026', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('july 25 2026', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('25 Jul 2026', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('25 July, 2026', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('Sept 3', TODAY)).toBe('2026-09-03');
    expect(parseTypedDate('3 September', TODAY)).toBe('2026-09-03');
    expect(parseTypedDate('Jul 25 12', TODAY)).toBe('2012-07-25');
  });

  it('ParsesBareDigitRuns_MMDDYYYY_MMDDYY_AndYYYYMMDD', () => {
    expect(parseTypedDate('07252026', TODAY)).toBe('2026-07-25');
    expect(parseTypedDate('072512', TODAY)).toBe('2012-07-25');
    expect(parseTypedDate('20260725', TODAY)).toBe('2026-07-25');
  });

  it('ParsesRelativeWords_TodayTomorrowYesterday', () => {
    expect(parseTypedDate('today', TODAY)).toBe('2026-08-21');
    expect(parseTypedDate(' Tomorrow ', TODAY)).toBe('2026-08-22');
    expect(parseTypedDate('yesterday', TODAY)).toBe('2026-08-20');
  });

  it('RejectsImpossibleCalendarDates_RatherThanRollingThemOver', () => {
    expect(parseTypedDate('2/30/2026', TODAY)).toBeNull();
    expect(parseTypedDate('2026-13-01', TODAY)).toBeNull();
    expect(parseTypedDate('4/31', TODAY)).toBeNull();
    expect(parseTypedDate('2/29/2027', TODAY)).toBeNull(); // not a leap year
    expect(parseTypedDate('2/29/2028', TODAY)).toBe('2028-02-29'); // leap year
  });

  it('RejectsEmptyAndGarbage_WithNull', () => {
    expect(parseTypedDate('', TODAY)).toBeNull();
    expect(parseTypedDate('   ', TODAY)).toBeNull();
    expect(parseTypedDate('next tuesday', TODAY)).toBeNull();
    expect(parseTypedDate('7/', TODAY)).toBeNull();
    expect(parseTypedDate('2026', TODAY)).toBeNull();
  });
});

describe('formatDateDisplay / toISODate / isValidISODate (pure)', () => {
  it('FormatDateDisplay_RendersIsoAsShortMonthDayYear', () => {
    expect(formatDateDisplay('2026-07-25')).toBe('Jul 25, 2026');
    expect(formatDateDisplay('2012-04-01')).toBe('Apr 1, 2012');
  });

  it('FormatDateDisplay_ReturnsEmpty_ForEmptyOrInvalid', () => {
    expect(formatDateDisplay('')).toBe('');
    expect(formatDateDisplay('garbage')).toBe('');
  });

  it('ToISODate_UsesLocalCalendarFields_NotUtc', () => {
    expect(toISODate(new Date(2026, 0, 1, 23, 30))).toBe('2026-01-01');
  });

  it('IsValidISODate_AcceptsRealDatesOnly', () => {
    expect(isValidISODate('2026-02-28')).toBe(true);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-2-3')).toBe(false);
  });
});
