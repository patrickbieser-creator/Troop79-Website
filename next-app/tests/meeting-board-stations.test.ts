import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting board, Phase 3b (Plans/Meeting-Requests-And-Teaching-Offers.md, Decision 10): a merit badge night's database
 * half and its loaders. meeting_set_stations (badge + 2-6 stations in one transaction; a saved station keeps its
 * teachers through edits), teaching a station (adults only, the counselor flag is shown not enforced),
 * meeting_save_rotations (the leader's arrangement; placing a scout with no answer records Coming), leaving merit badge
 * mode drops the night's stations, merge_people, the posture, the server actions' authorization, and the rotation draft
 * through loadRotationBoard (held rank picks don't make a scout Coming; a finished station is skipped; a badge holder is
 * listed). Real local database, the admin actor mocked. Every row is test-owned: fixture entries are dated 2093 and
 * deleted by id (their boards, topics, stations, placements and picks cascade); people, scouts and their ledger rows by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({ actor: null as null | { personId: number | null; subjectKind: 'adult' | 'scout'; capabilities: Set<string> } }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => state.actor,
  actorHas: (a: { capabilities: Set<string> } | null, c: string) => a?.capabilities.has(c) ?? false
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const actions = () => import('../src/app/admin/(workspace)/advancement/meeting-plan/actions');

let rank1 = 0; // 2093-03-01, a rank board
let mbNight = 0; // 2093-03-08, the merit badge night
let rank2 = 0; // 2093-03-15, the next rank board
let past = 0;
const entries = () => [rank1, mbNight, rank2, past];
const people: number[] = [];
const scoutIds: string[] = [];
let adult = 0;
let junior = 0;
let s1 = 0; // coming, finished the first station
let s2 = 0; // coming
let s3 = 0; // never answered, has carried rank picks
let holder = 0; // coming, has the badge
let badge = '';
let codes: string[] = []; // the badge's first four top-level requirements, all leaves
let pickKey = '';

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}
async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MBS3 ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string, patrol: string | null = null): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mbs3-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} MBS3 ${label}`, person_id: pid, active: true, current_rank: rank, patrol });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
const scoutIdOf = (pid: number) => `vitest-mbs3-${pid}`;

beforeAll(async () => {
  rank1 = await entry('2093-03-01');
  mbNight = await entry('2093-03-08');
  rank2 = await entry('2093-03-15');
  const { data: pe } = await sb.from('calendar_entries').insert({ entry_date: '2020-03-08', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  past = pe!.id as number;
  adult = await person('Adult');
  junior = await scout('Junior', 'first-class');
  s1 = await scout('One', 'tenderfoot', 'Hawks');
  s2 = await scout('Two', 'tenderfoot', 'Hawks');
  s3 = await scout('Three', 'scout');
  holder = await scout('Holder', 'star');
  // A badge with at least four top-level requirements that have no sub-requirements (one ledger row finishes each).
  badge = localSql(
    `select mb_id from merit_badge_requirements q where parent_id is null and not exists (select 1 from merit_badge_requirements c where c.parent_id = q.id) group by mb_id having count(*) >= 4 order by mb_id limit 1`
  );
  codes = localSql(
    `select string_agg(code, ',' order by sort_order) from (select code, sort_order from merit_badge_requirements q where mb_id = '${badge}' and parent_id is null and not exists (select 1 from merit_badge_requirements c where c.parent_id = q.id) order by sort_order limit 4) x`
  ).split(',');
  if (!badge || codes.length < 4) throw new Error('fixture: need a badge with four leaf top-level requirements');
  const { data: reqs } = await sb.from('rank_requirements').select('code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(1);
  pickKey = `tenderfoot-${(reqs as { code: string }[])[0].code}`;
  const ledger = (pid: number, kind: string, code: string) => ({ scout_id: scoutIdOf(pid), date: '2026-01-01', kind, code, label: 'vitest', unit: kind === 'merit_badge_award' ? 'award' : 'complete', entered_by: 'vitest' });
  const { error } = await sb.from('ledger_entries').insert([ledger(s1, 'merit_badge_requirement', `${badge}-${codes[0]}`), ledger(holder, 'merit_badge_award', `MB:${badge}`)]);
  if (error) throw new Error(`fixture ledger: ${error.message}`);
});

afterEach(async () => {
  for (const e of entries()) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_boards').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_rotation_placements').delete().eq('calendar_entry_id', e);
  }
  state.actor = null;
});

afterAll(async () => {
  await sb.from('ledger_entries').delete().in('scout_id', scoutIds);
  await sb.from('calendar_entries').delete().in('id', entries());
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const st = (title: string, c: string[], topicId: number | null = null, location = '') => ({ topic_id: topicId, title, location, codes: c });
const setStations = (stations: unknown[], entryId = mbNight, mb = badge) => sb.rpc('meeting_set_stations', { p_entry: entryId, p_mb_id: mb, p_stations: stations });
const FOUR = () => [st('First', [codes[0]]), st('Second', [codes[1]]), st('Third', [codes[2]]), st('Fourth', [codes[3]])];
async function stationRows(entryId = mbNight) {
  const { data } = await sb.from('meeting_stations').select('topic_id, position, title, location, req_codes, meeting_topics(topic_key, kind)').eq('calendar_entry_id', entryId).order('position');
  return (data ?? []) as unknown as { topic_id: number; position: number; title: string; location: string | null; req_codes: string[]; meeting_topics: { topic_key: string; kind: string } }[];
}
const teach = (key: string, who = adult, entryId = mbNight) => sb.rpc('meeting_teach_topic', { p_entries: [entryId], p_person: who, p_actor: who, p_leader: false, p_topic_key: key, p_title: null, p_note: null });
const teachersOn = async (topicId: number) => ((await sb.from('meeting_topic_teachers').select('person_id').eq('topic_id', topicId)).data ?? []).map((r) => (r as { person_id: number }).person_id);
const save = (placements: unknown[], entryId = mbNight, actor: number | null = adult) => sb.rpc('meeting_save_rotations', { p_entry: entryId, p_actor: actor, p_placements: placements });
const placementsOf = async (entryId = mbNight) =>
  ((await sb.from('meeting_rotation_placements').select('person_id, group_index, helper_topic_id, other_work').eq('calendar_entry_id', entryId).order('person_id')).data ?? []) as {
    person_id: number;
    group_index: number | null;
    helper_topic_id: number | null;
    other_work: boolean;
  }[];
const intent = (who: number, it: string, entryId = mbNight) => sb.rpc('meeting_set_intent', { p_entry: entryId, p_person: who, p_actor: who, p_leader: false, p_intent: it });

describe('stations (meeting_set_stations)', () => {
  it('Leader_SetsTheBadgeAndStations_InOneSave', async () => {
    const res = await setStations([st('Fire safety', [codes[1], codes[0]], null, 'Parking lot'), st('Nutrition', [codes[2]])]);
    const rows = await stationRows();
    const board = (await sb.from('meeting_boards').select('board_mode, board_mb_id').eq('calendar_entry_id', mbNight).single()).data;
    expect([res.error, board, rows.map((r) => [r.position, r.title, r.location, r.req_codes, r.meeting_topics.topic_key, r.meeting_topics.kind])]).toEqual([
      null,
      { board_mode: 'merit_badge', board_mb_id: badge },
      [
        [1, 'Fire safety', 'Parking lot', [codes[0], codes[1]], `${badge}-${codes[0]}`, 'mb_req'],
        [2, 'Nutrition', null, [codes[2]], `${badge}-${codes[2]}`, 'mb_req']
      ]
    ]);
  });

  it('Stations_RefuseFewerThanTwo_AndMoreThanSix', async () => {
    const one = await setStations([st('Only', [codes[0]])]);
    const seven = await setStations(Array.from({ length: 7 }, (_, i) => st(`S${i}`, [codes[i % 4]])));
    expect([one.error?.message, seven.error?.message]).toEqual(['Add at least 2 stations so groups have somewhere to rotate.', 'Six stations is the most a meeting can rotate through.']);
  });

  it('Stations_RefuseNoName_NoRequirement_ARequirementTwice_AndOneNotOnTheBadge', async () => {
    const results = [
      await setStations([st(' ', [codes[0]]), st('B', [codes[1]])]),
      await setStations([st('A', []), st('B', [codes[1]])]),
      await setStations([st('A', [codes[0]]), st('B', [codes[0], codes[1]])]),
      await setStations([st('A', ['no-such-req']), st('B', [codes[1]])])
    ];
    expect([results.map((r) => r.error?.message), await stationRows()]).toEqual([
      ['Station 1 needs a name.', 'Station 1 needs at least one requirement.', 'A requirement can be in only one station.', 'Station 1 lists a requirement that isn’t one of this badge’s.'],
      []
    ]);
  });

  it('Station_KeepsItsTeacher_WhenRenamedAndItsLeadRequirementSwaps', async () => {
    await setStations([st('A', [codes[0]]), st('B', [codes[1]])]);
    const [a, b] = await stationRows();
    expect((await teach(a.meeting_topics.topic_key)).error).toBeNull();
    // The two stations trade requirements: their keys swap, each keeps its own topic row and teachers.
    const res = await setStations([st('Renamed A', [codes[1]], a.topic_id), st('B', [codes[0]], b.topic_id)]);
    const after = await stationRows();
    expect([res.error, after.map((r) => [r.topic_id, r.title, r.meeting_topics.topic_key]), await teachersOn(a.topic_id)]).toEqual([
      null,
      [
        [a.topic_id, 'Renamed A', `${badge}-${codes[1]}`],
        [b.topic_id, 'B', `${badge}-${codes[0]}`]
      ],
      [adult]
    ]);
  });

  it('RemovedStation_TakesItsTeacherSignUps_WithIt', async () => {
    await setStations([st('A', [codes[0]]), st('B', [codes[1]]), st('C', [codes[2]])]);
    const [a, b, c] = await stationRows();
    await teach(c.meeting_topics.topic_key);
    await setStations([st('A', [codes[0]], a.topic_id), st('B', [codes[1]], b.topic_id)]);
    const { count } = await sb.from('meeting_topic_teachers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', mbNight);
    expect([(await stationRows()).length, count]).toEqual([2, 0]);
  });

  it('Stations_RefuseAStationFromSomewhereElse', async () => {
    await setStations([st('A', [codes[0]]), st('B', [codes[1]])], rank2);
    const [other] = await stationRows(rank2);
    expect((await setStations([st('A', [codes[0]], other.topic_id), st('B', [codes[1]])])).error?.message).toBe('The stations changed. Reload the page and try again.');
  });

  it('Stations_RefusedForAPastMeeting', async () => {
    expect((await setStations(FOUR(), past)).error?.message).toBe('That meeting has passed.');
  });

  it('LeavingMeritBadgeMode_DropsTheNightsStations_TheirTeachers_AndTheArrangement', async () => {
    // This night's rank pick, made while it was still a rank board.
    const add = await sb.rpc('meeting_add_pick', { p_entry: mbNight, p_person: s3, p_actor: s3, p_leader: false, p_topic_key: pickKey, p_later: false, p_mark_coming: false, p_carry: [] });
    expect(add.error).toBeNull();
    // Another meeting: its own merit badge night (stations and a teacher) and a rank pick on a third.
    await setStations([st('A', [codes[0]]), st('B', [codes[1]])], rank2);
    const [otherStation] = await stationRows(rank2);
    await teach(otherStation.meeting_topics.topic_key, adult, rank2);
    await sb.rpc('meeting_add_pick', { p_entry: rank1, p_person: s3, p_actor: s3, p_leader: false, p_topic_key: pickKey, p_later: false, p_mark_coming: false, p_carry: [] });
    await setStations(FOUR());
    const [a] = await stationRows();
    await teach(a.meeting_topics.topic_key);
    await intent(s2, 'coming');
    await save([{ person_id: s2, group: 1 }]);
    await sb.rpc('meeting_set_board', { p_entry: mbNight, p_mode: 'rank', p_mb_id: null, p_block_count: 2 });
    const topics = ((await sb.from('meeting_topics').select('kind').eq('calendar_entry_id', mbNight)).data ?? []).map((t) => (t as { kind: string }).kind);
    const picks = async (entryId: number) => (await sb.from('meeting_topic_picks').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', entryId)).count;
    expect([
      (await stationRows()).length,
      topics,
      (await placementsOf()).length,
      await picks(mbNight),
      (await stationRows(rank2)).length,
      await teachersOn(otherStation.topic_id),
      await picks(rank1)
    ]).toEqual([0, ['rank_req'], 0, 1, 2, [adult], 1]);
  });

  it('ResavingTheSameBadge_KeepsTheStations', async () => {
    await setStations(FOUR());
    await sb.rpc('meeting_set_board', { p_entry: mbNight, p_mode: 'merit_badge', p_mb_id: badge, p_block_count: null });
    expect((await stationRows()).length).toBe(4);
  });
});

describe('teaching a station', () => {
  it('Adult_CommitsToAStation_OnAMeritBadgeNight', async () => {
    await setStations(FOUR());
    const [a] = await stationRows();
    expect([(await teach(a.meeting_topics.topic_key)).error, await teachersOn(a.topic_id)]).toEqual([null, [adult]]);
  });

  it('Teacher_IsRefusedATopicThatIsntAStation_OnAMeritBadgeNight', async () => {
    await setStations(FOUR());
    expect((await teach(pickKey)).error?.message).toBe('There’s no teaching sign-up for this meeting.');
  });

  it('JuniorLeader_IsRefusedAStation_ALeaderPlacesThem', async () => {
    await setStations(FOUR());
    const [a] = await stationRows();
    expect((await teach(a.meeting_topics.topic_key, junior)).error?.message).toBe('On a merit badge night, a leader places Junior Leaders.');
  });

  it('Teacher_CanTakeAThirdStation_NoCap', async () => {
    await setStations(FOUR());
    const [a, b, c] = await stationRows();
    await teach(a.meeting_topics.topic_key);
    await teach(b.meeting_topics.topic_key);
    expect((await teach(c.meeting_topics.topic_key)).error).toBeNull();
  });

  it('Teacher_RemovesTheirStation', async () => {
    await setStations(FOUR());
    const [a] = await stationRows();
    await teach(a.meeting_topics.topic_key);
    await sb.rpc('meeting_unteach_topic', { p_entry: mbNight, p_person: adult, p_actor: adult, p_leader: false, p_topic_key: a.meeting_topics.topic_key });
    expect([await teachersOn(a.topic_id), (await stationRows()).length]).toEqual([[], 4]);
  });
});

describe('the arrangement (meeting_save_rotations)', () => {
  it('Leader_SavesAnArrangement_AndASecondSaveReplacesIt', async () => {
    await setStations(FOUR());
    const [a] = await stationRows();
    await save([{ person_id: s1, group: 0 }, { person_id: s2, group: 2 }, { person_id: holder, helper_topic_id: a.topic_id }]);
    const first = await placementsOf();
    await save([{ person_id: s1, group: 3 }, { person_id: holder, other: true }]);
    expect([first.length, await placementsOf()]).toEqual([
      3,
      [
        { person_id: s1, group_index: 3, helper_topic_id: null, other_work: false },
        { person_id: holder, group_index: null, helper_topic_id: null, other_work: true }
      ].sort((x, y) => x.person_id - y.person_id)
    ]);
  });

  it('Leader_StartsOverFromTheDraft_WithAnEmptyArrangement', async () => {
    await setStations(FOUR());
    await save([{ person_id: s1, group: 0 }]);
    await save([]);
    expect(await placementsOf()).toEqual([]);
  });

  it('PlacingAScoutWhoNeverAnswered_RecordsThemComing_ByTheLeader', async () => {
    await setStations(FOUR());
    await intent(s2, 'undecided');
    await save([{ person_id: s3, group: 1 }, { person_id: s2, group: 1 }]);
    const { data } = await sb.from('meeting_intents').select('person_id, intent, entered_by_person_id').eq('calendar_entry_id', mbNight).order('person_id');
    expect(data).toEqual(
      [
        { person_id: s2, intent: 'undecided', entered_by_person_id: s2 },
        { person_id: s3, intent: 'coming', entered_by_person_id: adult }
      ].sort((x, y) => x.person_id - y.person_id)
    );
  });

  it('Arrangement_RefusesAScoutWhoSaidTheyCantMakeIt_TheirAnswerWins', async () => {
    await setStations(FOUR());
    await intent(s2, 'not_coming');
    const res = await save([{ person_id: s1, group: 0 }, { person_id: s2, group: 1 }]);
    const { data } = await sb.from('meeting_intents').select('intent').eq('calendar_entry_id', mbNight).eq('person_id', s2).single();
    expect([res.error?.message, await placementsOf(), data]).toEqual([`${TEST_PREFIX} MBS3 Two said they can’t make it. Reload the page to see the latest.`, [], { intent: 'not_coming' }]);
  });

  it('RotationsAction_ShowsTheCantMakeItMessage_InTheLeadersWords', async () => {
    state.actor = { personId: adult, subjectKind: 'adult', capabilities: new Set(['meeting_plan.use']) };
    await setStations(FOUR());
    await intent(s2, 'not_coming');
    const res = await (await actions()).saveRotationsAction({ entryId: mbNight, placements: [{ personId: s2, placement: { kind: 'group', group: 0 } }] });
    expect(res).toEqual({ ok: false, error: `${TEST_PREFIX} MBS3 Two said they can’t make it. Reload the page to see the latest.` });
  });

  it('Arrangement_RefusesARankBoard_AndAPastMeeting', async () => {
    const rank = await save([{ person_id: s1, group: 0 }], rank1);
    expect([rank.error?.message, (await save([], past)).error?.message]).toEqual(['This meeting isn’t a merit badge night.', 'That meeting has passed.']);
  });

  it('Arrangement_RefusesANonScout_TwoPlaces_AndAHelperStationNotOnThisBoard', async () => {
    await setStations(FOUR());
    await setStations([st('A', [codes[0]]), st('B', [codes[1]])], rank2);
    const [elsewhere] = await stationRows(rank2);
    const results = [
      await save([{ person_id: adult, group: 0 }]),
      await save([{ person_id: s1, group: 0 }, { person_id: s1, group: 1 }]),
      await save([{ person_id: s1, group: 0, other: true }]),
      await save([{ person_id: holder, helper_topic_id: elsewhere.topic_id }])
    ];
    expect([results.map((r) => r.error?.message), await placementsOf()]).toEqual([
      ['Only scouts go in rotations.', 'Each scout goes in one place.', 'Each scout goes in one place.', 'The stations changed. Reload the page and try again.'],
      []
    ]);
  });

  it('ChangingHowManyStations_StartsTheGroupsOver_ButKeepsHelpers', async () => {
    await setStations(FOUR());
    const [a, b, c] = await stationRows();
    await save([{ person_id: s1, group: 3 }, { person_id: holder, helper_topic_id: a.topic_id }]);
    await setStations([st('A', [codes[0]], a.topic_id), st('B', [codes[1]], b.topic_id), st('C', [codes[2]], c.topic_id)]);
    expect((await placementsOf()).map((p) => [p.person_id, p.group_index, p.helper_topic_id])).toEqual([[holder, null, a.topic_id]]);
  });

  it('BoardStamp_Changes_WhenStationsOrTheArrangementChange', async () => {
    const s0 = (await sb.rpc('meeting_board_stamp', { p_entry: mbNight })).data;
    await setStations(FOUR());
    const sA = (await sb.rpc('meeting_board_stamp', { p_entry: mbNight })).data;
    await save([{ person_id: s1, group: 0 }]);
    const sB = (await sb.rpc('meeting_board_stamp', { p_entry: mbNight })).data;
    expect([sA !== s0, sB !== sA]).toEqual([true, true]);
  });

  it('MergePeople_MovesARotationPlacement_ToTheSurvivor', async () => {
    await setStations(FOUR());
    const loser = await scout('Loser', 'scout');
    const survivor = await person('Survivor');
    await save([{ person_id: loser, group: 2 }], mbNight, loser);
    const { error } = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (error) throw new Error(error.message);
    const rows = ((await sb.from('meeting_rotation_placements').select('person_id, group_index, entered_by_person_id').eq('calendar_entry_id', mbNight)).data ?? []) as unknown[];
    expect(rows).toEqual([{ person_id: survivor, group_index: 2, entered_by_person_id: survivor }]);
  });
});

describe('the server actions', () => {
  const asLeader = () => (state.actor = { personId: adult, subjectKind: 'adult', capabilities: new Set(['meeting_plan.use']) });
  const drafts = () => FOUR().map((s) => ({ topicId: null, title: s.title, location: s.location, codes: s.codes }));

  it('Leader_SavesStations_ThroughTheAction', async () => {
    asLeader();
    const res = await (await actions()).setMeetingStationsAction({ entryId: mbNight, mbId: badge, stations: drafts() });
    expect([res, (await stationRows()).length]).toEqual([{ ok: true }, 4]);
  });

  it('StationsAction_SaysWhy_InTheLeadersWords', async () => {
    asLeader();
    expect(await (await actions()).setMeetingStationsAction({ entryId: mbNight, mbId: badge, stations: drafts().slice(0, 1) })).toEqual({ ok: false, error: 'Add at least 2 stations so groups have somewhere to rotate.' });
  });

  it('StationsAndRotations_RefusedWithoutMeetingPlan', async () => {
    state.actor = { personId: adult, subjectKind: 'adult', capabilities: new Set(['advancement.write']) };
    const a = await actions();
    expect([await a.setMeetingStationsAction({ entryId: mbNight, mbId: badge, stations: drafts() }), await a.saveRotationsAction({ entryId: mbNight, placements: [] })]).toEqual([
      { ok: false, error: 'Not authenticated' },
      { ok: false, error: 'Not authenticated' }
    ]);
  });

  it('StationsAndRotations_RefusedForAYouthLeader_WhoHoldsMeetingPlan', async () => {
    state.actor = { personId: junior, subjectKind: 'scout', capabilities: new Set(['meeting_plan.use']) };
    const a = await actions();
    expect([(await a.setMeetingStationsAction({ entryId: mbNight, mbId: badge, stations: drafts() })).ok, (await a.saveRotationsAction({ entryId: mbNight, placements: [] })).ok, (await stationRows()).length]).toEqual([
      false,
      false,
      0
    ]);
  });

  it('RotationsAction_SavesAsTheLeader_AndRefusesAMalformedPlacement', async () => {
    asLeader();
    const a = await actions();
    await a.setMeetingStationsAction({ entryId: mbNight, mbId: badge, stations: drafts() });
    const bad = await a.saveRotationsAction({ entryId: mbNight, placements: [{ personId: s1, placement: { kind: 'group', group: 'x' as unknown as number } }] });
    const good = await a.saveRotationsAction({ entryId: mbNight, placements: [{ personId: s3, placement: { kind: 'group', group: 1 } }] });
    const by = (await sb.from('meeting_rotation_placements').select('entered_by_person_id').eq('calendar_entry_id', mbNight).single()).data;
    expect([bad, good, by]).toEqual([{ ok: false, error: 'Malformed request' }, { ok: true }, { entered_by_person_id: adult }]);
  });

  it('Rotations_Posture_TablesAndFunctions_AreServiceRoleOnly_InvokerAndPinned', () => {
    const tables = localSql(
      `select string_agg(c.relname || ':' || c.relrowsecurity || ':' || has_table_privilege('anon', c.oid, 'select') || ':' || has_table_privilege('authenticated', c.oid, 'select'), ',' order by c.relname) from pg_class c where c.relname in ('meeting_stations', 'meeting_rotation_placements') and c.relnamespace = 'public'::regnamespace`
    );
    const fns = [
      'public.meeting_set_stations(bigint,text,jsonb)',
      'public.meeting_save_rotations(bigint,bigint,jsonb)',
      'public.meeting_set_board(bigint,text,text,integer)',
      'public._meeting_teach_guard(bigint,bigint,bigint,boolean,text)',
      'public.meeting_teach_topic(bigint[],bigint,bigint,boolean,text,text,text)',
      'public.meeting_board_stamp(bigint)'
    ].map((f) =>
      localSql(
        `select (has_function_privilege('anon', '${f}', 'execute') or has_function_privilege('authenticated', '${f}', 'execute') or has_function_privilege('public', '${f}', 'execute'))::text || '|' || (not p.prosecdef)::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = '${f}'::regprocedure`
      )
    );
    expect([tables, fns]).toEqual(['meeting_rotation_placements:true:false:false,meeting_stations:true:false:false', Array(6).fill('false|true|search_path=public, pg_temp')]);
  });
});

describe('the rotation draft from the database (loadRotationBoard)', () => {
  async function rotation(entryId = mbNight) {
    const { fetchAdvancementCatalog } = await import('../src/lib/advancement-catalog');
    const { loadBoardState, loadMeetingById } = await import('../src/lib/meeting-board');
    const { loadRotationBoard } = await import('../src/lib/meeting-board-stations');
    const catalog = await fetchAdvancementCatalog(sb);
    const meeting = (await loadMeetingById(sb, entryId))!;
    const rows = await loadBoardState(sb, meeting, catalog);
    return { rot: await loadRotationBoard(sb, meeting, catalog, rows), rows };
  }
  const groupOf = (rot: NonNullable<Awaited<ReturnType<typeof rotation>>['rot']>, pid: number) => rot.result.groups.find((g) => g.members.some((m) => m.personId === pid));

  it('Matcher_DraftsComingScouts_SkipsAFinishedStation_AndListsTheBadgeHolder', async () => {
    await setStations(FOUR());
    for (const p of [s1, s2, holder]) await intent(p, 'coming');
    const { rot } = await rotation();
    const one = groupOf(rot!, s1)!.members.find((m) => m.personId === s1)!;
    expect([!!groupOf(rot!, s1), !!groupOf(rot!, s2), groupOf(rot!, holder), one.skips, rot!.result.badgeHolders.map((h) => h.personId), rot!.badgeHolderIds.includes(holder)]).toEqual([
      true,
      true,
      undefined,
      [0],
      [holder],
      true
    ]);
  });

  it('RotationBoard_ReadsPatrols_FromTheRoster', async () => {
    await setStations(FOUR());
    await intent(s1, 'coming');
    const { rot } = await rotation();
    expect([rot!.patrolOf.get(s1), rot!.patrolOf.get(s3)]).toEqual(['Hawks', null]);
  });

  it('Scout_RankPicksHeld_DuringMeritBadgeMeeting_AndReturnAfter', async () => {
    // Scout 3 picks on the rank board before the merit badge night, then says nothing.
    const add = await sb.rpc('meeting_add_pick', { p_entry: rank1, p_person: s3, p_actor: s3, p_leader: false, p_topic_key: pickKey, p_later: false, p_mark_coming: false, p_carry: [] });
    expect(add.error).toBeNull();
    const asked = ((await sb.from('meeting_topic_picks').select('first_asked_on').eq('calendar_entry_id', rank1).eq('person_id', s3).single()).data as { first_asked_on: string }).first_asked_on;
    await setStations(FOUR());
    const { rot, rows } = await rotation();
    const onMb = rows.find((r) => r.personId === s3)!;
    // Held: no pick can be added on the night, the carried pick doesn't make them Coming, so they're in no group.
    const refused = await sb.rpc('meeting_add_pick', { p_entry: mbNight, p_person: s3, p_actor: s3, p_leader: false, p_topic_key: pickKey, p_later: false, p_mark_coming: false, p_carry: [] });
    const { loadBoardState, loadMeetingById } = await import('../src/lib/meeting-board');
    const { fetchAdvancementCatalog } = await import('../src/lib/advancement-catalog');
    const next = (await loadBoardState(sb, (await loadMeetingById(sb, rank2))!, await fetchAdvancementCatalog(sb))).find((r) => r.personId === s3)!;
    expect([
      onMb.picks.map((p) => p.key),
      groupOf(rot!, s3),
      rot!.noAnswer.some((n) => n.personId === s3),
      refused.error?.message,
      next.picks.map((p) => [p.key, p.firstAskedOn, p.carriedFrom])
    ]).toEqual([[pickKey], undefined, true, 'There are no picks for this meeting.', [[pickKey, asked, '2093-03-01']]]);
  });

  it('Matcher_KeepsTheLeadersPins_AndDraftsALateSignUpAroundThem', async () => {
    await setStations(FOUR());
    await intent(s1, 'coming');
    await save([{ person_id: s1, group: 3 }]);
    await intent(s2, 'coming');
    const { rot } = await rotation();
    const late = groupOf(rot!, s2)!.members.find((m) => m.personId === s2)!;
    expect([groupOf(rot!, s1)?.label, late.isNew, rot!.result.arranged]).toEqual(['D', true, true]);
  });

  it('RotationBoard_IsNull_OnARankBoard', async () => {
    expect((await rotation(rank1)).rot).toBeNull();
  });
});

describe('the meeting editor tray on a merit badge night (loadBoardTray)', () => {
  // P5a (Decision 10): a merit badge night is just a meeting. The tray shows the board's match, never stations.
  it('Tray_OnALegacyMeritBadgeBoard_ShowsTheMatch_NotStations', async () => {
    await setStations([st('First', [codes[0]], null, 'Back room'), st('Second', [codes[1]])]);
    const { loadBoardTray } = await import('../src/app/admin/(workspace)/advancement/meetings/load-agenda');
    const t = (await loadBoardTray(mbNight))!;
    expect([t.mode, t.sessions.some((c) => c.blockLabel.startsWith('Station'))]).toEqual(['rank', false]);
  });
});
