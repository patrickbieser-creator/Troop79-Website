import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Build a Plan B1 (Plans/Build-A-Plan.md): Add from a suggestion (plannerAddOfferingAction → meeting_seed_many, one
 * lock, idempotent per key) and Remove a seeded row (the unseed). Seed holders only, on one of the next 4 meetings,
 * refused before any write; an Add costs the same few round trips however many keys it carries. Real local database;
 * the admin actor and "today" are mocked (today = 2086-02-20, so the test's own 2086 meetings are the next ones).
 * Test-owned rows only: 2086 meetings deleted by id (their topics, picks and teachers go by entry), fixture people and
 * scouts deleted by id.
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2086-02-20' }));

const actions = () => import('../src/app/(public)/planner/build-actions');

const people: number[] = [];
const scoutIds: string[] = [];
const entries: number[] = [];
let meeting = 0;
/** The 5th meeting out: not one of the next 4. */
let fifth = 0;
let past = 0;
let draft = 0;
let closed = 0;
let seeder = 0;
let editor = 0;
let picker = 0;
let keys: string[] = [];

async function entry(date: string, over: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}`, ...over }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
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
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', meeting);
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
}
const asSeeder = () => (state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed']) });
const asEditor = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit', 'meeting_planner.view']) });

beforeAll(async () => {
  // Clear anything a crashed run left on these dates (test-titled only).
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2086-01-01').lte('entry_date', '2086-12-31');
  meeting = await entry('2086-03-01');
  await entry('2086-03-08');
  await entry('2086-03-15');
  await entry('2086-03-22');
  fifth = await entry('2086-03-29');
  past = await entry('2086-02-01');
  draft = await entry('2086-03-02', { status: 'draft' });
  closed = await entry('2086-03-03', { title: `No Troop Meeting ${TEST_PREFIX}` });
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
  await sb.from('meeting_intents').delete().in('calendar_entry_id', entries);
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().in('calendar_entry_id', entries);
  await sb.from('meeting_topics').delete().in('calendar_entry_id', entries);
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('Build a Plan B1: Add and Remove', () => {
  it('NonSeeder_IsRefused_WhenAddingOffering', async () => {
    await clearTopics();
    asEditor();
    const res = await (await actions()).plannerAddOfferingAction({ entryId: meeting, keys: [keys[0]] });
    expect({ res, topics: await topicKeys() }).toEqual({ res: { ok: false, error: 'Only the planning team can seed a meeting.' }, topics: [] });
  });

  it('NonSeeder_IsRefused_WhenRemovingOffering', async () => {
    await clearTopics();
    await sb.rpc('meeting_seed_many', { p_entry: meeting, p_keys: [keys[0]], p_actor: seeder });
    asEditor();
    const res = await (await actions()).plannerRemoveOfferingAction({ entryId: meeting, key: keys[0] });
    expect({ res, seeded: await seededKeys() }).toEqual({ res: { ok: false, error: 'Only the planning team can seed a meeting.' }, seeded: [keys[0]] });
  });

  it('BuildPlan_Add_RefusesPastDraftClosedAndFifthMeetings', async () => {
    asSeeder();
    const { plannerAddOfferingAction } = await actions();
    const err = async (entryId: number) => {
      const res = await plannerAddOfferingAction({ entryId, keys: [keys[0]] });
      return res.ok ? 'ok' : res.error;
    };
    expect([await err(past), await err(draft), await err(closed), await err(fifth)]).toEqual([
      'That meeting has passed.',
      'That meeting isn’t taking sign-ups.',
      'That meeting isn’t taking sign-ups.',
      'Plans are open for the next 4 meetings only.'
    ]);
  });

  it('BuildPlan_Add_RejectsMalformedKeysAndOverTwenty', async () => {
    await clearTopics();
    asSeeder();
    const { plannerAddOfferingAction } = await actions();
    const err = async (ks: unknown) => {
      const res = await plannerAddOfferingAction({ entryId: meeting, keys: ks as string[] });
      return res.ok ? 'ok' : res.error;
    };
    const many = Array.from({ length: 21 }, () => keys[0]);
    expect([await err([]), await err(['']), await err(['x'.repeat(200)]), await err(["a'; drop"]), await err('tenderfoot-1a'), await err(many), await topicKeys()]).toEqual([
      'Malformed request',
      'Malformed request',
      'Malformed request',
      'Malformed request',
      'Malformed request',
      'Malformed request',
      []
    ]);
  });

  it('BuildPlan_Remove_RejectsMalformedKey', async () => {
    asSeeder();
    const res = await (await actions()).plannerRemoveOfferingAction({ entryId: meeting, key: 'x'.repeat(200) });
    expect(res).toEqual({ ok: false, error: 'Malformed request' });
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
    // The gate (meeting; categories + next meetings), the prior stamp, one meeting_seed_many call, the stamp, and who
    // teaches the new rows (topic teachers, skill offers; nobody here): eight, for one key or three.
    expect({ one: await trips(keys.slice(0, 1)), three: await trips(keys) }).toEqual({ one: 8, three: 8 });
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

  it('BuildPlan_Remove_KeepsPickedAndTaughtRows', async () => {
    await clearTopics();
    asSeeder();
    const { plannerAddOfferingAction, plannerRemoveOfferingAction } = await actions();
    const added = await plannerAddOfferingAction({ entryId: meeting, keys: [keys[0], keys[1]] });
    if (!added.ok) throw new Error(added.error);
    const pick = await sb.rpc('meeting_add_pick', { p_entry: meeting, p_person: picker, p_actor: seeder, p_leader: true, p_topic_key: keys[0], p_later: false, p_mark_coming: false, p_carry: [] });
    const teach = await sb.rpc('meeting_teach_topic', { p_entries: [meeting], p_person: editor, p_actor: editor, p_leader: false, p_topic_key: keys[1], p_title: null, p_note: null });
    if (pick.error || teach.error) throw new Error((pick.error ?? teach.error)!.message);
    const a = await plannerRemoveOfferingAction({ entryId: meeting, key: keys[0] });
    const b = await plannerRemoveOfferingAction({ entryId: meeting, key: keys[1] });
    expect({ stays: [a.ok && a.stays, b.ok && b.stays], seeded: await seededKeys(), topics: await topicKeys() }).toEqual({ stays: [true, true], seeded: [], topics: [keys[0], keys[1]].sort() });
  });

  it('BuildPlan_Add_ReturnsPriorAndNewStamp', async () => {
    await clearTopics();
    asSeeder();
    const before = await sb.rpc('meeting_board_stamp', { p_entry: meeting });
    const res = await (await actions()).plannerAddOfferingAction({ entryId: meeting, keys: [keys[0]] });
    expect(res.ok && [res.prior === String(before.data), res.stamp !== res.prior]).toEqual([true, true]);
  });
});

describe('Build a Plan B1: the stamp for the poller', () => {
  it('BuildStamp_RefusesNonViewer', async () => {
    state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set() };
    expect(await (await actions()).plannerBuildStampAction(meeting)).toEqual({ ok: false });
  });

  it('BuildStamp_OnlyForTheNextFourMeetings', async () => {
    asEditor();
    const { plannerBuildStampAction } = await actions();
    expect([(await plannerBuildStampAction(meeting)).ok, (await plannerBuildStampAction(fifth)).ok, (await plannerBuildStampAction(past)).ok]).toEqual([true, false, false]);
  });
});
