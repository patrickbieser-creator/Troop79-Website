import { describe, it, expect } from 'vitest';
import { indexDirectory } from '@/lib/person-directory';

/**
 * indexDirectory() replaced `directory.find(p => p.person_id === id)` inside
 * a loop over household memberships in advancement/roster/page.tsx — O(n²)
 * over 100 people × 100 memberships (Plans/Performance-Review-2026-08-27.md
 * #17). Pure, no DB — the contract is just "same lookup answer, O(1) per
 * call instead of O(rows)".
 */
describe('indexDirectory', () => {
  it('IndexDirectory_MapsEachRowByPersonId_ForLookup', () => {
    const rows = [
      { person_id: 1, display_name: 'Alice' },
      { person_id: 2, display_name: 'Bob' }
    ];
    const byId = indexDirectory(rows);
    expect(byId.get(1)?.display_name).toBe('Alice');
    expect(byId.get(2)?.display_name).toBe('Bob');
  });

  it('IndexDirectory_ReturnsUndefined_ForAnUnknownPersonId', () => {
    const byId = indexDirectory([{ person_id: 1, display_name: 'Alice' }]);
    expect(byId.get(999)).toBeUndefined();
  });

  it('IndexDirectory_LastRowWins_WhenPersonIdRepeats', () => {
    // person_directory is one row per person, so this shouldn't happen in
    // practice — but the Map semantics (last write wins) should be explicit,
    // not an accident of insertion order nobody decided on.
    const rows = [
      { person_id: 1, display_name: 'First' },
      { person_id: 1, display_name: 'Second' }
    ];
    expect(indexDirectory(rows).get(1)?.display_name).toBe('Second');
  });

  it('IndexDirectory_ReturnsAnEmptyMap_ForAnEmptyArray', () => {
    expect(indexDirectory([]).size).toBe(0);
  });
});
