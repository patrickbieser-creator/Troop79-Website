import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { centralToday } from '../src/lib/dates';

/**
 * Build a Plan B8 (Plans/Build-A-Plan.md "B8"; D-429): Meeting Live is reversible and attendance is approved, never
 * automatic. Presence taps on Live are a draft (meeting_live_presence); nothing writes event_attendance or the ledger
 * until an editor approves the checklist after the meeting ("Record attendance"), and then only the differences.
 * "Discard Live arrangement" deletes the classes, rotations and draft ticks and keeps recorded attendance, visitors,
 * offerings and teacher sign-ups. A stale tab can't silently restart Live. Real local database (migration
 * 20261218100000); the admin actor is mocked. Meetings: one dated today (Central), one in 2079 (future), one in 2020
 * (over). Cleanup by test-owned ids only.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; label: string; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));

const live = () => import('../src/app/(public)/planner/live-actions');
const lib = () => import('../src/lib/meeting-live');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
const visitors: number[] = [];
let householdExisted = true;
let today = 0;
let future = 0;
let past = 0;
let campout = 0;
let campoutToday = 0;
let draftPast = 0;
let editorAdult = 0;
let teacher = 0;
let ann = 0;
let bo = 0;
let key = '';

async function entry(date: string, category = 'Troop Meeting', status = 'published'): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category, title: `${category} ${TEST_PREFIX}`, status }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} B8 ${label}`, first_name: `${TEST_PREFIX} B8`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-b8-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} B8`, last_name: label, display_name: `${TEST_PREFIX} B8 ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
async function started(entryId: number, classes: { rotation: number | null; teacher_person_id?: number | null; members: number[] }[]): Promise<number[]> {
  await sb.rpc('_meeting_topic_id', { p_entry: entryId, p_key: key });
  const { error } = await sb.rpc('meeting_live_suggest', {
    p_entry: entryId,
    p_actor: editorAdult,
    p_snapshot: { rotations: [], classes: classes.map((c, i) => ({ source_key: `t:${i}`, topic_key: key, title: null, teacher_person_id: null, position: i, ...c })) }
  });
  if (error) throw new Error(error.message);
  const { data } = await sb.from('meeting_classes').select('id, source_key').eq('calendar_entry_id', entryId);
  const rows = (data ?? []) as { id: number; source_key: string }[];
  return classes.map((_, i) => rows.find((r) => r.source_key === `t:${i}`)!.id);
}
async function clearMeeting(entryId: number) {
  // Rotations L3: empty the plan first, or a reconcile on the way out begins the arrangement again.
  await sb.from('meeting_topics').update({ seeded_at: null }).eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_rotations').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_live_presence').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_boards').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', entryId);
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', entryId);
  await sb.from('event_attendance').delete().eq('calendar_entry_id', entryId);
  if (scoutIds.length) await sb.from('ledger_entries').delete().in('scout_id', scoutIds);
}
const recorded = async (entryId: number) =>
  (((await sb.from('event_attendance').select('person_id').eq('calendar_entry_id', entryId)).data ?? []) as { person_id: number }[]).map((r) => r.person_id).sort((a, b) => a - b);
const board = async (entryId: number) =>
  (await sb.from('meeting_boards').select('live_started_at, live_version').eq('calendar_entry_id', entryId).maybeSingle()).data as { live_started_at: string | null; live_version: number } | null;
const visitorHousehold = async () => (await sb.from('households').select('id').eq('system_key', 'meeting-visitors').maybeSingle()).data as { id: number } | null;
const trackVisitors = async () => {
  const hh = await visitorHousehold();
  if (!hh) return;
  const { data } = await sb.from('people').select('id').eq('guest_host_household_id', hh.id).like('display_name', `${TEST_PREFIX}%`);
  for (const r of (data ?? []) as { id: number }[]) if (!visitors.includes(r.id)) visitors.push(r.id);
};

const asEditor = () => (state.actor = { personId: editorAdult, label: 'Editor', subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editorAdult, label: 'Editor', subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });

beforeAll(async () => {
  householdExisted = (await visitorHousehold()) != null;
  today = await entry(centralToday());
  future = await entry('2079-05-07');
  past = await entry('2020-03-01');
  campout = await entry('2020-03-07', 'Campout / Overnight');
  campoutToday = await entry(centralToday(), 'Campout / Overnight');
  draftPast = await entry('2020-03-08', 'Troop Meeting', 'draft');
  editorAdult = await person('Editor');
  teacher = await person('Teacher');
  ann = await scout('Ann');
  bo = await scout('Bo');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(1);
  key = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`)[0];
});

afterEach(async () => {
  for (const e of entries) await clearMeeting(e);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  await trackVisitors();
  if (visitors.length) await sb.from('people').delete().in('id', visitors);
  if (!householdExisted) await sb.from('households').delete().eq('system_key', 'meeting-visitors');
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('nothing automatic', () => {
  it('LiveOpen_OnMeetingDay_RecordsNoAttendance', async () => {
    await started(today, [{ rotation: 1, teacher_person_id: teacher, members: [ann] }]);
    asEditor();
    await (await import('../src/app/(public)/planner/rotations/page')).default();
    expect(await recorded(today)).toEqual([]);
  });

  it('LivePresenceTap_IsDraftOnly', async () => {
    await started(today, [{ rotation: 1, members: [ann] }]);
    asEditor();
    const res = await (await live()).plannerLiveSetPresentAction({ entryId: today, personId: ann, present: true });
    const { data: draft } = await sb.from('meeting_live_presence').select('person_id, present').eq('calendar_entry_id', today);
    expect({ ok: res.ok, recorded: await recorded(today), draft }).toEqual({ ok: true, recorded: [], draft: [{ person_id: ann, present: true }] });
  });

  it('LiveVisitor_IsDraftOnly', async () => {
    await started(today, []);
    asEditor();
    const res = await (await live()).plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} B8 Visitor`, to: null });
    await trackVisitors();
    expect([res.ok, await recorded(today)]).toEqual([true, []]);
  });

  it('LiveVisitor_ShowsInThePool_AsHere', async () => {
    await started(today, []);
    asEditor();
    await (await live()).plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} B8 Pooled`, to: null });
    await trackVisitors();
    const { loadMeetingById } = await import('../src/lib/meeting-board');
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, today))!);
    const row = v.pool.find((p) => p.personId === visitors[visitors.length - 1]);
    expect([row?.visitor, row?.present]).toEqual([true, true]);
  });
});

describe('Would you like to update attendance?', () => {
  it('UpdateAttendance_AppearsAfterMeeting', async () => {
    await started(future, [{ rotation: 1, members: [ann] }]);
    const prompt = await (await lib()).loadAttendancePrompt(sb, { date: '2079-05-08', time: '09:00' });
    expect(prompt?.entryId).toBe(future);
  });

  it('UpdateAttendance_NotBeforeTheMeetingIsOver', async () => {
    await started(future, [{ rotation: 1, members: [ann] }]);
    const prompt = await (await lib()).loadAttendancePrompt(sb, { date: '2079-05-07', time: '19:00' });
    expect(prompt?.entryId).not.toBe(future);
  });

  it('UpdateAttendance_RecordsOnlyChanges', async () => {
    await started(past, [{ rotation: 1, teacher_person_id: teacher, members: [ann, bo] }]);
    await sb.from('event_attendance').insert({ calendar_entry_id: past, person_id: ann, qty: 1, source: 'manual', recorded_by: 'Earlier' });
    asEditor();
    const res = await (await live()).plannerRecordAttendanceAction({ entryId: past, add: [ann, bo], remove: [] });
    const { data } = await sb.from('event_attendance').select('person_id, recorded_by').eq('calendar_entry_id', past).order('person_id');
    expect({ res, rows: data }).toEqual({
      res: { ok: true, added: 1, removed: 0, failed: 0 },
      rows: [
        { person_id: ann, recorded_by: 'Earlier' },
        { person_id: bo, recorded_by: 'Editor' }
      ].sort((a, b) => a.person_id - b.person_id)
    });
  });

  it('UpdateAttendance_RemovesOnlyADeliberateUntick', async () => {
    await started(past, [{ rotation: 1, members: [ann] }]);
    await sb.from('event_attendance').insert([
      { calendar_entry_id: past, person_id: ann, qty: 1, source: 'manual', recorded_by: 'Earlier' },
      { calendar_entry_id: past, person_id: bo, qty: 1, source: 'manual', recorded_by: 'Earlier' }
    ]);
    asEditor();
    await (await live()).plannerRecordAttendanceAction({ entryId: past, add: [], remove: [bo] });
    expect(await recorded(past)).toEqual([ann]);
  });

  it('UpdateAttendance_WritesTheLedgerCredit', async () => {
    await started(past, [{ rotation: 1, members: [bo] }]);
    asEditor();
    await (await live()).plannerRecordAttendanceAction({ entryId: past, add: [bo], remove: [] });
    const { data } = await sb.from('ledger_entries').select('kind, deleted_at').eq('calendar_entry_id', past).eq('scout_id', `vitest-b8-${bo}`);
    expect(data).toEqual([{ kind: 'meeting_attendance', deleted_at: null }]);
  });

  it('UpdateAttendance_RequiresEdit', async () => {
    await started(past, [{ rotation: 1, members: [ann] }]);
    asViewer();
    const res = await (await live()).plannerRecordAttendanceAction({ entryId: past, add: [ann], remove: [] });
    expect([res.ok, await recorded(past)]).toEqual([false, []]);
  });

  it('UpdateAttendance_RefusesSomeoneNotOnTheChecklist', async () => {
    await started(past, [{ rotation: 1, members: [ann] }]);
    asEditor();
    const res = await (await live()).plannerRecordAttendanceAction({ entryId: past, add: [ann, editorAdult], remove: [] });
    expect([res.ok, await recorded(past)]).toEqual([false, []]);
  });

  it('UpdateAttendance_RefusesAMeetingThatIsntOver', async () => {
    await started(future, [{ rotation: 1, members: [ann] }]);
    asEditor();
    const res = await (await live()).plannerRecordAttendanceAction({ entryId: future, add: [ann], remove: [] });
    expect([res.ok, await recorded(future)]).toEqual([false, []]);
  });
});

describe('Discard Live arrangement', () => {
  // Rotations L3: Discard became "Reset to match picks": the hand work goes and the arrangement is rebuilt from the plan.
  it('Reset_ClearsTheHandWork_AndRebuilds', async () => {
    await started(future, [{ rotation: 1, teacher_person_id: teacher, members: [ann] }]);
    await sb.rpc('meeting_live_set_presence', { p_entry: future, p_actor: editorAdult, p_person: bo, p_present: true });
    asEditor();
    const res = await (await live()).plannerLiveResetAction({ entryId: future });
    const [scheduled, rot, draft] = await Promise.all([
      sb.from('meeting_classes').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', future).not('rotation', 'is', null),
      sb.from('meeting_rotations').select('number', { count: 'exact', head: true }).eq('calendar_entry_id', future),
      sb.from('meeting_live_presence').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', future)
    ]);
    expect({ ok: res.ok, scheduled: scheduled.count, rotations: rot.count, draft: draft.count }).toEqual({ ok: true, scheduled: 0, rotations: 2, draft: 0 });
  });

  it('Discard_KeepsAttendanceVisitorsAndOfferings', async () => {
    await started(future, [{ rotation: 1, members: [ann] }]);
    asEditor();
    const a = await live();
    // Visitors are added on the meeting day; the RPC adds one to this future meeting directly.
    const added = await sb.rpc('meeting_live_add_visitor_draft', { p_entry: future, p_actor: editorAdult, p_name: `${TEST_PREFIX} B8 Stays`, p_to: null });
    if (added.error) throw new Error(added.error.message);
    const vid = Number(added.data);
    visitors.push(vid);
    await sb.from('event_attendance').insert({ calendar_entry_id: future, person_id: ann, qty: 1, source: 'manual', recorded_by: 'Earlier' });
    await a.plannerLiveResetAction({ entryId: future });
    const [topics, guest, draft] = await Promise.all([
      sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', future),
      sb.from('people').select('id').eq('id', vid).maybeSingle(),
      sb.from('meeting_live_presence').select('person_id').eq('calendar_entry_id', future)
    ]);
    expect({ recorded: await recorded(future), topics: topics.data, visitor: guest.data?.id, visitorStays: draft.data }).toEqual({
      recorded: [ann],
      topics: [{ topic_key: key }],
      visitor: vid,
      visitorStays: [{ person_id: vid }]
    });
  });

  it('Discard_BumpsVersion', async () => {
    await started(future, [{ rotation: 1, members: [ann] }]);
    const before = (await board(future))!.live_version;
    asEditor();
    await (await live()).plannerLiveResetAction({ entryId: future });
    expect((await board(future))!.live_version).toBeGreaterThan(before);
  });

  it('Discard_RequiresEdit', async () => {
    await started(future, [{ rotation: 1, members: [ann] }]);
    asViewer();
    const res = await (await live()).plannerLiveResetAction({ entryId: future });
    expect([res.ok, (await board(future))?.live_started_at != null]).toEqual([false, true]);
  });

  it('Discard_ThenStart_CopiesTheMatcherAgain', async () => {
    await started(future, [{ rotation: 1, members: [ann] }]);
    await sb.rpc('meeting_live_discard', { p_entry: future, p_actor: editorAdult });
    const again = await sb.rpc('meeting_live_suggest', { p_entry: future, p_actor: editorAdult, p_snapshot: { rotations: [], classes: [{ source_key: 't:0', topic_key: key, rotation: 1, members: [bo] }] } });
    const { data } = await sb.from('meeting_classes').select('rotation, meeting_class_members(person_id)').eq('calendar_entry_id', future).eq('source_key', 't:0').single();
    const c = data as { rotation: number; meeting_class_members: { person_id: number }[] };
    expect([again.error, c.rotation, c.meeting_class_members.map((m) => m.person_id).includes(bo)]).toEqual([null, 1, true]);
  });
});

describe('the stale-tab guard', () => {
  it('StaleTabEdit_AfterDiscard_ReturnsStale', async () => {
    const [c] = await started(future, [{ rotation: 1, members: [ann] }]);
    asEditor();
    const a = await live();
    await a.plannerLiveResetAction({ entryId: future });
    const res = await a.plannerLiveMoveClassAction({ entryId: future, classId: `c:${c}`, version: 1, rotation: 2 });
    expect([res.ok, !res.ok && res.stale, (await board(future))?.live_started_at]).toEqual([false, true, null]);
  });

  it('StaleTabRotationEdit_AfterDiscard_ReturnsStale', async () => {
    await started(future, []);
    asEditor();
    const a = await live();
    await a.plannerLiveResetAction({ entryId: future });
    const res = await a.plannerLiveAddRotationAction({ entryId: future, expectMax: 2, expectStarted: true });
    expect([!res.ok && res.stale, (await board(future))?.live_started_at]).toEqual([true, null]);
  });

  it('PreviewEdit_StillStartsLive', async () => {
    asEditor();
    const res = await (await live()).plannerLiveAddRotationAction({ entryId: future, expectMax: 2, expectStarted: false });
    expect([res.ok, (await board(future))?.live_started_at != null]).toEqual([true, true]);
  });
});

describe('DB-first is safe for the code in production (main = bb45acc7)', () => {
  it('OldProductionCode_StillWorks_AfterMigration', async () => {
    // The old code's Live calls, by their old signatures: start, the day-of seed claim, a visitor with attendance,
    // the touch, and the stamp.
    const [c] = await started(future, [{ rotation: 1, members: [ann] }]);
    const res = await Promise.all([
      sb.rpc('meeting_live_claim_seed', { p_entry: future }),
      sb.rpc('meeting_live_add_visitor', { p_entry: future, p_actor: editorAdult, p_by: 'Editor', p_name: `${TEST_PREFIX} B8 Old`, p_to: c, p_qty: 1 }),
      sb.rpc('meeting_live_touch', { p_entry: future }),
      sb.rpc('meeting_board_stamp', { p_entry: future })
    ]);
    await trackVisitors();
    expect(res.map((r) => r.error)).toEqual([null, null, null, null]);
  });
});

describe('B8 qa: only a published troop meeting (the filter loadAttendancePrompt uses)', () => {
  it('RecordAttendance_OnACampout_IsRefused', async () => {
    await sb.from('event_attendance').insert({ calendar_entry_id: campout, person_id: ann, qty: 1, source: 'manual', recorded_by: 'Earlier' });
    asEditor();
    const res = await (await live()).plannerRecordAttendanceAction({ entryId: campout, add: [], remove: [ann] });
    expect(res.ok).toBe(false);
  });

  it('RecordAttendance_OnACampout_ChangesNothing', async () => {
    await sb.from('event_attendance').insert({ calendar_entry_id: campout, person_id: ann, qty: 1, source: 'manual', recorded_by: 'Earlier' });
    asEditor();
    await (await live()).plannerRecordAttendanceAction({ entryId: campout, add: [], remove: [ann] });
    expect(await recorded(campout)).toEqual([ann]);
  });

  it('RecordAttendance_OnAnUnpublishedMeeting_ChangesNothing', async () => {
    await sb.from('event_attendance').insert({ calendar_entry_id: draftPast, person_id: ann, qty: 1, source: 'manual', recorded_by: 'Earlier' });
    asEditor();
    await (await live()).plannerRecordAttendanceAction({ entryId: draftPast, add: [], remove: [ann] });
    expect(await recorded(draftPast)).toEqual([ann]);
  });

  it('Discard_OnACampout_ChangesNothing', async () => {
    await sb.rpc('meeting_live_set_presence', { p_entry: campout, p_actor: editorAdult, p_person: ann, p_present: true });
    asEditor();
    await (await live()).plannerLiveResetAction({ entryId: campout });
    const { data } = await sb.from('meeting_live_presence').select('person_id').eq('calendar_entry_id', campout);
    expect(data).toEqual([{ person_id: ann }]);
  });

  it('LivePresence_OnACampout_WritesNoDraft', async () => {
    asEditor();
    await (await live()).plannerLiveSetPresentAction({ entryId: campoutToday, personId: ann, present: false });
    const { count } = await sb.from('meeting_live_presence').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', campoutToday);
    expect(count).toBe(0);
  });

  it('LiveVisitor_OnACampout_IsRefused', async () => {
    asEditor();
    const res = await (await live()).plannerLiveAddVisitorAction({ entryId: campoutToday, name: `${TEST_PREFIX} B8 Camp`, to: null });
    await trackVisitors();
    expect(res.ok).toBe(false);
  });
});

describe('B8 qa: recording is idempotent and an untick retires the credit', () => {
  it('RecordAttendance_ReSubmitted_AddsNothingMore', async () => {
    await started(past, [{ rotation: 1, members: [bo] }]);
    asEditor();
    const a = await live();
    await a.plannerRecordAttendanceAction({ entryId: past, add: [bo], remove: [] });
    const again = await a.plannerRecordAttendanceAction({ entryId: past, add: [bo], remove: [] });
    expect(again).toEqual({ ok: true, added: 0, removed: 0, failed: 0 });
  });

  it('RecordAttendance_ReSubmitted_LeavesOneLedgerCredit', async () => {
    await started(past, [{ rotation: 1, members: [bo] }]);
    asEditor();
    const a = await live();
    await a.plannerRecordAttendanceAction({ entryId: past, add: [bo], remove: [] });
    await a.plannerRecordAttendanceAction({ entryId: past, add: [bo], remove: [] });
    const { data } = await sb.from('ledger_entries').select('id').eq('calendar_entry_id', past).eq('scout_id', `vitest-b8-${bo}`).is('deleted_at', null);
    expect(data?.length).toBe(1);
  });

  it('RecordAttendance_AnUntick_RetiresTheLedgerCredit', async () => {
    await started(past, [{ rotation: 1, members: [bo] }]);
    asEditor();
    const a = await live();
    await a.plannerRecordAttendanceAction({ entryId: past, add: [bo], remove: [] });
    await a.plannerRecordAttendanceAction({ entryId: past, add: [], remove: [bo] });
    const { data } = await sb.from('ledger_entries').select('deleted_by').eq('calendar_entry_id', past).eq('scout_id', `vitest-b8-${bo}`);
    expect(data).toEqual([{ deleted_by: 'Editor' }]);
  });
});

describe('B8 qa: an old-code meeting (attendance_seeded_at set)', () => {
  it('Review_OldCodeMeeting_PlacedWithNoDraftRow_StartsUnticked', async () => {
    await started(past, [{ rotation: 1, members: [ann] }]);
    await sb.from('meeting_boards').update({ attendance_seeded_at: new Date().toISOString() }).eq('calendar_entry_id', past);
    const review = await (await lib()).loadAttendanceReview(sb, past, '2020-03-01');
    expect(review.groups.flatMap((g) => g.people).find((p) => p.personId === ann)?.ticked).toBe(false);
  });
});

describe('B8 qa: Discard under concurrency', () => {
  it('StaleEdit_AfterDiscardAndRestart_ReturnsStale', async () => {
    const [c] = await started(future, [{ rotation: 1, members: [ann] }]);
    asEditor();
    const a = await live();
    await a.plannerLiveResetAction({ entryId: future });
    await started(future, [{ rotation: 1, members: [bo] }]);
    const res = await a.plannerLiveMoveClassAction({ entryId: future, classId: `c:${c}`, version: 1, rotation: 2 });
    expect(!res.ok && res.stale).toBe(true);
  });

  it('StaleEdit_RacingDiscard_NeverRestartsLive', async () => {
    const [c] = await started(future, [{ rotation: 1, members: [ann] }]);
    asEditor();
    const a = await live();
    await Promise.all([
      a.plannerLiveResetAction({ entryId: future }),
      a.plannerLiveMoveClassAction({ entryId: future, classId: `c:${c}`, version: 1, rotation: 2 })
    ]);
    expect((await board(future))?.live_started_at).toBeNull();
  });
});

describe('B8 qa: merge_people moves the draft', () => {
  it('Merge_MovesTheLosersDraftRow_ToTheSurvivor', async () => {
    const survivor = await person('MergeKeep');
    const loser = await person('MergeGo');
    await sb.rpc('meeting_live_set_presence', { p_entry: future, p_actor: editorAdult, p_person: loser, p_present: true });
    const m = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (m.error) throw new Error(m.error.message);
    const { data } = await sb.from('meeting_live_presence').select('person_id, present').eq('calendar_entry_id', future);
    expect(data).toEqual([{ person_id: survivor, present: true }]);
  });

  it('Merge_BothHaveADraftRow_KeepsTheSurvivors', async () => {
    const survivor = await person('MergeKeep2');
    const loser = await person('MergeGo2');
    await sb.rpc('meeting_live_set_presence', { p_entry: future, p_actor: editorAdult, p_person: survivor, p_present: false });
    await sb.rpc('meeting_live_set_presence', { p_entry: future, p_actor: editorAdult, p_person: loser, p_present: true });
    const m = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (m.error) throw new Error(m.error.message);
    const { data } = await sb.from('meeting_live_presence').select('person_id, present').eq('calendar_entry_id', future);
    expect(data).toEqual([{ person_id: survivor, present: false }]);
  });

  it('Merge_RepointsEnteredBy', async () => {
    const survivor = await person('MergeKeep3');
    const loser = await person('MergeGo3');
    await sb.rpc('meeting_live_set_presence', { p_entry: future, p_actor: loser, p_person: ann, p_present: true });
    const m = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (m.error) throw new Error(m.error.message);
    const { data } = await sb.from('meeting_live_presence').select('entered_by_person_id').eq('calendar_entry_id', future).eq('person_id', ann);
    expect(data).toEqual([{ entered_by_person_id: survivor }]);
  });
});
