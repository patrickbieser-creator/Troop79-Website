import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { addMeetingPick, loadMeetingById } from '../src/lib/meeting-board';
import { teachTopic } from '../src/lib/meeting-board-supply';

/**
 * Meeting Live P4b, editing (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8d, 10a; the tech-lead's P4 spec sections
 * 2, 5 and 7). Every Live write takes the meeting's Live lock and bumps live_version; card writes carry the card's
 * version and a scout move is compare-and-set, so two leaders on two phones never silently lose a write. The first
 * edit on an unstarted meeting starts Live (once) and resolves the preview's card ids through source_key. Editors
 * (the SPL included) only; viewers are refused on the server. Real local database; the admin actor is mocked.
 * Fixture meetings are dated 2097; cleanup by test-owned ids only.
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
let meeting = 0; // 2097-03-07
let mbNight = 0; // 2097-03-14, a legacy merit badge board row (set up in v1's Admin)
let editorAdult = 0;
let teacher = 0;
let teacher2 = 0;
let spl = 0;
let ann = 0;
let bo = 0;
let key = '';
let key2 = '';

async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MLE ${label}`, first_name: `${TEST_PREFIX} MLE`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mle-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} MLE`, last_name: label, display_name: `${TEST_PREFIX} MLE ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
const pick = async (personId: number, k: string) => {
  const res = await addMeetingPick(sb, { entryId: meeting, personId, actorPersonId: editorAdult, leader: true, carry: null }, k, { later: false, markComing: true });
  if (!res.ok) throw new Error(res.error);
};
const teach = async (personId: number, k: string) => {
  const res = await teachTopic(sb, { personId, actorPersonId: editorAdult, leader: true }, [meeting], { key: k }, null);
  if (!res.ok) throw new Error(res.error);
};
/** Start Live straight from a snapshot: class ids back, in the order given. */
async function started(classes: { topic_key: string; rotation: number | null; teacher_person_id?: number | null; members: number[] }[]): Promise<number[]> {
  for (const c of classes) await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: c.topic_key });
  const { error } = await sb.rpc('meeting_live_start', {
    p_entry: meeting,
    p_actor: editorAdult,
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
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', entryId);
}
const membersOf = async (classId: number) =>
  (((await sb.from('meeting_class_members').select('person_id').eq('class_id', classId)).data ?? []) as { person_id: number }[]).map((m) => m.person_id).sort((a, b) => a - b);
const classRow = async (classId: number) =>
  (await sb.from('meeting_classes').select('rotation, teacher_person_id, version, title').eq('id', classId).maybeSingle()).data as { rotation: number | null; teacher_person_id: number | null; version: number; title: string | null } | null;
const liveVersion = async () => ((await sb.from('meeting_boards').select('live_version').eq('calendar_entry_id', meeting).maybeSingle()).data as { live_version: number } | null)?.live_version ?? 0;
const rotations = async (entryId = meeting) =>
  ((((await sb.from('meeting_rotations').select('number, location').eq('calendar_entry_id', entryId).order('number')).data ?? []) as { number: number; location: string | null }[]));
const classCount = async () => (await sb.from('meeting_classes').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting)).count ?? 0;

beforeAll(async () => {
  meeting = await entry('2097-03-07');
  mbNight = await entry('2097-03-14');
  editorAdult = await person('Editor');
  teacher = await person('Teacher');
  teacher2 = await person('Teacher2');
  spl = await scout('Spl', 'star');
  ann = await scout('Ann', 'scout');
  bo = await scout('Bo', 'scout');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(2);
  [key, key2] = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
  const { data: mb } = await sb.from('merit_badges').select('id').limit(1).single();
  const { error } = await sb.from('meeting_boards').insert({ calendar_entry_id: mbNight, board_mode: 'merit_badge', board_mb_id: (mb as { id: string }).id });
  if (error) throw new Error(error.message);
});

afterEach(async () => {
  await clearMeeting(meeting);
  state.actor = null;
});

afterAll(async () => {
  await clearMeeting(mbNight);
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asEditor = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asSpl = () => (state.actor = { personId: spl, subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });

describe('who may edit Meeting Live', () => {
  it('Viewer_IsRefused_OnEveryLiveWrite', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1, members: [ann] }]);
    const before = await liveVersion();
    asViewer();
    const a = await live();
    const id = `c:${c}`;
    const results = await Promise.all([
      a.plannerLiveStartAction({ entryId: meeting }),
      a.plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: id, to: null }),
      a.plannerLiveSetTeacherAction({ entryId: meeting, classId: id, version: 1, teacherId: teacher }),
      a.plannerLiveMoveClassAction({ entryId: meeting, classId: id, version: 1, rotation: 2 }),
      a.plannerLiveRepeatClassAction({ entryId: meeting, classId: id, version: 1, rotation: 2 }),
      a.plannerLiveRemoveClassAction({ entryId: meeting, classId: id, version: 1 }),
      a.plannerLiveAddRotationAction({ entryId: meeting, expectMax: 2 }),
      a.plannerLiveDropRotationAction({ entryId: meeting, number: 2 }),
      a.plannerLiveSetLocationAction({ entryId: meeting, number: 1, location: 'Gym' }),
      a.plannerLiveAddClassAction({ entryId: meeting, key: key2, title: null, teacherId: null, rotation: 1 })
    ]);
    expect([results.every((r) => !r.ok), await liveVersion(), await membersOf(c)]).toEqual([true, before, [ann]]);
  });

  it('ScoutEditor_CanMoveAScout', async () => {
    const [a, b] = await started([
      { topic_key: key, rotation: 1, members: [ann] },
      { topic_key: key2, rotation: 1, members: [] }
    ]);
    asSpl();
    const res = await (await live()).plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: `c:${a}`, to: `c:${b}` });
    expect([res.ok, await membersOf(a), await membersOf(b)]).toEqual([true, [], [ann]]);
  });

  // P5a (Decision 10): a merit badge night is just a meeting. A board row still saying merit_badge changes nothing.
  it('Planner_CanOpenLive_WhenMeetingHasLegacyMeritBadgeRow', async () => {
    asEditor();
    const res = await (await live()).plannerLiveStartAction({ entryId: mbNight });
    expect(res.ok).toBe(true);
  });
});

describe('two leaders at once', () => {
  it('SequentialMoves_DoNotLoseAWrite (a stale card version)', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1, members: [] }]);
    asEditor();
    const a = await live();
    const first = await a.plannerLiveMoveClassAction({ entryId: meeting, classId: `c:${c}`, version: 1, rotation: 2 });
    const second = await a.plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${c}`, version: 1, teacherId: teacher });
    expect([first.ok, second.ok, !second.ok && second.stale, (await classRow(c))?.rotation, (await classRow(c))?.teacher_person_id]).toEqual([true, false, true, 2, null]);
  });

  it('SequentialMoves_DoNotLoseAWrite (a scout who has already gone)', async () => {
    const [x, y, z] = await started([
      { topic_key: key, rotation: 1, members: [ann] },
      { topic_key: key2, rotation: 1, members: [] },
      { topic_key: key2, rotation: 2, members: [] }
    ]);
    asEditor();
    const a = await live();
    const first = await a.plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: `c:${x}`, to: `c:${y}` });
    const second = await a.plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: `c:${x}`, to: `c:${z}` });
    expect([first.ok, !second.ok && second.stale, await membersOf(y), await membersOf(z)]).toEqual([true, true, [ann], []]);
  });

  it('ConcurrentMoves_OnTheSameCardVersion_ExactlyOneWins', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1, members: [] }]);
    asEditor();
    const a = await live();
    const [x, y] = await Promise.all([
      a.plannerLiveMoveClassAction({ entryId: meeting, classId: `c:${c}`, version: 1, rotation: 2 }),
      a.plannerLiveMoveClassAction({ entryId: meeting, classId: `c:${c}`, version: 1, rotation: null })
    ]);
    const winner = x.ok ? 2 : null;
    expect([[x.ok, y.ok].filter(Boolean).length, [x, y].filter((r) => !r.ok && r.stale).length, (await classRow(c))?.rotation, (await classRow(c))?.version]).toEqual([
      1,
      1,
      x.ok ? winner : null,
      2
    ]);
  });

  it('TwoLeadersPlacingTheSameUnplacedScout_OnlyOneWins', async () => {
    const [p, q] = await started([
      { topic_key: key, rotation: 1, members: [] },
      { topic_key: key2, rotation: 1, members: [] }
    ]);
    asEditor();
    const a = await live();
    const first = await a.plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: null, to: `c:${p}` });
    const second = await a.plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: null, to: `c:${q}` });
    expect([first.ok, !second.ok && second.stale, await membersOf(p), await membersOf(q)]).toEqual([true, true, [ann], []]);
  });

  it('TwoLeadersPlacingTheSameUnplacedScout_InParallel_OnlyOneWins', async () => {
    const [p, q] = await started([
      { topic_key: key, rotation: 1, members: [] },
      { topic_key: key2, rotation: 1, members: [] }
    ]);
    asEditor();
    const a = await live();
    const res = await Promise.all([
      a.plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: null, to: `c:${p}` }),
      a.plannerLiveMoveScoutAction({ entryId: meeting, personId: ann, from: null, to: `c:${q}` })
    ]);
    expect([res.filter((r) => r.ok).length, (await membersOf(p)).length + (await membersOf(q)).length]).toEqual([1, 1]);
  });

  it('AClassFromAnotherMeeting_IsStale_AndNothingChanges', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1, members: [ann] }]);
    const other = await entry('2097-03-21');
    const { error: e1 } = await sb.rpc('_meeting_topic_id', { p_entry: other, p_key: key });
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await sb.rpc('meeting_live_start', { p_entry: other, p_actor: editorAdult, p_snapshot: { rotations: [], classes: [] } });
    if (e2) throw new Error(e2.message);
    asEditor();
    const a = await live();
    // Acting on `other` with this meeting's class id: every card op and a scout move into it.
    const results = await Promise.all([
      a.plannerLiveMoveClassAction({ entryId: other, classId: `c:${c}`, version: 1, rotation: 2 }),
      a.plannerLiveSetTeacherAction({ entryId: other, classId: `c:${c}`, version: 1, teacherId: teacher }),
      a.plannerLiveRemoveClassAction({ entryId: other, classId: `c:${c}`, version: 1 }),
      a.plannerLiveMoveScoutAction({ entryId: other, personId: ann, from: `c:${c}`, to: null })
    ]);
    const row = await classRow(c);
    await clearMeeting(other);
    expect([results.every((r) => !r.ok && r.stale), row?.rotation, row?.teacher_person_id, row?.version, await membersOf(c)]).toEqual([true, 1, null, 1, [ann]]);
  });

  it('EveryEdit_BumpsLiveVersion_SoPollersSeeIt', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1, members: [] }]);
    const before = await liveVersion();
    asEditor();
    await (await live()).plannerLiveSetLocationAction({ entryId: meeting, number: 1, location: 'Back room' });
    expect(await liveVersion()).toBe(before + 1);
    expect(c).toBeGreaterThan(0);
  });
});

describe('the first edit starts Live', () => {
  it('FirstEdit_StartsLive_Once', async () => {
    await pick(ann, key);
    await pick(bo, key2);
    await teach(teacher, key);
    await teach(teacher2, key2);
    const m = (await loadMeetingById(sb, meeting))!;
    const view = await (await lib()).loadLiveView(sb, m);
    const [p1, p2] = [teacher, teacher2].map((t) => view.cards.find((c) => c.teacher?.personId === t)!);
    asEditor();
    const a = await live();
    const [r1, r2] = await Promise.all([
      a.plannerLiveMoveClassAction({ entryId: meeting, classId: p1.id, version: p1.version, rotation: 2 }),
      a.plannerLiveSetTeacherAction({ entryId: meeting, classId: p2.id, version: p2.version, teacherId: editorAdult })
    ]);
    const { data } = await sb.from('meeting_classes').select('rotation, teacher_person_id, source_key').eq('calendar_entry_id', meeting);
    const rows = (data ?? []) as { rotation: number; teacher_person_id: number; source_key: string }[];
    expect([r1.ok, r2.ok, rows.length, rows.find((r) => `s:${r.source_key}` === p1.id)?.rotation, rows.find((r) => `s:${r.source_key}` === p2.id)?.teacher_person_id]).toEqual([
      true,
      true,
      view.cards.length,
      2,
      editorAdult
    ]);
  });

  it('APreviewIdTheMatcherNoLongerHas_IsStale', async () => {
    await pick(ann, key);
    await teach(teacher, key);
    asEditor();
    const res = await (await live()).plannerLiveMoveClassAction({ entryId: meeting, classId: 's:999:nope', version: 1, rotation: 2 });
    expect([res.ok, !res.ok && res.stale]).toEqual([false, true]);
  });
});

describe('cards', () => {
  it('MeetingLive_RepeatClass_InSecondRotation_WithDifferentScouts', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1, teacher_person_id: teacher, members: [ann] }]);
    asEditor();
    const a = await live();
    const rep = await a.plannerLiveRepeatClassAction({ entryId: meeting, classId: `c:${c}`, version: 1, rotation: 2 });
    const { data } = await sb.from('meeting_classes').select('id').eq('calendar_entry_id', meeting).neq('id', c).single();
    const copy = (data as { id: number }).id;
    await a.plannerLiveMoveScoutAction({ entryId: meeting, personId: bo, from: null, to: `c:${copy}` });
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, meeting))!);
    const cards = v.cards.filter((x) => x.topicKey === key).sort((x, y) => (x.rotation ?? 0) - (y.rotation ?? 0));
    expect([rep.ok, cards.map((x) => [x.rotation, x.repeats, x.members.map((m) => m.personId), x.teacher?.personId ?? null])]).toEqual([
      true,
      [
        [1, [2], [ann], teacher],
        [2, [1], [bo], null]
      ]
    ]);
  });

  it('SetTeacher_AndClear', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1, members: [] }]);
    asEditor();
    const a = await live();
    await a.plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${c}`, version: 1, teacherId: teacher });
    const set = (await classRow(c))!;
    await a.plannerLiveSetTeacherAction({ entryId: meeting, classId: `c:${c}`, version: set.version, teacherId: null });
    expect([set.teacher_person_id, set.version, (await classRow(c))?.teacher_person_id]).toEqual([teacher, 2, null]);
  });

  it('MoveClass_ToNotScheduled', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1, members: [] }]);
    asEditor();
    await (await live()).plannerLiveMoveClassAction({ entryId: meeting, classId: `c:${c}`, version: 1, rotation: null });
    expect((await classRow(c))?.rotation).toBeNull();
  });

  it('RemoveClass_SendsItsScoutsBackToThePool', async () => {
    await pick(ann, key);
    const [c] = await started([{ topic_key: key, rotation: 1, members: [ann] }]);
    asEditor();
    const res = await (await live()).plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${c}`, version: 1 });
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, meeting))!);
    expect([res.ok, await classRow(c), v.pool.some((p) => p.personId === ann)]).toEqual([true, null, true]);
  });

  it('AddAnOffer_WithATeacher_AlsoPutsThemOnTheBoard', async () => {
    await started([]);
    asEditor();
    const res = await (await live()).plannerLiveAddClassAction({ entryId: meeting, key: key2, title: null, teacherId: teacher, rotation: 2 });
    const { data: cls } = await sb.from('meeting_classes').select('rotation, teacher_person_id, meeting_topics(topic_key)').eq('calendar_entry_id', meeting).single();
    const { data: tt } = await sb.from('meeting_topic_teachers').select('person_id, entered_by_person_id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting);
    expect([res.ok, cls, tt]).toEqual([
      true,
      { rotation: 2, teacher_person_id: teacher, meeting_topics: { topic_key: key2 } },
      [{ person_id: teacher, entered_by_person_id: editorAdult, meeting_topics: { topic_key: key2 } }]
    ]);
  });

  it('AddAnOffer_ByTitle_MakesAFreeformClass', async () => {
    await started([]);
    asEditor();
    await (await live()).plannerLiveAddClassAction({ entryId: meeting, key: null, title: `${TEST_PREFIX} Knife care`, teacherId: null, rotation: null });
    const { data } = await sb.from('meeting_classes').select('rotation, meeting_topics(kind)').eq('calendar_entry_id', meeting).single();
    expect(data).toEqual({ rotation: null, meeting_topics: { kind: 'freeform' } });
  });
});

describe('rotations', () => {
  it('MeetingLive_CanAddFourthRotation_AndBeyond', async () => {
    await started([]);
    asEditor();
    const a = await live();
    await a.plannerLiveAddRotationAction({ entryId: meeting, expectMax: 2 });
    await a.plannerLiveAddRotationAction({ entryId: meeting, expectMax: 3 });
    await a.plannerLiveAddRotationAction({ entryId: meeting, expectMax: 4 });
    // A second leader's tap with the old count adds nothing.
    const again = await a.plannerLiveAddRotationAction({ entryId: meeting, expectMax: 4 });
    expect([again.ok, (await rotations()).map((r) => r.number)]).toEqual([true, [1, 2, 3, 4, 5]]);
  });

  it('DropRotation_OnlyTheLastEmptyOne', async () => {
    await started([{ topic_key: key, rotation: 2, members: [] }]);
    asEditor();
    const a = await live();
    await a.plannerLiveAddRotationAction({ entryId: meeting, expectMax: 2 });
    const notLast = await a.plannerLiveDropRotationAction({ entryId: meeting, number: 2 });
    const last = await a.plannerLiveDropRotationAction({ entryId: meeting, number: 3 });
    expect([notLast.ok, last.ok, (await rotations()).map((r) => r.number)]).toEqual([false, true, [1, 2]]);
  });

  it('SetLocation_LastWriteWins_AndBlankClears', async () => {
    await started([]);
    asEditor();
    const a = await live();
    await a.plannerLiveSetLocationAction({ entryId: meeting, number: 1, location: 'Gym' });
    await a.plannerLiveSetLocationAction({ entryId: meeting, number: 1, location: '  Back room ' });
    await a.plannerLiveSetLocationAction({ entryId: meeting, number: 2, location: 'Lobby' });
    await a.plannerLiveSetLocationAction({ entryId: meeting, number: 2, location: '' });
    expect(await rotations()).toEqual([
      { number: 1, location: 'Back room' },
      { number: 2, location: null }
    ]);
  });

  it('ClassCount_IsUnchangedByRotationEdits', async () => {
    await started([{ topic_key: key, rotation: 1, members: [] }]);
    asEditor();
    await (await live()).plannerLiveAddRotationAction({ entryId: meeting, expectMax: 2 });
    expect(await classCount()).toBe(1);
  });
});

describe('after Live starts, the other screens keep their lists', () => {
  it('Seam_ComingNothing_ListsAComingScoutWithNoClass', async () => {
    await pick(ann, key);
    await pick(bo, key2);
    await started([{ topic_key: key, rotation: 1, members: [ann] }]);
    const m = (await loadMeetingById(sb, meeting))!;
    const { loadAdvancementCatalog } = await import('../src/lib/advancement-catalog');
    const { loadBoardState } = await import('../src/lib/meeting-board');
    const { loadTeachBoard } = await import('../src/lib/meeting-board-supply');
    const catalog = await loadAdvancementCatalog();
    const rows = await loadBoardState(sb, m, catalog);
    const match = await (await lib()).loadMatchOrPlacement(sb, m, rows, await loadTeachBoard(sb, m, catalog, rows));
    const ids = match.comingNothing.map((c) => c.personId);
    expect([ids.includes(bo), ids.includes(ann)]).toEqual([true, false]);
  });
});

describe('posture', () => {
  it('LiveEditFunctions_AreServiceRoleOnly', () => {
    const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
    const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${/^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app'}`;
    const fns = [
      '_meeting_live_edit(bigint)',
      '_meeting_live_bump(bigint)',
      'meeting_live_move_scout(bigint,bigint,bigint,bigint,bigint)',
      'meeting_live_set_teacher(bigint,bigint,bigint,integer,bigint)',
      'meeting_live_move_class(bigint,bigint,bigint,integer,smallint)',
      'meeting_live_repeat_class(bigint,bigint,bigint,integer,smallint)',
      'meeting_live_remove_class(bigint,bigint,bigint,integer)',
      'meeting_live_add_rotation(bigint,bigint,smallint)',
      'meeting_live_drop_rotation(bigint,bigint,smallint)',
      'meeting_live_set_location(bigint,bigint,smallint,text)',
      'meeting_live_add_class(bigint,bigint,text,text,bigint,smallint)'
    ];
    const checks = ['anon', 'authenticated'].flatMap((role) => fns.map((f) => `(has_function_privilege('${role}', 'public.${f}', 'execute'))`));
    const out = execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', `select bool_or(x) from (values ${checks.join(', ')}) v(x)`], { encoding: 'utf8' }).trim();
    expect(out).toBe('f');
  });
});
