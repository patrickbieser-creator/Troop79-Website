import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Build a Plan B10c + B10d (Plans/Build-A-Plan.md "B10 spec"): talent discovery. "What else would you enjoy teaching,
 * now or in the future?" lives on /member/teaching (the teacher answer page that also asked it is retired:
 * Plans/Planner-Teacher-Email-To-Family-Card.md). Interests land in teaching_interests (never teaching_skills);
 * /member/teaching lists and removes them and can add one's skill through the signed-in set_teaching_skills path;
 * planners see "New talent".
 * Real local database; the mail transport, "today" (2094-02-20), the request headers and the session are mocked.
 * Test-owned rows only: the meeting (its pages, invites, topics and teachers by entry), fixture people by id (their
 * interests, skills and skill changes), households by id, failure rows by this run's IP.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  send: vi.fn(async (opts: { to: string[]; html?: string; text?: string }) => ({ status: 'sent', to: opts.to })),
  redirect: vi.fn(),
  ip: '198.51.100.31',
  session: null as null | { personId: number; subjectKind: 'adult' | 'scout'; displayName: string }
}));

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/email', () => ({ sendEmail: (opts: { to: string[] }) => state.send(opts) }));
vi.mock('@/lib/audit', async (orig) => ({ ...(await orig<typeof import('../src/lib/audit')>()), recordAudit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ headers: async () => new Map([['x-forwarded-for', state.ip]]) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    state.redirect(url);
    throw new Error('REDIRECT');
  }
}));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2094-02-20' }));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => state.session }));
vi.mock('@/lib/identity-session', () => ({ isEpochCurrent: async () => true }));

const { addMemberInterests, loadNewTalent, loadMyInterests } = await import('../src/lib/teaching-interests');

const DATE = '2094-03-15';
let meeting = 0;
let teacher = 0;
let keys: string[] = [];
let allKeys: string[] = [];
const people: number[] = [];
const scouts: string[] = [];
const EDITOR = { canEdit: true, canEmail: true };
const households: number[] = [];
const mail = (id: number) => `zzvitest-b10c-${id}-${process.pid}@example.com`;

async function adult(label: string): Promise<number> {
  const { data, error } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} B10c ${label}`, first_name: TEST_PREFIX, last_name: `B10c ${label}`, active: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const id = data!.id as number;
  people.push(id);
  const { error: e2 } = await sb.from('person_emails').insert({ person_id: id, email: mail(id), is_primary: true });
  if (e2) throw new Error(e2.message);
  const { data: h } = await sb.from('households').insert({ label: `${TEST_PREFIX} B10c ${label} family` }).select('id').single();
  households.push(h!.id);
  await sb.from('household_members').insert({ household_id: h!.id, person_id: id });
  return id;
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).eq('entry_date', DATE);
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: DATE, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} B10c` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id;
  teacher = await adult('Teacher');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code, parent_id, venue').is('parent_id', null).order('rank_id').order('sort_order');
  allKeys = ((reqs ?? []) as { rank_id: string; code: string; venue: string }[]).filter((r) => r.code.toLowerCase() !== 'bor').map((r) => `${r.rank_id}-${r.code}`);
  keys = ((reqs ?? []) as { rank_id: string; code: string; venue: string }[])
    .filter((r) => r.rank_id === 'tenderfoot' && r.venue !== 'outing' && r.code.toLowerCase() !== 'bor')
    .slice(0, 6)
    .map((r) => `tenderfoot-${r.code}`);
  if (keys.length < 6 || allKeys.length < 45) throw new Error('fixture: need meeting-doable Tenderfoot requirements and a catalog');
  const seeded = await sb.rpc('meeting_seed_many', { p_entry: meeting, p_keys: [keys[0]], p_actor: teacher });
  if (seeded.error) throw new Error(seeded.error.message);
}, 60_000);

afterEach(async () => {
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_invite_failures').delete().eq('ip', state.ip);
  await sb.from('teaching_interests').delete().in('person_id', people);
  await sb.from('teaching_skill_changes').delete().in('person_id', people);
  await sb.from('teaching_skills').delete().in('person_id', people);
  await sb.from('audit_log').delete().eq('area', 'meeting').in('actor_person_id', people);
  state.send.mockReset();
  state.send.mockImplementation(async (opts: { to: string[] }) => ({ status: 'sent', to: opts.to }));
  state.redirect.mockReset();
  state.session = null;
});

afterAll(async () => {
  if (scouts.length) await sb.from('scouts').delete().in('id', scouts);
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('household_members').delete().in('household_id', households);
  await sb.from('households').delete().in('id', households);
  await sb.from('person_emails').delete().in('person_id', people);
  await sb.from('people').delete().in('id', people);
});

const pick = (key: string, note: string | null = null) => ({ key, note });
const active = async (who = teacher) =>
  ((await sb.from('teaching_interests').select('topic_key').eq('person_id', who).is('removed_at', null).order('topic_key')).data ?? []).map((r) => r.topic_key as string);

describe('B10c: adding interests', () => {
  it('Interest_InvalidKey_Refused', async () => {
    await addMemberInterests(sb, teacher, [pick(keys[1]), pick('tenderfoot-no-such-thing')]);
    expect(await active()).toEqual([]);
  }, 60_000);

  it('Interest_CapsPerSubmit', async () => {
    const res = await addMemberInterests(sb, teacher, allKeys.slice(0, 16).map((k) => pick(k)));
    expect([res.ok, await active()]).toEqual([false, []]);
  }, 60_000);

  it('Interest_CapsActivePerPerson', async () => {
    state.session = { personId: teacher, subjectKind: 'adult', displayName: 'Teacher' };
    const { addMyInterestsAction } = await import('../src/app/(public)/member/teaching/actions');
    for (let i = 0; i < 40; i += 10) await addMyInterestsAction(allKeys.slice(i, i + 10).map((k) => pick(k)));
    const res = await addMyInterestsAction([pick(allKeys[40])]);
    expect([res.ok, (await active()).length]).toEqual([false, 40]);
  }, 60_000);

  it('Interest_DuplicateIsIdempotent', async () => {
    await addMemberInterests(sb, teacher, [pick(keys[1], 'Eagle Scout, 1998')]);
    await addMemberInterests(sb, teacher, [pick(keys[1]), pick(keys[1])]);
    const { data } = await sb.from('teaching_interests').select('topic_key, note').eq('person_id', teacher);
    expect(data).toEqual([{ topic_key: keys[1], note: 'Eagle Scout, 1998' }]);
  }, 60_000);
});

describe('B10d: /member/teaching', () => {
  it('MemberTeaching_ListsAndRemovesInterests', async () => {
    state.session = { personId: teacher, subjectKind: 'adult', displayName: 'Teacher' };
    const { addMyInterestsAction, removeMyInterestAction } = await import('../src/app/(public)/member/teaching/actions');
    await addMyInterestsAction([pick(keys[1], 'love knots'), pick('mb:first-aid')]);
    const listed = await loadMyInterests(sb, teacher);
    await removeMyInterestAction(listed.find((i) => i.key === 'mb:first-aid')!.id);
    expect([listed.map((i) => i.key).sort(), await active()]).toEqual([[keys[1], 'mb:first-aid'].sort(), [keys[1]]]);
  }, 60_000);

  it('MemberTeaching_RemoveOthersInterest_Refused', async () => {
    await addMemberInterests(sb, teacher, [pick(keys[1])]);
    const [mine] = await loadMyInterests(sb, teacher);
    const stranger = await adult(`Stranger ${people.length}`);
    state.session = { personId: stranger, subjectKind: 'adult', displayName: 'Stranger' };
    const { removeMyInterestAction } = await import('../src/app/(public)/member/teaching/actions');
    await removeMyInterestAction(mine.id);
    expect(await active()).toEqual([keys[1]]);
  }, 60_000);

  it('MemberTeaching_AddToSkills_UsesSignedInPath', async () => {
    const { data: withSkill } = await sb.from('rank_requirements').select('rank_id, code, skill_id').is('parent_id', null).not('skill_id', 'is', null).limit(1).single();
    const r = withSkill as { rank_id: string; code: string; skill_id: string };
    state.session = { personId: teacher, subjectKind: 'adult', displayName: 'Teacher' };
    const { addMyInterestsAction, addInterestToSkillsAction } = await import('../src/app/(public)/member/teaching/actions');
    await addMyInterestsAction([pick(`${r.rank_id}-${r.code}`)]);
    const [it1] = await loadMyInterests(sb, teacher);
    await addInterestToSkillsAction(it1.id);
    const { data } = await sb.from('teaching_skill_changes').select('skill_id, source, changed_by_person_id').eq('person_id', teacher);
    expect(data).toEqual([{ skill_id: r.skill_id, source: 'member', changed_by_person_id: teacher }]);
  }, 60_000);
});

describe('B10d: the Invite tab', () => {
  it('InviteTab_NewTalent_ListsLast30Days', async () => {
    await addMemberInterests(sb, teacher, [pick(keys[1], 'recent'), pick(keys[2], 'old')]);
    await sb.from('teaching_interests').update({ created_at: new Date(Date.now() - 31 * 86400_000).toISOString() }).eq('person_id', teacher).eq('topic_key', keys[2]);
    const mine = (await loadNewTalent(sb, EDITOR)).find((g) => g.personId === teacher);
    expect(mine?.items.map((i) => i.note)).toEqual(['recent']);
  }, 60_000);

  // qa-lead B10c #1 (Patrick): planner editors who are adults only, enforced where it loads; adults' interests only.
  const listed = async (who: number, access = EDITOR) => (await loadNewTalent(sb, access)).some((g) => g.personId === who);
  const memberAdd = (who: number, key: string) => sb.rpc('teaching_interest_add_member', { p_person: who, p_items: [{ key, note: null }] });

  it('NewTalent_ViewOnly_GetsNothing', async () => {
    await memberAdd(teacher, keys[1]);
    expect(await loadNewTalent(sb, { canEdit: false, canEmail: false })).toEqual([]);
  }, 60_000);

  it('NewTalent_ScoutEditor_GetsNothing', async () => {
    await memberAdd(teacher, keys[1]);
    expect(await loadNewTalent(sb, { canEdit: true, canEmail: false })).toEqual([]);
  }, 60_000);

  it('NewTalent_LeavesOutInactivePeople', async () => {
    const gone = await adult(`Inactive ${people.length}`);
    await memberAdd(gone, keys[1]);
    await sb.from('people').update({ active: false }).eq('id', gone);
    expect(await listed(gone)).toBe(false);
  }, 60_000);

  it('NewTalent_LeavesOutRemovedRows', async () => {
    await memberAdd(teacher, keys[1]);
    await sb.from('teaching_interests').update({ removed_at: new Date().toISOString() }).eq('person_id', teacher);
    expect(await listed(teacher)).toBe(false);
  }, 60_000);

  it('NewTalent_LeavesOutScouts', async () => {
    const youth = await adult(`Scout ${people.length}`);
    const id = `vitest-b10c-${youth}`;
    const { error } = await sb.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: 'B10c Scout', display_name: `${TEST_PREFIX} B10c Scout`, person_id: youth, active: true, current_rank: 'first-class', graduation_year: 2095 });
    if (error) throw new Error(error.message);
    scouts.push(id);
    await memberAdd(youth, keys[1]);
    expect(await listed(youth)).toBe(false);
  }, 60_000);
});
