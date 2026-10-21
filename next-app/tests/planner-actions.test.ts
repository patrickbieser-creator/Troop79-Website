import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
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
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }
}));
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
let gone = 0; // an inactive person
let editorAdult = 0;
let spl = 0;
let teacher = 0;
let young = 0; // working on Tenderfoot
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
  gone = await person('Gone', { active: false });
  editorAdult = await person('Editor');
  teacher = await person('Teacher');
  spl = await scout('Spl', 'star');
  young = await scout('Young', 'scout');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(3);
  keys = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
});

afterEach(async () => {
  for (const e of entries) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
  }
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
    const res = await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: true });
    expect(res.ok && res.drawer.options.find((o) => o.key === keys[0])?.on).toBe(true);
  });

  it('Editor_UnticksAPick', async () => {
    asEditor();
    const act = await actions();
    await act.plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: true });
    const res = await act.plannerTogglePickAction({ entryId: meeting, personId: young, key: keys[0], on: false });
    expect(res.ok && res.drawer.kind === 'scout' && res.drawer.picked).toBe(0);
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
