import { describe, it, expect } from 'vitest';
import { rankKey, mbKey, splitScouts, withAwardedBadgeLeaves, type HasNeedsScout } from '../src/lib/has-needs';

/**
 * Has/Needs Tool — the pure split/credit logic, extracted for the merit-
 * badge expansion (Jenna's review, 2026-08-30). Three rules pinned here:
 *
 * 1. KEY NAMESPACE — rank and badge ids share one checked-Set, and the old
 *    bare `${id}-${code}` concatenation had no separation between them; the
 *    helpers prefix `rank:`/`mb:` so a rank id can never collide with a
 *    badge id (Jenna's low-probability-collision risk).
 * 2. TRI-BUCKET SPLIT + PARTIAL BREAKDOWN — Has = all checked, Needs =
 *    none, Partial = some, and Partial rows now name WHICH checked keys are
 *    missing (Patrick, 2026-08-30: "do partial now").
 * 3. AWARD IMPLIES LEAVES — a scout whose merit badge is awarded holds
 *    every leaf of that badge even when no individual requirement was ever
 *    logged (fast-entry's blue-card "clean slate bypass"); Patrick,
 *    2026-08-30: fold it silently into Has.
 */

function scout(overrides: Partial<HasNeedsScout> & { id: string }): HasNeedsScout {
  return {
    firstName: overrides.id,
    displayName: overrides.id,
    currentRank: null,
    rankSortOrder: 0,
    heldKeys: [],
    ...overrides
  };
}

describe('key helpers — rank and badge ids can never collide', () => {
  it('PrefixesRankAndBadgeKeysDistinctly_EvenForTheSameIdAndCode', () => {
    expect(rankKey('scout', '1a')).toBe('rank:scout-1a');
    expect(mbKey('cooking', '1a')).toBe('mb:cooking-1a');
    expect(rankKey('cooking', '1a')).not.toBe(mbKey('cooking', '1a'));
  });
});

describe('splitScouts — the tri-bucket split', () => {
  const a = scout({ id: 'a', firstName: 'Ann', heldKeys: [rankKey('scout', '1a'), mbKey('cooking', '2')] });
  const b = scout({ id: 'b', firstName: 'Bea', heldKeys: [rankKey('scout', '1a')] });
  const c = scout({ id: 'c', firstName: 'Cal', heldKeys: [] });

  it('ReturnsEmptyBuckets_WhenNothingIsChecked', () => {
    const r = splitScouts([], [a, b, c]);
    expect(r.has).toEqual([]);
    expect(r.needs).toEqual([]);
    expect(r.partial).toEqual([]);
  });

  it('BucketsHasNeedsPartial_AcrossMixedRankAndBadgeKeys', () => {
    const checked = [rankKey('scout', '1a'), mbKey('cooking', '2')];
    const r = splitScouts(checked, [a, b, c]);
    expect(r.has.map((s) => s.id)).toEqual(['a']);
    expect(r.needs.map((s) => s.id)).toEqual(['c']);
    expect(r.partial.map((p) => p.scout.id)).toEqual(['b']);
  });

  it('NamesTheMissingCheckedKeys_OnEachPartialRow', () => {
    const checked = [rankKey('scout', '1a'), mbKey('cooking', '2'), mbKey('cooking', '3')];
    const r = splitScouts(checked, [a]);
    expect(r.partial).toHaveLength(1);
    expect(r.partial[0].missingKeys).toEqual([mbKey('cooking', '3')]);
  });

  it('SortsEveryBucketByRankThenFirstName', () => {
    const first = scout({ id: 'z', firstName: 'Zoe', rankSortOrder: 1, heldKeys: [] });
    const second = scout({ id: 'm', firstName: 'Amy', rankSortOrder: 2, heldKeys: [] });
    const third = scout({ id: 'n', firstName: 'Ben', rankSortOrder: 2, heldKeys: [] });
    const r = splitScouts([rankKey('scout', '1a')], [third, second, first]);
    expect(r.needs.map((s) => s.id)).toEqual(['z', 'm', 'n']);
  });
});

describe('withAwardedBadgeLeaves — a blue-card award credits every leaf', () => {
  const leafCodesByMb = new Map<string, readonly string[]>([
    ['cooking', ['1', '2a', '2b']],
    ['archery', ['1a']]
  ]);

  it('AddsEveryLeafKeyOfAnAwardedBadge_EvenWithNoLoggedRequirements', () => {
    const held = withAwardedBadgeLeaves([], ['cooking'], leafCodesByMb);
    expect(held.has(mbKey('cooking', '1'))).toBe(true);
    expect(held.has(mbKey('cooking', '2a'))).toBe(true);
    expect(held.has(mbKey('cooking', '2b'))).toBe(true);
  });

  it('LeavesUnawardedBadgesUntouched_AndKeepsLedgerHeldKeys', () => {
    const held = withAwardedBadgeLeaves([rankKey('scout', '1a')], ['cooking'], leafCodesByMb);
    expect(held.has(rankKey('scout', '1a'))).toBe(true);
    expect(held.has(mbKey('archery', '1a'))).toBe(false);
  });

  it('IgnoresAnAwardedBadgeWithNoLoadedRequirementTree', () => {
    const held = withAwardedBadgeLeaves([], ['textile'], leafCodesByMb);
    expect(held.size).toBe(0);
  });
});
