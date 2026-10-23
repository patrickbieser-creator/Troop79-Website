import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { loadAdvancementCatalog } from '../src/lib/advancement-catalog';
import { addMeetingPick, loadBoardState, loadMeetingById, type BoardMeeting } from '../src/lib/meeting-board';
import { loadTeachBoard, teachTopic } from '../src/lib/meeting-board-supply';

/**
 * Meeting Live P4a (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8c; the tech-lead's P4 spec sections 1, 2, 6):
 * the saved placement, copied from the matcher on the first Live write (meeting_live_start, idempotent under the
 * meeting's lock), read back by every match reader through loadMatchOrPlacement, and drawn by the read-only Live view.
 * Real local database; the admin actor is mocked. Fixture meetings are dated 2096 so they never collide with the real
 * calendar or another file's fixtures; cleanup is by test-owned ids only.
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
let meeting = 0; // 2096-04-05
let editorAdult = 0;
let teacher = 0;
let spl = 0;
let ann = 0; // working on Tenderfoot
let bo = 0; // working on Tenderfoot
let cy = 0; // working on Tenderfoot, picks after Live starts
let done = 0; // First Class: every Tenderfoot requirement is behind them
let key = '';
let key2 = '';

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}

async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MLV ${label}`, first_name: `${TEST_PREFIX} MLV`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mlv-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} MLV`, last_name: label, display_name: `${TEST_PREFIX} MLV ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
const pick = async (entryId: number, personId: number, k: string) => {
  const res = await addMeetingPick(sb, { entryId, personId, actorPersonId: editorAdult, leader: true, carry: null }, k, { later: false, markComing: true });
  if (!res.ok) throw new Error(res.error);
};
const teach = async (entryId: number, personId: number, k: string) => {
  const res = await teachTopic(sb, { personId, actorPersonId: editorAdult, leader: true }, [entryId], { key: k }, null);
  if (!res.ok) throw new Error(res.error);
};
/** Drops the placement first (a class holds its topic), then the board's rows. */
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
const boardOf = async (m: BoardMeeting) => {
  const catalog = await loadAdvancementCatalog();
  const rows = await loadBoardState(sb, m, catalog);
  return { catalog, rows, teach: await loadTeachBoard(sb, m, catalog, rows) };
};
const mine = (ids: readonly number[]) => ids.filter((id) => [ann, bo, cy, done].includes(id)).sort((a, b) => a - b);
const snapshot = (classes: { source_key?: string; topic_key: string; rotation: number | null; teacher_person_id?: number | null; members: number[]; title?: string | null }[]) => ({
  rotations: [
    { number: 1, location: null },
    { number: 2, location: null }
  ],
  classes: classes.map((c, i) => ({ source_key: c.source_key ?? `t:${i}`, title: c.title ?? null, teacher_person_id: c.teacher_person_id ?? null, position: i, ...c }))
});

beforeAll(async () => {
  meeting = await entry('2096-04-05');
  editorAdult = await person('Editor');
  teacher = await person('Teacher');
  spl = await scout('Spl', 'star');
  ann = await scout('Ann', 'scout');
  bo = await scout('Bo', 'scout');
  cy = await scout('Cy', 'scout');
  done = await scout('Done', 'first-class');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(2);
  [key, key2] = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
});

afterEach(async () => {
  for (const e of entries) await clearMeeting(e);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asEditor = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asSpl = () => (state.actor = { personId: spl, subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });
const classCount = async (entryId: number) => (await sb.from('meeting_classes').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', entryId)).count ?? 0;

describe('starting Meeting Live', () => {
  it('Viewer_IsRefused_AndNothingIsSaved', async () => {
    await pick(meeting, ann, key);
    await teach(meeting, teacher, key);
    asViewer();
    const res = await (await live()).plannerLiveStartAction({ entryId: meeting });
    expect([res.ok, await classCount(meeting)]).toEqual([false, 0]);
  });

  it('SignedOut_IsRefused', async () => {
    expect((await (await live()).plannerLiveStartAction({ entryId: meeting })).ok).toBe(false);
  });

  it('Editor_StartsMeetingLive_CopyingTheMatch', async () => {
    await pick(meeting, ann, key);
    await pick(meeting, bo, key);
    await teach(meeting, teacher, key);
    asEditor();
    const res = await (await live()).plannerLiveStartAction({ entryId: meeting });
    const { data } = await sb.from('meeting_classes').select('rotation, teacher_person_id, entered_by_person_id, meeting_topics(topic_key), meeting_class_members(person_id)').eq('calendar_entry_id', meeting);
    const rows = (data ?? []) as unknown as { rotation: number; teacher_person_id: number; entered_by_person_id: number; meeting_topics: { topic_key: string }; meeting_class_members: { person_id: number }[] }[];
    const mineRow = rows.find((r) => r.teacher_person_id === teacher)!;
    expect([res.ok, mineRow.rotation, mineRow.meeting_topics.topic_key, mineRow.entered_by_person_id, mine(mineRow.meeting_class_members.map((m) => m.person_id))]).toEqual([true, 1, key, editorAdult, mine([ann, bo])]);
  });

  it('Spl_CanStartMeetingLive', async () => {
    await pick(meeting, ann, key);
    await teach(meeting, teacher, key);
    asSpl();
    expect((await (await live()).plannerLiveStartAction({ entryId: meeting })).ok).toBe(true);
  });

  it('Start_IsIdempotent_TheSecondStartChangesNothing', async () => {
    await pick(meeting, ann, key);
    await teach(meeting, teacher, key);
    asEditor();
    const act = await live();
    await act.plannerLiveStartAction({ entryId: meeting });
    await pick(meeting, bo, key2);
    await teach(meeting, editorAdult, key2);
    // Rotations L2: those two writes give key2 its class on their own; a second Start adds nothing more.
    const before = await classCount(meeting);
    const again = await act.plannerLiveStartAction({ entryId: meeting });
    expect([again.ok, await classCount(meeting)]).toEqual([true, before]);
  });

  it('Stamp_Changes_WhenMeetingLiveStarts', async () => {
    await pick(meeting, ann, key);
    await teach(meeting, teacher, key);
    const before = localSql(`select public.meeting_board_stamp(${meeting})`);
    asEditor();
    await (await live()).plannerLiveStartAction({ entryId: meeting });
    expect(localSql(`select public.meeting_board_stamp(${meeting})`)).not.toBe(before);
  });
});

describe('the saved placement is the truth', () => {
  it('MeetingLive_ReturnsSavedPlacement_AfterFirstChange', async () => {
    await pick(meeting, ann, key);
    await pick(meeting, bo, key);
    await teach(meeting, teacher, key);
    asEditor();
    await (await live()).plannerLiveStartAction({ entryId: meeting });
    await pick(meeting, cy, key); // the board moves on: Cy's late pick lands in the saved class (Rotations L1)
    const m = (await loadMeetingById(sb, meeting))!;
    const b = await boardOf(m);
    const match = await (await lib()).loadMatchOrPlacement(sb, m, b.rows, b.teach);
    const s = match.sessions.find((x) => x.teacherId === teacher)!;
    expect([s.id.startsWith('c:'), s.rotation, mine(s.scouts.map((x) => x.personId))]).toEqual([true, 1, mine([ann, bo, cy])]);
  });

  it('BeforeStart_TheSeamReturnsTheMatcher', async () => {
    await pick(meeting, ann, key);
    await teach(meeting, teacher, key);
    const m = (await loadMeetingById(sb, meeting))!;
    const b = await boardOf(m);
    const match = await (await lib()).loadMatchOrPlacement(sb, m, b.rows, b.teach);
    expect(match.sessions.find((x) => x.teacherId === teacher)?.id.startsWith('c:')).toBe(false);
  });

  it('LiveView_ShowsThePreviewBeforeStart_AndTheSavedPlacementAfter', async () => {
    await pick(meeting, ann, key);
    await teach(meeting, teacher, key);
    const m = (await loadMeetingById(sb, meeting))!;
    const { loadLiveView } = await lib();
    const before = await loadLiveView(sb, m);
    asEditor();
    await (await live()).plannerLiveStartAction({ entryId: meeting });
    const after = await loadLiveView(sb, m);
    const card = (v: typeof before) => v.cards.find((c) => c.teacher?.personId === teacher)!;
    expect([before.started, card(before).id.startsWith('s:'), after.started, card(after).id.startsWith('c:'), after.rotations.map((r) => r.number)]).toEqual([false, true, true, true, [1, 2]]);
  });
});

describe('repeats and retakes on the Live view', () => {
  it('MeetingLive_RepeatClass_InSecondRotation_WithDifferentScouts', async () => {
    await pick(meeting, ann, key); // makes the topic row
    const ok = await sb.rpc('meeting_live_start', {
      p_entry: meeting,
      p_actor: editorAdult,
      p_snapshot: snapshot([
        { topic_key: key, rotation: 1, teacher_person_id: teacher, members: [ann] },
        { topic_key: key, rotation: 2, teacher_person_id: editorAdult, members: [bo] }
      ])
    });
    if (ok.error) throw new Error(ok.error.message);
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, meeting))!);
    const cards = v.cards.filter((c) => c.topicKey === key).sort((a, b) => (a.rotation ?? 0) - (b.rotation ?? 0));
    expect(cards.map((c) => [c.rotation, c.repeats, c.members.map((x) => x.personId)])).toEqual([
      [1, [2], [ann]],
      [2, [1], [bo]]
    ]);
  });

  it('MeetingLive_FlagsConflict_WhenScoutInTwoRepeatsOfSameClass', async () => {
    await pick(meeting, ann, key);
    await sb.rpc('meeting_live_start', {
      p_entry: meeting,
      p_actor: editorAdult,
      p_snapshot: snapshot([
        { topic_key: key, rotation: 1, members: [ann] },
        { topic_key: key, rotation: 2, members: [ann] }
      ])
    });
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, meeting))!);
    expect([v.overlaps, v.cards.filter((c) => c.topicKey === key).every((c) => c.conflicts.length === 1)]).toEqual([1, true]);
  });

  it('MeetingLive_MarksRetake_WhenScoutAlreadyCompletedClass', async () => {
    await pick(meeting, ann, key);
    await sb.rpc('meeting_live_start', { p_entry: meeting, p_actor: editorAdult, p_snapshot: snapshot([{ topic_key: key, rotation: 1, members: [ann, done] }]) });
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, meeting))!);
    const c = v.cards.find((x) => x.topicKey === key)!;
    expect(c.members.map((x) => [x.personId, x.retake]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual(
      [
        [ann, false],
        [done, true]
      ].sort((a, b) => Number(a[0]) - Number(b[0]))
    );
  });
});

describe('the schema holds', () => {
  it('Unseed_KeepsTheTopic_WhenAClassHoldsIt', async () => {
    const seeded = await sb.rpc('meeting_seed_topic', { p_entry: meeting, p_key: key, p_actor: editorAdult });
    if (seeded.error) throw new Error(seeded.error.message);
    await sb.rpc('meeting_live_start', { p_entry: meeting, p_actor: editorAdult, p_snapshot: snapshot([{ topic_key: key, rotation: null, members: [] }]) });
    const { error } = await sb.rpc('meeting_unseed_topic', { p_entry: meeting, p_key: key });
    const { data } = await sb.from('meeting_topics').select('seeded_at').eq('calendar_entry_id', meeting).eq('topic_key', key).maybeSingle();
    expect([error, data ? (data as { seeded_at: string | null }).seeded_at : 'gone']).toEqual([null, null]);
  });

  it('Unteach_KeepsAFreeformTopic_WhenAClassHoldsIt', async () => {
    const res = await teachTopic(sb, { personId: teacher, actorPersonId: editorAdult, leader: true }, [meeting], { title: `${TEST_PREFIX} knife sharpening` }, null);
    if (!res.ok) throw new Error(res.error);
    const { data: t } = await sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', meeting).eq('kind', 'freeform').single();
    const ff = (t as { topic_key: string }).topic_key;
    await sb.rpc('meeting_live_start', { p_entry: meeting, p_actor: editorAdult, p_snapshot: snapshot([{ topic_key: ff, rotation: 1, teacher_person_id: teacher, members: [] }]) });
    const { error } = await sb.rpc('meeting_unteach_topic', { p_entry: meeting, p_person: teacher, p_actor: editorAdult, p_leader: true, p_topic_key: ff });
    expect([error, await classCount(meeting)]).toEqual([null, 1]);
  });

  it('DeletingTheMeeting_TakesItsPlacementWithIt', async () => {
    const other = await entry('2096-04-12');
    await pick(other, ann, key);
    await sb.rpc('meeting_live_start', { p_entry: other, p_actor: editorAdult, p_snapshot: snapshot([{ topic_key: key, rotation: 1, members: [ann] }]) });
    const { error } = await sb.from('calendar_entries').delete().eq('id', other);
    expect([error, await classCount(other)]).toEqual([null, 0]);
  });

  it('MergePeople_MovesClassTeacherMembersAndEnteredBy', async () => {
    const survivor = await person('Survivor');
    const loser = await person('Loser');
    await pick(meeting, ann, key);
    await sb.rpc('meeting_live_start', { p_entry: meeting, p_actor: loser, p_snapshot: snapshot([{ topic_key: key, rotation: 1, teacher_person_id: loser, members: [loser, survivor] }]) });
    const { error } = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (error) throw new Error(error.message);
    const { data } = await sb.from('meeting_classes').select('teacher_person_id, entered_by_person_id, meeting_class_members(person_id, entered_by_person_id)').eq('calendar_entry_id', meeting).single();
    const c = data as { teacher_person_id: number; entered_by_person_id: number; meeting_class_members: { person_id: number; entered_by_person_id: number }[] };
    // Ann's pick lands too (Rotations L1, on the merge's reconcile); the merge is about the two people.
    const theirs = c.meeting_class_members.filter((m) => m.person_id === survivor || m.person_id === loser);
    expect([c.teacher_person_id, c.entered_by_person_id, theirs]).toEqual([survivor, survivor, [{ person_id: survivor, entered_by_person_id: survivor }]]);
  });

  it('NewTablesAndFunctions_AreServiceRoleOnly', () => {
    const fns = ['meeting_live_start(bigint,bigint,jsonb)', 'meeting_board_stamp(bigint)', 'meeting_unseed_topic(bigint,text)', 'meeting_unteach_topic(bigint,bigint,bigint,boolean,text)'];
    const tables = ['meeting_rotations', 'meeting_classes', 'meeting_class_members'];
    const checks = ['anon', 'authenticated'].flatMap((role) => [
      ...fns.map((f) => `has_function_privilege('${role}', 'public.${f}', 'execute')`),
      ...tables.map((t) => `has_table_privilege('${role}', 'public.${t}', 'select')`)
    ]);
    expect(localSql(`select bool_or(x) from (values ${checks.map((c) => `(${c})`).join(', ')}) v(x)`)).toBe('f');
  });
});
