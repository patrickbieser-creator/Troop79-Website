import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { addMeetingPick, loadMeetingById, setMeetingIntent } from '../src/lib/meeting-board';
import { teachTopic } from '../src/lib/meeting-board-supply';
import { driftText } from '../src/lib/meeting-live-shared';

/**
 * Rotations L0 (Plans/Build-A-Plan.md, "Rotations: one arrangement over the live plan"): the "Needs attention" strip on
 * a started arrangement and its one-click fixes, against the real local database. The real case (Oct 25, entry 133):
 * Live started, then a teacher was added to a topic and a scout picked it; Live had no class for it. Every fix needs
 * planner Edit (checked on the server) and goes through Live's stale checks. Fixture meetings are dated 2096; cleanup
 * by test-owned ids only.
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
let teacher = 0;
let teacher2 = 0;
let anjali = 0;
let ben = 0;
let key = '';
let key2 = '';
let key3 = '';

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MLD ${label}`, first_name: `${TEST_PREFIX} MLD`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mld-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} MLD`, last_name: label, display_name: `${TEST_PREFIX} MLD ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
const writer = (personId: number) => ({ entryId: meeting, personId, actorPersonId: editor, leader: true, carry: null });
const pick = async (personId: number, k: string) => {
  const res = await addMeetingPick(sb, writer(personId), k, { later: false, markComing: true });
  if (!res.ok) throw new Error(res.error);
};
const cant = async (personId: number) => {
  const res = await setMeetingIntent(sb, { entryId: meeting, personId, actorPersonId: editor, leader: true }, 'not_coming');
  if (!res.ok) throw new Error(res.error);
};
const teach = async (personId: number, k: string) => {
  const res = await teachTopic(sb, { personId, actorPersonId: editor, leader: true }, [meeting], { key: k }, null);
  if (!res.ok) throw new Error(res.error);
};
/** Start Live straight from a snapshot: class ids back, in the order given. */
async function started(classes: { topic_key: string; rotation: number | null; teacher_person_id?: number | null; members: number[] }[]): Promise<number[]> {
  for (const c of classes) await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: c.topic_key });
  const { error } = await sb.rpc('meeting_live_start', {
    p_entry: meeting,
    p_actor: editor,
    p_snapshot: { rotations: [], classes: classes.map((c, i) => ({ source_key: `t:${i}`, title: null, teacher_person_id: null, position: i, ...c })) }
  });
  if (error) throw new Error(error.message);
  const { data } = await sb.from('meeting_classes').select('id, source_key').eq('calendar_entry_id', meeting);
  const rows = (data ?? []) as { id: number; source_key: string }[];
  return classes.map((_, i) => rows.find((r) => r.source_key === `t:${i}`)!.id);
}
async function clearMeeting(entryId: number) {
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
const membersOf = async (classId: number) =>
  (((await sb.from('meeting_class_members').select('person_id').eq('class_id', classId)).data ?? []) as { person_id: number }[]).map((m) => m.person_id).sort((a, b) => a - b);
const classRow = async (classId: number) =>
  (await sb.from('meeting_classes').select('teacher_person_id, version').eq('id', classId).maybeSingle()).data as { teacher_person_id: number | null; version: number } | null;
const classesFor = async (k: string) =>
  ((await sb.from('meeting_classes').select('id, rotation, teacher_person_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('meeting_topics.topic_key', k)).data ?? []) as {
    id: number;
    rotation: number | null;
    teacher_person_id: number | null;
  }[];
const planTeachers = async (k: string) =>
  (((await sb.from('meeting_topic_teachers').select('person_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('meeting_topics.topic_key', k)).data ?? []) as { person_id: number }[])
    .map((r) => r.person_id)
    .sort((a, b) => a - b);
const liveVersion = async () => ((await sb.from('meeting_boards').select('live_version').eq('calendar_entry_id', meeting).maybeSingle()).data as { live_version: number } | null)?.live_version ?? 0;
const view = async (client: SupabaseClient = sb) => (await lib()).loadLiveView(client, (await loadMeetingById(sb, meeting))!);
/** Our own fixture's drift lines: the local database holds the troop's real scouts too, whose carried picks may show. */
const ours = (d: Awaited<ReturnType<typeof view>>['drift']) => d.filter((x) => !('personId' in x) || people.includes(x.personId)).map(driftText);

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2096-04-05', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  entries.push(meeting);
  editor = await person('Editor');
  teacher = await person('Teacher');
  teacher2 = await person('Teacher2');
  anjali = await scout('Anjali', 'scout');
  ben = await scout('Ben', 'scout');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(3);
  [key, key2, key3] = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
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

const asEditor = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });

/** The real case: Live started with one class; then a teacher on key2 and Anjali picks key2. */
async function realCase() {
  await pick(ben, key);
  const [c] = await started([{ topic_key: key, rotation: 1, teacher_person_id: teacher2, members: [ben] }]);
  await teach(teacher2, key);
  await teach(teacher, key2);
  await pick(anjali, key2);
  return c;
}

describe('Rotations L0: the drift on a started arrangement', () => {
  it('Drift_RealCase_StripShowsOfferingAndPick', async () => {
    await realCase();
    const v = await view();
    const lines = v.drift.filter((d) => (d.kind === 'offering' && d.key === key2) || (d.kind === 'pick' && d.personId === anjali)).map((d) => d.kind);
    expect(lines).toEqual(['offering', 'pick']);
  });

  it('Drift_NotStarted_IsEmpty', async () => {
    await teach(teacher, key2);
    expect((await view()).drift).toEqual([]);
  });

  it('NotInAClassYet_ShowsPick', async () => {
    await realCase();
    const chip = (await view()).pool.find((p) => p.personId === anjali);
    expect(chip?.picks.length === 1 && chip.picks[0].startsWith('Ten ')).toBe(true);
  });
});

describe('Rotations L0: the fixes', () => {
  it('Drift_MakeClass_PlacesPickers', async () => {
    await realCase();
    asEditor();
    const res = await (await live()).plannerLiveMakeClassAction({ entryId: meeting, key: key2 });
    const [made] = await classesFor(key2);
    expect([res.ok, made?.rotation, made?.teacher_person_id, made ? await membersOf(made.id) : null]).toEqual([true, null, teacher, [anjali]]);
  });

  it('Drift_MakeClass_ClearsBothLines', async () => {
    await realCase();
    asEditor();
    await (await live()).plannerLiveMakeClassAction({ entryId: meeting, key: key2 });
    const left = (await view()).drift.filter((d) => (d.kind === 'offering' && d.key === key2) || (d.kind === 'pick' && d.personId === anjali));
    expect(left).toEqual([]);
  });

  it('Drift_CantMakeIt_Placed_ShowsOnTheLoadedView', async () => {
    await pick(ben, key);
    await started([{ topic_key: key, rotation: 1, members: [ben] }]);
    await cant(ben);
    expect((await view()).drift.filter((d) => d.kind === 'cant' && d.personId === ben).length).toBe(1);
  });

  it('Drift_RemoveFromClass_Removes', async () => {
    await pick(ben, key);
    const [c] = await started([{ topic_key: key, rotation: 1, members: [ben] }]);
    await cant(ben);
    asEditor();
    const res = await (await live()).plannerLiveMoveScoutAction({ entryId: meeting, personId: ben, from: `c:${c}`, to: null });
    expect([res.ok, await membersOf(c)]).toEqual([true, []]);
  });

  it('Drift_TeacherMismatch_UsePlan', async () => {
    await pick(ben, key);
    const [c] = await started([{ topic_key: key, rotation: 1, teacher_person_id: teacher2, members: [ben] }]);
    await teach(teacher, key);
    const d = (await view()).drift.find((x) => x.kind === 'teacher' && x.classId === `c:${c}`);
    asEditor();
    const res = d?.kind === 'teacher' ? await (await live()).plannerLiveSetTeacherAction({ entryId: meeting, classId: d.classId, version: d.version, teacherId: d.plan.personId }) : null;
    expect([res?.ok, (await classRow(c))?.teacher_person_id]).toEqual([true, teacher]);
  });

  it('Drift_TeacherMismatch_UseClass', async () => {
    await pick(ben, key);
    const [c] = await started([{ topic_key: key, rotation: 1, teacher_person_id: teacher2, members: [ben] }]);
    await teach(teacher, key);
    asEditor();
    const res = await (await live()).plannerLiveUseClassTeacherAction({ entryId: meeting, classId: `c:${c}`, version: 1, teacherId: teacher2 });
    expect([res.ok, await planTeachers(key)]).toEqual([true, [teacher2]]);
  });

  it('Drift_TeacherMismatch_UseClass_KeepsAPlanTeacherOfAnotherRepeat', async () => {
    await pick(ben, key);
    const [c] = await started([
      { topic_key: key, rotation: 1, teacher_person_id: teacher2, members: [ben] },
      { topic_key: key, rotation: 2, teacher_person_id: teacher, members: [] }
    ]);
    await teach(teacher, key);
    asEditor();
    await (await live()).plannerLiveUseClassTeacherAction({ entryId: meeting, classId: `c:${c}`, version: 1, teacherId: teacher2 });
    expect(await planTeachers(key)).toEqual([teacher, teacher2].sort((a, b) => a - b));
  });

  it('Drift_OrphanClass_Shows', async () => {
    await pick(ben, key);
    const [, o] = await started([
      { topic_key: key, rotation: 1, members: [ben] },
      { topic_key: key3, rotation: null, members: [] }
    ]);
    expect((await view()).drift.filter((d) => d.kind === 'orphan').map((d) => d.kind === 'orphan' && d.classId)).toEqual([`c:${o}`]);
  });

  it('Drift_OrphanClass_RemoveClass', async () => {
    await pick(ben, key);
    const [, o] = await started([
      { topic_key: key, rotation: 1, members: [ben] },
      { topic_key: key3, rotation: null, members: [] }
    ]);
    asEditor();
    const res = await (await live()).plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${o}`, version: 1 });
    expect([res.ok, (await view()).drift.filter((d) => d.kind === 'orphan').length]).toEqual([true, 0]);
  });
});

describe('Rotations L0: rights and stale checks', () => {
  it('Drift_Viewer_IsRefused', async () => {
    const c = await realCase();
    const before = await liveVersion();
    asViewer();
    const a = await live();
    const results = await Promise.all([
      a.plannerLiveMakeClassAction({ entryId: meeting, key: key2 }),
      a.plannerLiveUseClassTeacherAction({ entryId: meeting, classId: `c:${c}`, version: 1, teacherId: teacher2 })
    ]);
    expect([results.every((r) => !r.ok), await liveVersion(), (await classesFor(key2)).length, await planTeachers(key)]).toEqual([true, before, 0, [teacher2]]);
  });

  it('Drift_StaleVersion_Refused', async () => {
    await pick(ben, key);
    const [c] = await started([{ topic_key: key, rotation: 1, teacher_person_id: teacher2, members: [ben] }]);
    await teach(teacher, key);
    asEditor();
    const a = await live();
    await a.plannerLiveMoveClassAction({ entryId: meeting, classId: `c:${c}`, version: 1, rotation: 2 });
    const res = await a.plannerLiveUseClassTeacherAction({ entryId: meeting, classId: `c:${c}`, version: 1, teacherId: teacher2 });
    expect([!res.ok && res.stale, await planTeachers(key)]).toEqual([true, [teacher]]);
  });

  it('Drift_MakeClass_SomeoneMadeItFirst_IsStale', async () => {
    await realCase();
    asEditor();
    const a = await live();
    await a.plannerLiveMakeClassAction({ entryId: meeting, key: key2 });
    const second = await a.plannerLiveMakeClassAction({ entryId: meeting, key: key2 });
    expect([!second.ok && second.stale, (await classesFor(key2)).length]).toEqual([true, 1]);
  });

  it('Drift_MakeClass_LiveNotStarted_IsStale', async () => {
    await teach(teacher, key2);
    asEditor();
    const res = await (await live()).plannerLiveMakeClassAction({ entryId: meeting, key: key2 });
    expect([!res.ok && res.stale, (await classesFor(key2)).length]).toEqual([true, 0]);
  });

  it('Drift_MakeClass_NotOnThePlan_IsRefused', async () => {
    await started([]);
    asEditor();
    const res = await (await live()).plannerLiveMakeClassAction({ entryId: meeting, key: key3 });
    expect([res.ok, (await classesFor(key3)).length]).toEqual([false, 0]);
  });
});

describe('Rotations L0: perf', () => {
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

  // Drift comes from what the Live page already loads: no read per class, scout or drift line.
  it('Drift_LoadsInBoundedRoundTrips', async () => {
    await pick(ben, key);
    await started([{ topic_key: key, rotation: 1, teacher_person_id: teacher2, members: [ben] }]);
    await teach(teacher2, key);
    const calm = counting();
    const calmView = await view(calm.client);
    await teach(teacher, key2);
    await pick(anjali, key2);
    await teach(teacher, key3);
    await cant(ben);
    const busy = counting();
    const busyView = await view(busy.client);
    expect([ours(calmView.drift).length === 0, ours(busyView.drift).length >= 3, busy.calls() === calm.calls()]).toEqual([true, true, true]);
  });
});
