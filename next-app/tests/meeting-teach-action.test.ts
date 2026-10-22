import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { NOT_A_TEACHER } from '../src/lib/can-offer-to-teach';

/**
 * /member/meeting teach section (Phase 2): the server actions act only for the verified session (self, or a leader on
 * behalf), only for someone who may teach (an adult, or a Junior Leader by canOfferToTeach); standing offers post a row
 * per date and mark problems by field; the loaders give scouts their "Teacher: Mr. Vest" tag and admin home its
 * "requests with no teacher" count. Real local database; the session and the admin actor are mocked. Fixture meetings
 * are dated 2093 so they never collide with the real calendar or another file's fixtures; every row is deleted by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  session: null as null | { personId: number; subjectKind: 'adult' | 'scout'; displayName: string },
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => state.session }));
vi.mock('@/lib/identity-session', () => ({ isEpochCurrent: async () => true }));
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => state.actor,
  actorHas: (a: { capabilities: Set<string> } | null, c: string) => a?.capabilities.has(c) ?? false
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const actions = () => import('../src/app/(public)/member/meeting/teach-actions');
const supply = () => import('../src/lib/meeting-board-supply');
const board = () => import('../src/lib/meeting-board');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
let meeting1 = 0; // 2093-03-01
let meeting2 = 0; // 2093-03-08
let parent = 0; // an adult with no leader record, gender M, last name Vestry
let other = 0;
let junior = 0; // First Class
let young = 0; // a Scout-rank scout (not a Junior Leader)
let knotKey = '';
let knotSkill = '';

async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string, o: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MTA ${label}`, first_name: `${TEST_PREFIX} MTA`, last_name: label, ...o }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mta-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} MTA`, last_name: label, display_name: `${TEST_PREFIX} MTA ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}

beforeAll(async () => {
  meeting1 = await entry('2093-03-01');
  meeting2 = await entry('2093-03-08');
  parent = await person('Vestry', { gender: 'M' });
  other = await person('Other');
  junior = await scout('Junior', 'first-class');
  young = await scout('Young', 'scout');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code, skill_id, skills!inner(youth_teachable)').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').eq('skills.youth_teachable', true).order('sort_order');
  const r = ((reqs ?? []) as unknown as { rank_id: string; code: string; skill_id: string }[]).find((x) => x.code !== '9' && x.code !== '10');
  if (!r) throw new Error('fixture: need a youth-teachable Tenderfoot requirement');
  knotKey = `${r.rank_id}-${r.code}`;
  knotSkill = r.skill_id;
});

afterEach(async () => {
  for (const e of entries) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_teaching_offers').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
  }
  await sb.from('teaching_skill_changes').delete().in('person_id', people);
  await sb.from('teaching_skills').delete().in('person_id', people);
  state.session = null;
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asAdult = (pid: number) => (state.session = { personId: pid, subjectKind: 'adult', displayName: 'Adult' });
const asScout = (pid: number) => (state.session = { personId: pid, subjectKind: 'scout', displayName: 'Scout' });
const pickFor = async (scoutPerson: number, key: string, entryId = meeting1) => {
  const { error } = await sb.rpc('meeting_add_pick', { p_entry: entryId, p_person: scoutPerson, p_actor: scoutPerson, p_leader: false, p_topic_key: key, p_later: false, p_mark_coming: false, p_carry: [] });
  if (error) throw new Error(error.message);
};
const teachBoardFor = async (entryId: number, include: number[] = []) => {
  const { loadAdvancementCatalog } = await import('../src/lib/advancement-catalog');
  const catalog = await loadAdvancementCatalog();
  const meeting = (await (await board()).loadMeetingById(sb, entryId))!;
  const rows = await (await board()).loadBoardState(sb, meeting, catalog);
  return { catalog, meeting, rows, teach: await (await supply()).loadTeachBoard(sb, meeting, catalog, rows, include) };
};

describe('who may teach', () => {
  it('Parent_CanCommitToTeachTopic', async () => {
    asAdult(parent);
    const r = await (await actions()).meetingTeachAction({ entryId: meeting1, personId: parent, key: knotKey });
    expect([r.ok, r.ok ? r.view.items.map((i) => i.key) : r.error]).toEqual([true, [knotKey]]);
  });

  it('Adult_CannotCommitForSomeoneElse', async () => {
    asAdult(parent);
    const r = await (await actions()).meetingTeachAction({ entryId: meeting1, personId: other, key: knotKey });
    expect(r).toEqual({ ok: false, error: 'You can only sign up to teach for yourself.' });
  });

  it('Scout_WhoIsNotAJuniorLeader_CannotTeach', async () => {
    asScout(young);
    const r = await (await actions()).meetingTeachAction({ entryId: meeting1, personId: young, key: knotKey });
    expect(r).toEqual({ ok: false, error: NOT_A_TEACHER });
  });

  it('JuniorLeader_CanCommitToTeach', async () => {
    asScout(junior);
    const r = await (await actions()).meetingTeachAction({ entryId: meeting1, personId: junior, key: knotKey });
    expect([r.ok, r.ok && r.view.kind]).toEqual([true, 'junior']);
  });

  it('Leader_CanCommitOnBehalf_OfAnAdult', async () => {
    asAdult(parent);
    state.actor = { personId: parent, subjectKind: 'adult', capabilities: new Set(['meeting_plan.use']) };
    const r = await (await actions()).meetingTeachAction({ entryId: meeting1, personId: other, key: knotKey, onBehalf: true });
    const { data } = await sb.from('meeting_topic_teachers').select('entered_by_person_id').eq('calendar_entry_id', meeting1).eq('person_id', other);
    expect([r.ok, (data ?? []).map((d) => d.entered_by_person_id)]).toEqual([true, [parent]]);
  });

  it('NonLeader_CannotUseOnBehalf', async () => {
    asAdult(parent);
    state.actor = { personId: parent, subjectKind: 'adult', capabilities: new Set() };
    const r = await (await actions()).meetingTeachAction({ entryId: meeting1, personId: other, key: knotKey, onBehalf: true });
    expect(r.ok).toBe(false);
  });

  it('Adult_SaysNotSureYet_ThroughTheTeachSection', async () => {
    asAdult(parent);
    const r = await (await actions()).meetingTeacherIntentAction({ entryId: meeting1, personId: parent, intent: 'undecided' });
    expect([r.ok, r.ok && r.view.intent]).toEqual([true, 'undecided']);
  });
});

describe('the 2-cap through the actions', () => {
  it('Adult_CanTakeAThirdCommitment', async () => {
    asAdult(parent);
    const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'second-class').order('sort_order').limit(2);
    const [a, b] = ((reqs ?? []) as { rank_id: string; code: string }[]).map((x) => `${x.rank_id}-${x.code}`);
    const act = await actions();
    await act.meetingTeachAction({ entryId: meeting1, personId: parent, key: a });
    await act.meetingTeachAction({ entryId: meeting1, personId: parent, key: b });
    const third = await act.meetingTeachAction({ entryId: meeting1, personId: parent, key: knotKey });
    expect(third.ok && third.view.count).toBe(3);
  });
});

describe('Offer something', () => {
  it('Adult_MultiDateSkillOffer_CreatesARowPerDate', async () => {
    asAdult(parent);
    await (await import('../src/lib/teaching-skills')).saveTeachingSkills(sb, parent, [knotSkill], 'member', { personId: parent, label: null });
    const r = await (await actions()).meetingPostOfferAction({ entryId: meeting1, personId: parent, what: { type: 'skill', skillId: knotSkill }, entryIds: [meeting1, meeting2], note: 'Bring rope' });
    const { data } = await sb.from('meeting_teaching_offers').select('calendar_entry_id, note').eq('person_id', parent);
    expect([r.ok, ((data ?? []) as { calendar_entry_id: number; note: string }[]).map((d) => [d.calendar_entry_id, d.note]).sort()]).toEqual([
      true,
      [
        [meeting1, 'Bring rope'],
        [meeting2, 'Bring rope']
      ].sort()
    ]);
  });

  it('Adult_SkillOffer_ShowsOtherDates_AndCountsAsOne', async () => {
    asAdult(parent);
    await (await import('../src/lib/teaching-skills')).saveTeachingSkills(sb, parent, [knotSkill], 'member', { personId: parent, label: null });
    const r = await (await actions()).meetingPostOfferAction({ entryId: meeting1, personId: parent, what: { type: 'skill', skillId: knotSkill }, entryIds: [meeting1, meeting2] });
    expect(r.ok && [r.view.count, r.view.items[0].alsoOn]).toEqual([1, ['Mar 8']]);
  });

  it('Adult_SkillOffer_NeedsTheSkillOnFile', async () => {
    asAdult(parent);
    const r = await (await actions()).meetingPostOfferAction({ entryId: meeting1, personId: parent, what: { type: 'skill', skillId: knotSkill }, entryIds: [meeting1] });
    expect(r).toEqual({ ok: false, error: 'Add it to What I can teach first.', field: 'what' });
  });

  it('Offer_WithNoDates_MarksTheDatesField', async () => {
    asAdult(parent);
    const r = await (await actions()).meetingPostOfferAction({ entryId: meeting1, personId: parent, what: { type: 'ff', title: 'Knife sharpening' }, entryIds: [] });
    expect(r).toEqual({ ok: false, error: 'Pick at least one date.', field: 'dates' });
  });

  it('Adult_FreeformOffer_PutsATopicOnEachBoard', async () => {
    asAdult(parent);
    await (await actions()).meetingPostOfferAction({ entryId: meeting1, personId: parent, what: { type: 'ff', title: 'Knife sharpening' }, entryIds: [meeting1, meeting2] });
    const { data } = await sb.from('meeting_topics').select('calendar_entry_id').eq('topic_key', 'ff:knife sharpening').in('calendar_entry_id', [meeting1, meeting2]);
    expect((data ?? []).length).toBe(2);
  });

  it('Offer_PostsOnEveryDate_EvenWhereTheyAlreadyTeachTwo', async () => {
    asAdult(parent);
    const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'second-class').order('sort_order').limit(2);
    const [a, b] = ((reqs ?? []) as { rank_id: string; code: string }[]).map((x) => `${x.rank_id}-${x.code}`);
    await sb.rpc('meeting_teach_topic', { p_entries: [meeting2], p_person: parent, p_actor: parent, p_leader: false, p_topic_key: a, p_title: null, p_note: null });
    await sb.rpc('meeting_teach_topic', { p_entries: [meeting2], p_person: parent, p_actor: parent, p_leader: false, p_topic_key: b, p_title: null, p_note: null });
    const r = await (await actions()).meetingPostOfferAction({ entryId: meeting1, personId: parent, what: { type: 'req', key: knotKey }, entryIds: [meeting1, meeting2] });
    const { count } = await sb.from('meeting_topic_teachers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting1).eq('person_id', parent);
    expect([r.ok, count]).toEqual([true, 1]);
  });
});

describe('qa-lead follow-ups (round 2)', () => {
  it('RpcError_OutsideTheKnownMessages_IsNeverShownRaw', async () => {
    const s = await supply();
    const res = await s.offerSkill(sb, { personId: parent, actorPersonId: parent, leader: false }, [meeting1], 'no-such-skill', null);
    expect([res, s.sanitizeRpcError('Junior Leaders can’t teach that: it’s adults only.')]).toEqual([
      { ok: false, error: 'Couldn’t save that. Try again.' },
      'Junior Leaders can’t teach that: it’s adults only.'
    ]);
  });

  it('RpcGuard_CantTeachMessage_IsShownNotSwallowed', async () => {
    const s = await supply();
    expect(s.sanitizeRpcError('That person can’t teach at troop meetings.')).toBe('That person can’t teach at troop meetings.');
  });

  it('Adult_RemovesTheirOwnCommitment_OutsideTheirSkills', async () => {
    asAdult(other);
    const act = await actions();
    const added = await act.meetingTeachAction({ entryId: meeting1, personId: other, key: knotKey });
    const removed = await act.meetingUnteachAction({ entryId: meeting1, personId: other, key: knotKey });
    expect([added.ok && added.view.items[0].flags.length > 0, removed.ok && removed.view.items.length]).toEqual([true, 0]);
  });

  async function leavingTeacher() {
    const leaving = await person('Leaving');
    await sb.rpc('meeting_teach_topic', { p_entries: [meeting1], p_person: leaving, p_actor: leaving, p_leader: false, p_topic_key: knotKey, p_title: null, p_note: null });
    await (await import('../src/lib/teaching-skills')).saveTeachingSkills(sb, leaving, [knotSkill], 'admin', { personId: parent, label: null });
    await sb.rpc('meeting_offer_skill', { p_entries: [meeting1], p_person: leaving, p_actor: leaving, p_leader: false, p_skill_id: knotSkill, p_note: null });
    await sb.from('people').update({ active: false }).eq('id', leaving);
    return leaving;
  }

  it('NoLongerQualified_StillSeesTheirRows_AndCannotAdd', async () => {
    const leaving = await leavingTeacher();
    const b = await teachBoardFor(meeting1, [leaving]);
    const view = await (await supply()).loadTeachView(sb, b.meeting, b.catalog, leaving, { board: b.rows, upcoming: [], teach: b.teach });
    asAdult(leaving);
    const add = await (await actions()).meetingTeachAction({ entryId: meeting1, personId: leaving, key: knotKey });
    expect([b.teach.people.get(leaving)?.eligible, view?.canAdd, view?.items.map((i) => i.kind).sort(), add.ok]).toEqual([false, false, ['offer', 'topic'], false]);
  });

  it('NoLongerQualified_RemovesTheirOwnRows', async () => {
    const leaving = await leavingTeacher();
    asAdult(leaving);
    const act = await actions();
    const r1 = await act.meetingUnteachAction({ entryId: meeting1, personId: leaving, key: knotKey });
    const r2 = await act.meetingWithdrawOfferAction({ entryId: meeting1, personId: leaving, skillId: knotSkill });
    expect([r1.ok && r1.view.items.length, r2.ok && r2.view.items.length]).toEqual([1, 0]);
  });

  it('Leader_SeesAndRemoves_ANoLongerQualifiedTeachersRows', async () => {
    const leaving = await leavingTeacher();
    const all = await teachBoardFor(meeting1);
    const adminAll = await (await supply()).loadTeachBoard(sb, all.meeting, all.catalog, all.rows, 'all');
    asAdult(parent);
    state.actor = { personId: parent, subjectKind: 'adult', capabilities: new Set(['meeting_plan.use']) };
    const r = await (await actions()).meetingUnteachAction({ entryId: meeting1, personId: leaving, key: knotKey, onBehalf: true });
    const w = await (await actions()).meetingWithdrawOfferAction({ entryId: meeting1, personId: leaving, skillId: knotSkill, onBehalf: true });
    expect([adminAll.people.get(leaving)?.displayName, adminAll.match.offered.includes(knotKey) || adminAll.supply.topicTeachers.some((t) => t.personId === leaving), r.ok, w.ok && w.view.items.length]).toEqual([
      `${TEST_PREFIX} MTA Leaving`,
      true,
      true,
      0
    ]);
  });
});

describe('the board', () => {
  it('Adult_SelfAddedSkill_CountsForMatchingImmediately', async () => {
    await pickFor(young, knotKey);
    const before = await teachBoardFor(meeting1, [parent]);
    const viewBefore = await (await supply()).loadTeachView(sb, before.meeting, before.catalog, parent, { board: before.rows, upcoming: [], teach: before.teach });
    await (await import('../src/lib/teaching-skills')).saveTeachingSkills(sb, parent, [knotSkill], 'member', { personId: parent, label: null });
    const after = await teachBoardFor(meeting1, [parent]);
    const viewAfter = await (await supply()).loadTeachView(sb, after.meeting, after.catalog, parent, { board: after.rows, upcoming: [], teach: after.teach });
    const q = (v: typeof viewBefore) => v!.wanted.find((w) => w.key === knotKey)?.qualified;
    expect([q(viewBefore), q(viewAfter)]).toEqual([false, true]);
  });

  it('Scout_SeesTeacherComing_ByFormalName_ForACommitment', async () => {
    await sb.rpc('meeting_teach_topic', { p_entries: [meeting1], p_person: parent, p_actor: parent, p_leader: false, p_topic_key: knotKey, p_title: null, p_note: null });
    const { teach } = await teachBoardFor(meeting1);
    expect((await supply()).teacherTags(teach).get(knotKey)).toBe('Mr. Vestry');
  });

  it('Scout_SeesTeacherComing_ForARequirementASkillOfferCovers', async () => {
    await (await import('../src/lib/teaching-skills')).saveTeachingSkills(sb, parent, [knotSkill], 'member', { personId: parent, label: null });
    await sb.rpc('meeting_offer_skill', { p_entries: [meeting1], p_person: parent, p_actor: parent, p_leader: false, p_skill_id: knotSkill, p_note: null });
    const { teach } = await teachBoardFor(meeting1);
    expect((await supply()).teacherTags(teach).get(knotKey)).toBe('Mr. Vestry');
  });

  it('Scout_SeesJuniorLeaderTeacher_AsFirstNameLastInitial', async () => {
    await sb.rpc('meeting_teach_topic', { p_entries: [meeting1], p_person: junior, p_actor: junior, p_leader: false, p_topic_key: knotKey, p_title: null, p_note: null });
    const { teach } = await teachBoardFor(meeting1);
    expect((await supply()).teacherTags(teach).get(knotKey)).toBe(`${TEST_PREFIX} J`);
  });

  it('Teacher_WhoCantMakeIt_IsNoLongerTheTeacherComing', async () => {
    await sb.rpc('meeting_teach_topic', { p_entries: [meeting1], p_person: parent, p_actor: parent, p_leader: false, p_topic_key: knotKey, p_title: null, p_note: null });
    await sb.rpc('meeting_set_intent', { p_entry: meeting1, p_person: parent, p_actor: parent, p_leader: false, p_intent: 'not_coming' });
    const { teach } = await teachBoardFor(meeting1);
    expect((await supply()).teacherTags(teach).has(knotKey)).toBe(false);
  });

  it('TeachView_CarriesNoContactDetails', async () => {
    await sb.from('people').update({ primary_phone: '414-555-0199' }).in('id', [young, parent]);
    await pickFor(young, knotKey);
    await sb.rpc('meeting_teach_topic', { p_entries: [meeting1], p_person: parent, p_actor: parent, p_leader: false, p_topic_key: knotKey, p_title: null, p_note: null });
    const b = await teachBoardFor(meeting1, [parent]);
    const view = await (await supply()).loadTeachView(sb, b.meeting, b.catalog, parent, { board: b.rows, upcoming: [], teach: b.teach });
    await sb.from('people').update({ primary_phone: null }).in('id', [young, parent]);
    expect([JSON.stringify(view).includes('555-0199'), JSON.stringify([...(await supply()).teacherTags(b.teach)]).includes('555-0199')]).toEqual([false, false]);
  });

  it('Leader_SeesAdminHomeRow_WhenARequestHasNoTeacher', async () => {
    const { loadSundayNoTeacher } = await import('../src/app/admin/(workspace)/advancement/dashboard/attention-items');
    // The local DB mirrors production, whose scouts' standing requests reach this fixture meeting too: assert the
    // change this test's own request makes (a delta), never an absolute count. If a real scout already wants the
    // same topic, our pick adds no new "no teacher" row.
    const added = (await teachBoardFor(meeting1)).teach.match.wanted.includes(knotKey) ? 0 : 1;
    const before = (await loadSundayNoTeacher(sb, '2093-03-01')).count;
    await pickFor(young, knotKey);
    const mid = await loadSundayNoTeacher(sb, '2093-03-01');
    const forPlanner = await loadSundayNoTeacher(sb, '2093-03-01', { planner: true });
    await sb.rpc('meeting_teach_topic', { p_entries: [meeting1], p_person: parent, p_actor: parent, p_leader: false, p_topic_key: knotKey, p_title: null, p_note: null });
    const after = (await loadSundayNoTeacher(sb, '2093-03-01')).count;
    const n = before + added;
    expect([mid.count, mid.label.endsWith(`${n} ${n === 1 ? 'request' : 'requests'} with no teacher`), mid.href, forPlanner.href, after]).toEqual([n, true, '/admin/advancement/meeting-plan', '/planner', before]);
  });
});
