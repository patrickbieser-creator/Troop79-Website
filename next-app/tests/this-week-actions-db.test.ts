import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { fetchPeopleLists } from '../src/lib/people-lists';
import { loadThisWeekData } from '../src/lib/this-week-db';
import { buildThisWeek } from '../src/lib/this-week';

/**
 * Meeting Planner III, This week's writes (Plans/Meeting-Planner-III.md, P2): the focus and the night's badges are the
 * planning team's (seed), hand placement and teacher slots are editors' (edit), check-in is the meeting day only, and
 * every refusal happens before a write. Real local database (migration 20261228100000_planner_iii_groups); the actor
 * and "today" (2085-02-20) are mocked. Test-owned rows only: a 2085 meeting (its topics, roles, badges and teachers
 * cascade with it), focus sets this file made, deleted by id. Real scouts and adults are only read.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> },
  today: '2085-02-20'
}));

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => state.today }));

const actions = () => import('../src/app/(public)/planner/this-week-actions');

let meeting = 0;
let setId = 0;
let planner = 0;
let teacherA = 0;
let teacherB = 0;
let scoutPerson = 0;
const asSeeder = () => (state.actor = { personId: planner, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed', 'meeting_planner.edit']) });
const asEditor = () => (state.actor = { personId: planner, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: planner, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });

async function view() {
  const [catalog, lists] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb)]);
  const data = await loadThisWeekData(sb, { entryId: meeting, date: '2085-03-04' }, lists, catalog);
  return buildThisWeek(data.input);
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2085-01-01').lte('entry_date', '2085-12-31');
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2085-03-04', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} TW` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  // Real people, read only: two adult leaders and an active scout.
  const { data: leaders } = await sb.from('person_directory').select('person_id').eq('tab', 'leader').eq('in_picker', true).order('person_id').limit(3);
  [planner, teacherA, teacherB] = ((leaders ?? []) as { person_id: number }[]).map((r) => r.person_id);
  const { data: scout } = await sb.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null).order('person_id').limit(1).single();
  scoutPerson = (scout as { person_id: number }).person_id;
  const { data: set, error: se } = await sb.from('focus_sets').insert({ name: `${TEST_PREFIX} TW set` }).select('id').single();
  if (se) throw new Error(se.message);
  setId = set!.id as number;
  await sb.from('focus_set_items').insert([
    { set_id: setId, topic_key: 'tenderfoot-4a', position: 0 },
    { set_id: setId, topic_key: 'second-class-6a', position: 1 }
  ]);
});

afterAll(async () => {
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('focus_sets').delete().eq('id', setId);
});

describe('This week: rights', () => {
  it('Viewer_IsRefused_OnEveryThisWeekWrite', async () => {
    asViewer();
    const a = await actions();
    const results = await Promise.all([
      a.twAddFocusSetAction({ entryId: meeting, setId }),
      a.twSetNightBadgeAction({ entryId: meeting, mbId: 'first-aid', on: true }),
      a.twSetRoleAction({ entryId: meeting, personId: scoutPerson, role: 'teach' }),
      a.twSetTeacherAction({ entryId: meeting, key: 'fr:tenderfoot', personId: teacherA, on: true })
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false, false, false]);
  });

  it('NonSeeder_IsRefused_WhenChangingFocusOrBadges', async () => {
    asEditor();
    const a = await actions();
    const results = await Promise.all([a.twAddFocusSetAction({ entryId: meeting, setId }), a.twSetNightBadgeAction({ entryId: meeting, mbId: 'first-aid', on: true })]);
    expect(results.map((r) => r.ok)).toEqual([false, false]);
  });
});

describe('This week: the focus and badges', () => {
  it('Seeder_AddsAFocusSet_AndItsRankGroupsAppear', async () => {
    asSeeder();
    expect((await (await actions()).twAddFocusSetAction({ entryId: meeting, setId })).ok).toBe(true);
    expect((await view()).groups.map((g) => g.key)).toEqual(['fr:tenderfoot', 'fr:second-class']);
  });

  it('Seeder_AddsANightBadge_AndItsGroupAppears', async () => {
    asSeeder();
    expect((await (await actions()).twSetNightBadgeAction({ entryId: meeting, mbId: 'first-aid', on: true })).ok).toBe(true);
    expect((await view()).badges).toEqual([{ mbId: 'first-aid', name: expect.any(String), direct: true }]);
  });

  it('Seeder_RemovesTheNightBadge', async () => {
    asSeeder();
    await (await actions()).twSetNightBadgeAction({ entryId: meeting, mbId: 'first-aid', on: false });
    expect((await view()).badges).toEqual([]);
  });

  it('UnknownBadge_IsRefused', async () => {
    asSeeder();
    expect((await (await actions()).twSetNightBadgeAction({ entryId: meeting, mbId: 'no-such-badge-zz', on: true })).ok).toBe(false);
  });
});

describe('This week: hand placement and teachers', () => {
  it('Editor_SetsHelpTeach_AndTheRowFollows', async () => {
    asEditor();
    expect((await (await actions()).twSetRoleAction({ entryId: meeting, personId: scoutPerson, role: 'teach' })).ok).toBe(true);
    const row = (await view()).sections.flatMap((s) => s.rows).find((r) => r.personId === scoutPerson)!;
    expect([row.status, row.hand]).toEqual(['teach', true]);
  });

  it('Editor_LetsPlacementDecideAgain', async () => {
    asEditor();
    await (await actions()).twSetRoleAction({ entryId: meeting, personId: scoutPerson, role: null });
    const row = (await view()).sections.flatMap((s) => s.rows).find((r) => r.personId === scoutPerson)!;
    expect(row.hand).toBe(false);
  });

  it('Unassign_AlsoDropsAFamilysHelpTeach_AndHandsTheScoutBack', async () => {
    asEditor();
    await sb.from('meeting_scout_helpers').upsert({ calendar_entry_id: meeting, person_id: scoutPerson, group_key: 'fr:tenderfoot' });
    await (await actions()).twSetRoleAction({ entryId: meeting, personId: scoutPerson, role: null });
    const { count } = await sb.from('meeting_scout_helpers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting).eq('person_id', scoutPerson);
    const row = (await view()).sections.flatMap((s) => s.rows).find((r) => r.personId === scoutPerson)!;
    expect([count, row.hand]).toEqual([0, false]);
  });

  it('Role_ForSomeoneWhoIsNotAnActiveScout_IsRefused', async () => {
    asEditor();
    expect((await (await actions()).twSetRoleAction({ entryId: meeting, personId: teacherA, role: 'teach' })).ok).toBe(false);
  });

  const teachersOf = async () => (await view()).groups.find((g) => g.key === 'fr:tenderfoot')!.teachers.map((t) => t.personId).sort((x, y) => x - y);

  it('GroupTeacher_MakesTheGroupTopic_AndShowsOnTheGroup', async () => {
    asEditor();
    expect((await (await actions()).twSetTeacherAction({ entryId: meeting, key: 'fr:tenderfoot', personId: teacherA, on: true })).ok).toBe(true);
    expect(await teachersOf()).toEqual([teacherA]);
  });

  it('GroupTeacher_ASecondTeacher_JoinsTheFirst', async () => {
    asEditor();
    await (await actions()).twSetTeacherAction({ entryId: meeting, key: 'fr:tenderfoot', personId: teacherB, on: true });
    expect(await teachersOf()).toEqual([teacherA, teacherB].sort((x, y) => x - y));
  });

  it('GroupTeacher_TakenOff_LeavesTheOthers', async () => {
    asEditor();
    await (await actions()).twSetTeacherAction({ entryId: meeting, key: 'fr:tenderfoot', personId: teacherA, on: false });
    expect(await teachersOf()).toEqual([teacherB]);
  });

  it('GroupTeachers_Cleared_LeavesTheSlotEmpty', async () => {
    asEditor();
    await (await actions()).twSetTeacherAction({ entryId: meeting, key: 'fr:tenderfoot', personId: teacherA, on: true });
    await (await actions()).twSetTeacherAction({ entryId: meeting, key: 'fr:tenderfoot', personId: null, on: false });
    expect(await teachersOf()).toEqual([]);
  });

  it('TeacherForAClassNotOnThisMeeting_IsRefused', async () => {
    asEditor();
    expect((await (await actions()).twSetTeacherAction({ entryId: meeting, key: 'tenderfoot-5', personId: teacherA, on: true })).ok).toBe(false);
  });
});

describe('This week: Live at the meeting', () => {
  it('CheckIn_IsRefused_BeforeTheMeetingDay', async () => {
    asEditor();
    expect((await (await actions()).twSetPresentAction({ entryId: meeting, personId: scoutPerson, present: true })).ok).toBe(false);
  });

  it('CheckIn_OnTheMeetingDay_WritesADraftTick', async () => {
    asEditor();
    state.today = '2085-03-04';
    try {
      expect((await (await actions()).twSetPresentAction({ entryId: meeting, personId: scoutPerson, present: true })).ok).toBe(true);
      const { data } = await sb.from('meeting_live_presence').select('present').eq('calendar_entry_id', meeting).eq('person_id', scoutPerson).single();
      expect((data as { present: boolean }).present).toBe(true);
    } finally {
      state.today = '2085-02-20';
    }
  });
});
