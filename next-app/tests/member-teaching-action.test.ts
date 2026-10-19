import { describe, it, expect, vi, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Members › What I can teach (Phase 0b): the action acts only for the verified session, saves only skills the card
 * offers, and logs member changes unreviewed. Real local database; the session is mocked.
 */
const admin = adminClient();
const state = vi.hoisted(() => ({ session: null as null | { personId: number; subjectKind: 'adult' | 'scout'; displayName: string } }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => state.session }));
vi.mock('@/lib/identity-session', () => ({ isEpochCurrent: async () => true }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

let personIds: number[] = [];
let scoutIds: string[] = [];
afterEach(async () => {
  if (scoutIds.length) await admin.from('scouts').delete().in('id', scoutIds);
  if (personIds.length) {
    await admin.from('teaching_skill_changes').delete().in('person_id', personIds);
    await admin.from('teaching_skills').delete().in('person_id', personIds);
    await admin.from('people').delete().in('id', personIds);
  }
  personIds = [];
  scoutIds = [];
  state.session = null;
});

async function makePerson(label: string): Promise<number> {
  const { data } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} MTA ${label}` }).select('id').single();
  personIds.push(data!.id);
  return data!.id as number;
}
async function makeScout(label: string, rank: string): Promise<number> {
  const personId = await makePerson(label);
  const id = `vitest-mta-${personId}`;
  const { error } = await admin.from('scouts').insert({
    id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} MTA ${label}`, person_id: personId, active: true, current_rank: rank, graduation_year: 2033
  });
  if (error) throw new Error(`fixture scout: ${error.message}`);
  scoutIds.push(id);
  return personId;
}
const act = async (ids: unknown) => (await import('../src/app/(public)/member/teaching/actions')).saveMyTeachingSkillsAction(ids);
const held = async (personId: number) =>
  ((await admin.from('teaching_skills').select('skill_id').eq('person_id', personId).order('skill_id')).data ?? []).map((r) => r.skill_id);

describe('saveMyTeachingSkillsAction', () => {
  it('NoSession_IsRefused', async () => {
    expect((await act(['knots'])).ok).toBe(false);
  });

  it('Parent_SavesOwnSkills_LoggedFromTheMemberPage', async () => {
    const parent = await makePerson('Parent');
    state.session = { personId: parent, subjectKind: 'adult', displayName: 'Parent' };
    await act(['knots', 'first-aid']);
    const { data } = await admin.from('teaching_skill_changes').select('source, reviewed_at').eq('person_id', parent);
    expect([await held(parent), (data ?? []).map((c) => [c.source, c.reviewed_at])]).toEqual([
      ['first-aid', 'knots'],
      [['member', null], ['member', null]]
    ]);
  });

  it('JuniorLeader_IsRefusedAdultOnlySkill_WhenPostedDirectly', async () => {
    const scout = await makeScout('FC', 'first-class');
    state.session = { personId: scout, subjectKind: 'scout', displayName: 'Scout' };
    expect([(await act(['knots', 'aquatics'])).ok, await held(scout)]).toEqual([false, []]);
  });

  it('JuniorLeader_SavesAYouthTeachableSkill', async () => {
    const scout = await makeScout('FC', 'first-class');
    state.session = { personId: scout, subjectKind: 'scout', displayName: 'Scout' };
    expect([(await act(['knots'])).ok, await held(scout)]).toEqual([true, ['knots']]);
  });

  it('Member_SaveRecordsSelfAsWhoAuthorized', async () => {
    const parent = await makePerson('Parent');
    state.session = { personId: parent, subjectKind: 'adult', displayName: 'Parent' };
    await act(['knots']);
    const { data } = await admin.from('teaching_skills').select('authorized_by').eq('person_id', parent).single();
    expect(data?.authorized_by).toBe('self');
  });

  it('JuniorLeader_Save_DropsALeftoverAdultOnlySkill_AndLogsIt', async () => {
    const scout = await makeScout('FC', 'first-class');
    // A pre-guard adults-only row on a scout can't be kept (scouts may not teach it): the save removes it, visibly.
    await admin.from('teaching_skills').insert({ person_id: scout, skill_id: 'first-aid' });
    state.session = { personId: scout, subjectKind: 'scout', displayName: 'Scout' };
    await act(['knots']);
    const { data } = await admin.from('teaching_skill_changes').select('skill_id, action').eq('person_id', scout).order('skill_id');
    expect([await held(scout), data]).toEqual([['knots'], [{ skill_id: 'first-aid', action: 'removed' }, { skill_id: 'knots', action: 'added' }]]);
  });

  it('ScoutSignIn_WithNoActiveScoutRow_IsNotAnAdult', async () => {
    const person = await makePerson('Former');
    state.session = { personId: person, subjectKind: 'scout', displayName: 'Former' };
    expect([(await act(['aquatics'])).ok, await held(person)]).toEqual([false, []]);
  });

  it('YoungerScout_IsRefused', async () => {
    const scout = await makeScout('Young', 'tenderfoot');
    state.session = { personId: scout, subjectKind: 'scout', displayName: 'Scout' };
    expect([(await act(['knots'])).ok, await held(scout)]).toEqual([false, []]);
  });

  it('MalformedPayload_IsRefused', async () => {
    state.session = { personId: await makePerson('Parent'), subjectKind: 'adult', displayName: 'Parent' };
    expect((await act('knots')).ok).toBe(false);
  });
});
