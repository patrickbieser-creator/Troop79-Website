import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { planningState, topClasses } from '../src/lib/requirement-class';

/**
 * Build a Plan B9 (Plans/Build-A-Plan.md, "B9: Finding orphans"), the read: who has nothing on a meeting's plan, from
 * ONE scoutCandidatesMany over the plan's and the suggestions' keys (the engine read is the page's cached one, passed
 * in). Real local database. Test-owned rows only: a 2091 meeting deleted by id (its topics and intents go by entry),
 * fixture people and scouts deleted by id. The mirror's own scouts are in the result too, so every check reads only
 * this file's scouts.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const { fetchAdvancementCatalog } = await import('../src/lib/advancement-catalog');
const { setMeetingIntent } = await import('../src/lib/meeting-board');
const { scoutCandidatesMany } = await import('../src/lib/meeting-invites-send');
const { loadOrphans } = await import('../src/lib/build-plan-orphans-db');
const { orphanScouts } = await import('../src/lib/build-plan-orphans');

const sb = adminClient();
let catalog: Awaited<ReturnType<typeof fetchAdvancementCatalog>>;
const loadCatalog = async () => catalog;

let meeting = 0;
let covered = 0; // Scout rank: working on Tenderfoot, which is on the plan
let orphan = 0; // Tenderfoot rank: working on Second Class, nothing of which is on the plan
let away = 0; // Tenderfoot rank, said "Can't make it"
let actor = 0;
let tfKey = '';
let scKeys: string[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
const NO_SUGGESTIONS = { cards: [], scouts: [] };

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} B9O ${label}`, first_name: TEST_PREFIX, last_name: `B9O ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id as number);
  return data!.id as number;
}
async function scout(id: number, rank: string): Promise<void> {
  const sid = `vitest-b9o-${id}`;
  const { error } = await sb.from('scouts').insert({ id: sid, first_name: TEST_PREFIX, last_name: `B9O ${id}`, display_name: `${TEST_PREFIX} B9O ${id}`, person_id: id, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(sid);
}
function counting(): { client: SupabaseClient; calls: () => number } {
  let n = 0;
  const client = new Proxy(sb, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if ((prop === 'from' || prop === 'rpc') && typeof v === 'function') {
        return (...args: unknown[]) => {
          n++;
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return v;
    }
  });
  return { client, calls: () => n };
}
const mineOf = (ids: readonly number[]) => (scouts: readonly { scoutId: string }[]) =>
  scouts.filter((s) => ids.some((id) => s.scoutId === `vitest-b9o-${id}`)).map((s) => s.scoutId);

beforeAll(async () => {
  catalog = await fetchAdvancementCatalog(sb);
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2091-05-20', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id;
  covered = await person('Covered');
  orphan = await person('Orphan');
  away = await person('Away');
  actor = await person('Actor');
  await scout(covered, 'scout');
  await scout(orphan, 'tenderfoot');
  await scout(away, 'tenderfoot');
  const tops = (rank: string) =>
    catalog.rankRequirements
      .filter((r) => r.rank_id === rank && r.parent_id == null && planningState(topClasses(r), 'meeting') !== 'elsewhere' && r.code.toLowerCase() !== 'bor')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => `${rank}-${r.code}`);
  tfKey = tops('tenderfoot')[0];
  scKeys = tops('second-class').slice(0, 4);
  const seeded = await sb.rpc('meeting_seed_topic', { p_entry: meeting, p_key: tfKey, p_actor: actor });
  if (seeded.error) throw new Error(seeded.error.message);
  const said = await setMeetingIntent(sb, { entryId: meeting, personId: away, actorPersonId: away, leader: true }, 'not_coming');
  if (!said.ok) throw new Error(said.error);
}, 60_000);

afterAll(async () => {
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', meeting);
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('B9 orphans read', () => {
  it('Orphans_CountsOnlyTheScoutWithNoLikelyOffering', async () => {
    const data = await loadOrphans(sb, meeting, [tfKey], NO_SUGGESTIONS, { loadCatalog });
    expect(mineOf([covered, orphan, away])(orphanScouts(data, new Set([tfKey])))).toEqual([`vitest-b9o-${orphan}`]);
  });

  it('Orphans_ExcludesCantMakeIt', async () => {
    const data = await loadOrphans(sb, meeting, [tfKey], NO_SUGGESTIONS, { loadCatalog });
    expect(mineOf([away])(data.scouts)).toEqual([]);
  });

  it('Orphans_LoadsInBoundedRoundTrips', async () => {
    const one = counting();
    await scoutCandidatesMany(one.client, { entryId: meeting, keys: [tfKey] }, { loadCatalog });
    const many = counting();
    // The plan plus a suggestions payload with more keys: still ONE scoutCandidatesMany, nothing per key or scout.
    const suggestions = { cards: [], scouts: [{ id: 'x', name: 'X', patrol: null, rankLabel: 'Tenderfoot', nextRankId: 'second-class', items: scKeys.map((key) => ({ key, codeLabel: key, title: key, kind: 'rank' as const, eagle: false, ranks: ['second-class'] })) }] };
    await loadOrphans(many.client, meeting, [tfKey, ...scKeys.slice(0, 2)], suggestions, { loadCatalog });
    expect(many.calls()).toBe(one.calls());
  });
});
