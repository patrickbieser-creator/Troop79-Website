import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { addMeetingPick, setMeetingIntent } from '../src/lib/meeting-board';
import { teachTopic, unteachTopic } from '../src/lib/meeting-board-supply';

/**
 * Rotations L2 (Plans/Build-A-Plan.md, "Rotations", Decisions 1 and 4), against the real local database. On a meeting
 * with an arrangement, every offering on the plan has a class (made in Not scheduled), and a class and the plan share
 * one teacher: a card's teacher on a single class is the plan's, and the plan's teacher shows on its class. A repeat
 * keeps its own. A class a planner removed by hand isn't made again until asked. Fixture meetings are dated 2096.
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

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
let meeting = 0;
let editor = 0;
let maria = 0;
let dan = 0;
let ann = 0;
let key = '';
let key2 = '';

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} RL2 ${label}`, first_name: `${TEST_PREFIX} RL2`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-rl2-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} RL2`, last_name: label, display_name: `${TEST_PREFIX} RL2 ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
const pick = async (personId: number, k: string) => {
  const res = await addMeetingPick(sb, { entryId: meeting, personId, actorPersonId: editor, leader: true, carry: null }, k, { later: false, markComing: false });
  if (!res.ok) throw new Error(res.error);
};
const answer = async (personId: number, intent: 'coming' | 'undecided' | 'not_coming') => {
  const res = await setMeetingIntent(sb, { entryId: meeting, personId, actorPersonId: editor, leader: true }, intent);
  if (!res.ok) throw new Error(res.error);
};
const teach = async (personId: number, k: string) => {
  const res = await teachTopic(sb, { personId, actorPersonId: editor, leader: true }, [meeting], { key: k }, null);
  if (!res.ok) throw new Error(res.error);
};
const unteach = async (personId: number, k: string) => {
  const res = await unteachTopic(sb, { personId, actorPersonId: editor, leader: true }, meeting, k);
  if (!res.ok) throw new Error(res.error);
};
const seed = async (k: string) => {
  const { error } = await sb.rpc('meeting_seed_many', { p_entry: meeting, p_keys: [k], p_actor: editor });
  if (error) throw new Error(error.message);
};
const unseed = async (k: string) => {
  const { error } = await sb.rpc('meeting_unseed_topic', { p_entry: meeting, p_key: k });
  if (error) throw new Error(error.message);
};
/** An arrangement with nothing in it yet (rotations 1 and 2). */
async function start() {
  const { error } = await sb.rpc('meeting_live_start', { p_entry: meeting, p_actor: editor, p_snapshot: { rotations: [], classes: [] } });
  if (error) throw new Error(error.message);
}
async function clearMeeting(entryId: number) {
  await sb.from('meeting_live_holds').delete().eq('calendar_entry_id', entryId);
  const { data: cls } = await sb.from('meeting_classes').select('id').eq('calendar_entry_id', entryId);
  const ids = ((cls ?? []) as { id: number }[]).map((c) => c.id);
  if (ids.length) await sb.from('meeting_classes').delete().in('id', ids);
  await sb.from('meeting_rotations').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_boards').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', entryId);
}
type Cls = { id: number; rotation: number | null; teacher_person_id: number | null; version: number; auto: boolean; teacher_override: boolean };
const classesFor = async (k: string) =>
  ((await sb.from('meeting_classes').select('id, rotation, teacher_person_id, version, auto, teacher_override, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('meeting_topics.topic_key', k).order('id'))
    .data ?? []) as unknown as Cls[];
const planTeachers = async (k: string) =>
  (((await sb.from('meeting_topic_teachers').select('person_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('meeting_topics.topic_key', k)).data ?? []) as { person_id: number }[])
    .map((r) => r.person_id)
    .sort((a, b) => a - b);
const leadOf = async (k: string) =>
  (((await sb.from('meeting_topic_teachers').select('person_id, lead, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('meeting_topics.topic_key', k)).data ?? []) as {
    person_id: number;
    lead: boolean;
  }[]).find((r) => r.lead)?.person_id ?? null;
const membersOf = async (classId: number) =>
  (((await sb.from('meeting_class_members').select('person_id').eq('class_id', classId)).data ?? []) as { person_id: number }[]).map((m) => m.person_id);
const asEditor = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2096-05-10', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  entries.push(meeting);
  editor = await person('Editor');
  maria = await person('Maria');
  dan = await person('Dan');
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

describe('Rotations L2: every offering has a class', () => {
  it('AddOffering_WithArrangement_MakesAClassInNotScheduled', async () => {
    await start();
    await seed(key);
    expect((await classesFor(key)).map((c) => [c.rotation, c.auto])).toEqual([[null, true]]);
  });

  it('AddOffering_NoArrangement_MakesNoClass', async () => {
    await seed(key);
    expect(await classesFor(key)).toEqual([]);
  });

  it('TeacherSignsUp_NewTopic_ClassHasThatTeacher', async () => {
    await start();
    await teach(maria, key);
    expect((await classesFor(key)).map((c) => c.teacher_person_id)).toEqual([maria]);
  });

  it('Pick_NewTopic_MakesAClassAndLands', async () => {
    await start();
    await pick(ann, key);
    const [c] = await classesFor(key);
    expect(c ? await membersOf(c.id) : null).toEqual([ann]);
  });

  it('RemoveOffering_EmptyAutoClass_Goes', async () => {
    await start();
    await seed(key);
    await unseed(key);
    expect(await classesFor(key)).toEqual([]);
  });

  // qa-lead: unseed can't delete a topic that has a class; reconcile takes the row once the class goes.
  it('RemoveOffering_NothingHoldsIt_TheTopicRowGoes', async () => {
    await start();
    await seed(key);
    await unseed(key);
    expect((await sb.from('meeting_topics').select('id').eq('calendar_entry_id', meeting).eq('topic_key', key)).data).toEqual([]);
  });

  it('RemoveOffering_ScoutsStillPickIt_ClassStays', async () => {
    await start();
    await seed(key);
    await pick(ann, key);
    await unseed(key);
    expect((await classesFor(key)).length).toBe(1);
  });

  it('RemoveOffering_ClassMovedByHand_Stays', async () => {
    await start();
    await seed(key);
    const [c] = await classesFor(key);
    asEditor();
    await (await live()).plannerLiveMoveClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, rotation: 1 });
    await unseed(key);
    expect((await classesFor(key)).map((x) => x.rotation)).toEqual([1]);
  });

  it('RemoveLastClassByHand_IsNotMadeAgain', async () => {
    await start();
    await seed(key);
    const [c] = await classesFor(key);
    asEditor();
    await (await live()).plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version });
    await pick(ann, key);
    expect(await classesFor(key)).toEqual([]);
  });

  it('SetAside_AddedToThePlanAgain_GetsAClass', async () => {
    await start();
    await seed(key);
    const [c] = await classesFor(key);
    asEditor();
    await (await live()).plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version });
    await unseed(key);
    await seed(key);
    expect((await classesFor(key)).length).toBe(1);
  });

  it('SetAside_MakeAClass_ClearsIt', async () => {
    await start();
    await teach(maria, key);
    const [c] = await classesFor(key);
    asEditor();
    const a = await live();
    await a.plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version });
    const res = await a.plannerLiveMakeClassAction({ entryId: meeting, key });
    const { data } = await sb.from('meeting_topics').select('class_set_aside_at').eq('calendar_entry_id', meeting).eq('topic_key', key).single();
    expect([res.ok, (await classesFor(key)).length, (data as { class_set_aside_at: string | null }).class_set_aside_at]).toEqual([true, 1, null]);
  });

  it('Discard_ClearsSetAside', async () => {
    await start();
    await seed(key);
    const [c] = await classesFor(key);
    asEditor();
    const a = await live();
    await a.plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version });
    await a.plannerLiveDiscardAction({ entryId: meeting });
    const { data } = await sb.from('meeting_topics').select('class_set_aside_at').eq('calendar_entry_id', meeting).eq('topic_key', key).single();
    expect((data as { class_set_aside_at: string | null }).class_set_aside_at).toBeNull();
  });
});

describe('Rotations L2: one teacher', () => {
  it('CardTeacher_SingleClass_WritesThePlan', async () => {
    await start();
    await teach(maria, key);
    const [c] = await classesFor(key);
    asEditor();
    const res = await (await live()).plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, teacherId: dan });
    expect([res.ok, await leadOf(key), (await classesFor(key))[0].teacher_person_id]).toEqual([true, dan, dan]);
  });

  // qa-lead: choosing never deletes a sign-up; the volunteer who said Yes stays on the plan as a co-teacher.
  it('CardTeacher_SingleClass_KeepsEveryoneElsesSignUp', async () => {
    await start();
    await teach(maria, key);
    const [c] = await classesFor(key);
    asEditor();
    await (await live()).plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, teacherId: dan });
    expect(await planTeachers(key)).toEqual([maria, dan].sort((a, b) => a - b));
  });

  it('CardTeacher_SingleClass_KeepsAnAssignedTeacher', async () => {
    await start();
    await teach(maria, key);
    const { data: t } = await sb.from('meeting_topics').select('id').eq('calendar_entry_id', meeting).eq('topic_key', key).single();
    await sb.from('meeting_topic_teachers').update({ for_picks: true }).eq('topic_id', (t as { id: number }).id).eq('person_id', maria);
    const [c] = await classesFor(key);
    asEditor();
    await (await live()).plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, teacherId: dan });
    expect((await planTeachers(key)).includes(maria)).toBe(true);
  });

  it('CardTeacher_Cleared_ThisClassOnly', async () => {
    await start();
    await teach(maria, key);
    const [c] = await classesFor(key);
    asEditor();
    await (await live()).plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, teacherId: null });
    expect([await planTeachers(key), (await classesFor(key))[0]?.teacher_person_id]).toEqual([[maria], null]);
  });

  it('CardTeacher_SaidCant_IsRefused', async () => {
    await start();
    await teach(maria, key);
    await answer(dan, 'not_coming');
    const [c] = await classesFor(key);
    asEditor();
    const res = await (await live()).plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, teacherId: dan });
    expect([res.ok, !res.ok && res.error, (await classesFor(key))[0].teacher_person_id]).toEqual([false, 'That teacher said they can’t make it.', maria]);
  });

  it('CardTeacher_Repeat_OnlyThatRepeat', async () => {
    await start();
    await teach(maria, key);
    const [c] = await classesFor(key);
    asEditor();
    const a = await live();
    await a.plannerLiveRepeatClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, rotation: 2 });
    const [, r] = await classesFor(key);
    await a.plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${r.id}`, version: r.version, teacherId: dan });
    const after = await classesFor(key);
    expect([await planTeachers(key), after.map((x) => x.teacher_person_id)]).toEqual([[maria], [maria, dan]]);
  });

  it('PlanTeacher_TakesItBack_ClassHasNoTeacher', async () => {
    await start();
    await seed(key);
    await teach(maria, key);
    await unteach(maria, key);
    expect((await classesFor(key)).map((c) => c.teacher_person_id)).toEqual([null]);
  });

  it('PlanTeacher_SaysCant_ClassFallsToTheNext', async () => {
    await start();
    await teach(maria, key);
    await teach(dan, key);
    await answer(maria, 'not_coming');
    expect((await classesFor(key)).map((c) => c.teacher_person_id)).toEqual([dan]);
  });

  it('PlanTeacher_Changes_BumpsTheCardVersion', async () => {
    await start();
    await seed(key);
    const [before] = await classesFor(key);
    await teach(maria, key);
    const [after] = await classesFor(key);
    expect(after.version).toBeGreaterThan(before.version);
  });

  it('RepeatRemoved_SingleAgain_KeepsItsTeacher', async () => {
    await start();
    await teach(maria, key);
    const [c] = await classesFor(key);
    asEditor();
    const a = await live();
    await a.plannerLiveRepeatClassAction({ entryId: meeting, classId: `c:${c.id}`, version: c.version, rotation: 2 });
    const [, r] = await classesFor(key);
    await a.plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${r.id}`, version: r.version, teacherId: dan });
    const first = (await classesFor(key))[0];
    await a.plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${first.id}`, version: first.version });
    expect((await classesFor(key)).map((x) => x.teacher_person_id)).toEqual([dan]);
  });

  // qa-lead: a plan teacher who signed up first doesn't take the class from the matcher's choice.
  it('Start_MatcherTeacher_StaysWhenThePlanAlreadyHadOne', async () => {
    await teach(maria, key2);
    const { error } = await sb.rpc('meeting_live_start', {
      p_entry: meeting,
      p_actor: editor,
      p_snapshot: { rotations: [], classes: [{ source_key: 't:0', topic_key: key2, title: null, rotation: 1, teacher_person_id: dan, position: 0, members: [] }] }
    });
    expect([error, (await classesFor(key2)).map((c) => c.teacher_person_id)]).toEqual([null, [dan]]);
  });

  it('Start_MatcherSplitIntoRepeats_EachKeepsItsTeacher', async () => {
    await teach(maria, key2);
    await sb.rpc('meeting_live_start', {
      p_entry: meeting,
      p_actor: editor,
      p_snapshot: {
        rotations: [],
        classes: [
          { source_key: 't:0', topic_key: key2, title: null, rotation: 1, teacher_person_id: maria, position: 0, members: [] },
          { source_key: 't:1', topic_key: key2, title: null, rotation: 2, teacher_person_id: dan, position: 0, members: [] }
        ]
      }
    });
    const first = (await classesFor(key2))[0];
    asEditor();
    await (await live()).plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${first.id}`, version: first.version });
    expect((await classesFor(key2)).map((c) => c.teacher_person_id)).toEqual([dan]);
  });

  it('Start_MatcherTeacher_ReachesThePlan', async () => {
    await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: key2 });
    const { error } = await sb.rpc('meeting_live_start', {
      p_entry: meeting,
      p_actor: editor,
      p_snapshot: { rotations: [], classes: [{ source_key: 't:0', topic_key: key2, title: null, rotation: 1, teacher_person_id: maria, position: 0, members: [] }] }
    });
    expect([error, await planTeachers(key2), (await classesFor(key2)).map((c) => c.teacher_person_id)]).toEqual([null, [maria], [maria]]);
  });
});
