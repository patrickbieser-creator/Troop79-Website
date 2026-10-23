import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { addMeetingPick, setMeetingIntent } from '../src/lib/meeting-board';
import { teachTopic } from '../src/lib/meeting-board-supply';

/**
 * Rotations L3 (Plans/Build-A-Plan.md, "Rotations"; D-437), against the real local database. There is one arrangement
 * from planning time on: it begins on its own with a meeting's first offering, pick or teacher (no Start). "Reset to
 * match picks" rebuilds it from the plan; "Suggest an arrangement" is the matcher, once. Fixture meetings are 2096.
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const live = () => import('../src/app/(public)/planner/live-actions');
const lib = () => import('../src/lib/meeting-live');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
let meeting = 0;
let editor = 0;
let maria = 0;
let ann = 0;
let key = '';
let key2 = '';

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} RL3 ${label}`, first_name: `${TEST_PREFIX} RL3`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-rl3-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} RL3`, last_name: label, display_name: `${TEST_PREFIX} RL3 ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
const pick = async (personId: number, k: string) => {
  const res = await addMeetingPick(sb, { entryId: meeting, personId, actorPersonId: editor, leader: true, carry: null }, k, { later: false, markComing: false });
  if (!res.ok) throw new Error(res.error);
};
const teach = async (personId: number, k: string) => {
  const res = await teachTopic(sb, { personId, actorPersonId: editor, leader: true }, [meeting], { key: k }, null);
  if (!res.ok) throw new Error(res.error);
};
const seed = async (k: string, entry = meeting) => {
  const { error } = await sb.rpc('meeting_seed_many', { p_entry: entry, p_keys: [k], p_actor: editor });
  if (error) throw new Error(error.message);
};
async function clearMeeting(entryId: number) {
  // Rotations L3: empty the plan first, or a reconcile on the way out begins the arrangement again.
  await sb.from('meeting_topics').update({ seeded_at: null }).eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_live_holds').delete().eq('calendar_entry_id', entryId);
  const { data: cls } = await sb.from('meeting_classes').select('id').eq('calendar_entry_id', entryId);
  const ids = ((cls ?? []) as { id: number }[]).map((c) => c.id);
  if (ids.length) await sb.from('meeting_classes').delete().in('id', ids);
  await sb.from('meeting_rotations').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_boards').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', entryId);
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', entryId);
}
const started = async (entry = meeting) =>
  ((await sb.from('meeting_boards').select('live_started_at').eq('calendar_entry_id', entry).maybeSingle()).data as { live_started_at: string | null } | null)?.live_started_at != null;
const rotations = async () => (((await sb.from('meeting_rotations').select('number').eq('calendar_entry_id', meeting).order('number')).data ?? []) as { number: number }[]).map((r) => r.number);
type Cls = { id: number; rotation: number | null; teacher_person_id: number | null; version: number };
const classesFor = async (k: string) =>
  ((await sb.from('meeting_classes').select('id, rotation, teacher_person_id, version, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('meeting_topics.topic_key', k).order('id')).data ??
    []) as unknown as Cls[];
const membersOf = async (classId: number) =>
  (((await sb.from('meeting_class_members').select('person_id, pinned').eq('class_id', classId)).data ?? []) as { person_id: number; pinned: boolean }[]).map((m) => [m.person_id, m.pinned]);
const asEditor = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2096-05-17', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  entries.push(meeting);
  editor = await person('Editor');
  maria = await person('Maria');
  ann = await scout('Ann');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(2);
  [key, key2] = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
});

afterEach(async () => {
  await clearMeeting(meeting);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('Rotations L3: the arrangement begins on its own', () => {
  it('FirstOffering_BeginsTheArrangement', async () => {
    await seed(key);
    expect([await started(), await rotations(), (await classesFor(key)).map((c) => c.rotation)]).toEqual([true, [1, 2], [null]]);
  });

  it('FirstPick_BeginsTheArrangement_AndLands', async () => {
    await pick(ann, key);
    const [c] = await classesFor(key);
    expect([await started(), c ? await membersOf(c.id) : null]).toEqual([true, [[ann, false]]]);
  });

  it('AnAnswerAlone_DoesNotBegin', async () => {
    const res = await setMeetingIntent(sb, { entryId: meeting, personId: ann, actorPersonId: editor, leader: true }, 'coming');
    expect([res.ok, await started()]).toEqual([true, false]);
  });

  it('PastMeeting_DoesNotBegin', async () => {
    const { data } = await sb.from('calendar_entries').insert({ entry_date: '2020-05-17', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
    const past = (data as { id: number }).id;
    entries.push(past);
    try {
      const { data: t } = await sb.rpc('_meeting_topic_id', { p_entry: past, p_key: key });
      await sb.from('meeting_topics').update({ seeded_at: new Date().toISOString() }).eq('id', t as number);
      expect(await started(past)).toBe(false);
    } finally {
      await clearMeeting(past);
    }
  });
});

describe('Rotations L3: Reset to match picks', () => {
  it('Reset_RebuildsFromThePlan', async () => {
    await seed(key);
    await pick(ann, key);
    asEditor();
    const a = await live();
    const [c] = await classesFor(key);
    await a.plannerLiveAddRotationAction({ entryId: meeting, expectMax: 2, expectStarted: true });
    await a.plannerLiveMoveClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, rotation: 3 });
    await a.plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: `c:${c.id}`, to: `c:${c.id}` }).catch(() => null);
    const res = await a.plannerLiveResetAction({ entryId: meeting });
    const [after] = await classesFor(key);
    expect([res.ok, await rotations(), after.rotation, await membersOf(after.id)]).toEqual([true, [1, 2], null, [[ann, false]]]);
  });

  it('Reset_KeepsTeacherSignUps', async () => {
    await teach(maria, key);
    asEditor();
    await (await live()).plannerLiveResetAction({ entryId: meeting });
    expect((await classesFor(key)).map((c) => c.teacher_person_id)).toEqual([maria]);
  });

  it('Reset_Viewer_IsRefused', async () => {
    await seed(key);
    const [c] = await classesFor(key);
    asEditor();
    await (await live()).plannerLiveMoveClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, rotation: 1 });
    asViewer();
    const res = await (await live()).plannerLiveResetAction({ entryId: meeting });
    expect([res.ok, (await classesFor(key)).map((x) => x.rotation)]).toEqual([false, [1]]);
  });
});

describe('Rotations L3: Suggest an arrangement', () => {
  it('Suggest_TheMatcherPlacesTheClassInARotation', async () => {
    await teach(maria, key);
    await pick(ann, key);
    asEditor();
    const res = await (await live()).plannerLiveSuggestAction({ entryId: meeting });
    const [c] = await classesFor(key);
    expect([res.ok, c.rotation, c.teacher_person_id, await membersOf(c.id)]).toEqual([true, 1, maria, [[ann, false]]]);
  });

  it('Suggest_OfferingsTheMatcherLeavesOut_StillHaveClasses', async () => {
    await teach(maria, key);
    await pick(ann, key);
    await seed(key2);
    asEditor();
    await (await live()).plannerLiveSuggestAction({ entryId: meeting });
    expect((await classesFor(key2)).map((c) => c.rotation)).toEqual([null]);
  });

  it('Suggest_Viewer_IsRefused', async () => {
    await teach(maria, key);
    await pick(ann, key);
    asViewer();
    const res = await (await live()).plannerLiveSuggestAction({ entryId: meeting });
    expect([res.ok, (await classesFor(key)).map((c) => c.rotation)]).toEqual([false, [null]]);
  });
});

describe('Rotations L3: Build a Plan reads the arrangement', () => {
  it('PlanArrangement_ClassesByKey', async () => {
    await seed(key);
    const [c] = await classesFor(key);
    const arr = await (await lib()).loadPlanArrangement(sb, meeting);
    expect(arr).toEqual({ rotations: [1, 2], classes: { [key]: [{ id: `c:${c.id}`, rotation: null, version: c.version }] } });
  });

  it('PlanArrangement_NothingPlanned_IsNull', async () => {
    expect(await (await lib()).loadPlanArrangement(sb, meeting)).toBeNull();
  });
});
