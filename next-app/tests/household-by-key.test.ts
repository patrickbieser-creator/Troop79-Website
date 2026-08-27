import { describe, it, expect } from 'vitest';
import { loadHouseholds, loadHouseholdByKey } from '@/lib/households';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout } from './helpers/signup-fixtures';

/**
 * loadHouseholdByKey() used to be `loadHouseholds().find(...)` — six unbounded
 * table reads to place one family, on every gated event and signup view
 * (Plans/Performance-Review-2026-08-27.md #3). It now fetches only the rows
 * in that household's scope and runs them through the same builder.
 *
 * The contract that makes the scoped read safe: for every key the full loader
 * produces, the scoped loader produces the identical household — same label,
 * same scouts, same adults, same order. Runs against the real local DB so the
 * stored, `scout:`, `leader:` and `person:` key shapes are all exercised on
 * prod-shaped data.
 */
describe('loadHouseholdByKey', () => {
  it('LoadHouseholdByKey_MatchesTheFullRoster_ForEveryKey', async () => {
    // The local roster has no unassigned active scout, so the `scout:` shape
    // comes from a fixture — an active scout with a person and no household.
    const admin = adminClient();
    const unassigned = await createTestScout(admin, 'ByKey');
    try {
      const all = await loadHouseholds();
      expect(all.length).toBeGreaterThan(0);
      const shapes = new Set(all.map((h) => h.key.replace(/[:\d].*$/, '') || 'stored'));
      // Every key shape the roster produces must be represented, or this
      // test proves less than it claims.
      expect([...shapes].sort()).toEqual(['leader', 'person', 'scout', 'stored']);
      expect(all.some((h) => h.key === `scout:${unassigned.scoutId}`)).toBe(true);

      for (const expected of all) {
        const actual = await loadHouseholdByKey(expected.key);
        expect(actual, expected.key).toEqual(expected);
      }
    } finally {
      await deleteTestScout(admin, unassigned);
    }
  });

  it('LoadHouseholdByKey_ReturnsNull_ForAnUnknownKey', async () => {
    expect(await loadHouseholdByKey('999999')).toBeNull();
    expect(await loadHouseholdByKey('scout:nobody')).toBeNull();
    expect(await loadHouseholdByKey('leader:ZZZZ')).toBeNull();
    expect(await loadHouseholdByKey('person:999999')).toBeNull();
    expect(await loadHouseholdByKey('bogus')).toBeNull();
  });
});
