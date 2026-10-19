import { describe, it, expect, vi, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import type { Capability } from '../src/lib/capabilities';

/**
 * Admin › Lookups writes teaching skills by person (Phase 0a): one action for adults and scouts, diffing rather than
 * delete-then-insert (a mid-way failure can't wipe a person's skills), with the youth-teachable guard on the server.
 */
const admin = adminClient();
const state = vi.hoisted(() => ({ caps: new Set<string>(['roster.manage']) }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({ kind: 'identity', label: 'Vitest Leader', personId: null, capabilities: state.caps as Set<Capability>, legacyRole: null, subjectKind: 'adult' }),
  actorHas: () => true
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

let personIds: number[] = [];
let scoutIds: string[] = [];
afterEach(async () => {
  if (scoutIds.length) await admin.from('scouts').delete().in('id', scoutIds);
  if (personIds.length) {
    await admin.from('teaching_skills').delete().in('person_id', personIds);
    await admin.from('people').delete().in('id', personIds);
  }
  personIds = [];
  scoutIds = [];
  state.caps = new Set(['roster.manage']);
});

async function makePerson(label: string): Promise<number> {
  const { data } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} TS ${label}` }).select('id').single();
  personIds.push(data!.id);
  return data!.id;
}
async function makeScout(label: string): Promise<number> {
  const personId = await makePerson(label);
  const id = `vitest-ts-${personId}`;
  const { error } = await admin.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} TS ${label}`, person_id: personId, active: true });
  if (error) throw new Error(`fixture scout: ${error.message}`);
  scoutIds.push(id);
  return personId;
}
const save = async (personId: number, skills: string[]) => {
  const { setTeachingSkills } = await import('../src/app/admin/(workspace)/advancement/lookups/actions');
  const fd = new FormData();
  fd.set('person_id', String(personId));
  fd.set('skill_ids', JSON.stringify(skills));
  return setTeachingSkills(fd);
};
const skillsOf = async (personId: number) => ((await admin.from('teaching_skills').select('skill_id').eq('person_id', personId).order('skill_id')).data ?? []).map((r) => r.skill_id);

describe('setTeachingSkills', () => {
  it('Parent_WithoutLeaderCode_CanBeGivenTeachingSkills', async () => {
    const parent = await makePerson('Parent');
    expect(await save(parent, ['first-aid', 'knots'])).toMatchObject({ ok: true });
    expect(await skillsOf(parent)).toEqual(['first-aid', 'knots']);
  });

  it('SetTeachingSkills_KeepsAnUnchangedRow_AndRemovesOnlyWhatWasDropped', async () => {
    const parent = await makePerson('Diff');
    await save(parent, ['first-aid', 'knots']);
    const before = (await admin.from('teaching_skills').select('authorized_at').eq('person_id', parent).eq('skill_id', 'knots').single()).data!.authorized_at;
    expect(await save(parent, ['knots'])).toMatchObject({ ok: true });
    const after = (await admin.from('teaching_skills').select('authorized_at').eq('person_id', parent).eq('skill_id', 'knots').single()).data!.authorized_at;
    expect([await skillsOf(parent), after]).toEqual([['knots'], before]);
  });

  it('JuniorLeader_IsRefusedAdultOnlySkill_WhenPostedDirectly', async () => {
    const scout = await makeScout('Scout');
    expect(await save(scout, ['first-aid'])).toMatchObject({ ok: false });
    expect(await skillsOf(scout)).toEqual([]);
  });

  // qa-lead: a merged-away record must not quietly collect skills.
  it('SetTeachingSkills_RefusesAPersonMergedIntoAnother', async () => {
    const keep = await makePerson('Keep');
    const gone = await makePerson('Gone');
    await admin.from('people').update({ merged_into_person_id: keep }).eq('id', gone);
    expect(await save(gone, ['knots'])).toMatchObject({ ok: false });
    expect(await skillsOf(gone)).toEqual([]);
  });

  it('SetTeachingSkills_RequiresRosterManage', async () => {
    const parent = await makePerson('Gate');
    state.caps = new Set(['news.write']);
    expect(await save(parent, ['knots'])).toMatchObject({ ok: false });
    expect(await skillsOf(parent)).toEqual([]);
  });
});
