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

describe('validCriteria (qa-lead: write-side limits)', () => {
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
