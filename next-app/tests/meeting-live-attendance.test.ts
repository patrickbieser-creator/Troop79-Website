import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { centralToday } from '../src/lib/dates';
import { addMeetingPick, loadMeetingById } from '../src/lib/meeting-board';

/**
 * Meeting Live P4c: attendance and visitors (Plans/Meeting-Planner-II.md Decision 9; the tech-lead's P4 spec section 4).
 * Meeting Live takes attendance into event_attendance, the one presence truth that Roll Call reads, through the same
 * cascade as Roll Call (recordAttendance / removeAttendance), so a scout's meeting credit lands in the ledger and is
 * retired first on removal. Writes only on the meeting day (Central), editors only (the SPL included). The first Live
 * load of the day seeds placed scouts and class teachers once. "+ Add as visitor" makes a guest person hosted by a
 * system household that no household list shows. Real local database; the admin actor is mocked. The "today" meeting
 * is a test-owned entry dated today; others are dated 2098. Cleanup by test-owned ids only.
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const live = () => import('../src/app/(public)/planner/live-actions');
const lib = () => import('../src/lib/meeting-live');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
const visitors: number[] = [];
let householdExisted = true;
let today = 0; // a meeting dated today (Central)
let later = 0; // 2098-04-04
let editorAdult = 0;
let teacher = 0;
let spl = 0;
let ann = 0;
let bo = 0;
let key = '';

async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MLA ${label}`, first_name: `${TEST_PREFIX} MLA`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mla-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} MLA`, last_name: label, display_name: `${TEST_PREFIX} MLA ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
async function started(entryId: number, classes: { topic_key: string; rotation: number | null; teacher_person_id?: number | null; members: number[] }[]): Promise<number[]> {
  for (const c of classes) await sb.rpc('_meeting_topic_id', { p_entry: entryId, p_key: c.topic_key });
  const { error } = await sb.rpc('meeting_live_start', {
    p_entry: entryId,
    p_actor: editorAdult,
    p_snapshot: { rotations: [], classes: classes.map((c, i) => ({ source_key: `t:${i}`, title: null, teacher_person_id: null, position: i, ...c })) }
  });
  if (error) throw new Error(error.message);
  const { data } = await sb.from('meeting_classes').select('id, source_key').eq('calendar_entry_id', entryId);
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
  await sb.from('event_attendance').delete().eq('calendar_entry_id', entryId);
  if (scoutIds.length) await sb.from('ledger_entries').delete().in('scout_id', scoutIds);
}
const present = async (entryId: number) =>
  (((await sb.from('event_attendance').select('person_id').eq('calendar_entry_id', entryId)).data ?? []) as { person_id: number }[]).map((r) => r.person_id).sort((a, b) => a - b);
const visitorHousehold = async () => (await sb.from('households').select('id, label').eq('system_key', 'meeting-visitors').maybeSingle()).data as { id: number; label: string } | null;

beforeAll(async () => {
  householdExisted = (await visitorHousehold()) != null;
  today = await entry(centralToday());
  later = await entry('2098-04-04');
  editorAdult = await person('Editor');
  teacher = await person('Teacher');
  spl = await scout('Spl', 'star');
  ann = await scout('Ann', 'scout');
  bo = await scout('Bo', 'scout');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(1);
  key = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`)[0];
});

afterEach(async () => {
  for (const e of entries) await clearMeeting(e);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  if (visitors.length) await sb.from('people').delete().in('id', visitors);
  if (!householdExisted) await sb.from('households').delete().eq('system_key', 'meeting-visitors');
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asEditor = () => (state.actor = { personId: editorAdult, label: 'Editor', subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asSpl = () => (state.actor = { personId: spl, label: 'Spl', subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editorAdult, label: 'Editor', subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });
const trackVisitors = async () => {
  const hh = await visitorHousehold();
  if (!hh) return;
  const { data } = await sb.from('people').select('id').eq('guest_host_household_id', hh.id).like('display_name', `${TEST_PREFIX}%`);
  for (const r of (data ?? []) as { id: number }[]) if (!visitors.includes(r.id)) visitors.push(r.id);
};

describe('who and when', () => {
  it('Viewer_IsRefused_AndNothingIsWritten', async () => {
    await started(today, [{ topic_key: key, rotation: 1, members: [ann] }]);
    asViewer();
    const a = await live();
    const res = await Promise.all([
      a.plannerLiveSetPresentAction({ entryId: today, personId: ann, present: true }),
      a.plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} Viewer Visitor`, to: null })
    ]);
    await trackVisitors();
    expect([res.every((r) => !r.ok), await present(today)]).toEqual([true, []]);
  });

  it('DayGate_RefusesAttendance_OnAnyOtherDay', async () => {
    await started(later, [{ topic_key: key, rotation: 1, members: [ann] }]);
    asEditor();
    const res = await (await live()).plannerLiveSetPresentAction({ entryId: later, personId: ann, present: true });
    expect([res, await present(later)]).toEqual([{ ok: false, error: 'Attendance is taken on the day of the meeting.' }, []]);
  });

  it('ScoutEditor_CanTakeAttendance', async () => {
    await started(today, []);
    asSpl();
    expect((await (await live()).plannerLiveSetPresentAction({ entryId: today, personId: bo, present: true })).ok).toBe(true);
  });
});

describe('attendance through Roll Call’s cascade', () => {
  it('MeetingLive_Attendance_WritesEventAttendance (with ledger credit)', async () => {
    await started(today, [{ topic_key: key, rotation: 1, members: [ann] }]);
    asEditor();
    const res = await (await live()).plannerLiveSetPresentAction({ entryId: today, personId: ann, present: true });
    const { data: ledger } = await sb.from('ledger_entries').select('kind, deleted_at').eq('calendar_entry_id', today).eq('scout_id', `vitest-mla-${ann}`);
    expect([res.ok, await present(today), ledger]).toEqual([true, [ann], [{ kind: 'meeting_attendance', deleted_at: null }]]);
  });

  it('MarkingNotPresent_RetiresTheCreditAndDropsTheRow', async () => {
    await started(today, [{ topic_key: key, rotation: 1, members: [ann] }]);
    asEditor();
    const a = await live();
    await a.plannerLiveSetPresentAction({ entryId: today, personId: ann, present: true });
    const res = await a.plannerLiveSetPresentAction({ entryId: today, personId: ann, present: false });
    const { data: ledger } = await sb.from('ledger_entries').select('deleted_at').eq('calendar_entry_id', today).eq('scout_id', `vitest-mla-${ann}`).single();
    expect([res.ok, await present(today), (ledger as { deleted_at: string | null }).deleted_at != null]).toEqual([true, [], true]);
  });

  it('AttendanceChange_BumpsLiveVersion', async () => {
    await started(today, []);
    const v = async () => ((await sb.from('meeting_boards').select('live_version').eq('calendar_entry_id', today).single()).data as { live_version: number }).live_version;
    const before = await v();
    asEditor();
    await (await live()).plannerLiveSetPresentAction({ entryId: today, personId: bo, present: true });
    expect(await v()).toBeGreaterThan(before);
  });
});

describe('seeding the day', () => {
  it('Seeding_MarksPlacedScoutsAndTeachers_Once', async () => {
    await started(today, [{ topic_key: key, rotation: 1, teacher_person_id: teacher, members: [ann] }]);
    const m = (await loadMeetingById(sb, today))!;
    const { seedLiveAttendance } = await lib();
    const first = (await seedLiveAttendance(sb, m, 'Editor')).seeded;
    const afterFirst = await present(today);
    asEditor();
    await (await live()).plannerLiveSetPresentAction({ entryId: today, personId: ann, present: false });
    const second = (await seedLiveAttendance(sb, m, 'Editor')).seeded;
    expect([first, afterFirst, second, await present(today)]).toEqual([true, [teacher, ann].sort((a, b) => a - b), false, [teacher]]);
  });

  it('Seeding_WaitsForTheMeetingDay_AndForLiveToStart', async () => {
    const { seedLiveAttendance } = await lib();
    const notStarted = (await seedLiveAttendance(sb, (await loadMeetingById(sb, today))!, 'Editor')).seeded;
    await started(later, [{ topic_key: key, rotation: 1, members: [ann] }]);
    const notToday = (await seedLiveAttendance(sb, (await loadMeetingById(sb, later))!, 'Editor')).seeded;
    expect([notStarted, notToday, await present(today), await present(later)]).toEqual([false, false, [], []]);
  });
});

describe('visitors', () => {
  it('MeetingLive_AddVisitor_CreatesGuestPerson', async () => {
    const [c] = await started(today, [{ topic_key: key, rotation: 1, members: [] }]);
    asEditor();
    const res = await (await live()).plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} Vic Visitor`, to: `c:${c}` });
    await trackVisitors();
    const hh = await visitorHousehold();
    const { data: p } = await sb.from('people').select('id, display_name, guest_host_household_id').eq('guest_host_household_id', hh!.id).eq('display_name', `${TEST_PREFIX} Vic Visitor`).single();
    const vic = (p as { id: number }).id;
    const { data: m } = await sb.from('meeting_class_members').select('person_id').eq('class_id', c);
    expect([res.ok, hh?.label, (await present(today)).includes(vic), (m ?? []).map((x) => (x as { person_id: number }).person_id)]).toEqual([true, 'Meeting visitors', true, [vic]]);
  });

  it('TwoVisitors_ShareOneSystemHousehold', async () => {
    await started(today, []);
    asEditor();
    const a = await live();
    await a.plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} One`, to: null });
    await a.plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} Two`, to: null });
    await trackVisitors();
    const { count } = await sb.from('households').select('id', { count: 'exact', head: true }).eq('system_key', 'meeting-visitors');
    expect(count).toBe(1);
  });

  it('AVisitorWithNoClass_ShowsInThePool_MarkedAsAVisitor', async () => {
    await started(today, []);
    asEditor();
    await (await live()).plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} Pool Visitor`, to: null });
    await trackVisitors();
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, today))!);
    const vid = visitors[visitors.length - 1];
    const row = v.pool.find((x) => x.personId === vid);
    expect([row?.visitor, row?.present]).toEqual([true, true]);
  });

  it('VisitorHousehold_IsHiddenFromHouseholdLists', async () => {
    await started(today, []);
    asEditor();
    await (await live()).plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} Hidden`, to: null });
    await trackVisitors();
    const hh = (await visitorHousehold())!;
    const { loadRosterPrintData } = await import('../src/lib/roster-print-data');
    const { loadHouseholds } = await import('../src/lib/households');
    const [print, households] = await Promise.all([loadRosterPrintData(), loadHouseholds()]);
    const keyOf = `h:${hh.id}`;
    expect([
      (print as unknown as { households: { id: number }[] }).households.some((h) => h.id === hh.id),
      households.some((h) => (h as unknown as { key: string }).key === keyOf || h.label === 'Meeting visitors')
    ]).toEqual([false, false]);
  });

  it('EveryHouseholdListRead_LeavesOutSystemHouseholds', () => {
    // The admin screens that list households (the lookups table, a person's household picker) read the table straight.
    for (const f of ['src/app/admin/(workspace)/advancement/lookups/page.tsx', 'src/app/admin/(workspace)/advancement/roster/[personId]/load-person-record.ts', 'src/lib/households.ts', 'src/lib/roster-print-data.ts']) {
      expect([f, readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').includes(".is('system_key', null)")]).toEqual([f, true]);
    }
  });
});

describe('qa-lead follow-ups (P4c)', () => {
  it('Seeding_CountsAndLogsWhoCouldntBeMarked', async () => {
    // A person with two scout records makes the credit lookup fail: the seed keeps going and says how many failed.
    const twin = await scout('Twin', 'scout');
    const extra = `vitest-mla-${twin}-b`;
    const { error } = await sb.from('scouts').insert({ id: extra, first_name: `${TEST_PREFIX} MLA`, last_name: 'Twin', display_name: `${TEST_PREFIX} MLA Twin`, person_id: twin, active: true });
    if (error) throw new Error(error.message);
    scoutIds.push(extra);
    await started(today, [{ topic_key: key, rotation: 1, teacher_person_id: teacher, members: [ann, twin] }]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await (await lib()).seedLiveAttendance(sb, (await loadMeetingById(sb, today))!, 'Editor');
    const logged = spy.mock.calls.length > 0;
    spy.mockRestore();
    expect([res, logged]).toEqual([{ seeded: true, failed: 1 }, true]);
  });

  it('SetPresent_RefusesSomeoneNotOnThisMeetingsBoard', async () => {
    const { data: gone, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MLA Gone`, first_name: `${TEST_PREFIX} MLA`, last_name: 'Gone', active: false }).select('id').single();
    if (error) throw new Error(error.message);
    people.push((gone as { id: number }).id);
    await started(today, []);
    asEditor();
    const res = await (await live()).plannerLiveSetPresentAction({ entryId: today, personId: (gone as { id: number }).id, present: true });
    expect([res, await present(today)]).toEqual([{ ok: false, error: 'That person isn’t on this meeting’s board.' }, []]);
  });

  it('SetPresent_RefusesAVisitorFromAnotherMeeting', async () => {
    await started(later, []);
    await sb.from('event_attendance').delete().eq('calendar_entry_id', later);
    const { data: hh } = await sb.from('households').upsert({ label: 'Meeting visitors', system_key: 'meeting-visitors' }, { onConflict: 'system_key', ignoreDuplicates: true }).select('id');
    const hhId = ((hh ?? []) as { id: number }[])[0]?.id ?? (await visitorHousehold())!.id;
    const { data: v, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MLA Elsewhere`, first_name: `${TEST_PREFIX} MLA`, last_name: 'Elsewhere', guest_host_household_id: hhId }).select('id').single();
    if (error) throw new Error(error.message);
    visitors.push((v as { id: number }).id);
    await sb.from('event_attendance').insert({ calendar_entry_id: later, person_id: (v as { id: number }).id, source: 'manual' });
    await started(today, []);
    asEditor();
    const res = await (await live()).plannerLiveSetPresentAction({ entryId: today, personId: (v as { id: number }).id, present: true });
    expect(res).toEqual({ ok: false, error: 'That person isn’t on this meeting’s board.' });
  });

  it('SetPresent_AllowsAThisMeetingVisitor_AndAnAdult', async () => {
    // A visitor in a class stays on the screen when marked not here, so they can be marked here again.
    const [c] = await started(today, [{ topic_key: key, rotation: 1, members: [] }]);
    asEditor();
    const a = await live();
    await a.plannerLiveAddVisitorAction({ entryId: today, name: `${TEST_PREFIX} Here Visitor`, to: `c:${c}` });
    await trackVisitors();
    const vid = visitors[visitors.length - 1];
    const off = await a.plannerLiveSetPresentAction({ entryId: today, personId: vid, present: false });
    const on = await a.plannerLiveSetPresentAction({ entryId: today, personId: vid, present: true });
    const adult = await a.plannerLiveSetPresentAction({ entryId: today, personId: teacher, present: true });
    expect([off.ok, on.ok, adult.ok]).toEqual([true, true, true]);
  });
});

describe('the pool and the people', () => {
  it('Pool_IncludesAttendedScouts_WhoAreInNoClass', async () => {
    await started(today, []);
    asEditor();
    await (await live()).plannerLiveSetPresentAction({ entryId: today, personId: bo, present: true });
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, today))!);
    expect(v.pool.find((x) => x.personId === bo)).toEqual({ personId: bo, name: expect.any(String), present: true, visitor: false });
  });

  it('Pool_StillIncludesComingScouts_NotYetHere', async () => {
    const res = await addMeetingPick(sb, { entryId: today, personId: ann, actorPersonId: editorAdult, leader: true, carry: null }, key, { later: false, markComing: true });
    if (!res.ok) throw new Error(res.error);
    await started(today, []);
    const v = await (await lib()).loadLiveView(sb, (await loadMeetingById(sb, today))!);
    expect(v.pool.find((x) => x.personId === ann)?.present).toBe(false);
  });

  it('MergePeople_MovesEventAttendance', async () => {
    const survivor = await person('Survivor');
    const loser = await person('Loser');
    const both = await person('Both');
    const loser2 = await person('Loser2');
    await sb.from('event_attendance').insert([
      { calendar_entry_id: later, person_id: loser, source: 'manual' },
      { calendar_entry_id: today, person_id: both, source: 'manual' },
      { calendar_entry_id: today, person_id: loser2, source: 'manual' }
    ]);
    const m1 = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    const m2 = await sb.rpc('merge_people', { p_survivor: both, p_loser: loser2, p_decided_by: 'vitest' });
    expect([m1.error, m2.error, await present(later), await present(today)]).toEqual([null, null, [survivor], [both]]);
  });
});
