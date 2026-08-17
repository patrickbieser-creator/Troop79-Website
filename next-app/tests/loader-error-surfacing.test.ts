import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { mustList, mustMaybe } from '../src/lib/db';

/**
 * Loaders must FAIL LOUDLY (lib/db.ts).
 *
 * The regression these guard is a real outage: on 2026-08-16 a migration
 * shipped behind the code that needed it, and every public calendar surface —
 * grid, list, homepage, event pages, and the .ics subscription feed — went
 * silently empty and returned HTTP 200. PostgREST said "column does not
 * exist"; the loaders destructured `{ data }`, dropped `error`, and rendered
 * "no upcoming events", which is indistinguishable from a troop that has
 * none.
 *
 * An empty page is the worst available failure mode here. A 500 is noticed in
 * minutes; an empty calendar looks like the truth.
 */

describe('loader error surfacing', () => {
  // ── the helpers (pure) ───────────────────────────────────────────────────

  it('MustList_Throws_WhenTheQueryFailed', () => {
    expect(() =>
      mustList({ data: null, error: { message: 'column does not exist', code: '42703' } }, 'probe')
    ).toThrow(/probe/);
  });

  it('MustList_IncludesTheContextAndTheDatabaseMessage_SoTheLogIsActionable', () => {
    try {
      mustList({ data: null, error: { message: 'relation "x" does not exist' } }, 'calendar: .ics feed');
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('calendar: .ics feed');
      expect(msg).toContain('relation "x" does not exist');
    }
  });

  it('MustList_ReturnsEmpty_WhenThereAreGenuinelyNoRows', () => {
    // The distinction that matters: no rows is fine, a broken query is not.
    expect(mustList({ data: [], error: null }, 'probe')).toEqual([]);
    expect(mustList<{ id: number }>({ data: null, error: null }, 'probe')).toEqual([]);
  });

  it('MustMaybe_ReturnsNull_ForNoRow_ButThrows_ForABrokenQuery', () => {
    // `const { data }` collapsed these two into the same null. That collapse
    // is the entire bug — a missing event and a missing column both 404'd.
    expect(mustMaybe({ data: null, error: null }, 'probe')).toBeNull();
    expect(() => mustMaybe({ data: null, error: { message: 'boom' } }, 'probe')).toThrow(/probe/);
  });

  // ── against the real client ──────────────────────────────────────────────

  it('MustList_Throws_WhenPostgrestRejectsAMissingColumn', async () => {
    // The exact shape of the 2026-08-16 outage, reproduced end to end: select a
    // column that does not exist and confirm the helper turns it into a throw
    // rather than an empty list.
    const res = await adminClient().from('calendar_entries').select('no_such_column_here');
    expect(res.error, 'expected PostgREST to reject the column').not.toBeNull();
    expect(() => mustList(res as never, 'calendar: probe')).toThrow(/database read failed/);
  });

  // ── the public loaders actually use it ───────────────────────────────────

  it('PublicContentLoaders_DoNotSwallowErrors_OnTheirListReads', () => {
    // Source-level, because the loaders build their own Supabase client and
    // cannot be handed a failing one. Catches a NEW public list read that
    // reverts to the old shape.
    const files = [
      'src/lib/calendar.ts',
      'src/lib/home-feed.ts',
      'src/lib/news-feed.ts',
      'src/lib/event-signup.ts'
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} should import the loud-read helpers`).toMatch(/from '@\/lib\/db'/);
      // `(data ?? [])` is the fingerprint of the swallowed-error shape.
      const swallowed = src.match(/\(data \?\? \[\]\)/g) ?? [];
      expect(swallowed, `${f} still has ${swallowed.length} swallowed list read(s)`).toEqual([]);
    }
  });

  it('EnumerationSafeLookups_AreLeftAlone_OnPurpose', () => {
    // NOT every silent read is a bug. identity-challenge swallows lookup
    // failures because the sign-in flow must not reveal whether an address is
    // on the roster — converting those would be a security regression, not a
    // fix. Asserted so a future sweep does not "helpfully" harden them.
    const src = readFileSync('src/lib/identity-challenge.ts', 'utf8');
    expect(src).not.toMatch(/from '@\/lib\/db'/);
  });
});
