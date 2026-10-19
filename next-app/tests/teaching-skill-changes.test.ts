import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import {
  loadTeachingProfile,
  saveTeachingSkills,
  undoTeachingSkillChange,
  markTeachingSkillChangeReviewed,
  loadTeachingSkillChanges,
  countUnreviewedTeachingSkillChanges
} from '../src/lib/teaching-skills';

/**
 * Phase 0b of Plans/Meeting-Requests-And-Teaching-Offers.md: "What I can teach" self-service, the change log, admin
 * undo and Mark reviewed (20261114100000_teaching_skill_changes). Real local database; the local DB mirrors
 * production, so counts are asserted as deltas and every row is test-owned.
 */
const admin = adminClient();
const ON = '2026-10-25';
const ME = { personId: null, label: 'Vitest Leader' };
let personIds: number[] = [];
let scoutIds: string[] = [];

afterEach(async () => {
  if (scoutIds.length) await admin.from('scouts').delete().in('id', scoutIds);
  if (personIds.length) {
    await admin.from('teaching_skill_changes').delete().in('person_id', personIds);
    await admin.from('teaching_skills').delete().in('person_id', personIds);
    await admin.from('merit_badge_counselors').delete().in('person_id', personIds);
    await admin.from('people').delete().in('id', personIds);
  }
  personIds = [];
  scoutIds = [];
});

async function makePerson(label: string): Promise<number> {
  const { data, error } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} TSC ${label}` }).select('id').single();
  if (error || !data) throw new Error(`fixture people: ${error?.message}`);
  personIds.push(data.id);
  return data.id as number;
}
async function makeScout(label: string, rank: string | null, graduationYear = 2033, override: 'yes' | 'no' | null = null): Promise<number> {
  const personId = await makePerson(label);
  const id = `vitest-tsc-${personId}`;
  const { error } = await admin.from('scouts').insert({
    id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} TSC ${label}`, person_id: personId, active: true,
    current_rank: rank, graduation_year: graduationYear, junior_leader_override: override
  });
  if (error) throw new Error(`fixture scout: ${error.message}`);
  scoutIds.push(id);
  return personId;
}
const held = async (personId: number) =>
  ((await admin.from('teaching_skills').select('skill_id').eq('person_id', personId).order('skill_id')).data ?? []).map((r) => r.skill_id);
const changesOf = async (personId: number) =>
  ((await admin.from('teaching_skill_changes').select('id, skill_id, action, source, reviewed_at, reverted_at').eq('person_id', personId).order('id')).data ?? []);

describe('What I can teach profile', () => {
  it('Adult_SeesAllSkills_OnWhatICanTeachCard', async () => {
    const parent = await makePerson('Parent');
    const p = await loadTeachingProfile(admin, parent, ON);
    const { count } = await admin.from('skills').select('id', { count: 'exact', head: true });
    expect([p.kind, p.skills.length]).toEqual(['adult', count]);
  });

  it('Adult_AdultOnlySkills_CarryTheirReason', async () => {
    const p = await loadTeachingProfile(admin, await makePerson('Parent'), ON);
    const note = (id: string) => p.skills.find((s) => s.id === id)?.adultOnlyNote;
    expect([note('first-aid'), note('aquatics'), note('knots')]).toEqual(['Adults only (troop rule)', 'Adults only (Guide to Safe Scouting)', null]);
  });

  it('JuniorLeader_SeesOnlyYouthTeachableSkills_OnWhatICanTeachCard', async () => {
    const p = await loadTeachingProfile(admin, await makeScout('FC', 'first-class'), ON);
    expect([p.kind, p.skills.every((s) => s.youthTeachable), p.skills.some((s) => s.id === 'first-aid')]).toEqual(['junior', true, false]);
  });

  it('JuniorLeader_FirstClassScout_FinishedEveryRankRequirementForTheSkill', async () => {
    const p = await loadTeachingProfile(admin, await makeScout('FC', 'first-class'), ON);
    const knots = p.skills.find((s) => s.id === 'knots')!;
    expect(knots.finished && knots.finished.done === knots.finished.total && knots.finished.total > 0).toBe(true);
  });

  it('JuniorLeader_YoungerScout_GetsNoCard', async () => {
    const p = await loadTeachingProfile(admin, await makeScout('Young', 'tenderfoot'), ON);
    expect(p.kind).toBe('none');
  });

  it('JuniorLeader_YoungerScout_IncludedByOverrideYes', async () => {
    const p = await loadTeachingProfile(admin, await makeScout('JL', 'tenderfoot', 2033, 'yes'), ON);
    expect(p.kind).toBe('junior');
  });

  it('Adult_CounselorStatus_ListsTheirBadges', async () => {
    const parent = await makePerson('Counselor');
    const { data: mb } = await admin.from('merit_badges').select('id, name').order('name').limit(1).single();
    await admin.from('merit_badge_counselors').insert({ mb_id: mb!.id, person_id: parent, sort_order: 0 });
    expect((await loadTeachingProfile(admin, parent, ON)).counselorFor).toEqual([mb!.name]);
  });
});

describe('saveTeachingSkills', () => {
  it('Parent_WithoutLeaderCode_CanSaveTeachingSkills', async () => {
    const parent = await makePerson('Parent');
    const res = await saveTeachingSkills(admin, parent, ['knots', 'first-aid'], 'member', { personId: parent, label: 'Parent' });
    expect([res, await held(parent)]).toEqual([{ ok: true, added: ['first-aid', 'knots'], removed: [] }, ['first-aid', 'knots']]);
  });

  it('JuniorLeader_IsRefusedAdultOnlySkill_WhenPostedDirectly', async () => {
    const scout = await makeScout('FC', 'first-class');
    const res = await saveTeachingSkills(admin, scout, ['knots', 'first-aid'], 'member', { personId: scout, label: 'Scout' });
    expect([res.ok, await held(scout)]).toEqual([false, []]);
  });

  it('Save_MemberChange_IsLoggedUnreviewed', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'member', { personId: parent, label: 'Parent' });
    await saveTeachingSkills(admin, parent, ['cooking'], 'member', { personId: parent, label: 'Parent' });
    const log = (await changesOf(parent)).map((c) => `${c.action}:${c.skill_id}:${c.source}:${c.reviewed_at == null ? 'open' : 'reviewed'}`);
    expect(log).toEqual(['added:knots:member:open', 'added:cooking:member:open', 'removed:knots:member:open']);
  });

  it('Save_AdminChange_IsLoggedAlreadyReviewed', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'admin', ME);
    expect((await changesOf(parent)).map((c) => [c.source, c.reviewed_at != null])).toEqual([['admin', true]]);
  });

  it('Save_NoChange_LogsNothing', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'admin', ME);
    expect(await saveTeachingSkills(admin, parent, ['knots'], 'member', { personId: parent, label: 'Parent' })).toEqual({ ok: true, added: [], removed: [] });
  });

  it('Save_MergedAwayPerson_IsRefused', async () => {
    const survivor = await makePerson('Survivor');
    const loser = await makePerson('Loser');
    await admin.from('people').update({ merged_into_person_id: survivor }).eq('id', loser);
    expect((await saveTeachingSkills(admin, loser, ['knots'], 'admin', ME)).ok).toBe(false);
  });

  it('Adult_SelfAddedSkill_CountsForMatchingImmediately', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'member', { personId: parent, label: 'Parent' });
    // The Meeting Plan reads teaching_skills directly: no pending state stands in between.
    expect(await held(parent)).toEqual(['knots']);
  });
});

describe('admin review', () => {
  it('Leader_SeesSelfServiceChange_InRecentChanges', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'member', { personId: parent, label: 'Parent' });
    const rows = await loadTeachingSkillChanges(admin, { filter: 'review' });
    const mine = rows.find((r) => r.personId === parent);
    expect([mine?.skillName, mine?.action, mine?.source]).toEqual(['Knots & Lashings', 'added', 'member']);
  });

  it('Leader_UndoAdd_RemovesSkillAndLogsUndo', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'member', { personId: parent, label: 'Parent' });
    const [change] = await changesOf(parent);
    const res = await undoTeachingSkillChange(admin, change.id, ME);
    const log = (await changesOf(parent)).map((c) => `${c.action}:${c.source}:${c.reverted_at == null ? '' : 'reverted'}`);
    expect([res, await held(parent), log]).toEqual([{ ok: true, outcome: 'ok' }, [], ['added:member:reverted', 'removed:undo:']]);
  });

  it('Leader_UndoRemove_RestoresSkill', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'admin', ME);
    await saveTeachingSkills(admin, parent, [], 'member', { personId: parent, label: 'Parent' });
    const removal = (await changesOf(parent)).find((c) => c.action === 'removed')!;
    await undoTeachingSkillChange(admin, removal.id, ME);
    expect(await held(parent)).toEqual(['knots']);
  });

  it('Leader_UndoTwice_SecondSaysAlready', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'member', { personId: parent, label: 'Parent' });
    const [change] = await changesOf(parent);
    await undoTeachingSkillChange(admin, change.id, ME);
    expect(await undoTeachingSkillChange(admin, change.id, ME)).toEqual({ ok: true, outcome: 'already' });
  });

  it('Leader_UndoAfterThePersonChangedItBack_SaysSuperseded', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'member', { personId: parent, label: 'Parent' });
    await saveTeachingSkills(admin, parent, [], 'member', { personId: parent, label: 'Parent' });
    const [add] = await changesOf(parent);
    expect([await undoTeachingSkillChange(admin, add.id, ME), await held(parent)]).toEqual([{ ok: true, outcome: 'superseded' }, []]);
  });

  it('Leader_UndoAnOlderChange_AfterALaterOneOnTheSameSkill_SaysSuperseded', async () => {
    const parent = await makePerson('Parent');
    const by = { personId: parent, label: 'Parent' };
    await saveTeachingSkills(admin, parent, ['knots'], 'member', by);
    await saveTeachingSkills(admin, parent, [], 'member', by);
    await saveTeachingSkills(admin, parent, ['knots'], 'member', by);
    const [firstAdd] = await changesOf(parent);
    expect([await undoTeachingSkillChange(admin, firstAdd.id, ME), await held(parent)]).toEqual([{ ok: true, outcome: 'superseded' }, ['knots']]);
  });

  it('Leader_UndoRemove_RefusesAnAdultOnlySkillForAScout', async () => {
    const scout = await makeScout('Was', 'first-class');
    await admin.from('scouts').update({ active: false, inactive_reason: 'other' }).eq('person_id', scout);
    await saveTeachingSkills(admin, scout, ['first-aid'], 'admin', ME);
    await saveTeachingSkills(admin, scout, [], 'admin', ME);
    await admin.from('scouts').update({ active: true, inactive_reason: null }).eq('person_id', scout);
    const removal = (await changesOf(scout)).find((c) => c.action === 'removed')!;
    expect([(await undoTeachingSkillChange(admin, removal.id, ME)).ok, await held(scout)]).toEqual([false, []]);
  });

  it('Leader_UndoForAMergedAwayPerson_IsRefused', async () => {
    const survivor = await makePerson('Survivor');
    const loser = await makePerson('Loser');
    await saveTeachingSkills(admin, loser, ['knots'], 'member', { personId: loser, label: 'Loser' });
    await admin.from('people').update({ merged_into_person_id: survivor }).eq('id', loser);
    const [change] = await changesOf(loser);
    expect((await undoTeachingSkillChange(admin, change.id, ME)).ok).toBe(false);
  });

  it('Leader_SeesAdminHomeAlert_WhenSkillChangeUnreviewed', async () => {
    const before = await countUnreviewedTeachingSkillChanges(admin);
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots', 'cooking'], 'member', { personId: parent, label: 'Parent' });
    expect(await countUnreviewedTeachingSkillChanges(admin)).toBe(before + 2);
  });

  it('Leader_MarkReviewed_ClearsAlertWithoutUndoing', async () => {
    const parent = await makePerson('Parent');
    await saveTeachingSkills(admin, parent, ['knots'], 'member', { personId: parent, label: 'Parent' });
    const before = await countUnreviewedTeachingSkillChanges(admin);
    const [change] = await changesOf(parent);
    await markTeachingSkillChangeReviewed(admin, change.id);
    expect([await countUnreviewedTeachingSkillChanges(admin), await held(parent)]).toEqual([before - 1, ['knots']]);
  });

  it('Anon_CannotReadTheChangeLogOrCallTheWriter', async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const read = await anon.from('teaching_skill_changes').select('id').limit(1);
    const call = await anon.rpc('set_teaching_skills', { p_person_id: 1, p_skill_ids: [], p_source: 'member', p_changed_by_person_id: null, p_changed_by_label: null });
    expect([read.error != null || (read.data ?? []).length === 0, call.error != null]).toEqual([true, true]);
  });
});
