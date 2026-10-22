import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Build a Plan B1 (Plans/Build-A-Plan.md): Add from a suggestion (plannerAddOfferingAction → meeting_seed_many, one
 * lock, idempotent per key) and Remove a seeded row (the unseed). Seed holders only, refused before any write; an Add
 * costs the same few round trips however many keys it carries. Real local database; the admin actor is mocked.
 * Test-owned rows only: a 2093 meeting deleted by id (its topics and picks go by entry), fixture people and scouts
 * deleted by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> },
  /** When set, the actions' client counts its round trips here. */
  counter: null as null | { n: number }
}));

/** A client that counts its round trips (every from() and rpc()). */
function counting(target: SupabaseClient, counter: { n: number }): SupabaseClient {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if ((prop === 'from' || prop === 'rpc') && typeof v === 'function') {
        return (...args: unknown[]) => {
          counter.n++;
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return v;
    }
  });
}

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => (state.counter ? counting(make(), state.counter) : make()) };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const actions = () => import('../src/app/(public)/planner/build-actions');

const people: number[] = [];
const scoutIds: string[] = [];
let meeting = 0;
let seeder = 0;
let editor = 0;
let picker = 0;
let keys: string[] = [];

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} BAP ${label}`, first_name: `${TEST_PREFIX} BAP`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function seededKeys(): Promise<string[]> {
  const { data, error } = await sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', meeting).not('seeded_at', 'is', null).order('topic_key');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { topic_key: string }[]).map((r) => r.topic_key);
}
async function topicKeys(): Promise<string[]> {
  const { data, error } = await sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', meeting).order('topic_key');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { topic_key: string }[]).map((r) => r.topic_key);
}
async function clearTopics() {
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
}
const asSeeder = () => (state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed']) });

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2093-03-01', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  seeder = await person('Seeder');
  editor = await person('Editor');
  picker = await person('Picker');
  const sid = `vitest-bap-${picker}`;
  const sc = await sb.from('scouts').insert({ id: sid, first_name: `${TEST_PREFIX} BAP`, last_name: 'Picker', display_name: `${TEST_PREFIX} BAP Picker`, person_id: picker, active: true, current_rank: 'scout' });
  if (sc.error) throw new Error(sc.error.message);
  scoutIds.push(sid);
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(3);
  keys = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
});

afterAll(async () => {
  await clearTopics();
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('Build a Plan B1: Add and Remove', () => {
  it('NonSeeder_IsRefused_WhenAddingOffering', async () => {
    await clearTopics();
    state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit', 'meeting_planner.view']) };
    const res = await (await actions()).plannerAddOfferingAction({ entryId: meeting, keys: [keys[0]] });
    expect({ res, topics: await topicKeys() }).toEqual({ res: { ok: false, error: 'Only the planning team can seed a meeting.' }, topics: [] });
  });

  it('BuildPlan_AddSuggestion_UsesBoundedRoundTrips', async () => {
    asSeeder();
    const { plannerAddOfferingAction } = await actions();
    const trips = async (ks: string[]) => {
      await clearTopics();
      state.counter = { n: 0 };
      try {
        const res = await plannerAddOfferingAction({ entryId: meeting, keys: ks });
        if (!res.ok) throw new Error(res.error);
        return state.counter.n;
      } finally {
        state.counter = null;
      }
    };
    // The meeting read, one meeting_seed_many call, the stamp: three, for one key or three.
    expect({ one: await trips(keys.slice(0, 1)), three: await trips(keys) }).toEqual({ one: 3, three: 3 });
  });

  it('SeedMany_IsIdempotent_PerKey', async () => {
    await clearTopics();
    const first = await sb.rpc('meeting_seed_many', { p_entry: meeting, p_keys: [keys[0], keys[1]], p_actor: seeder });
    const again = await sb.rpc('meeting_seed_many', { p_entry: meeting, p_keys: [keys[1], keys[2], keys[2]], p_actor: editor });
    const { data: who } = await sb.from('meeting_topics').select('topic_key, seeded_by_person_id').eq('calendar_entry_id', meeting).eq('topic_key', keys[1]).single();
    expect({ first: first.data, again: again.data, keys: await seededKeys(), keptSeeder: (who as { seeded_by_person_id: number }).seeded_by_person_id }).toEqual({
      first: [keys[0], keys[1]],
      again: [keys[2]],
      keys: [...keys].sort(),
      keptSeeder: seeder
    });
  });

  it('BuildPlan_RemoveSeededRow_Unseeds', async () => {
    await clearTopics();
    asSeeder();
    const { plannerAddOfferingAction, plannerRemoveOfferingAction } = await actions();
    const added = await plannerAddOfferingAction({ entryId: meeting, keys: [keys[0], keys[1]] });
    if (!added.ok) throw new Error(added.error);
    const res = await plannerRemoveOfferingAction({ entryId: meeting, key: keys[0] });
    expect({ ok: res.ok, stays: res.ok && res.stays, seeded: await seededKeys(), topics: await topicKeys() }).toEqual({ ok: true, stays: false, seeded: [keys[1]], topics: [keys[1]] });
  });
});
