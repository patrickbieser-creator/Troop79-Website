import { describe, it, expect } from 'vitest';
import { buildHappened, pastWeekPage, plannedKeyTest, rankAsOf } from '@/lib/past-meeting';

/**
 * Planner: a past meeting, view only (2026-11-09). Pure pieces: the past-weeks strip, each scout's rank as of the
 * meeting (so the groups are the ones that night, not today's), and the "What happened" summary.
 */

const past = [
  { entryId: 10, date: '2026-11-08' },
  { entryId: 9, date: '2026-11-01' },
  { entryId: 8, date: '2026-10-25' },
  { entryId: 7, date: '2026-10-18' },
  { entryId: 6, date: '2026-10-11' },
  { entryId: 5, date: '2026-10-04' },
  { entryId: 4, date: '2026-09-27' },
  { entryId: 3, date: '2026-09-20' }
];

describe('pastWeekPage', () => {
  it('PastWeekPage_ListsTheNewestPageOldestFirst_WhenTheLatestIsSelected', () => {
    expect(pastWeekPage(past, 10, 3)?.weeks.map((w) => w.entryId)).toEqual([8, 9, 10]);
  });

  it('PastWeekPage_OffersTheNextOlderMeeting_WhenOlderOnesExist', () => {
    expect(pastWeekPage(past, 10, 3)?.olderId).toBe(7);
  });

  it('PastWeekPage_OffersNoNewerPage_OnTheNewestPage', () => {
    expect(pastWeekPage(past, 9, 3)?.newerId).toBeNull();
  });

  it('PastWeekPage_OffersTheOldestOfTheNewerPage_OnAnOlderPage', () => {
    expect(pastWeekPage(past, 6, 3)?.newerId).toBe(8);
  });

  it('PastWeekPage_OffersNoOlder_OnTheOldestPage', () => {
    expect(pastWeekPage(past, 3, 3)?.olderId).toBeNull();
  });

  it('PastWeekPage_ReturnsNull_WhenTheMeetingIsNotInThePastList', () => {
    expect(pastWeekPage(past, 99, 3)).toBeNull();
  });
});

describe('rankAsOf', () => {
  const ranks = [
    { id: 'scout', sort_order: 0 },
    { id: 'tenderfoot', sort_order: 1 },
    { id: 'second-class', sort_order: 2 }
  ];

  it('RankAsOf_TakesTheHighestRankAwardedBeforeTheDate', () => {
    const awards = [
      { scoutId: 'A1', code: 'scout', date: '2026-01-01' },
      { scoutId: 'A1', code: 'tenderfoot', date: '2026-05-01' }
    ];
    expect(rankAsOf(awards, '2026-11-08', ranks).get('A1')).toBe('tenderfoot');
  });

  it('RankAsOf_IgnoresAnAwardOnOrAfterTheMeetingDate', () => {
    const awards = [
      { scoutId: 'A1', code: 'scout', date: '2026-01-01' },
      { scoutId: 'A1', code: 'tenderfoot', date: '2026-11-08' }
    ];
    expect(rankAsOf(awards, '2026-11-08', ranks).get('A1')).toBe('scout');
  });

  it('RankAsOf_LeavesAScoutWithNoEarlierAwardOut', () => {
    expect(rankAsOf([{ scoutId: 'A1', code: 'scout', date: '2026-12-01' }], '2026-11-08', ranks).has('A1')).toBe(false);
  });
});

describe('buildHappened', () => {
  const base = {
    attendance: [1, 2, 3],
    scoutPersonIds: new Set([1, 2]),
    personNames: new Map([
      [1, 'Ava Smith'],
      [2, 'Ben Jones'],
      [3, 'Mr. Adult']
    ]),
    scoutNames: new Map([
      ['A1', 'Ava Smith'],
      ['B1', 'Ben Jones']
    ]),
    planned: (key: string) => key.startsWith('tenderfoot-'),
    words: (key: string) => `Words ${key}`,
    awardWords: (code: string) => `Award ${code}`
  };

  it('BuildHappened_SplitsAttendanceIntoScoutsAndAdults', () => {
    const h = buildHappened({ ...base, ledger: [] });
    expect(h.attended).toEqual({ scouts: ['Ava Smith', 'Ben Jones'], adults: ['Mr. Adult'] });
  });

  it('BuildHappened_GroupsSignOffsByRequirementWithTheScoutsNames', () => {
    const ledger = [
      { scoutId: 'B1', kind: 'rank_requirement', code: 'tenderfoot-4a' },
      { scoutId: 'A1', kind: 'rank_requirement', code: 'tenderfoot-4a' }
    ];
    expect(buildHappened({ ...base, ledger }).signedOff).toEqual([{ key: 'tenderfoot-4a', label: 'Words tenderfoot-4a', names: ['Ava Smith', 'Ben Jones'], planned: true }]);
  });

  it('BuildHappened_MarksASignOffThatWasNotOnThePlan', () => {
    const ledger = [{ scoutId: 'A1', kind: 'merit_badge_requirement', code: 'first-aid-1' }];
    expect(buildHappened({ ...base, ledger }).signedOff[0].planned).toBe(false);
  });

  it('BuildHappened_ListsAwardsSeparatelyFromRequirements', () => {
    const ledger = [{ scoutId: 'A1', kind: 'rank_award', code: 'tenderfoot' }];
    expect(buildHappened({ ...base, ledger }).earned).toEqual([{ label: 'Award tenderfoot', names: ['Ava Smith'] }]);
  });

  it('BuildHappened_PutsTheMostSignedOffRequirementFirst', () => {
    const ledger = [
      { scoutId: 'A1', kind: 'rank_requirement', code: 'tenderfoot-1' },
      { scoutId: 'A1', kind: 'rank_requirement', code: 'tenderfoot-2' },
      { scoutId: 'B1', kind: 'rank_requirement', code: 'tenderfoot-2' }
    ];
    expect(buildHappened({ ...base, ledger }).signedOff.map((r) => r.key)).toEqual(['tenderfoot-2', 'tenderfoot-1']);
  });
});

describe('plannedKeyTest', () => {
  const plan = { focus: [{ members: ['tenderfoot-4a', 'tenderfoot-4b'] }], seededSingles: ['second-class-2a'], nightBadges: ['climbing'] };

  it('PlannedKey_IsTrue_ForAFocusMember', () => {
    expect(plannedKeyTest(plan)('tenderfoot-4b')).toBe(true);
  });

  it('PlannedKey_IsTrue_ForASingleRequirementSeededByHand', () => {
    expect(plannedKeyTest(plan)('second-class-2a')).toBe(true);
  });

  it('PlannedKey_IsTrue_ForAnyRequirementOfABadgeOfTheNight', () => {
    expect(plannedKeyTest(plan)('climbing-5c')).toBe(true);
  });

  it('PlannedKey_IsFalse_ForAnythingElse', () => {
    expect(plannedKeyTest(plan)('first-aid-1')).toBe(false);
  });
});

describe('buildHappened, a scout no longer on the roster', () => {
  it('BuildHappened_NamesAFormerScout_NotTheirId', () => {
    const h = buildHappened({
      attendance: [],
      scoutPersonIds: new Set(),
      personNames: new Map(),
      scoutNames: new Map(),
      ledger: [{ scoutId: 'Z99', kind: 'rank_requirement', code: 'tenderfoot-1' }],
      planned: () => true,
      words: (k) => k,
      awardWords: (c) => c
    });
    expect(h.signedOff[0].names).toEqual(['A former scout']);
  });
});
