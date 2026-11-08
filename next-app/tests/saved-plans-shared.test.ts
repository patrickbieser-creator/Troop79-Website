import { describe, it, expect } from 'vitest';
import { cleanPlanName, filterPlans, planBadges, planSummary, removedByLoad, validCriteria, type SavedPlan } from '../src/lib/saved-plans-shared';

/**
 * Saved meeting plans (Patrick, 2026-10-29), the client-safe part: a name's rules, the load list's search, merit
 * badge filter and date sort, the one-line summary, and what a load would take off the meeting. Pure.
 */
const plan = (id: number, name: string, planDate: string, o: Partial<SavedPlan['criteria']> = {}): SavedPlan => ({
  id,
  name,
  planDate,
  updatedAt: '2026-10-29T00:00:00Z',
  createdBy: null,
  criteria: { focus: [], singles: [], badges: [], ...o }
});
const BADGE_IDS = ['first-aid', 'first', 'cooking'];

describe('cleanPlanName', () => {
  it('TrimsAndCollapsesSpaces', () => {
    expect(cleanPlanName('  First   aid night ')).toBe('First aid night');
  });

  it('RefusesBlankOrTooLong', () => {
    expect([cleanPlanName('   '), cleanPlanName('x'.repeat(81))]).toEqual([null, null]);
  });
});

describe('planBadges', () => {
  it('CountsNightBadgesAndBadgeRequirements_ByTheLongestId', () => {
    const p = plan(1, 'A', '2026-11-01', { badges: ['cooking'], singles: ['first-aid-2'], focus: [{ setId: 1, title: 'X', items: ['tenderfoot-4a'] }] });
    expect(planBadges(p.criteria, BADGE_IDS).sort()).toEqual(['cooking', 'first-aid']);
  });
});

describe('filterPlans', () => {
  const plans = [plan(1, 'First aid night', '2026-11-01', { badges: ['first-aid'] }), plan(2, 'Knots', '2026-12-06'), plan(3, 'Cooking crew', '2026-10-04', { badges: ['cooking'] })];

  it('SearchesByName', () => {
    expect(filterPlans(plans, { q: 'knot', mbId: null, sort: 'newest' }, BADGE_IDS).map((p) => p.id)).toEqual([2]);
  });

  it('FiltersByMeritBadge', () => {
    expect(filterPlans(plans, { q: '', mbId: 'cooking', sort: 'newest' }, BADGE_IDS).map((p) => p.id)).toEqual([3]);
  });

  it('SortsByDate_NewestOrOldest', () => {
    expect([filterPlans(plans, { q: '', mbId: null, sort: 'newest' }, BADGE_IDS).map((p) => p.id), filterPlans(plans, { q: '', mbId: null, sort: 'oldest' }, BADGE_IDS).map((p) => p.id)]).toEqual([
      [2, 1, 3],
      [3, 1, 2]
    ]);
  });
});

describe('planSummary', () => {
  it('CountsEachKindInWords', () => {
    expect(planSummary(plan(1, 'A', '2026-11-01', { focus: [{ setId: 1, title: 'X', items: ['a'] }], badges: ['first-aid', 'cooking'], singles: ['tenderfoot-5'] }).criteria)).toBe(
      '1 focus set · 2 merit badges · 1 added requirement'
    );
  });

  it('SaysNothingWhenEmpty', () => {
    expect(planSummary(plan(1, 'A', '2026-11-01').criteria)).toBe('Nothing saved');
  });
});

describe('removedByLoad', () => {
  it('NamesWhatTheMeetingLoses_AndKeepsWhatTheSavedPlanAlsoHas', () => {
    const current = {
      focus: [
        { key: 'fg:1', setId: 1, name: 'First aid' },
        { key: 'fg:2', setId: 2, name: 'Knots' }
      ],
      badges: [
        { mbId: 'first-aid', name: 'First Aid', direct: true },
        { mbId: 'cooking', name: 'Cooking', direct: false }
      ],
      extras: [{ key: 'tenderfoot-5', title: 'Swim', origin: 'planner' as const }]
    };
    const saved = plan(1, 'A', '2026-11-01', { focus: [{ setId: 1, title: 'First aid', items: ['a'] }], badges: [] }).criteria;
    expect(removedByLoad(current, saved)).toEqual(['Knots', 'First Aid merit badge', 'Swim']);
  });
});

const BASE = { focus: [{ setId: 1, title: 'First aid', items: ['tenderfoot-4a'] }], singles: [], badges: [] };

describe('validCriteria (qa-lead: write-side limits)', () => {
  it('Splits_OfARankGroup_WithTwoOrThreeGroupsAndRisingLevels_AreValid', () => {
    expect(validCriteria({ ...BASE, splits: [{ group: 'fr:tenderfoot', sections: [['tenderfoot-4a'], ['tenderfoot-8']], levels: [0, 4] }] })).toBe(true);
  });

  it('Splits_ThatAreMalformed_AreRefused', () => {
    const bad = [
      { group: 'fr:tenderfoot~2', sections: [['tenderfoot-4a'], ['tenderfoot-8']], levels: [0, 4] },
      { group: 'fr:tenderfoot', sections: [['tenderfoot-4a']], levels: [0] },
      { group: 'fr:tenderfoot', sections: [['fr:scout'], ['tenderfoot-8']], levels: [0, 4] },
      { group: 'fr:tenderfoot', sections: [['tenderfoot-4a'], ['tenderfoot-8']], levels: [0, -1] }
    ];
    expect(bad.map((x) => validCriteria({ ...BASE, splits: [x] }))).toEqual([false, false, false, false]);
  });

  const ok = { focus: [{ setId: 1, title: 'First aid', items: ['tenderfoot-4a'] }], singles: ['first-class-1a'], badges: ['first-aid'] };

  it('AcceptsWhatThePlannerMakes', () => {
    expect(validCriteria(ok)).toBe(true);
  });

  it('RefusesTokenKeysBadIdsAndOversizedCriteria', () => {
    expect([
      validCriteria({ ...ok, singles: ['fg:12'] }),
      validCriteria({ ...ok, badges: ['Not A Badge!'] }),
      validCriteria({ ...ok, focus: [1, 2, 3].map((n) => ({ setId: n, title: 'x', items: Array.from({ length: 300 }, (_, i) => `tenderfoot-${'x'.repeat(100)}${i}`) })) })
    ]).toEqual([false, false, false]);
  });
});

describe('validCriteria: stations (step 6)', () => {
  it('Stations_AsIndexesIntoTheFocus_AreValid', () => {
    expect(validCriteria({ ...BASE, stations: [0] })).toBe(true);
  });

  it('Stations_PointingPastTheFocus_AreRefused', () => {
    expect(validCriteria({ ...BASE, stations: [1] })).toBe(false);
  });

  it('Stations_Repeated_AreRefused', () => {
    expect(validCriteria({ focus: [...BASE.focus, { setId: 2, title: 'B', items: ['tenderfoot-4b'] }], singles: [], badges: [], stations: [0, 0] })).toBe(false);
  });

  it('Stations_NotWholeNumbers_AreRefused', () => {
    expect(validCriteria({ ...BASE, stations: [0.5] })).toBe(false);
  });
});
