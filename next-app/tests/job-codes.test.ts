import { describe, it, expect } from 'vitest';
import {
  bandJobsByDay,
  deriveJobCode,
  isValidJobCode,
  jobHeaderTitle,
  jobWhen,
  normalizeJobCode,
  resolveJobCodes
} from '../src/lib/job-codes';

/**
 * Job codes (Plans/Roster-Status-Tab.md, "job-heavy events" — Patrick,
 * 2026-08-22: "the rummage sale will have 20–30 jobs; we should come up with a
 * plan for how that's displayed on the roster"). One narrow roster column per
 * job, headed by a 1–5 character code the leader sets in the Builder or that
 * is derived from the label; banded by day when the jobs span days.
 */
describe('normalizeJobCode / isValidJobCode', () => {
  it('Code_IsTrimmedAndUppercased_BlankBecomesNull', () => {
    expect(normalizeJobCode('  cash ')).toBe('CASH');
    expect(normalizeJobCode('')).toBeNull();
    expect(normalizeJobCode('   ')).toBeNull();
    expect(normalizeJobCode(null)).toBeNull();
  });

  it('Code_IsOneToFiveLettersOrDigits_NothingElse', () => {
    expect(isValidJobCode('SET')).toBe(true);
    expect(isValidJobCode('S2')).toBe(true);
    expect(isValidJobCode('CASH1')).toBe(true);
    expect(isValidJobCode('TOOLONG')).toBe(false);
    expect(isValidJobCode('SET UP')).toBe(false);
    expect(isValidJobCode('SE-T')).toBe(false);
    expect(isValidJobCode('')).toBe(false);
  });
});

describe('deriveJobCode', () => {
  it('MultiWordLabel_UsesInitials', () => {
    expect(deriveJobCode('Setup crew')).toBe('SC');
    expect(deriveJobCode('Grill — Sat lunch')).toBe('GSL');
    expect(deriveJobCode('Pick up tables, chairs & coolers')).toBe('PUTC'); // capped at four
  });

  it('SingleWordLabel_UsesAConsonantSkeleton_UpToFour', () => {
    expect(deriveJobCode('Cashier')).toBe('CSHR');
    expect(deriveJobCode('Trucks')).toBe('TRCK');
    expect(deriveJobCode('Setup')).toBe('STP');
    expect(deriveJobCode('Grill')).toBe('GRLL');
    expect(deriveJobCode('Bake')).toBe('BK');
  });

  it('NumbersInTheLabel_SurviveAsTokens', () => {
    expect(deriveJobCode('Shift 2')).toBe('S2');
    expect(deriveJobCode('Sorting night 1')).toBe('SN1');
  });

  it('CollidingCode_GetsADigitSuffix_AndStaysWithinFiveChars', () => {
    const taken = new Set(['SC']);
    expect(deriveJobCode('Serve coffee', taken)).toBe('SC2');
    taken.add('SC2');
    expect(deriveJobCode('Sweep corners', taken)).toBe('SC3');
    const long = new Set(['PUTC']);
    expect(deriveJobCode('Pick up tables, chairs & coolers', long)).toBe('PUTC2');
  });

  it('EmptyOrSymbolOnlyLabel_FallsBackToJOB', () => {
    expect(deriveJobCode('')).toBe('JOB');
    expect(deriveJobCode('—')).toBe('JOB');
  });
});

describe('resolveJobCodes', () => {
  it('LeaderCodeWins_DerivedFillsTheRest_AllUniquePerEvent', () => {
    const codes = resolveJobCodes([
      { id: 1, label: 'Setup crew', code: 'SET' },
      { id: 2, label: 'Serve coffee' }, // derives SC
      { id: 3, label: 'Sweep corners' }, // SC taken → SC2
      { id: 4, label: 'Cashier', code: ' cash ' } // normalized
    ]);
    expect(codes.get(1)).toBe('SET');
    expect(codes.get(2)).toBe('SC');
    expect(codes.get(3)).toBe('SC2');
    expect(codes.get(4)).toBe('CASH');
    expect(new Set(codes.values()).size).toBe(4);
  });

  it('DerivedCode_NeverCollidesWithALeaderCodeLaterInTheList', () => {
    // Explicit codes are reserved first, whatever their order.
    const codes = resolveJobCodes([
      { id: 1, label: 'Serve coffee' },
      { id: 2, label: 'Sorting', code: 'SC' }
    ]);
    expect(codes.get(2)).toBe('SC');
    expect(codes.get(1)).toBe('SC2');
  });
});

describe('bandJobsByDay', () => {
  const jobs = [
    { id: 1, label: 'Sorting', slotDate: '2026-10-09' },
    { id: 2, label: 'Cashier', slotDate: '2026-10-10' },
    { id: 3, label: 'Setup', slotDate: '2026-10-09' },
    { id: 4, label: 'Bring a table', slotDate: null },
    { id: 5, label: 'Teardown', slotDate: '2026-10-10' }
  ];

  it('Jobs_AreBandedByDate_InDateOrder_UntimedLast_BuilderOrderWithinADay', () => {
    const bands = bandJobsByDay(jobs);
    expect(bands.map((b) => b.label)).toEqual(['Fri 10/9', 'Sat 10/10', 'Anytime']);
    expect(bands[0].jobs.map((j) => j.id)).toEqual([1, 3]);
    expect(bands[1].jobs.map((j) => j.id)).toEqual([2, 5]);
    expect(bands[2].jobs.map((j) => j.id)).toEqual([4]);
  });

  it('OneBand_WhenEveryJobSharesADay_OrNoneHasOne', () => {
    expect(bandJobsByDay(jobs.filter((j) => j.slotDate === '2026-10-09')).length).toBe(1);
    expect(bandJobsByDay([{ id: 9, label: 'x', slotDate: null }]).map((b) => b.label)).toEqual(['Anytime']);
    expect(bandJobsByDay([]).length).toBe(0);
  });
});

describe('jobWhen / jobHeaderTitle', () => {
  it('When_IsDayAndTimeRange_OnlyThePartsTheJobHas', () => {
    expect(jobWhen({ slotDate: '2026-09-02', startsAt: '17:00:00', endsAt: '19:30:00' })).toBe('Wed Sep 2 · 5:00 PM–7:30 PM');
    expect(jobWhen({ slotDate: '2026-09-02' })).toBe('Wed Sep 2');
    expect(jobWhen({ startsAt: '09:00:00' })).toBe('9:00 AM');
    expect(jobWhen({})).toBe('');
  });

  it('HeaderTitle_IsLabelWhenAndCoverage', () => {
    expect(jobHeaderTitle({ id: 1, label: 'Serve dinner', slotDate: '2026-09-02', startsAt: '17:00:00', endsAt: '19:30:00', needed: 4, filled: 2 })).toBe(
      'Serve dinner · Wed Sep 2 · 5:00 PM–7:30 PM · 2 of 4 claimed'
    );
    expect(jobHeaderTitle({ id: 2, label: 'Bring dessert', filled: 3 })).toBe('Bring dessert · 3 claimed');
    expect(jobHeaderTitle({ id: 3, label: 'Bring dessert' })).toBe('Bring dessert');
  });
});
