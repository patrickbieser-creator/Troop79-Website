import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { revalidatePath } from 'next/cache';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting Planner P2a writes (Plans/Meeting-Planner-II.md): an editor enters answers and picks for someone, assigns a
 * teacher, adds an offer. Viewers and people without a planner right are refused; the SPL (a scout holding edit) may
 * write; every write records the editor as entered_by. Real local database; the admin actor is mocked. Fixture
 * meetings are dated 2094 so they never collide with the real calendar or another file's fixtures.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> },
  /** P5b: what loadPlannerPage returns instead of the real page ('real' = pass through). */
  page: 'real' as 'real' | null | { board: { haventAnswered: { scouts: { personId: number; name: string }[]; adults: { personId: number; name: string }[] } } }
}));
vi.mock('@/lib/meeting-planner-load', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/meeting-planner-load')>();
  return { ...real, loadPlannerPage: (...a: Parameters<typeof real.loadPlannerPage>) => (state.page === 'real' ? real.loadPlannerPage(...a) : Promise.resolve(state.page)) };
});
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const actions = () => import('../src/app/(public)/planner/actions');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
let meeting = 0; // 2094-03-01
let past = 0; // 2020-03-01
let campout = 0; // 2094-03-07, not a meeting
let draft = 0; // 2094-03-08, a meeting not yet published
let mbNight = 0; // 2094-03-15, a meeting with a board row (v1's merit badge nights had one)
let earlier = 0; // 2094-02-22, the board before `meeting` (carried picks)
let gone = 0; // an inactive person
let editorAdult = 0;
let spl = 0;
let teacher = 0;
let young = 0; // working on Tenderfoot
let other = 0; // a second scout working on Tenderfoot
let keys: string[] = [];

async function entry(date: string, o: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}`, ...o }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string, o: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} PLA ${label}`, first_name: `${TEST_PREFIX} PLA`, last_name: label, ...o }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-pla-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} PLA`, last_name: label, display_name: `${TEST_PREFIX} PLA ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}

beforeAll(async () => {
  meeting = await entry('2094-03-01');
  past = await entry('2020-03-01');
  campout = await entry('2094-03-07', { category: 'Campout / Overnight', title: `Campout ${TEST_PREFIX}` });
  draft = await entry('2094-03-08', { status: 'draft' });
  mbNight = await entry('2094-03-15');
  earlier = await entry('2094-02-22');
  const { error } = await sb.from('meeting_boards').insert({ calendar_entry_id: mbNight });
  if (error) throw new Error(error.message);
  gone = await person('Gone', { active: false });
  editorAdult = await person('Editor');
  teacher = await person('Teacher');
  spl = await scout('Spl', 'star');
  young = await scout('Young', 'scout');
  other = await scout('Other', 'scout');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(3);
  keys = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
});

afterEach(async () => {
  for (const e of entries) {
    await sb.from('meeting_invites').delete().eq('calendar_entry_id', e);
    // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
    await sb.from('meeting_classes').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
  }
  state.actor = null;
  state.page = 'real';
});

afterAll(async () => {
  await sb.from('teaching_skills').delete().in('person_id', people);
  await sb.from('meeting_boards').delete().in('calendar_entry_id', entries);
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asEditor = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asSpl = () => (state.actor = { personId: spl, subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });
const intentOf = async (pid: number) =>
  (await sb.from('meeting_intents').select('intent, entered_by_person_id').eq('calendar_entry_id', meeting).eq('person_id', pid).maybeSingle()).data as { intent: string; entered_by_person_id: number } | null;
const teachingOf = async (pid: number) =>
  ((await sb.from('meeting_topic_teachers').select('entered_by_person_id, meeting_topics!inner(topic_key, title)').eq('calendar_entry_id', meeting).eq('person_id', pid)).data ?? []) as unknown as {
    entered_by_person_id: number;
    meeting_topics: { topic_key: string; title: string | null };
  }[];

describe('who may write', () => {
  it('Viewer_IsRefused_WhenSettingAnAnswer', async () => {
    asViewer();
    const res = await (await actions()).plannerSetAnswerAction({ entryId: meeting, personId: young, intent: 'coming' });
    expect([res.ok, await intentOf(young)]).toEqual([false, null]);
  });

  it('SignedOut_IsRefused', async () => {
    expect((await (await actions()).plannerOpenPersonAction({ entryId: meeting, personId: young })).ok).toBe(false);
  });

  it('Editor_IsRefused_OnAPastMeeting', async () => {
    asEditor();
    expect(await (await actions()).plannerSetAnswerAction({ entryId: past, personId: young, intent: 'coming' })).toEqual({ ok: false, error: 'That meeting has passed. Reload the page for the next one.' });
  });
});

describe('which meetings and people', () => {
  it('Editor_IsRefused_OnACalendarEntryThatIsntAMeeting', async () => {
    asEditor();
    expect(await (await actions()).plannerSetAnswerAction({ entryId: campout, personId: young, intent: 'coming' })).toEqual({ ok: false, error: 'That meeting isn’t taking sign-ups.' });
  });

  it('Editor_IsRefused_OnADraftMeeting', async () => {
    asEditor();
    expect(await (await actions()).plannerSetAnswerAction({ entryId: draft, personId: young, intent: 'coming' })).toEqual({ ok: false, error: 'That meeting isn’t taking sign-ups.' });
  });

  it('Editor_CantAnswerForSomeoneNotOnTheBoard_AndNothingIsSaved', async () => {
    asEditor();
    const res = await (await actions()).plannerSetAnswerAction({ entryId: meeting, personId: gone, intent: 'coming' });
    expect([res, await intentOf(gone)]).toEqual([{ ok: false, error: 'That person isn’t on the board.' }, null]);
  });

  it('Editor_SetsAnAdultsAnswer', async () => {
    asEditor();
    await (await actions()).plannerSetAnswerAction({ entryId: meeting, personId: teacher, intent: 'undecided' });
    expect((await intentOf(teacher))?.intent).toBe('undecided');
  });

  it('MalformedInput_IsRefused', async () => {
    asEditor();
    expect(await (await actions()).plannerSetAnswerAction({ entryId: meeting, personId: young, intent: 'maybe' as never })).toEqual({ ok: false, error: 'Malformed request' });
  });

  it('Viewer_CantListOfferChoices', async () => {
    asViewer();
    expect((await (await actions()).plannerOfferChoicesAction()).ok).toBe(false);
  });
});

describe('answers and picks', () => {
  it('Editor_SetsAScoutsAnswer_RecordedAsEnteredByThem', async () => {
    asEditor();
    await (await actions()).plannerSetAnswerAction({ entryId: meeting, personId: young, intent: 'undecided' });
    expect(await intentOf(young)).toEqual({ intent: 'undecided', entered_by_person_id: editorAdult });
  });

  it('Spl_CanSetAScoutsAnswer', async () => {
    asSpl();
    await (await actions()).plannerSetAnswerAction({ entryId: meeting, personId: young, intent: 'coming' });
    expect(await intentOf(young)).toEqual({ intent: 'coming', entered_by_person_id: spl });
  });

  it('Editor_TicksAPick_AndTheDrawerShowsIt', async () => {
    asEditor();
    await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: true });
    const res = await (await actions()).plannerOpenPersonAction({ entryId: meeting, personId: young });
    expect(res.ok && res.drawer.options.find((o) => o.key === keys[0])?.on).toBe(true);
  });

  it('Editor_UnticksAPick', async () => {
    asEditor();
    const act = await actions();
    await act.plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: true });
    const res = await act.plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: false });
    expect(res.ok && res.tick.count).toBe(0);
  });

  it('TogglePick_ReturnsOnlyWhatChanged', async () => {
    asEditor();
    const res = await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: true });
    expect(res.ok && res.tick).toEqual({ key: keys[0], on: true, count: 1, intent: null, shown: 'coming' });
  });

  it('ToggleTeach_ReturnsOnlyWhatChanged', async () => {
    asEditor();
    const res = await (await actions()).plannerToggleTeachAction({ entryId: meeting, personId: teacher, key: keys[0], on: true });
    expect(res.ok && res.tick).toEqual({ key: keys[0], on: true, count: 1, intent: null, shown: 'coming' });
  });

  it('SetAnswer_ReturnsOnlyWhatChanged', async () => {
    asEditor();
    const res = await (await actions()).plannerSetAnswerAction({ entryId: meeting, personId: young, intent: 'undecided' });
    expect(res.ok && res.tick).toEqual({ key: null, on: null, count: null, intent: 'undecided', shown: 'undecided' });
  });

  it('Editor_CantPickSomethingOffTheirList', async () => {
    asEditor();
    expect(await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: 'no-such-1a', on: true })).toEqual({ ok: false, error: 'That isn’t on their pick list.' });
  });

  it('OpenPerson_ReturnsAScoutsDrawer', async () => {
    asEditor();
    const res = await (await actions()).plannerOpenPersonAction({ entryId: meeting, personId: young });
    expect(res.ok && [res.drawer.kind, res.drawer.sub, res.drawer.options.some((o) => o.key === keys[0])]).toEqual(['scout', 'Working on Tenderfoot', true]);
  });
});

describe('a drawer tick does not reload the board (the board refreshes once when the drawer closes)', () => {
  it('TogglePick_DoesNotRevalidateThePlanner', async () => {
    asEditor();
    vi.mocked(revalidatePath).mockClear();
    await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: true });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it('ToggleTeach_DoesNotRevalidateThePlanner', async () => {
    asEditor();
    vi.mocked(revalidatePath).mockClear();
    await (await actions()).plannerToggleTeachAction({ entryId: meeting, personId: teacher, key: keys[0], on: true });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it('SetAnswer_FromTheDrawer_DoesNotRevalidateThePlanner', async () => {
    asEditor();
    vi.mocked(revalidatePath).mockClear();
    await (await actions()).plannerSetAnswerAction({ entryId: meeting, personId: young, intent: 'coming' });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });
});

describe('an assignment goes with the picks it was made for', () => {
  const pickFor = (act: Awaited<ReturnType<typeof actions>>, pid: number, on: boolean) => act.plannerTogglePickAction({ entryId: meeting, personId: pid, key: keys[0], on });

  it('Assign_IsTakenOff_WhenTheOnlyPickIsRemoved', async () => {
    asEditor();
    const act = await actions();
    await pickFor(act, young, true);
    await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    await pickFor(act, young, false);
    expect(await teachingOf(teacher)).toEqual([]);
  });

  it('Assign_Stays_WhileAnotherScoutStillPicksIt', async () => {
    asEditor();
    const act = await actions();
    await pickFor(act, young, true);
    await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    await pickFor(act, other, true);
    await pickFor(act, young, false);
    expect((await teachingOf(teacher)).map((t) => t.meeting_topics.topic_key)).toEqual([keys[0]]);
  });

  it('AddOffer_Stays_WhenAScoutPicksItAndTakesItBack', async () => {
    asEditor();
    const act = await actions();
    await act.plannerAddOfferAction({ entryId: meeting, personId: teacher, what: { key: keys[0] } });
    await pickFor(act, young, true);
    await pickFor(act, young, false);
    expect((await teachingOf(teacher)).map((t) => t.meeting_topics.topic_key)).toEqual([keys[0]]);
  });

  it('Assign_Stays_WhileAScoutsCarriedPickStillHoldsIt', async () => {
    asEditor();
    const act = await actions();
    // `other` picked it on an earlier board and hasn't touched this one: the pick carries here.
    await act.plannerTogglePickAction({ entryId: earlier, personId: other, key: keys[0], on: true });
    await pickFor(act, young, true);
    await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    await pickFor(act, young, false);
    expect((await teachingOf(teacher)).map((t) => t.meeting_topics.topic_key)).toEqual([keys[0]]);
  });

  it('Assign_IsTakenOff_WhenAnEarlierBoardNoLongerPicksIt', async () => {
    asEditor();
    const act = await actions();
    await act.plannerTogglePickAction({ entryId: earlier, personId: other, key: keys[0], on: true });
    await act.plannerTogglePickAction({ entryId: earlier, personId: other, key: keys[0], on: false });
    await pickFor(act, young, true);
    await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    await pickFor(act, young, false);
    expect(await teachingOf(teacher)).toEqual([]);
  });

  it('RemovePickRpc_ReleasesAForPicksAssign_ByItself', async () => {
    asEditor();
    const act = await actions();
    await pickFor(act, young, true);
    await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    await sb.rpc('meeting_remove_pick', { p_entry: meeting, p_person: young, p_actor: editorAdult, p_leader: true, p_topic_key: keys[0], p_carry: [] });
    expect(await teachingOf(teacher)).toEqual([]);
  });

  it('RemovePickRpc_LeavesASelfSignUp', async () => {
    asEditor();
    const act = await actions();
    await act.plannerToggleTeachAction({ entryId: meeting, personId: teacher, key: keys[0], on: true });
    await pickFor(act, young, true);
    await sb.rpc('meeting_remove_pick', { p_entry: meeting, p_person: young, p_actor: editorAdult, p_leader: true, p_topic_key: keys[0], p_carry: [] });
    expect((await teachingOf(teacher)).length).toBe(1);
  });

  it('RemovePickRpc_ReturnsTheScoutsWhoseCarriedPickMayHoldIt', async () => {
    asEditor();
    const act = await actions();
    await act.plannerTogglePickAction({ entryId: earlier, personId: other, key: keys[0], on: true });
    await pickFor(act, young, true);
    await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    const { data } = await sb.rpc('meeting_remove_pick', { p_entry: meeting, p_person: young, p_actor: editorAdult, p_leader: true, p_topic_key: keys[0], p_carry: [] });
    expect(data).toEqual([other]);
  });

  it('Assign_OfSomeoneAlreadyTeachingIt_LeavesTheirSignUp_WhenThePickGoes', async () => {
    asEditor();
    const act = await actions();
    await act.plannerToggleTeachAction({ entryId: meeting, personId: teacher, key: keys[0], on: true });
    await pickFor(act, young, true);
    await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    await pickFor(act, young, false);
    expect((await teachingOf(teacher)).map((t) => t.meeting_topics.topic_key)).toEqual([keys[0]]);
  });
});

describe('teaching', () => {
  it('Assign_SignsThemUpToTeach_AndMarksThemComing', async () => {
    asEditor();
    const res = await (await actions()).plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    expect([res.ok, (await teachingOf(teacher)).map((t) => t.meeting_topics.topic_key), (await intentOf(teacher))?.intent]).toEqual([true, [keys[0]], 'coming']);
  });

  it('Assign_RecordsTheEditorAsEnteredBy', async () => {
    asEditor();
    await (await actions()).plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    expect((await teachingOf(teacher))[0]?.entered_by_person_id).toBe(editorAdult);
  });

  it('Assign_AThirdTopic_IsAllowed', async () => {
    asEditor();
    const act = await actions();
    for (const k of keys) await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: k });
    expect((await teachingOf(teacher)).length).toBe(3);
  });

  it('AddOffer_WithATypedTitle_PutsItOnTheBoard', async () => {
    asEditor();
    await (await actions()).plannerAddOfferAction({ entryId: meeting, personId: teacher, what: { title: '  Knife   safety ' } });
    expect((await teachingOf(teacher)).map((t) => [t.meeting_topics.topic_key, t.meeting_topics.title])).toEqual([['ff:knife safety', 'Knife safety']]);
  });

  it('AddOffer_WithAnEmptyTitle_SaysWhy', async () => {
    asEditor();
    expect(await (await actions()).plannerAddOfferAction({ entryId: meeting, personId: teacher, what: { title: '   ' } })).toEqual({ ok: false, error: 'Type what will be taught.' });
  });

  it('AddOffer_WithATitleTooLong_SaysWhy', async () => {
    asEditor();
    expect(await (await actions()).plannerAddOfferAction({ entryId: meeting, personId: teacher, what: { title: 'x'.repeat(81) } })).toEqual({ ok: false, error: 'Keep it to 80 characters.' });
  });

  it('Viewer_IsRefused_WhenAssigning', async () => {
    asViewer();
    await (await actions()).plannerAssignAction({ entryId: meeting, personId: teacher, key: keys[0] });
    expect((await teachingOf(teacher)).length).toBe(0);
  });

  it('OfferChoices_ListRankRequirementsAndBadges', async () => {
    asEditor();
    const res = await (await actions()).plannerOfferChoicesAction();
    expect(res.ok && [res.choices.some((c) => c.key === keys[0]), res.choices.some((c) => c.key.startsWith('mb:'))]).toEqual([true, true]);
  });
});

describe('email (P2b, adults only)', () => {
  it('Spl_IsRefused_WhenSendingARequest', async () => {
    asSpl();
    expect(await (await actions()).plannerSendRequestAction({ entryId: meeting, topicKey: keys[0], personId: teacher })).toEqual({
      ok: false,
      error: 'Emails are sent by adults. Ask an adult leader to send this one.'
    });
  });

  it('ScoutEditor_IsRefused_WhenSendingReminders', async () => {
    asSpl();
    expect(await (await actions()).plannerSendRemindersAction({ entryId: meeting, personIds: [young] })).toEqual({
      ok: false,
      error: 'Emails are sent by adults. Ask an adult leader to send this one.'
    });
  });

  it('Remind_GoesThroughTheReminderSender_OnlyForSomeoneWhoHasntAnswered', async () => {
    asEditor();
    const act = await actions();
    await act.plannerSetAnswerAction({ entryId: meeting, personId: other, intent: 'coming' });
    const res = await act.plannerSendRemindersAction({ entryId: meeting, personIds: [young, other] });
    // The fixture scout's household has no parent with an email; the one who answered isn't sent to the sender at all.
    expect(res.ok && res.skipped).toEqual([{ name: `${TEST_PREFIX} PLA Young`, reason: 'no parent with an email in their household' }]);
  });

  it('Remind_DropsPeopleNotOnHaventAnswered', async () => {
    asEditor();
    const res = await (await actions()).plannerSendRemindersAction({ entryId: meeting, personIds: [young, gone] });
    expect(res.ok && res.skipped.map((s) => s.name)).toEqual([`${TEST_PREFIX} PLA Young`]);
  });

  it('Remind_AppliesTheCap_AfterDroppingPeopleNotWaiting', async () => {
    asEditor();
    const bogus = Array.from({ length: 101 }, (_, i) => 2_000_000_000 + i);
    expect((await (await actions()).plannerSendRemindersAction({ entryId: meeting, personIds: [young, ...bogus] })).ok).toBe(true);
  });

  it('Remind_SaysWhoIsLeftOver_WhenMoreThanTheCapAreWaiting', async () => {
    asEditor();
    const waiting = Array.from({ length: 101 }, (_, i) => ({ personId: 2_000_000_000 + i, name: `Nobody ${i}` }));
    state.page = { board: { haventAnswered: { scouts: waiting, adults: [] } } };
    const res = await (await actions()).plannerSendRemindersAction({ entryId: meeting, personIds: waiting.map((w) => w.personId) });
    expect(res.ok && res.skipped.filter((s) => s.reason.startsWith('over the 100-person limit'))).toEqual([{ name: 'Nobody 100', reason: 'over the 100-person limit for one send; reload and send again' }]);
  });

  it('Remind_SaysTheMeetingIsntAvailable_WhenThePlannerPageIsGone', async () => {
    asEditor();
    state.page = null;
    expect(await (await actions()).plannerSendRemindersAction({ entryId: meeting, personIds: [young] })).toEqual({ ok: false, error: 'That meeting isn’t available. Reload the page.' });
  });

  it('Editor_SendRequest_GoesThroughTheInviteSender', async () => {
    asEditor();
    const act = await actions();
    await act.plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: true });
    // Qualified means the requirement's skill is in what they've said they can teach (v1's assessTeacher).
    const { data: req } = await sb.from('rank_requirements').select('skill_id').eq('rank_id', 'tenderfoot').eq('code', keys[0].slice('tenderfoot-'.length)).is('parent_id', null).single();
    await sb.from('teaching_skills').insert({ person_id: teacher, skill_id: (req as { skill_id: string }).skill_id });
    const res = await act.plannerSendRequestAction({ entryId: meeting, topicKey: keys[0], personId: teacher });
    // The suite never mails anyone: the fixture adult has no email, so the sender says why it skipped them.
    expect(res.ok && res.skipped.map((x) => x.name)).toEqual([`${TEST_PREFIX} PLA Teacher`]);
  });

  it('SendRequest_AboutATopicNotOnThisMeeting_IsRefused', async () => {
    asEditor();
    expect(await (await actions()).plannerSendRequestAction({ entryId: meeting, topicKey: keys[2], personId: teacher })).toEqual({ ok: false, error: 'That isn’t on this meeting’s board.' });
  });

  it('SendRequest_ToSomeoneWhoCantTeach_IsRefused', async () => {
    asEditor();
    const act = await actions();
    await act.plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: true });
    expect(await act.plannerSendRequestAction({ entryId: meeting, topicKey: keys[0], personId: young })).toEqual({ ok: false, error: 'They aren’t someone who can teach that.' });
  });
});
