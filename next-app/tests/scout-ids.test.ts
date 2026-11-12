import { describe, it, expect } from 'vitest';
import { nextWebelosId } from '../src/lib/scout-ids';

/**
 * Troop IDs are joining cohorts: a letter per cohort (A ≈ 2020 … E = 2025–26)
 * and a two-digit number. A Webelos gets the NEXT cohort's letter when they
 * join and keeps the ID through crossover (Patrick, 2026-11-12).
 */
const s = (id: string, active = true, is_webelos = false) => ({ id, active, is_webelos });

describe('nextWebelosId', () => {
  it('FirstWebelos_GetsTheLetterAfterTheNewestActiveCohort', () => {
    expect(nextWebelosId([s('D08'), s('E13'), s('E02', false)])).toBe('F01');
  });

  it('InactiveOddIds_DoNotMoveTheCohort', () => {
    // T01 is an inactive test scout — it is not a cohort.
    expect(nextWebelosId([s('E13'), s('T01', false)])).toBe('F01');
  });

  it('LaterWebelos_ContinueTheWebelosCohort', () => {
    expect(nextWebelosId([s('E13'), s('F01', false, true), s('F02', false, true)])).toBe('F03');
  });

  it('CrossedOverScoutsInTheNewCohort_StillCount', () => {
    expect(nextWebelosId([s('E13'), s('F01'), s('F02', false, true)])).toBe('F03');
  });

  it('NoScoutsAtAll_StartsAtA01', () => {
    expect(nextWebelosId([])).toBe('A01');
  });
});
