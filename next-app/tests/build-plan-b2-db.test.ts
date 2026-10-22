import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { boardName } from '../src/lib/meeting-board-shared';

/**
 * Build a Plan B2 (Plans/Build-A-Plan.md): manual add (a requirement from the search, a focus set, a new mix), editing
 * a mix, and an offering's teacher. Seed holders add and edit mixes; editors set the teacher; both refused server-side
 * before any write. Each write costs a fixed number of round trips. Real local database (migration
 * 20261215100000_meeting_build_mix); the admin actor and "today" (2085-02-20) are mocked.
 * Test-owned rows only: a 2085 meeting deleted by id (its topics, members and teachers go with it), focus sets this
 * file made deleted by id, fixture people deleted by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> },
  counter: null as null | { n: number }
}));

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
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2085-02-20' }));

const actions = () => import('../src/app/(public)/planner/build-actions');
const focus = () => import('../src/app/(public)/planner/focus-actions');

const people: number[] = [];
const sets: number[] = [];
let meeting = 0;
let seeder = 0;
let editor = 0;
let teacher = 0;
let tops: string[] = [];
let parts: string[] = [];

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} BP2 ${label}`, first_name: `${TEST_PREFIX} BP2`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function clearTopics() {
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
}
async function seededKeys(): Promise<string[]> {
  const { data } = await sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', meeting).not('seeded_at', 'is', null).order('topic_key');
  return ((data ?? []) as { topic_key: string }[]).map((r) => r.topic_key);
}
async function setItems(id: number): Promise<string[]> {
  const { data } = await sb.from('focus_set_items').select('topic_key').eq('set_id', id).order('position');
  return ((data ?? []) as { topic_key: string }[]).map((r) => r.topic_key);
}
async function members(key: string): Promise<string[]> {
  const { data } = await sb.from('meeting_topic_members').select('item_key, position, meeting_topics!inner(calendar_entry_id, topic_key)').eq('meeting_topics.calendar_entry_id', meeting).eq('meeting_topics.topic_key', key).order('position');
  return ((data ?? []) as { item_key: string }[]).map((r) => r.item_key);
}
const track = (key: string) => {
  const id = Number(key.slice(3));
  if (Number.isInteger(id)) sets.push(id);
  return id;
};
const asSeeder = () => (state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed']) });
const asEditor = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2085-01-01').lte('entry_date', '2085-12-31');
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2085-03-04', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  seeder = await person('Seeder');
  editor = await person('Editor');
  teacher = await person('Teacher');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code, parent_id').eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order');
  const rows = (reqs ?? []) as { rank_id: string; code: string; parent_id: number | null }[];
  tops = rows.filter((r) => r.parent_id == null).slice(0, 3).map((r) => `${r.rank_id}-${r.code}`);
  parts = rows.slice(0, 3).map((r) => `${r.rank_id}-${r.code}`);
});

afterAll(async () => {
  await clearTopics();
  await sb.from('calendar_entries').delete().eq('id', meeting);
  if (sets.length) await sb.from('focus_sets').delete().in('id', sets);
  await sb.from('focus_sets').delete().like('name', `%${TEST_PREFIX}%`);
  await sb.from('people').delete().in('id', people);
});

describe('Build a Plan B2: manual add', () => {
  it('AddRequirement_FromSearch_AddsOffering', async () => {
    await clearTopics();
    asSeeder();
    const found = await (await focus()).focusSearchAction({ q: tops[0].replace('tenderfoot-', 'tenderfoot '), kind: 'rank', source: 'tenderfoot', offset: 0 });
    const hit = found.ok ? found.rows.find((r) => r.topLevel && r.key === tops[0]) : undefined;
    const res = await (await actions()).plannerAddOfferingAction({ entryId: meeting, keys: [hit?.key ?? 'missing'] });
    expect({ ok: res.ok, seeded: await seededKeys() }).toEqual({ ok: true, seeded: [tops[0]] });
  });

  it('AddFocusSet_AddsOneClass', async () => {
    await clearTopics();
    asSeeder();
    const saved = await sb.rpc('focus_set_save', { p_actor: seeder, p_set: null, p_name: `${TEST_PREFIX} BP2 set`, p_labels: [], p_items: parts });
    if (saved.error) throw new Error(saved.error.message);
    const key = `fg:${track(`fg:${saved.data}`)}`;
    const res = await (await actions()).plannerAddFocusSetAction({ entryId: meeting, setId: Number(saved.data) });
    expect({ res: res.ok && [res.key, res.title, res.count], seeded: await seededKeys(), members: await members(key) }).toEqual({
      res: [key, `${TEST_PREFIX} BP2 set`, parts.length],
      seeded: [key],
      members: parts
    });
  });

  it('NewMix_SavesFocusSetAndSeedsItOnce', async () => {
    await clearTopics();
    asSeeder();
    const res = await (await actions()).plannerNewMixAction({ entryId: meeting, name: `  ${TEST_PREFIX} BP2   mix `, items: [parts[0], parts[1], parts[0]] });
    if (!res.ok) throw new Error(res.error);
    const id = track(res.key);
    const { data: set } = await sb.from('focus_sets').select('name').eq('id', id).single();
    const { count } = await sb.from('meeting_topics').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting).eq('topic_key', res.key).not('seeded_at', 'is', null);
    expect({ name: (set as { name: string }).name, items: await setItems(id), classes: count, members: await members(res.key) }).toEqual({
      name: `${TEST_PREFIX} BP2 mix`,
      items: [parts[0], parts[1]],
      classes: 1,
      members: [parts[0], parts[1]]
    });
  });

  it('NewMix_Refused_LeavesNoOrphanSet', async () => {
    await clearTopics();
    asSeeder();
    const name = `${TEST_PREFIX} BP2 orphan`;
    const res = await (await actions()).plannerNewMixAction({ entryId: meeting, name, items: ['tenderfoot-zz99'] });
    const { count } = await sb.from('focus_sets').select('id', { count: 'exact', head: true }).eq('name', name);
    expect({ ok: res.ok, sets: count, seeded: await seededKeys() }).toEqual({ ok: false, sets: 0, seeded: [] });
  });

  it('NonSeeder_IsRefused_WhenCreatingMix', async () => {
    await clearTopics();
    asEditor();
    const name = `${TEST_PREFIX} BP2 refused`;
    const res = await (await actions()).plannerNewMixAction({ entryId: meeting, name, items: [parts[0]] });
    const { count } = await sb.from('focus_sets').select('id', { count: 'exact', head: true }).eq('name', name);
    expect({ res, sets: count }).toEqual({ res: { ok: false, error: 'Only the planning team can seed a meeting.' }, sets: 0 });
  });

  it('EditMix_UpdatesFocusSetItems', async () => {
    await clearTopics();
    asSeeder();
    const { plannerNewMixAction, plannerEditMixAction } = await actions();
    const made = await plannerNewMixAction({ entryId: meeting, name: `${TEST_PREFIX} BP2 edit`, items: [parts[0]] });
    if (!made.ok) throw new Error(made.error);
    const id = track(made.key);
    const res = await plannerEditMixAction({ entryId: meeting, key: made.key, name: `${TEST_PREFIX} BP2 edited`, items: [parts[2], parts[1]] });
    expect({ count: res.ok && res.count, set: await setItems(id), here: await members(made.key) }).toEqual({ count: 2, set: [parts[2], parts[1]], here: [parts[2], parts[1]] });
  });
});

describe('Build a Plan B2: the teacher', () => {
  it('SetTeacher_OnOffering_NeedsEditRight', async () => {
    await clearTopics();
    asSeeder();
    await (await actions()).plannerAddOfferingAction({ entryId: meeting, keys: [tops[0]] });
    // A seed holder without the edit right.
    const res = await (await actions()).plannerSetTeacherAction({ entryId: meeting, key: tops[0], personId: teacher, on: true });
    const { count } = await sb.from('meeting_topic_teachers').select('topic_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting);
    expect({ res, teachers: count }).toEqual({ res: { ok: false, error: 'Only someone who can edit the Meeting Planner can do that.' }, teachers: 0 });
  });

  it('SetTeacher_Editor_SetsThenClears', async () => {
    await clearTopics();
    asSeeder();
    await (await actions()).plannerAddOfferingAction({ entryId: meeting, keys: [tops[0]] });
    asEditor();
    const { plannerSetTeacherAction } = await actions();
    const on = await plannerSetTeacherAction({ entryId: meeting, key: tops[0], personId: teacher, on: true });
    const { data: row } = await sb.from('meeting_topic_teachers').select('for_picks').eq('calendar_entry_id', meeting).eq('person_id', teacher).single();
    const off = await plannerSetTeacherAction({ entryId: meeting, key: tops[0], personId: teacher, on: false });
    expect({
      on: on.ok && [on.teachers, on.onBoard],
      forPicks: (row as { for_picks: boolean }).for_picks,
      off: off.ok && [off.teachers, off.onBoard]
    }).toEqual({ on: [[boardName(`${TEST_PREFIX} BP2 Teacher`)], true], forPicks: false, off: [[], true] });
  });
});

describe('Build a Plan B2: qa follow-ups (who may, and what an edit keeps)', () => {
  const mixOn = async (name: string, items = [parts[0]]) => {
    asSeeder();
    const made = await (await actions()).plannerNewMixAction({ entryId: meeting, name: `${TEST_PREFIX} BP2 ${name}`, items });
    if (!made.ok) throw new Error(made.error);
    track(made.key);
    return made.key;
  };

  it('MixAction_IsRefused_ForNonSeeder', async () => {
    await clearTopics();
    const key = await mixOn('read');
    asEditor();
    expect(await (await actions()).plannerMixAction({ entryId: meeting, key })).toEqual({ ok: false, error: 'Only the planning team can seed a meeting.' });
  });

  it('TeacherChoicesAction_IsRefused_ForNonEditor', async () => {
    await clearTopics();
    asSeeder();
    await (await actions()).plannerAddOfferingAction({ entryId: meeting, keys: [tops[0]] });
    expect(await (await actions()).plannerTeacherChoicesAction({ entryId: meeting, key: tops[0] })).toEqual({ ok: false, error: 'Only someone who can edit the Meeting Planner can do that.' });
  });

  it('EditMix_IsRefused_ForNonSeeder', async () => {
    await clearTopics();
    const key = await mixOn('guarded');
    asEditor();
    const res = await (await actions()).plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP2 hijack`, items: [parts[1]] });
    expect({ res, here: await members(key) }).toEqual({ res: { ok: false, error: 'Only the planning team can seed a meeting.' }, here: [parts[0]] });
  });

  it('EditMix_IsRefused_ForSetNotOnTheMeeting', async () => {
    await clearTopics();
    asSeeder();
    const saved = await sb.rpc('focus_set_save', { p_actor: seeder, p_set: null, p_name: `${TEST_PREFIX} BP2 elsewhere`, p_labels: [], p_items: [parts[0]] });
    const id = track(`fg:${saved.data}`);
    const res = await (await actions()).plannerEditMixAction({ entryId: meeting, key: `fg:${id}`, name: `${TEST_PREFIX} BP2 elsewhere`, items: [parts[1]] });
    expect({ ok: res.ok, set: await setItems(id) }).toEqual({ ok: false, set: [parts[0]] });
  });

  it('EditMix_UnseededClass_StaysUnseeded', async () => {
    await clearTopics();
    const key = await mixOn('unseeded');
    await sb.from('meeting_topics').update({ seeded_at: null }).eq('calendar_entry_id', meeting).eq('topic_key', key);
    await (await actions()).plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP2 unseeded`, items: [parts[1]] });
    const { data } = await sb.from('meeting_topics').select('seeded_at').eq('calendar_entry_id', meeting).eq('topic_key', key).single();
    expect({ seeded: (data as { seeded_at: string | null }).seeded_at, here: await members(key) }).toEqual({ seeded: null, here: [parts[1]] });
  });

  it('EditMix_MeetingsAlreadySeeded_KeepTheirCopy', async () => {
    await clearTopics();
    const key = await mixOn('copies');
    const { data: other, error } = await sb.from('calendar_entries').insert({ entry_date: '2085-03-11', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
    if (error) throw new Error(error.message);
    const otherId = (other as { id: number }).id;
    try {
      const seeded = await sb.rpc('meeting_seed_focus_set', { p_entry: otherId, p_set: Number(key.slice(3)), p_actor: seeder });
      if (seeded.error) throw new Error(seeded.error.message);
      await (await actions()).plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP2 copies`, items: [parts[2]] });
      const { data } = await sb.from('meeting_topic_members').select('item_key, meeting_topics!inner(calendar_entry_id, topic_key)').eq('meeting_topics.calendar_entry_id', otherId).eq('meeting_topics.topic_key', key);
      expect(((data ?? []) as { item_key: string }[]).map((r) => r.item_key)).toEqual([parts[0]]);
    } finally {
      await sb.from('meeting_topics').delete().eq('calendar_entry_id', otherId);
      await sb.from('calendar_entries').delete().eq('id', otherId);
    }
  });

  it('SetTeacher_IsRefused_ForKeyNotOnTheMeeting', async () => {
    await clearTopics();
    asEditor();
    const res = await (await actions()).plannerSetTeacherAction({ entryId: meeting, key: tops[2], personId: teacher, on: true });
    const { count } = await sb.from('meeting_topics').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting);
    expect({ res, topics: count }).toEqual({ res: { ok: false, error: 'That isn’t on this meeting’s plan.' }, topics: 0 });
  });
});

describe('Build a Plan B2: round trips', () => {
  it('BuildPlan_B2Writes_UseBoundedRoundTrips', async () => {
    const { plannerAddFocusSetAction, plannerNewMixAction, plannerEditMixAction, plannerSetTeacherAction, plannerAddOfferingAction } = await actions();
    const trips = async (fn: () => Promise<{ ok: boolean }>) => {
      state.counter = { n: 0 };
      try {
        const res = await fn();
        if (!res.ok) throw new Error(JSON.stringify(res));
        return state.counter.n;
      } finally {
        state.counter = null;
      }
    };
    await clearTopics();
    asSeeder();
    const saved = await sb.rpc('focus_set_save', { p_actor: seeder, p_set: null, p_name: `${TEST_PREFIX} BP2 trips`, p_labels: [], p_items: parts });
    track(`fg:${saved.data}`);
    const set = await trips(() => plannerAddFocusSetAction({ entryId: meeting, setId: Number(saved.data) }));
    let key = '';
    const mix = await trips(async () => {
      const r = await plannerNewMixAction({ entryId: meeting, name: `${TEST_PREFIX} BP2 trips mix`, items: [parts[0]] });
      if (r.ok) key = r.key;
      return r;
    });
    track(key);
    const edit = await trips(() => plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP2 trips mix`, items: [parts[1]] }));
    await plannerAddOfferingAction({ entryId: meeting, keys: [tops[1]] });
    asEditor();
    const teach = await trips(() => plannerSetTeacherAction({ entryId: meeting, key: tops[1], personId: teacher, on: true }));
    // Gate (meeting; categories + next meetings) and prior stamp = 4, then:
    //   set: seed + stamp + title + topic teachers + offers = 9; mix: new_mix + stamp = 6; edit: edit_mix + stamp = 6;
    //   teacher: on-the-plan check + teach RPC + stamp + topic + topic teachers + offers + answers = 11.
    expect({ set, mix, edit, teach }).toEqual({ set: 9, mix: 6, edit: 6, teach: 11 });
  });
});
