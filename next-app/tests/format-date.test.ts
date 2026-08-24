import { describe, it, expect } from 'vitest';
import {
  fmtDate,
  fmtDateLong,
  fmtDateFull,
  fmtDay,
  fmtDateTime,
  fmtMonthYear,
  fmtRange
} from '../src/lib/format-date';

/**
 * Plans/Date-Display-Standard.md (Patrick, 2026-08-24: "UTC dates and european
 * formats slipping into lists and display"). One module, Central-pinned, that
 * treats the two input kinds explicitly:
 *   · a `date` column ('YYYY-MM-DD') is a calendar day — never fed to new Date(s)
 *     as an instant, which would read as UTC midnight = the evening before in Milwaukee;
 *   · a timestamptz is an instant, always rendered in America/Chicago.
 */
describe('format-date — date columns are calendar days', () => {
  it('DateColumn_RendersThatDay_NotTheUtcMidnightBefore', () => {
    expect(fmtDate('2026-07-01')).toBe('Jul 1, 2026');
    expect(fmtDateLong('2026-07-01')).toBe('July 1, 2026');
    expect(fmtDateFull('2026-07-12')).toBe('Sunday, July 12, 2026');
    expect(fmtDay('2026-07-12')).toBe('Sun, Jul 12');
    expect(fmtMonthYear('2026-07-01')).toBe('July 2026');
  });

  it('YearCanBeDropped_InsideAOneYearList', () => {
    expect(fmtDate('2026-07-12', { year: false })).toBe('Jul 12');
    expect(fmtDay('2026-07-12', { year: true })).toBe('Sun, Jul 12, 2026');
  });

  it('BlankOrGarbage_RendersAnEmDash', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('')).toBe('—');
    expect(fmtDate('not a date')).toBe('—');
  });
});

describe('format-date — timestamps are Central instants', () => {
  it('EveningCentral_StaysOnTheCentralDay_EvenThoughItIsTomorrowInUtc', () => {
    // 2026-07-12 21:30 CDT = 2026-07-13 02:30Z
    expect(fmtDate('2026-07-13T02:30:00.000Z')).toBe('Jul 12, 2026');
    expect(fmtDateTime('2026-07-13T02:30:00.000Z')).toBe('Jul 12, 2026, 9:30 PM');
  });

  it('WinterInstant_UsesCst', () => {
    // 2026-01-10 18:05 CST = 2026-01-11 00:05Z
    expect(fmtDateTime('2026-01-11T00:05:00.000Z')).toBe('Jan 10, 2026, 6:05 PM');
  });

  it('DateObject_IsAnInstantToo', () => {
    expect(fmtDate(new Date('2026-07-13T02:30:00.000Z'))).toBe('Jul 12, 2026');
  });

  it('DateTime_CanCarryTheZoneName_ForEmail', () => {
    expect(fmtDateTime('2026-07-13T02:30:00.000Z', { zone: true })).toBe('Jul 12, 2026, 9:30 PM Central');
  });
});

describe('fmtRange — collapses what it can', () => {
  it('SameMonth_SharesMonthAndYear', () => {
    expect(fmtRange('2026-07-12', '2026-07-14')).toBe('Jul 12–14, 2026');
  });
  it('AcrossMonths_RepeatsTheMonth_SharesTheYear', () => {
    expect(fmtRange('2026-07-30', '2026-08-02')).toBe('Jul 30 – Aug 2, 2026');
  });
  it('AcrossYears_SpellsBothOut', () => {
    expect(fmtRange('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025 – Jan 2, 2026');
  });
  it('SameDayOrMissingEnd_IsJustTheDate', () => {
    expect(fmtRange('2026-07-12', '2026-07-12')).toBe('Jul 12, 2026');
    expect(fmtRange('2026-07-12', null)).toBe('Jul 12, 2026');
  });
});
