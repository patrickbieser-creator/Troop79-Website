import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting board, Phase 1 (Plans/Meeting-Requests-And-Teaching-Offers.md): the database half. The RPCs hold the
 * five-pick cap, who may act, closed boards and the first-write carry; the board's default mode is one SQL resolver.
 * Real local database. Every row here is test-owned: fixture entries are dated 2091 and deleted by id (their picks,
 * topics, lists and answers cascade), fixture people are deleted by id.
 */
const sb = adminClient();

let meetingEntry = 0;
let otherEntry = 0;
let nonMeetingEntry = 0;
let pastEntry = 0;
let noMeetingEntry = 0;
const people: number[] = [];
const scoutIds: string[] = [];
let households: number[] = [];
let scoutA = 0; // in the Parent's household
let scoutB = 0; // another family
let parent = 0;
let keys: string[] = [];

async function entry(date: string, category: string, title: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category, title: `${title} ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MBR ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mbr-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} MBR ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}

beforeAll(async () => {
  meetingEntry = await entry('2091-01-07', 'Troop Meeting', 'Troop Meeting');
  otherEntry = await entry('2091-01-14', 'Troop Meeting', 'Troop Meeting');
  nonMeetingEntry = await entry('2091-01-10', 'Campout / Overnight', 'Campout');
  noMeetingEntry = await entry('2091-01-21', 'Troop Meeting', 'No Troop Meeting');
  pastEntry = await entry('2020-01-05', 'Troop Meeting', 'Troop Meeting');
  scoutA = await scout('A');
  scoutB = await scout('B');
  parent = await person('Parent');
  const { data: hh } = await sb.from('households').insert({ label: `${TEST_PREFIX} MBR family` }).select('id').single();
  households = [hh!.id];
  await sb.from('household_members').insert([
    { household_id: hh!.id, person_id: parent },
    { household_id: hh!.id, person_id: scoutA }
  ]);
  // Six pickable top-level requirements (any rank: the RPC checks the key names a top-level requirement).
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).in('rank_id', ['tenderfoot', 'second-class']).order('rank_id', { ascending: false }).order('sort_order').limit(8);
  keys = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
  if (keys.length < 8) throw new Error('fixture: need eight requirements');
});

afterEach(async () => {
  for (const e of [meetingEntry, otherEntry, pastEntry]) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_boards').delete().eq('calendar_entry_id', e);
  }
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', [meetingEntry, otherEntry, nonMeetingEntry, noMeetingEntry, pastEntry]);
  if (households.length) await sb.from('households').delete().in('id', households);
  if (scoutIds.length) await sb.from('scouts').delete().in('id', scoutIds);
  if (people.length) await sb.from('people').delete().in('id', people);
});

const add = (o: { entry?: number; person: number; actor: number; key: string; leader?: boolean; later?: boolean; markComing?: boolean; carry?: unknown[] }) =>
  sb.rpc('meeting_add_pick', {
    p_entry: o.entry ?? meetingEntry,
    p_person: o.person,
    p_actor: o.actor,
    p_leader: o.leader ?? false,
    p_topic_key: o.key,
    p_later: o.later ?? false,
    p_mark_coming: o.markComing ?? false,
    p_carry: o.carry ?? []
  });
const picksOf = async (personId: number, entryId = meetingEntry) =>
  ((await sb.from('meeting_topic_picks').select('priority, later, first_asked_on, entered_by_person_id, meeting_topics(topic_key)').eq('calendar_entry_id', entryId).eq('person_id', personId)).data ?? []) as unknown as {
    priority: number | null;
    later: boolean;
    first_asked_on: string;
    entered_by_person_id: number | null;
    meeting_topics: { topic_key: string };
  }[];

describe('meeting board mode', () => {
  it('Board_DefaultsClosed_ForNonMeetingCalendarEntry', async () => {
    const modes = await Promise.all([meetingEntry, nonMeetingEntry, noMeetingEntry].map(async (e) => (await sb.rpc('meeting_board_mode', { p_entry: e })).data));
    expect(modes).toEqual(['rank', 'closed', 'closed']);
  });

  // P5c: the stored mode is retired; a board row changes nothing, the calendar alone decides.
  it('Board_IgnoresTheBoardRow_TheCalendarDecides', async () => {
    await sb.from('meeting_boards').insert({ calendar_entry_id: meetingEntry });
    expect((await sb.rpc('meeting_board_mode', { p_entry: meetingEntry })).data).toBe('rank');
  });
});

describe('meeting picks', () => {
  it('Scout_IsRefusedSixthPick_WhenFiveAlreadyHeld', async () => {
    for (const k of keys.slice(0, 5)) {
      const { error } = await add({ person: scoutA, actor: scoutA, key: k });
      if (error) throw new Error(error.message);
    }
    const { error } = await add({ person: scoutA, actor: scoutA, key: keys[5] });
    expect([error?.message, (await picksOf(scoutA)).length]).toEqual(['You have 5. Take one off to add this.', 5]);
  });

  it('Scout_LaterPicksCountTowardTheFive', async () => {
    for (const k of keys.slice(0, 5)) await add({ person: scoutA, actor: scoutA, key: k, later: true });
    expect((await add({ person: scoutA, actor: scoutA, key: keys[5] })).error?.message).toBe('You have 5. Take one off to add this.');
  });

  it('Scout_CanSavePicks_WithoutRanking', async () => {
    await add({ person: scoutA, actor: scoutA, key: keys[0] });
    await add({ person: scoutA, actor: scoutA, key: keys[1] });
    expect((await picksOf(scoutA)).map((p) => p.priority)).toEqual([null, null]);
  });

  it('Scout_NewPickGoesLast_WhenListIsRanked', async () => {
    await add({ person: scoutA, actor: scoutA, key: keys[0] });
    await add({ person: scoutA, actor: scoutA, key: keys[1] });
    await sb.rpc('meeting_set_pick_order', { p_entry: meetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_keys: [keys[1], keys[0]], p_carry: [] });
    await add({ person: scoutA, actor: scoutA, key: keys[2] });
    const order = (await picksOf(scoutA)).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).map((p) => p.meeting_topics.topic_key);
    expect(order).toEqual([keys[1], keys[0], keys[2]]);
  });

  it('Scout_RemovingAPick_RenumbersTheOrder', async () => {
    for (const k of keys.slice(0, 3)) await add({ person: scoutA, actor: scoutA, key: k });
    await sb.rpc('meeting_set_pick_order', { p_entry: meetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_keys: keys.slice(0, 3), p_carry: [] });
    await sb.rpc('meeting_remove_pick', { p_entry: meetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_topic_key: keys[0], p_carry: [] });
    expect((await picksOf(scoutA)).map((p) => p.priority).sort()).toEqual([1, 2]);
  });

  it('Scout_IsRefusedAnUnknownRequirement', async () => {
    expect((await add({ person: scoutA, actor: scoutA, key: 'tenderfoot-zz99' })).error?.message).toBe("That isn't something you can pick for this meeting.");
  });

  it('Parent_CanPickForHouseholdScout', async () => {
    const { error } = await add({ person: scoutA, actor: parent, key: keys[0] });
    expect([error, (await picksOf(scoutA)).map((p) => p.entered_by_person_id)]).toEqual([null, [parent]]);
  });

  it('Parent_CannotPickForOtherFamilysScout', async () => {
    const { error } = await add({ person: scoutB, actor: parent, key: keys[0] });
    expect([error?.message, (await picksOf(scoutB)).length]).toEqual(['You can only pick for yourself or the scouts in your household.', 0]);
  });

  it('Scout_CannotPickForAnotherScout', async () => {
    expect((await add({ person: scoutB, actor: scoutA, key: keys[0] })).error?.message).toBe('You can only pick for yourself or the scouts in your household.');
  });

  it('Leader_CanPickOnBehalfOfAnyScout', async () => {
    const { error } = await add({ person: scoutB, actor: parent, key: keys[0], leader: true });
    expect([error, (await picksOf(scoutB)).length]).toEqual([null, 1]);
  });

  it('Board_RefusesPicks_WhenMeetingClosed', async () => {
    const closed = await add({ entry: noMeetingEntry, person: scoutA, actor: scoutA, key: keys[0] });
    const nonMeeting = await add({ entry: nonMeetingEntry, person: scoutA, actor: scoutA, key: keys[0] });
    expect([closed.error?.message, nonMeeting.error?.message]).toEqual(['There are no picks for this meeting.', 'There are no picks for this meeting.']);
  });

  it('Board_RefusesIntent_WhenMeetingClosed', async () => {
    const { error } = await sb.rpc('meeting_set_intent', { p_entry: nonMeetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_intent: 'coming' });
    expect(error?.message).toBe('There are no sign-ups for this meeting.');
  });

  it('Scout_PickWhileNotComing_AtSundaysMeeting_MarksComing', async () => {
    await sb.rpc('meeting_set_intent', { p_entry: meetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_intent: 'not_coming' });
    await add({ person: scoutA, actor: scoutA, key: keys[0], markComing: true });
    const { data } = await sb.from('meeting_intents').select('intent').eq('calendar_entry_id', meetingEntry).eq('person_id', scoutA).single();
    expect(data!.intent).toBe('coming');
  });

  it('Scout_PickWhileNotComing_Later_StaysNotComing', async () => {
    await sb.rpc('meeting_set_intent', { p_entry: meetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_intent: 'not_coming' });
    await add({ person: scoutA, actor: scoutA, key: keys[0], later: true });
    const { data } = await sb.from('meeting_intents').select('intent').eq('calendar_entry_id', meetingEntry).eq('person_id', scoutA).single();
    expect([data!.intent, (await picksOf(scoutA)).map((p) => p.later)]).toEqual(['not_coming', [true]]);
  });
});

describe('carry-forward on first write', () => {
  const carried = () => [
    { topic_key: keys[0], first_asked_on: '2090-12-03', priority: 2, note: null, entered_by_person_id: parent },
    { topic_key: keys[1], first_asked_on: '2090-12-10', priority: null, note: null, entered_by_person_id: scoutA }
  ];

  it('Scout_CarriedPicksKeepFirstAskedOn_WhenTheNewBoardIsFirstTouched', async () => {
    await add({ entry: otherEntry, person: scoutA, actor: scoutA, key: keys[2], carry: carried() });
    const rows = (await picksOf(scoutA, otherEntry)).sort((a, b) => a.meeting_topics.topic_key.localeCompare(b.meeting_topics.topic_key));
    const byKey = new Map(rows.map((r) => [r.meeting_topics.topic_key, r]));
    expect([rows.length, byKey.get(keys[0])!.first_asked_on, byKey.get(keys[1])!.first_asked_on, byKey.get(keys[0])!.priority, rows.every((r) => !r.later)]).toEqual([3, '2090-12-03', '2090-12-10', 1, true]);
  });

  it('Scout_CarryIsIgnored_OnceTheBoardHasTheirList', async () => {
    await add({ entry: otherEntry, person: scoutA, actor: scoutA, key: keys[2] });
    await add({ entry: otherEntry, person: scoutA, actor: scoutA, key: keys[3], carry: carried() });
    expect((await picksOf(scoutA, otherEntry)).length).toBe(2);
  });

  it('Scout_TakingOffEveryCarriedPick_LeavesAnEmptyList', async () => {
    await sb.rpc('meeting_remove_pick', { p_entry: otherEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_topic_key: keys[0], p_carry: carried() });
    await sb.rpc('meeting_remove_pick', { p_entry: otherEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_topic_key: keys[1], p_carry: carried() });
    const { count } = await sb.from('meeting_pick_lists').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', otherEntry).eq('person_id', scoutA);
    expect([(await picksOf(scoutA, otherEntry)).length, count]).toEqual([0, 1]);
  });
});

describe('board stamp', () => {
  it('BoardStamp_Changes_WhenAPickIsRemoved', async () => {
    await add({ person: scoutA, actor: scoutA, key: keys[0] });
    const before = (await sb.rpc('meeting_board_stamp', { p_entry: meetingEntry })).data;
    await sb.rpc('meeting_remove_pick', { p_entry: meetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_topic_key: keys[0], p_carry: [] });
    expect((await sb.rpc('meeting_board_stamp', { p_entry: meetingEntry })).data).not.toBe(before);
  });
});

describe('merge_people', () => {
  it('MergePeople_MovesBoardPicksAndAnswers_ToTheSurvivor', async () => {
    const loser = await person('Loser');
    const survivor = await person('Survivor');
    const loserScout = `vitest-mbr-${loser}`;
    await sb.from('scouts').insert({ id: loserScout, first_name: TEST_PREFIX, last_name: 'Loser', display_name: `${TEST_PREFIX} MBR Loser`, person_id: loser, active: true, current_rank: 'scout' });
    scoutIds.push(loserScout);
    await add({ person: loser, actor: loser, key: keys[0] });
    await sb.rpc('meeting_set_intent', { p_entry: meetingEntry, p_person: loser, p_actor: loser, p_leader: false, p_intent: 'coming' });
    const { error } = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (error) throw new Error(error.message);
    const [{ count: lists }, { count: intents }] = await Promise.all([
      sb.from('meeting_pick_lists').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meetingEntry).eq('person_id', survivor),
      sb.from('meeting_intents').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meetingEntry).eq('person_id', survivor)
    ]);
    expect([(await picksOf(survivor)).map((p) => [p.meeting_topics.topic_key, p.entered_by_person_id]), (await picksOf(loser)).length, lists, intents]).toEqual([[[keys[0], survivor]], 0, 1, 1]);
  });
});

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}

describe('qa-lead follow-ups', () => {
  it('Board_RefusesPicksAndAnswers_WhenMeetingHasPassed', async () => {
    const pick = await add({ entry: pastEntry, person: scoutA, actor: scoutA, key: keys[0] });
    const answer = await sb.rpc('meeting_set_intent', { p_entry: pastEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_intent: 'coming' });
    const remove = await sb.rpc('meeting_remove_pick', { p_entry: pastEntry, p_person: scoutA, p_actor: scoutA, p_leader: true, p_topic_key: keys[0], p_carry: [] });
    expect([pick.error?.message, answer.error?.message, remove.error?.message]).toEqual(Array(3).fill('That meeting has passed.'));
  });

  it('Scout_ParallelAdds_LeaveAtMostFivePicks', async () => {
    await Promise.all(keys.slice(0, 8).map((k) => add({ person: scoutA, actor: scoutA, key: k })));
    expect((await picksOf(scoutA)).length).toBe(5);
  });

  it('Board_RpcsAndTables_AreClosedToAnonAndAuthenticated', () => {
    const fns = [
      'meeting_board_mode(bigint)',
      '_meeting_may_act_for(bigint,bigint,boolean)',
      '_meeting_topic_id(bigint,text)',
      '_meeting_pick_guard(bigint,bigint,bigint,boolean,jsonb,text)',
      'meeting_add_pick(bigint,bigint,bigint,boolean,text,boolean,boolean,jsonb)',
      'meeting_remove_pick(bigint,bigint,bigint,boolean,text,jsonb)',
      'meeting_set_pick_order(bigint,bigint,bigint,boolean,text[],jsonb)',
      'meeting_set_pick_note(bigint,bigint,bigint,boolean,text,text,jsonb)',
      'meeting_set_intent(bigint,bigint,bigint,boolean,text)',
      'meeting_board_stamp(bigint)'
    ];
    const tables = ['meeting_boards', 'meeting_topics', 'meeting_pick_lists', 'meeting_topic_picks', 'meeting_intents'];
    const checks = ['anon', 'authenticated'].flatMap((role) => [
      ...fns.map((f) => `has_function_privilege('${role}', 'public.${f}', 'execute')`),
      ...tables.map((t) => `has_table_privilege('${role}', 'public.${t}', 'select')`)
    ]);
    expect(localSql(`select bool_or(x) from (values ${checks.map((c) => `(${c})`).join(', ')}) v(x)`)).toBe('f');
  });

  it('Parent_CannotAnswerForOtherFamilysScout_AtRpcLevel', async () => {
    const { error } = await sb.rpc('meeting_set_intent', { p_entry: meetingEntry, p_person: scoutB, p_actor: parent, p_leader: false, p_intent: 'coming' });
    expect(error?.message).toBe('You can only answer for yourself or the scouts in your household.');
  });

  it('InactiveScoutSibling_CannotPickForHouseholdScout', async () => {
    const sib = await person('Sibling');
    const sibId = `vitest-mbr-${sib}`;
    const { error: sibErr } = await sb.from('scouts').insert({ id: sibId, first_name: TEST_PREFIX, last_name: 'Sibling', display_name: `${TEST_PREFIX} MBR Sibling`, person_id: sib, active: false, inactive_reason: 'dropped_out', current_rank: 'scout' });
    if (sibErr) throw new Error(sibErr.message);
    scoutIds.push(sibId);
    await sb.from('household_members').insert({ household_id: households[0], person_id: sib });
    expect((await add({ person: scoutA, actor: sib, key: keys[0] })).error?.message).toBe('You can only pick for yourself or the scouts in your household.');
  });

  it('InactivePersonAdult_CannotPickForHouseholdScout', async () => {
    const gone = await person('Inactive adult');
    await sb.from('people').update({ active: false }).eq('id', gone);
    await sb.from('household_members').insert({ household_id: households[0], person_id: gone });
    expect((await add({ person: scoutA, actor: gone, key: keys[0] })).error?.message).toBe('You can only pick for yourself or the scouts in your household.');
  });

  it('Board_AllowsRemoveAndReorder_OnAClosedBoard_ButNotAdd', async () => {
    await add({ person: scoutA, actor: scoutA, key: keys[0] });
    await add({ person: scoutA, actor: scoutA, key: keys[1] });
    await sb.from('calendar_entries').update({ title: `No Troop Meeting ${TEST_PREFIX}` }).eq('id', meetingEntry);
    const order = await sb.rpc('meeting_set_pick_order', { p_entry: meetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_keys: [keys[1], keys[0]], p_carry: [] });
    const remove = await sb.rpc('meeting_remove_pick', { p_entry: meetingEntry, p_person: scoutA, p_actor: scoutA, p_leader: false, p_topic_key: keys[0], p_carry: [] });
    const added = await add({ person: scoutA, actor: scoutA, key: keys[2] });
    await sb.from('calendar_entries').update({ title: `Troop Meeting ${TEST_PREFIX}` }).eq('id', meetingEntry);
    expect([order.error, remove.error, added.error?.message, (await picksOf(scoutA)).map((p) => p.meeting_topics.topic_key)]).toEqual([
      null,
      null,
      'There are no picks for this meeting.',
      [keys[1]]
    ]);
  });
});
