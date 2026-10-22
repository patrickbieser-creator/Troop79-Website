import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Build a Plan B0 (Plans/Build-A-Plan.md): scoutCandidatesMany answers "who could this be offered to" for many keys
 * over ONE board load, and agrees exactly with v1's per-scout path (a loadScoutBoard per active scout, the oracle
 * below) for every key. Real local database. Test-owned rows only: a 2091 meeting deleted by id (its topics, picks
 * and intents go by entry), fixture people and scouts deleted by id.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const { fetchAdvancementCatalog } = await import('../src/lib/advancement-catalog');
const { addMeetingPick, loadBoardScouts, loadMeetingById, loadScoutBoard, setMeetingIntent } = await import('../src/lib/meeting-board');
const { pickableKeys } = await import('../src/lib/meeting-board-picklist');
const { boardName, INTENT_LABEL } = await import('../src/lib/meeting-board-shared');
const { scoutCandidatesMany } = await import('../src/lib/meeting-invites-send');

const sb = adminClient();
const loadCatalog = () => fetchAdvancementCatalog(sb);

let meeting = 0;
let picker = 0; // picked keys[0]
let away = 0; // can't make it
let actor = 0; // seeds the merit badge requirement
const people: number[] = [];
const scoutIds: string[] = [];
let keys: string[] = [];

async function person(label: string): Promise<number> {
  const { data, error } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} SCM ${label}`, first_name: TEST_PREFIX, last_name: `SCM ${label}` })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  people.push(data!.id as number);
  return data!.id as number;
}
async function scout(id: number, rank: string): Promise<void> {
  const sid = `vitest-scm-${id}`;
  const { error } = await sb.from('scouts').insert({ id: sid, first_name: TEST_PREFIX, last_name: `SCM ${id}`, display_name: `${TEST_PREFIX} SCM ${id}`, person_id: id, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(sid);
}

/** v1's scoutCandidates, scout by scout: the oracle the batched read must match. */
async function oneByOne(key: string) {
  const m = await loadMeetingById(sb, meeting);
  const catalog = await loadCatalog();
  const out: { personId: number; name: string; note: string; ticked: boolean }[] = [];
  for (const s of await loadBoardScouts(sb)) {
    const board = await loadScoutBoard(sb, m!, s, catalog, { viewerPersonId: null });
    const intent = board.view.intent;
    if (intent === 'not_coming' || !pickableKeys(board.pickList).has(key)) continue;
    const picked = board.picks.some((p) => p.key === key);
    out.push({ personId: s.personId, name: boardName(s.name), note: `${intent ? INTENT_LABEL[intent] : 'no answer'}${picked ? ' · picked it' : ''}`, ticked: !picked });
  }
  return out.sort((a, b) => Number(b.ticked) - Number(a.ticked) || a.name.localeCompare(b.name));
}

/** A client that counts its round trips (every from() and rpc()). */
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

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2091-05-06', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id;
  picker = await person('Picker');
  away = await person('Away');
  actor = await person('Actor');
  await scout(picker, 'scout');
  await scout(away, 'scout');

  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code, venue').is('parent_id', null).in('rank_id', ['tenderfoot', 'second-class']).order('sort_order');
  const rankKeys = ((reqs ?? []) as { rank_id: string; code: string; venue: string }[]).filter((r) => r.venue !== 'outing').map((r) => `${r.rank_id}-${r.code}`);
  const { data: mbReq } = await sb.from('merit_badge_requirements').select('mb_id, code').is('parent_id', null).eq('mb_id', 'first-aid').order('sort_order').limit(1).single();
  const mbKey = `${mbReq!.mb_id}-${mbReq!.code}`;
  keys = [rankKeys[0], rankKeys[1], rankKeys[rankKeys.length - 1], mbKey, 'tenderfoot-no-such-req'];

  const seeded = await sb.rpc('meeting_seed_topic', { p_entry: meeting, p_key: mbKey, p_actor: actor });
  if (seeded.error) throw new Error(seeded.error.message);
  const m = { entryId: meeting, personId: picker, actorPersonId: picker, leader: true, carry: null };
  const picked = await addMeetingPick(sb, m, keys[0], { later: false, markComing: true });
  if (!picked.ok) throw new Error(picked.error);
  const said = await setMeetingIntent(sb, { entryId: meeting, personId: away, actorPersonId: away, leader: true }, 'not_coming');
  if (!said.ok) throw new Error(said.error);
}, 60_000);

afterAll(async () => {
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('scoutCandidatesMany (Build a Plan B0)', () => {
  it('ScoutCandidatesMany_AgreesWithScoutCandidates_PerKey', async () => {
    const many = await scoutCandidatesMany(sb, { entryId: meeting, keys }, { loadCatalog });
    const expected = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await oneByOne(k)] as const)));
    expect(many.ok && Object.fromEntries(keys.map((k) => [k, many.byKey.get(k)]))).toEqual(expected);
  }, 120_000);

  it('ScoutCandidatesMany_QueryCount_DoesNotGrowWithKeys', async () => {
    const one = counting();
    await scoutCandidatesMany(one.client, { entryId: meeting, keys: keys.slice(0, 1) }, { loadCatalog });
    const all = counting();
    await scoutCandidatesMany(all.client, { entryId: meeting, keys }, { loadCatalog });
    expect(all.calls()).toBe(one.calls());
  }, 60_000);

  it('ScoutCandidatesMany_QueryCount_StaysUnderTwenty', async () => {
    const c = counting();
    await scoutCandidatesMany(c.client, { entryId: meeting, keys }, { loadCatalog });
    expect(c.calls()).toBeLessThanOrEqual(20);
  }, 60_000);
});
