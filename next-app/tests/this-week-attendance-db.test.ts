import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting Planner III (Decision 10) keeps B8's rule: nothing writes attendance on its own. Live's taps are a draft;
 * after the meeting an editor approves a checklist built from the PLAN (scouts who said they're coming or picked
 * something, the plan's teachers, Live's taps, visitors) and only the differences are recorded. Real local database;
 * the admin actor is mocked. Meetings: one in 2079 (future), one in 2020 (over), a campout. Test-owned rows only.
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

const act = () => import('../src/app/(public)/planner/attendance-actions');
const lib = () => import('../src/lib/meeting-live');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
let future = 0;
let past = 0;
let campout = 0;
let editor = 0;
let teacher = 0;
let ann = 0;
let bo = 0;
let cy = 0;
let key = '';

async function entry(date: string, category = 'Troop Meeting'): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category, title: `${category} ${TEST_PREFIX} TWA`, status: 'published' }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} TWA ${label}`, first_name: `${TEST_PREFIX} TWA`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-twa-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} TWA`, last_name: label, display_name: `${TEST_PREFIX} TWA ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
/** A plan on the meeting (one seeded topic, a teacher) and who said they're coming. */
async function planned(entryId: number, coming: number[], opts: { teacher?: number; cant?: number[] } = {}) {
  const { data: topicId } = await sb.rpc('_meeting_topic_id', { p_entry: entryId, p_key: key });
  await sb.from('meeting_topics').update({ seeded_at: new Date().toISOString(), seeded_by_person_id: editor }).eq('id', topicId as number);
  if (opts.teacher) await sb.from('meeting_topic_teachers').insert({ topic_id: topicId, calendar_entry_id: entryId, person_id: opts.teacher, entered_by_person_id: editor });
  const rows = [...coming.map((id) => ({ person_id: id, intent: 'coming' })), ...(opts.cant ?? []).map((id) => ({ person_id: id, intent: 'not_coming' }))];
  if (rows.length) await sb.from('meeting_intents').insert(rows.map((r) => ({ calendar_entry_id: entryId, ...r })));
}
async function clearMeeting(entryId: number) {
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_live_presence').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', entryId);
  await sb.from('event_attendance').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_boards').delete().eq('calendar_entry_id', entryId);
  if (scoutIds.length) await sb.from('ledger_entries').delete().in('scout_id', scoutIds);
}
const recorded = async (entryId: number) =>
  (((await sb.from('event_attendance').select('person_id').eq('calendar_entry_id', entryId)).data ?? []) as { person_id: number }[]).map((r) => r.person_id).sort((a, b) => a - b);
const asEditor = () => (state.actor = { personId: editor, label: 'Editor', subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editor, label: 'Editor', subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });

beforeAll(async () => {
  future = await entry('2079-05-07');
  past = await entry('2020-03-01');
  campout = await entry('2020-03-07', 'Campout / Overnight');
  editor = await person('Editor');
  teacher = await person('Teacher');
  ann = await scout('Ann');
  bo = await scout('Bo');
  cy = await scout('Cy');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').order('sort_order').limit(1);
  key = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`)[0];
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

describe('the checklist comes from the plan', () => {
  it('Review_ListsComingScoutsAndThePlansTeacher', async () => {
    await planned(past, [ann], { teacher });
    const review = await (await lib()).loadAttendanceReview(sb, past, '2020-03-01');
    const ids = review.groups.flatMap((g) => g.people.map((p) => p.personId)).sort((a, b) => a - b);
    expect(ids).toEqual([ann, teacher].sort((a, b) => a - b));
  });

  it('Review_CantMakeIt_StartsUnticked_UnlessTappedHere', async () => {
    await planned(past, [ann], { cant: [bo] });
    await sb.from('meeting_live_presence').insert({ calendar_entry_id: past, person_id: cy, present: true, entered_by_person_id: editor });
    const review = await (await lib()).loadAttendanceReview(sb, past, '2020-03-01');
    const ticked = review.groups.flatMap((g) => g.people.filter((p) => p.ticked).map((p) => p.personId)).sort((a, b) => a - b);
    expect(ticked).toEqual([ann, cy].sort((a, b) => a - b));
  });

  it('Prompt_AppearsAfterAPlannedMeeting', async () => {
    await planned(future, [ann]);
    expect((await (await lib()).loadAttendancePrompt(sb, { date: '2079-05-08', time: '09:00' }))?.entryId).toBe(future);
  });

  it('Prompt_NotBeforeTheMeetingIsOver', async () => {
    await planned(future, [ann]);
    expect((await (await lib()).loadAttendancePrompt(sb, { date: '2079-05-07', time: '15:00' }))?.entryId).not.toBe(future);
  });
});

describe('Record attendance', () => {
  it('RecordsOnlyTheChanges', async () => {
    await planned(past, [ann, bo]);
    await sb.from('event_attendance').insert({ calendar_entry_id: past, person_id: ann, qty: 1, source: 'manual', recorded_by: 'Earlier' });
    asEditor();
    const res = await (await act()).plannerRecordAttendanceAction({ entryId: past, add: [ann, bo], remove: [] });
    expect([res, await recorded(past)]).toEqual([{ ok: true, added: 1, removed: 0, failed: 0 }, [ann, bo].sort((a, b) => a - b)]);
  });

  it('RemovesOnlyADeliberateUntick', async () => {
    await planned(past, [ann, bo]);
    await sb.from('event_attendance').insert([
      { calendar_entry_id: past, person_id: ann, qty: 1, source: 'manual', recorded_by: 'Earlier' },
      { calendar_entry_id: past, person_id: bo, qty: 1, source: 'manual', recorded_by: 'Earlier' }
    ]);
    asEditor();
    await (await act()).plannerRecordAttendanceAction({ entryId: past, add: [], remove: [bo] });
    expect(await recorded(past)).toEqual([ann]);
  });

  it('WritesTheLedgerCredit', async () => {
    await planned(past, [bo]);
    asEditor();
    await (await act()).plannerRecordAttendanceAction({ entryId: past, add: [bo], remove: [] });
    const { data } = await sb.from('ledger_entries').select('kind, deleted_at').eq('calendar_entry_id', past).eq('scout_id', `vitest-twa-${bo}`);
    expect(data).toEqual([{ kind: 'meeting_attendance', deleted_at: null }]);
  });

  it('ReSubmitted_AddsNothingMore', async () => {
    await planned(past, [ann]);
    asEditor();
    await (await act()).plannerRecordAttendanceAction({ entryId: past, add: [ann], remove: [] });
    const again = await (await act()).plannerRecordAttendanceAction({ entryId: past, add: [ann], remove: [] });
    expect(again).toEqual({ ok: true, added: 0, removed: 0, failed: 0 });
  });

  it('RequiresEdit', async () => {
    await planned(past, [ann]);
    asViewer();
    const res = await (await act()).plannerRecordAttendanceAction({ entryId: past, add: [ann], remove: [] });
    expect([res.ok, await recorded(past)]).toEqual([false, []]);
  });

  it('RefusesSomeoneNotOnTheChecklist', async () => {
    await planned(past, [ann]);
    asEditor();
    const res = await (await act()).plannerRecordAttendanceAction({ entryId: past, add: [ann, editor], remove: [] });
    expect([res.ok, await recorded(past)]).toEqual([false, []]);
  });

  it('RefusesAMeetingThatIsntOver', async () => {
    await planned(future, [ann]);
    asEditor();
    const res = await (await act()).plannerRecordAttendanceAction({ entryId: future, add: [ann], remove: [] });
    expect([res.ok, await recorded(future)]).toEqual([false, []]);
  });

  it('RefusesACampout', async () => {
    await planned(campout, [ann]);
    asEditor();
    const res = await (await act()).plannerRecordAttendanceAction({ entryId: campout, add: [ann], remove: [] });
    expect([res.ok, await recorded(campout)]).toEqual([false, []]);
  });
});

describe('No thanks: dismiss the prompt (Patrick, 2026-10-29)', () => {
  it('Prompt_ShowsForThePastMeeting_BeforeADismiss', async () => {
    await planned(past, [ann]);
    expect((await (await lib()).loadAttendancePrompt(sb, { date: '2020-03-02', time: '09:00' }))?.entryId).toBe(past);
  });

  it('Editor_DismissesThePrompt_ItDoesNotAppearAgain', async () => {
    await planned(past, [ann]);
    asEditor();
    const res = await (await act()).plannerDismissAttendanceAction({ entryId: past });
    expect([res.ok, (await (await lib()).loadAttendancePrompt(sb, { date: '2020-03-02', time: '09:00' }))?.entryId]).toEqual([true, undefined]);
  });

  it('Dismissing_RecordsNoAttendance', async () => {
    await planned(past, [ann]);
    asEditor();
    await (await act()).plannerDismissAttendanceAction({ entryId: past });
    expect(await recorded(past)).toEqual([]);
  });

  it('Viewer_CannotDismissThePrompt', async () => {
    await planned(past, [ann]);
    asViewer();
    expect((await (await act()).plannerDismissAttendanceAction({ entryId: past })).ok).toBe(false);
  });

  it('Dismiss_RefusesACampout', async () => {
    asEditor();
    expect((await (await act()).plannerDismissAttendanceAction({ entryId: campout })).ok).toBe(false);
  });
});
