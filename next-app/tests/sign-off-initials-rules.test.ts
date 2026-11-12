import { describe, it, expect } from 'vitest';
import { initialsShapeProblem, reuseDate, suggestInitials } from '../src/lib/sign-off-initials';

describe('sign-off initials rules', () => {
  it('SuggestInitials_UsesFirstAndLastInitial', () => {
    expect(suggestInitials('Kara', 'Pitt-D’Andrea', ['PB'])).toBe('KP');
  });

  it('SuggestInitials_AddsANumberIfTaken_IgnoringCase', () => {
    expect(suggestInitials('Kara', 'Pitt', ['kp', 'KP2'])).toBe('KP3');
  });

  it('SuggestInitials_FallsBack_WhenTheNameHasNoLetters', () => {
    expect(suggestInitials('', '', [], 'f02')).toBe('F02');
  });

  it('ReuseDate_IsFiveYearsAfterTheNewestEntry', () => {
    expect(reuseDate('2026-10-18')).toBe('2031-10-18');
  });

  it('ReuseDate_FromLeapDay_LandsOnFeb28', () => {
    expect(reuseDate('2024-02-29')).toBe('2029-02-28');
  });

  it('Shape_AcceptsMixedCaseAndATrailingDigit', () => {
    expect(['PB', 'KrP', 'JPII', 'MBa', 'KP2'].map(initialsShapeProblem)).toEqual([null, null, null, null, null]);
  });

  it('Shape_RefusesTooShortTooLongOrSymbols', () => {
    expect(['P', 'ABCDEF', 'P-B', 'KP1', ''].every((c) => initialsShapeProblem(c) != null)).toBe(true);
  });
});
