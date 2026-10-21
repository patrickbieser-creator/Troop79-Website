import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting board, Phase 2 (Plans/Meeting-Requests-And-Teaching-Offers.md): the teacher side's database half. The RPCs
 * hold the two-commitment cap (a broad skill offer counts as one), who may act (self or a leader), who may teach (an
 * adult or an active scout, never an adults-only skill for a scout), standing offers across dates (a row per date,
 * all-or-nothing), and closed and past boards. Real local database. Every row is test-owned: fixture entries are dated
 * 2091 and deleted by id (their topics, teachers and offers cascade), fixture people are deleted by id.
 */
const sb = adminClient();

let meeting1 = 0; // 2091-02-04
let meeting2 = 0; // 2091-02-11
let meeting3 = 0; // 2091-02-18
let campout = 0;
let past = 0;
const people: number[] = [];
const scoutIds: string[] = [];
const households: number[] = [];
let parent = 0; // an adult with no leader record
let spouse = 0; // same household
let other = 0; // another adult
let junior = 0; // a First Class scout
let scoutKid = 0; // the parent's scout
let keys: string[] = [];
let adultOnlyKey = '';
let youthSkill = '';
let adultSkill = '';

async function entry(date: string, category = 'Troop Meeting', title = 'Troop Meeting'): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category, title: `${title} ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MBT ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mbt-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} MBT ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}

beforeAll(async () => {
  meeting1 = await entry('2091-02-04');
  meeting2 = await entry('2091-02-11');
  meeting3 = await entry('2091-02-18');
  campout = await entry('2091-02-07', 'Campout / Overnight', 'Campout');
  past = await entry('2020-02-02');
  parent = await person('Parent');
  spouse = await person('Spouse');
  other = await person('Other');
  junior = await scout('Junior', 'first-class');
  scoutKid = await scout('Kid', 'scout');
  const { data: hh } = await sb.from('households').insert({ label: `${TEST_PREFIX} MBT family` }).select('id').single();
  households.push(hh!.id);
  await sb.from('household_members').insert([
    { household_id: hh!.id, person_id: parent },
    { household_id: hh!.id, person_id: spouse },
    { household_id: hh!.id, person_id: scoutKid }
  ]);
  const { data: skills } = await sb.from('skills').select('id, youth_teachable').order('sort_order');
  const list = (skills ?? []) as { id: string; youth_teachable: boolean }[];
  youthSkill = list.find((s) => s.youth_teachable)!.id;
  adultSkill = list.find((s) => !s.youth_teachable)!.id;
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code, skill_id').is('parent_id', null).in('rank_id', ['tenderfoot', 'second-class']).order('rank_id', { ascending: false }).order('sort_order');
  const rows = (reqs ?? []) as { rank_id: string; code: string; skill_id: string | null }[];
  const adultOnly = new Set(list.filter((s) => !s.youth_teachable).map((s) => s.id));
  keys = rows.filter((r) => !r.skill_id || !adultOnly.has(r.skill_id)).slice(0, 6).map((r) => `${r.rank_id}-${r.code}`);
  const ao = rows.find((r) => r.skill_id && adultOnly.has(r.skill_id));
  if (keys.length < 6 || !ao) throw new Error('fixture: need six youth-teachable requirements and one adults-only one');
  adultOnlyKey = `${ao.rank_id}-${ao.code}`;
});

afterEach(async () => {
  for (const e of [meeting1, meeting2, meeting3, campout, past]) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_teaching_offers').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_boards').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
  }
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', [meeting1, meeting2, meeting3, campout, past]);
  if (households.length) await sb.from('households').delete().in('id', households);
  if (scoutIds.length) await sb.from('scouts').delete().in('id', scoutIds);
  if (people.length) await sb.from('people').delete().in('id', people);
});

const teach = (o: { entries?: number[]; person: number; actor: number; key?: string | null; title?: string; leader?: boolean; note?: string }) =>
  sb.rpc('meeting_teach_topic', {
    p_entries: o.entries ?? [meeting1],
    p_person: o.person,
    p_actor: o.actor,
    p_leader: o.leader ?? false,
    p_topic_key: o.key === undefined ? keys[0] : o.key,
    p_title: o.title ?? null,
    p_note: o.note ?? null
  });
const offer = (o: { entries?: number[]; person: number; actor: number; skill?: string; leader?: boolean; note?: string }) =>
  sb.rpc('meeting_offer_skill', {
    p_entries: o.entries ?? [meeting1],
    p_person: o.person,
    p_actor: o.actor,
    p_leader: o.leader ?? false,
    p_skill_id: o.skill ?? youthSkill,
    p_note: o.note ?? null
  });
const teachingOf = async (personId: number, entryId = meeting1) =>
  ((await sb.from('meeting_topic_teachers').select('entered_by_person_id, note, meeting_topics(topic_key, kind, title)').eq('calendar_entry_id', entryId).eq('person_id', personId)).data ?? []) as unknown as {
    entered_by_person_id: number | null;
    note: string | null;
    meeting_topics: { topic_key: string; kind: string; title: string | null };
  }[];
const offersOf = async (personId: number) =>
  ((await sb.from('meeting_teaching_offers').select('calendar_entry_id, skill_id').eq('person_id', personId).in('calendar_entry_id', [meeting1, meeting2, meeting3])).data ?? []) as { calendar_entry_id: number; skill_id: string }[];

describe('commitments', () => {
  it('Parent_CanCommitToTeachTopic', async () => {
    const { error } = await teach({ person: parent, actor: parent, note: 'bring rope' });
    expect([error, (await teachingOf(parent)).map((t) => [t.meeting_topics.topic_key, t.entered_by_person_id, t.note])]).toEqual([null, [[keys[0], parent, 'bring rope']]]);
  });

  it('Adult_CommittingTwice_ToTheSameTopic_IsOneRow', async () => {
    await teach({ person: parent, actor: parent });
    const { error } = await teach({ person: parent, actor: parent });
    expect([error, (await teachingOf(parent)).length]).toEqual([null, 1]);
  });

  // No teaching cap for adults (Plans/Meeting-Planner-II.md, Decision 7): adults decide for themselves.
  it('Adult_CanTakeAThirdCommitment', async () => {
    for (const k of keys.slice(0, 3)) await teach({ person: parent, actor: parent, key: k });
    expect((await teachingOf(parent)).length).toBe(3);
  });

  it('Adult_CanAddASkillOffer_OnTopOfTwoCommitments', async () => {
    await teach({ person: parent, actor: parent, key: keys[0] });
    await teach({ person: parent, actor: parent, key: keys[1] });
    expect((await offer({ person: parent, actor: parent })).error).toBeNull();
  });

  it('Adult_ParallelCommits_AllLand', async () => {
    await Promise.all(keys.slice(0, 6).map((k) => teach({ person: other, actor: other, key: k })));
    expect((await teachingOf(other)).length).toBe(6);
  });

  it('Adult_CanCommitToAMeritBadge', async () => {
    const { data: mb } = await sb.from('merit_badges').select('id').order('id').limit(1).single();
    const { error } = await teach({ person: parent, actor: parent, key: `mb:${mb!.id}` });
    expect([error, (await teachingOf(parent)).map((t) => t.meeting_topics.kind)]).toEqual([null, ['merit_badge']]);
  });
});

describe('standing offers across dates', () => {
  it('Adult_MultiDateSkillOffer_CreatesARowPerDate', async () => {
    const { error } = await offer({ entries: [meeting2, meeting1], person: parent, actor: parent });
    expect([error, (await offersOf(parent)).map((o) => o.calendar_entry_id).sort()]).toEqual([null, [meeting1, meeting2].sort()]);
  });

  it('Adult_MultiDateRequirementOffer_CreatesARowPerDate', async () => {
    await teach({ entries: [meeting1, meeting2, meeting3], person: parent, actor: parent, key: keys[3] });
    const counts = await Promise.all([meeting1, meeting2, meeting3].map(async (e) => (await teachingOf(parent, e)).map((t) => t.meeting_topics.topic_key)));
    expect(counts).toEqual([[keys[3]], [keys[3]], [keys[3]]]);
  });

  it('Adult_FreeformOffer_CreatesAnFfTopicPerDate', async () => {
    await teach({ entries: [meeting1, meeting2], person: parent, actor: parent, key: null, title: '  Knife   Sharpening ' });
    const [a, b] = await Promise.all([teachingOf(parent, meeting1), teachingOf(parent, meeting2)]);
    expect([...a, ...b].map((t) => [t.meeting_topics.topic_key, t.meeting_topics.kind, t.meeting_topics.title])).toEqual([
      ['ff:knife sharpening', 'freeform', 'Knife Sharpening'],
      ['ff:knife sharpening', 'freeform', 'Knife Sharpening']
    ]);
  });

  it('Adult_MultiDateOffer_LandsEverywhere_WhenOneDateAlreadyHasTwo', async () => {
    await teach({ entries: [meeting2], person: parent, actor: parent, key: keys[0] });
    await teach({ entries: [meeting2], person: parent, actor: parent, key: keys[1] });
    const { error } = await offer({ entries: [meeting1, meeting2], person: parent, actor: parent });
    expect([error, (await offersOf(parent)).length]).toEqual([null, 2]);
  });

  it('Adult_UntaughtFreeformTopic_GoesAway_WhenTheLastTeacherLeaves', async () => {
    await teach({ person: parent, actor: parent, key: null, title: 'Knot tying relay' });
    await sb.rpc('meeting_unteach_topic', { p_entry: meeting1, p_person: parent, p_actor: parent, p_leader: false, p_topic_key: 'ff:knot tying relay' });
    const { count } = await sb.from('meeting_topics').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting1).eq('topic_key', 'ff:knot tying relay');
    expect(count).toBe(0);
  });
});

describe('who may teach', () => {
  it('Parent_CannotCommitForAnotherAdultInTheHousehold', async () => {
    expect((await teach({ person: spouse, actor: parent })).error?.message).toBe('You can only sign up to teach for yourself.');
  });

  it('Parent_CannotCommitForTheirScout', async () => {
    expect((await teach({ person: scoutKid, actor: parent })).error?.message).toBe('You can only sign up to teach for yourself.');
  });

  it('Adult_CannotOfferForAnotherFamilysAdult', async () => {
    expect((await offer({ person: other, actor: parent })).error?.message).toBe('You can only sign up to teach for yourself.');
  });

  it('Leader_CanCommitOnBehalfOfAnyone', async () => {
    const { error } = await teach({ person: other, actor: parent, leader: true });
    expect([error, (await teachingOf(other)).map((t) => t.entered_by_person_id)]).toEqual([null, [parent]]);
  });

  it('JuniorLeader_CanCommitToAYouthTeachableTopic', async () => {
    expect((await teach({ person: junior, actor: junior, key: keys[0] })).error).toBeNull();
  });

  it('JuniorLeader_CanCommitToAMeritBadge_Flagged', async () => {
    const { data: mb } = await sb.from('merit_badges').select('id').order('id').limit(1).single();
    expect((await teach({ person: junior, actor: junior, key: `mb:${mb!.id}` })).error).toBeNull();
  });

  it('JuniorLeader_IsRefusedAdultOnlyTopic_AtRpcLevel', async () => {
    expect((await teach({ person: junior, actor: junior, key: adultOnlyKey })).error?.message).toBe('Junior Leaders can’t teach that: it’s adults only.');
  });

  it('JuniorLeader_IsRefusedAdultOnlySkillOffer_AtRpcLevel', async () => {
    expect((await offer({ person: junior, actor: junior, skill: adultSkill })).error?.message).toBe('Junior Leaders can’t teach that: it’s adults only.');
  });

  it('InactivePerson_CannotTeach', async () => {
    const gone = await person('Gone');
    await sb.from('people').update({ active: false }).eq('id', gone);
    expect((await teach({ person: gone, actor: gone })).error?.message).toBe('Teaching is for adults and Junior Leaders.');
  });
});

describe('qa-lead follow-ups', () => {
  it('Board_RefusesTeaching_OnAMeritBadgeNight', async () => {
    await sb.from('meeting_boards').insert({ calendar_entry_id: meeting1, board_mode: 'merit_badge' });
    expect((await teach({ person: parent, actor: parent })).error?.message).toBe('There’s no teaching sign-up for this meeting.');
  });

  it('Guest_CannotTeach', async () => {
    const guest = await person('Guest');
    await sb.from('people').update({ guest_host_household_id: households[0] }).eq('id', guest);
    expect((await teach({ person: guest, actor: guest })).error?.message).toBe('Teaching is for adults and Junior Leaders.');
  });

  it('Adult_CannotRemoveSomeoneElsesCommitment', async () => {
    await teach({ person: other, actor: other });
    const r = await sb.rpc('meeting_unteach_topic', { p_entry: meeting1, p_person: other, p_actor: parent, p_leader: false, p_topic_key: keys[0] });
    const w = await sb.rpc('meeting_withdraw_skill_offer', { p_entry: meeting1, p_person: other, p_actor: parent, p_leader: false, p_skill_id: youthSkill });
    expect([r.error?.message, w.error?.message, (await teachingOf(other)).length]).toEqual(['You can only sign up to teach for yourself.', 'You can only sign up to teach for yourself.', 1]);
  });

  it('DeactivatedTeacher_CanStillRemoveTheirCommitment', async () => {
    const leaving = await person('Leaving');
    await teach({ person: leaving, actor: leaving });
    await offer({ person: leaving, actor: leaving });
    await sb.from('people').update({ active: false }).eq('id', leaving);
    const r = await sb.rpc('meeting_unteach_topic', { p_entry: meeting1, p_person: leaving, p_actor: leaving, p_leader: false, p_topic_key: keys[0] });
    const w = await sb.rpc('meeting_withdraw_skill_offer', { p_entry: meeting1, p_person: leaving, p_actor: leaving, p_leader: false, p_skill_id: youthSkill });
    expect([r.error, w.error, (await teachingOf(leaving)).length, (await offersOf(leaving)).length]).toEqual([null, null, 0, 0]);
  });

  it('FreeformTopic_StaysWhenAScoutPickedIt_AfterTheTeacherLeaves', async () => {
    await teach({ person: parent, actor: parent, key: null, title: 'Knife sharpening' });
    const { error } = await sb.rpc('meeting_add_pick', { p_entry: meeting1, p_person: scoutKid, p_actor: scoutKid, p_leader: false, p_topic_key: 'ff:knife sharpening', p_later: false, p_mark_coming: false, p_carry: [] });
    if (error) throw new Error(error.message);
    await sb.rpc('meeting_unteach_topic', { p_entry: meeting1, p_person: parent, p_actor: parent, p_leader: false, p_topic_key: 'ff:knife sharpening' });
    const { count } = await sb.from('meeting_topic_picks').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting1).eq('person_id', scoutKid);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', meeting1);
    expect(count).toBe(1);
  });
});

describe('board state', () => {
  it('Board_RefusesTeaching_WhenMeetingClosed', async () => {
    await sb.from('meeting_boards').insert({ calendar_entry_id: meeting1, board_mode: 'closed' });
    const [closed, nonMeeting] = await Promise.all([teach({ person: parent, actor: parent }), offer({ entries: [campout], person: parent, actor: parent })]);
    expect([closed.error?.message, nonMeeting.error?.message]).toEqual(['There’s no teaching sign-up for this meeting.', 'There’s no teaching sign-up for this meeting.']);
  });

  it('Board_RefusesTeaching_WhenMeetingHasPassed', async () => {
    const [t, o, r] = await Promise.all([
      teach({ entries: [past], person: parent, actor: parent }),
      offer({ entries: [past], person: parent, actor: parent }),
      sb.rpc('meeting_unteach_topic', { p_entry: past, p_person: parent, p_actor: parent, p_leader: true, p_topic_key: keys[0] })
    ]);
    expect([t.error?.message, o.error?.message, r.error?.message]).toEqual(Array(3).fill('That meeting has passed.'));
  });

  it('BoardStamp_Changes_WhenSomeoneCommits', async () => {
    const before = (await sb.rpc('meeting_board_stamp', { p_entry: meeting1 })).data;
    await offer({ person: parent, actor: parent });
    expect((await sb.rpc('meeting_board_stamp', { p_entry: meeting1 })).data).not.toBe(before);
  });

  it('MergePeople_MovesCommitmentsAndOffers_ToTheSurvivor', async () => {
    const loser = await person('Loser');
    const survivor = await person('Survivor');
    await teach({ person: loser, actor: loser });
    await offer({ person: loser, actor: loser });
    const { error } = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (error) throw new Error(error.message);
    expect([
      (await teachingOf(survivor)).map((t) => [t.meeting_topics.topic_key, t.entered_by_person_id]),
      (await offersOf(survivor)).length,
      (await teachingOf(loser)).length,
      (await offersOf(loser)).length
    ]).toEqual([[[keys[0], survivor]], 1, 0, 0]);
  });
});

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}

describe('posture', () => {
  it('TeacherRpcsAndTables_AreClosedToAnonAndAuthenticated', () => {
    const fns = [
      '_meeting_teacher_kind(bigint)',
      '_meeting_teach_count(bigint,bigint)',
      '_meeting_freeform_topic_id(bigint,text)',
      '_meeting_teach_guard(bigint,bigint,bigint,boolean,text)',
      'meeting_teach_topic(bigint[],bigint,bigint,boolean,text,text,text)',
      'meeting_unteach_topic(bigint,bigint,bigint,boolean,text)',
      'meeting_offer_skill(bigint[],bigint,bigint,boolean,text,text)',
      'meeting_withdraw_skill_offer(bigint,bigint,bigint,boolean,text)',
      'meeting_board_stamp(bigint)'
    ];
    const tables = ['meeting_topic_teachers', 'meeting_teaching_offers'];
    const checks = ['anon', 'authenticated'].flatMap((role) => [
      ...fns.map((f) => `has_function_privilege('${role}', 'public.${f}', 'execute')`),
      ...tables.flatMap((t) => ['select', 'insert', 'update', 'delete'].map((p) => `has_table_privilege('${role}', 'public.${t}', '${p}')`))
    ]);
    const rls = localSql(`select bool_and(relrowsecurity) from pg_class where oid in ('public.meeting_topic_teachers'::regclass, 'public.meeting_teaching_offers'::regclass)`);
    expect([localSql(`select bool_or(x) from (values ${checks.map((c) => `(${c})`).join(', ')}) v(x)`), rls]).toEqual(['f', 't']);
  });
});
