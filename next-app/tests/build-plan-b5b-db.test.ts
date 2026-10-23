import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Build a Plan B5b (Plans/Build-A-Plan.md): Save in a mix's Edit changes ONLY this meeting's copy (its meeting_topics
 * row: title and members); the master focus set changes only through "Also update the focus set" (updateSet), which
 * needs the seed right like Save. Meetings already using the set keep their copy either way. The old five-argument
 * call to meeting_edit_mix (production code before this release) still works after the migration (DB-first).
 * Real local database (migration 20261217100000_meeting_edit_mix_this_meeting); the actor and "today" (2085-02-20) are
 * mocked. Test-owned rows only: 2085 meetings deleted by id, focus sets this file made deleted by id, people by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }
}));

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2085-02-20' }));

const actions = () => import('../src/app/(public)/planner/build-actions');

const people: number[] = [];
const sets: number[] = [];
const meetings: number[] = [];
let meeting = 0;
let other = 0;
let seeder = 0;
let editor = 0;
let parts: string[] = [];

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} BP5b ${label}`, first_name: `${TEST_PREFIX} BP5b`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function newMeeting(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meetings.push(data!.id as number);
  return data!.id as number;
}
async function clearTopics() {
  for (const id of meetings) {
    await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', id);
    // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
    await sb.from('meeting_classes').delete().eq('calendar_entry_id', id);
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', id);
  }
}
async function setItems(id: number): Promise<string[]> {
  const { data } = await sb.from('focus_set_items').select('topic_key').eq('set_id', id).order('position');
  return ((data ?? []) as { topic_key: string }[]).map((r) => r.topic_key);
}
async function setName(id: number): Promise<string> {
  const { data } = await sb.from('focus_sets').select('name').eq('id', id).single();
  return (data as { name: string }).name;
}
async function copy(entryId: number, key: string): Promise<{ title: string; members: string[] }> {
  const { data } = await sb.from('meeting_topics').select('title, meeting_topic_members(item_key, position)').eq('calendar_entry_id', entryId).eq('topic_key', key).single();
  const row = data as { title: string; meeting_topic_members: { item_key: string; position: number }[] };
  return { title: row.title, members: [...row.meeting_topic_members].sort((a, b) => a.position - b.position).map((m) => m.item_key) };
}
const asSeeder = () => (state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed']) });
const asEditor = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });

/** A mix on the meeting, made as a focus set holding parts[0]. Its key (fg:<set id>). */
async function mixOn(name: string): Promise<{ key: string; id: number }> {
  asSeeder();
  const made = await (await actions()).plannerNewMixAction({ entryId: meeting, name: `${TEST_PREFIX} BP5b ${name}`, items: [parts[0]] });
  if (!made.ok) throw new Error(made.error);
  const id = Number(made.key.slice(3));
  sets.push(id);
  return { key: made.key, id };
}

beforeAll(async () => {
  meeting = await newMeeting('2085-03-04');
  other = await newMeeting('2085-03-11');
  seeder = await person('Seeder');
  editor = await person('Editor');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code, parent_id').eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order');
  parts = ((reqs ?? []) as { rank_id: string; code: string }[]).slice(0, 3).map((r) => `${r.rank_id}-${r.code}`);
});

afterAll(async () => {
  await clearTopics();
  await sb.from('calendar_entries').delete().in('id', meetings);
  if (sets.length) await sb.from('focus_sets').delete().in('id', sets);
  await sb.from('people').delete().in('id', people);
});

describe('Build a Plan B5b: Save changes this meeting only', () => {
  it('EditMix_Save_ChangesOnlyThisMeeting', async () => {
    await clearTopics();
    const { key } = await mixOn('here');
    await (await actions()).plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP5b here edited`, items: [parts[2], parts[1]] });
    expect(await copy(meeting, key)).toEqual({ title: `${TEST_PREFIX} BP5b here edited`, members: [parts[2], parts[1]] });
  });

  it('EditMix_Save_LeavesMasterSetUnchanged', async () => {
    await clearTopics();
    const { key, id } = await mixOn('master');
    await (await actions()).plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP5b master edited`, items: [parts[2]] });
    expect({ name: await setName(id), items: await setItems(id) }).toEqual({ name: `${TEST_PREFIX} BP5b master`, items: [parts[0]] });
  });
});

describe('Build a Plan B5b: Also update the focus set', () => {
  it('EditMix_UpdateSet_ChangesMasterSet', async () => {
    await clearTopics();
    const { key, id } = await mixOn('both');
    await (await actions()).plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP5b both edited`, items: [parts[1], parts[2]], updateSet: true });
    expect({ name: await setName(id), items: await setItems(id), here: await copy(meeting, key) }).toEqual({
      name: `${TEST_PREFIX} BP5b both edited`,
      items: [parts[1], parts[2]],
      here: { title: `${TEST_PREFIX} BP5b both edited`, members: [parts[1], parts[2]] }
    });
  });

  it('EditMix_OtherMeetings_KeepTheirCopy', async () => {
    await clearTopics();
    const { key, id } = await mixOn('others');
    const seeded = await sb.rpc('meeting_seed_focus_set', { p_entry: other, p_set: id, p_actor: seeder });
    if (seeded.error) throw new Error(seeded.error.message);
    const { plannerEditMixAction } = await actions();
    await plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP5b others here`, items: [parts[1]] });
    await plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP5b others set`, items: [parts[2]], updateSet: true });
    expect(await copy(other, key)).toEqual({ title: `${TEST_PREFIX} BP5b others`, members: [parts[0]] });
  });

  it('EditMix_UpdateSet_RefusedForNonSeeder', async () => {
    await clearTopics();
    const { key, id } = await mixOn('guarded');
    asEditor();
    const res = await (await actions()).plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP5b hijack`, items: [parts[1]], updateSet: true });
    expect({ res, items: await setItems(id), here: (await copy(meeting, key)).members }).toEqual({
      res: { ok: false, error: 'Only the planning team can seed a meeting.' },
      items: [parts[0]],
      here: [parts[0]]
    });
  });

  it('EditMix_Save_MovesSeededAtForOtherPlanners', async () => {
    await clearTopics();
    const { key } = await mixOn('stamp');
    const old = '2085-01-01T00:00:00+00:00';
    await sb.from('meeting_topics').update({ seeded_at: old }).eq('calendar_entry_id', meeting).eq('topic_key', key);
    await (await actions()).plannerEditMixAction({ entryId: meeting, key, name: `${TEST_PREFIX} BP5b stamp`, items: [parts[1]] });
    const { data } = await sb.from('meeting_topics').select('seeded_at').eq('calendar_entry_id', meeting).eq('topic_key', key).single();
    expect(new Date((data as { seeded_at: string }).seeded_at).getTime()).not.toBe(new Date(old).getTime());
  });
});

describe('Build a Plan B5b: deploy order (DB-first)', () => {
  it('OldEditMixCall_StillWorks_AfterMigration', async () => {
    await clearTopics();
    const { key, id } = await mixOn('old call');
    // Exactly the arguments the pre-B5b production code sends.
    const res = await sb.rpc('meeting_edit_mix', { p_entry: meeting, p_set: id, p_name: `${TEST_PREFIX} BP5b old call`, p_items: [parts[1], parts[2]], p_actor: seeder });
    expect({ error: res.error?.message ?? null, count: res.data, here: (await copy(meeting, key)).members }).toEqual({ error: null, count: 2, here: [parts[1], parts[2]] });
  });
});
