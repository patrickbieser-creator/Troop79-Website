import { describe, it, expect } from 'vitest';
import { formatShortDate } from '../src/lib/dates';

/**
 * Compact numeric date for tight UI (the Weekly Advancement Report's
 * "Recent reports" cards — Patrick, 2026-08-21: "change the date to be
 * mm/dd/yy format"). Pure string work on a yyyy-mm-dd — no Date parsing,
 * so it can never shift a day across timezones.
 */
describe('formatShortDate (pure)', () => {
  it('FormatShortDate_RendersIsoAsMmDdYy', () => {
    expect(formatShortDate('2026-07-06')).toBe('07/06/26');
    expect(formatShortDate('2026-08-17')).toBe('08/17/26');
  });

  it('FormatShortDate_KeepsLeadingZeros_AndTwoDigitYear', () => {
    expect(formatShortDate('2031-01-01')).toBe('01/01/31');
    expect(formatShortDate('2000-12-31')).toBe('12/31/00');
  });

  it('FormatShortDate_PassesThroughAnythingThatIsNotIso_RatherThanInventingADate', () => {
    expect(formatShortDate('')).toBe('');
    expect(formatShortDate('not-a-date')).toBe('not-a-date');
  });
});
