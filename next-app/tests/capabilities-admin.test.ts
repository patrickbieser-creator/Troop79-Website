import { describe, it, expect } from 'vitest';
import { buildGrantRows } from '../src/lib/capabilities-admin';

/**
 * Access & Permissions row ordering (Patrick, 2026-08-19): toggling a single
 * person's capability used to re-sort the ENTIRE table, because the row
 * order was primarily "most capabilities first" — a grant or revoke changes
 * that count and can jump someone to a different position, losing your place
 * mid-edit. Fixed to a stable alphabetical-by-name order regardless of how
 * many capabilities anyone holds.
 */

function people(names: string[]) {
  return names.map((n, i) => ({ id: i + 1, display_name: n }));
}

describe('buildGrantRows row ordering', () => {
  it('AccessScreen_SortsRowsAlphabetically_RegardlessOfCapabilityCount', () => {
    // Zed holds 3 capabilities, Amy holds none — a capability-count sort
    // would put Zed first. Alphabetical must not.
    const rows = buildGrantRows(
      people(['Zed Zephyr', 'Amy Adams', 'Mike Miller']),
      [],
      new Set(),
      [
        { person_id: 1, capability: 'advancement.write', granted_at: '2026-01-01', granted_by: null },
        { person_id: 1, capability: 'roster.manage', granted_at: '2026-01-01', granted_by: null },
        { person_id: 1, capability: 'calendar.write', granted_at: '2026-01-01', granted_by: null }
      ],
      new Map()
    );
    expect(rows.map((r) => r.name)).toEqual(['Amy Adams', 'Mike Miller', 'Zed Zephyr']);
  });

  it('AccessScreen_KeepsSamePosition_WhenAGrantChangesSomeonesCapabilityCount', () => {
    const before = buildGrantRows(
      people(['Amy Adams', 'Mike Miller', 'Zed Zephyr']),
      [],
      new Set(),
      [{ person_id: 2, capability: 'news.write', granted_at: '2026-01-01', granted_by: null }],
      new Map()
    );
    // Same three people, but Mike now holds two capabilities instead of one —
    // simulates the actual toggle that used to trigger a re-sort.
    const after = buildGrantRows(
      people(['Amy Adams', 'Mike Miller', 'Zed Zephyr']),
      [],
      new Set(),
      [
        { person_id: 2, capability: 'news.write', granted_at: '2026-01-01', granted_by: null },
        { person_id: 2, capability: 'calendar.write', granted_at: '2026-01-01', granted_by: null }
      ],
      new Map()
    );
    expect(before.map((r) => r.name)).toEqual(after.map((r) => r.name));
    expect(after.map((r) => r.name)).toEqual(['Amy Adams', 'Mike Miller', 'Zed Zephyr']);
  });
});
