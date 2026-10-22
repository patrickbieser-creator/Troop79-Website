import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { loadHasNeedsPage } from '../src/lib/has-needs-db';

/**
 * Build a Plan B7 (Plans/Build-A-Plan.md "B7: Has/Needs as a planner tab"), the read: ONE load for the page, with the
 * split computed on the client. The catalog is the shared hourly-cached one (injected here); the rest is one read of
 * the active scouts, the ledger and the awarded badges (paged past PostgREST's 1000-row cap) and, for a seed holder,
 * one read of what is already on the next meetings' plans. Real local database, read-only.
 */
const sb = adminClient();

function counting(target: SupabaseClient, tables: string[]): SupabaseClient {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if ((prop === 'from' || prop === 'rpc') && typeof v === 'function') {
        return (...args: unknown[]) => {
          tables.push(String(args[0]));
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return v;
    }
  });
}

const pages = (rows: number) => Math.floor(rows / 1000) + 1;

describe('the Has/Needs tab load (B7)', () => {
  it('HasNeeds_LoadsInBoundedRoundTrips', async () => {
    const catalog = await fetchAdvancementCatalog(sb);
    const [{ count: ledger }, { count: awarded }] = await Promise.all([
      sb.from('ledger_active').select('id', { count: 'exact', head: true }).in('kind', ['rank_requirement', 'merit_badge_requirement']),
      sb.from('mb_progress').select('scout_id', { count: 'exact', head: true }).eq('awarded', true)
    ]);
    const tables: string[] = [];
    const meetings = [
      { entryId: 1, date: '2094-03-01' },
      { entryId: 2, date: '2094-03-08' },
      { entryId: 3, date: '2094-03-15' },
      { entryId: 4, date: '2094-03-22' }
    ];
    await loadHasNeedsPage(counting(sb, tables), { canSeed: true, loadCatalog: async () => catalog, loadMeetings: async () => meetings });
    const tally = (t: string) => tables.filter((x) => x === t).length;
    expect({
      scouts: tally('scouts'),
      meeting_topics: tally('meeting_topics'),
      ledgerPaged: tally('ledger_active') <= pages(ledger ?? 0),
      awardedPaged: tally('mb_progress') <= pages(awarded ?? 0),
      others: tables.filter((t) => !['scouts', 'meeting_topics', 'ledger_active', 'mb_progress'].includes(t))
    }).toEqual({ scouts: 1, meeting_topics: 1, ledgerPaged: true, awardedPaged: true, others: [] });
  }, 60_000);

  it('HasNeeds_LeavesOutTestPeople', async () => {
    const catalog = await fetchAdvancementCatalog(sb);
    const { data } = await sb.from('scouts').select('id, people!inner(is_test)').eq('active', true).eq('people.is_test', true);
    const testIds = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    const page = await loadHasNeedsPage(sb, { canSeed: false, loadCatalog: async () => catalog });
    expect(page.scouts.filter((x) => testIds.has(x.id)).map((x) => x.displayName)).toEqual([]);
  }, 60_000);
});
