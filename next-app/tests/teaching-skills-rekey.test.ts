import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Phase 0a of Plans/Meeting-Requests-And-Teaching-Offers.md: teaching skills and merit badge counselors keyed to
 * people (20261113100000_teaching_skills_rekey). Real local database.
 */
const admin = adminClient();
let personIds: number[] = [];

afterEach(async () => {
  if (personIds.length) {
    await admin.from('teaching_skills').delete().in('person_id', personIds);
    await admin.from('merit_badge_counselors').delete().in('person_id', personIds);
    await admin.from('people').delete().in('id', personIds);
  }
  personIds = [];
});

async function makePerson(label: string): Promise<number> {
  const { data, error } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} Teach ${label}` }).select('id').single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  personIds.push(data.id);
  return data.id as number;
}

describe('teaching_skills re-key', () => {
  // Valid until the old tables are dropped (the follow-up migration deletes this test with them).
  it('Rekey_PreservesEveryExistingSkillRow', async () => {
    const [ls, si, leaders, scouts, ts] = await Promise.all([
      admin.from('leader_skills').select('leader_code, skill_id'),
      admin.from('scout_instructors').select('scout_id, skill_id'),
      admin.from('leaders').select('code, person_id'),
      admin.from('scouts').select('id, person_id'),
      admin.from('teaching_skills').select('person_id, skill_id')
    ]);
    const personOfLeader = new Map((leaders.data ?? []).map((l) => [l.code, l.person_id]));
    const personOfScout = new Map((scouts.data ?? []).map((s) => [s.id, s.person_id]));
    const have = new Set((ts.data ?? []).map((t) => `${t.person_id}:${t.skill_id}`));
    const old = [
      ...(ls.data ?? []).filter((r) => personOfLeader.get(r.leader_code) != null).map((r) => `${personOfLeader.get(r.leader_code)}:${r.skill_id}`),
      ...(si.data ?? []).map((r) => `${personOfScout.get(r.scout_id)}:${r.skill_id}`)
    ];
    expect(old.filter((k) => !have.has(k))).toEqual([]);
  });

  it('Parent_WithoutLeaderCode_CanHoldTeachingSkills', async () => {
    const parent = await makePerson('Parent');
    expect((await admin.from('teaching_skills').insert({ person_id: parent, skill_id: 'knots' })).error).toBeNull();
  });

  it('TeachingSkills_CannotBeReadWithTheAnonKey', async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.from('teaching_skills').select('person_id').limit(1);
    expect(error != null || (data ?? []).length === 0).toBe(true);
  });
});

describe('merit_badge_counselors by person', () => {
  it('Counselor_ParentWithoutLeaderCode_CanCounsel', async () => {
    const parent = await makePerson('Counselor');
    const { data: mb } = await admin.from('merit_badges').select('id').limit(1).single();
    expect((await admin.from('merit_badge_counselors').insert({ mb_id: mb!.id, person_id: parent, sort_order: 0 })).error).toBeNull();
  });

  it('Counselor_WrittenByLeaderCodeOnly_LandsOnThePerson', async () => {
    const person = await makePerson('Leader');
    const code = `ZT${String(person).slice(-4)}`;
    await admin.from('leaders').insert({ code, name: `${TEST_PREFIX} Leader`, person_id: person, is_person: true });
    const { data: mb } = await admin.from('merit_badges').select('id').limit(1).single();
    await admin.from('merit_badge_counselors').insert({ mb_id: mb!.id, leader_code: code, sort_order: 0 });
    const { data } = await admin.from('merit_badge_counselors').select('person_id').eq('mb_id', mb!.id).eq('leader_code', code).single();
    await admin.from('merit_badge_counselors').delete().eq('leader_code', code);
    await admin.from('leaders').delete().eq('code', code);
    expect(data?.person_id).toBe(person);
  });
});

describe('merit_badge_counselors: non-person sources', () => {
  // Summer Camp stands in for the council camp staff who counsel at camp (Patrick, 2026-10-18).
  it('Counselor_SummerCampSource_CanCounsel', async () => {
    const { data: mb } = await admin.from('merit_badges').select('id').not('id', 'in', '(animal-science,art)').limit(1).single();
    const { error } = await admin.from('merit_badge_counselors').insert({ mb_id: mb!.id, leader_code: 'Camp', sort_order: 9 });
    await admin.from('merit_badge_counselors').delete().eq('mb_id', mb!.id).eq('leader_code', 'Camp');
    expect(error).toBeNull();
  });

  it('Rekey_KeepsTheExistingSummerCampCounselorRows', async () => {
    const { data } = await admin.from('merit_badge_counselors').select('mb_id').eq('leader_code', 'Camp').is('person_id', null).order('mb_id');
    expect((data ?? []).map((r) => r.mb_id)).toEqual(expect.arrayContaining(['animal-science', 'art']));
  });

  it('Counselor_NeitherPersonNorSource_IsRefused', async () => {
    const { data: mb } = await admin.from('merit_badges').select('id').limit(1).single();
    const { error } = await admin.from('merit_badge_counselors').insert({ mb_id: mb!.id, sort_order: 0 });
    expect(error).not.toBeNull();
  });

  it('Counselor_SameSourceTwiceOnOneBadge_IsRefused', async () => {
    const { data: mb } = await admin.from('merit_badges').select('id').not('id', 'in', '(animal-science,art)').limit(1).single();
    await admin.from('merit_badge_counselors').insert({ mb_id: mb!.id, leader_code: 'Camp', sort_order: 0 });
    const { error } = await admin.from('merit_badge_counselors').insert({ mb_id: mb!.id, leader_code: 'Camp', sort_order: 1 });
    await admin.from('merit_badge_counselors').delete().eq('mb_id', mb!.id).eq('leader_code', 'Camp');
    expect(error).not.toBeNull();
  });
});

describe('merge_people', () => {
  it('Merge_MovesTeachingSkillsAndCounselorBadges_ToTheSurvivor', async () => {
    const survivor = await makePerson('Survivor');
    const loser = await makePerson('Loser');
    const { data: mb } = await admin.from('merit_badges').select('id').limit(1).single();
    await admin.from('teaching_skills').insert([{ person_id: survivor, skill_id: 'knots' }, { person_id: loser, skill_id: 'knots' }, { person_id: loser, skill_id: 'first-aid' }]);
    await admin.from('merit_badge_counselors').insert({ mb_id: mb!.id, person_id: loser, sort_order: 0 });
    const { error } = await admin.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'test:teaching' });
    expect(error).toBeNull();
    const skills = ((await admin.from('teaching_skills').select('person_id, skill_id').in('person_id', [survivor, loser]).order('skill_id')).data ?? []).map((r) => `${r.person_id === survivor ? 'S' : 'L'}:${r.skill_id}`);
    const mbc = ((await admin.from('merit_badge_counselors').select('person_id').in('person_id', [survivor, loser])).data ?? []).map((r) => (r.person_id === survivor ? 'S' : 'L'));
    expect([skills, mbc]).toEqual([['S:first-aid', 'S:knots'], ['S']]);
  });
});
