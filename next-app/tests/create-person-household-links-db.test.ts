import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, type TestScout } from './helpers/signup-fixtures';

/**
 * Add adult into a household with scouts records how the adult relates to each one (lib/household-links). The
 * dialog used to create the membership alone, so Kevin Greene landed in Miren's household with no parent link and
 * couldn't add her health forms (2026-11-14). Same request-glue mocks as person-record-immediate; the DB is real.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import { createPerson } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

const admin = adminClient();
let scout: TestScout;
let householdId = 0;
const created: number[] = [];

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ first_name: 'ZZLink', last_name: 'Adult', household_id: String(householdId), ...entries })) fd.set(k, v);
  return fd;
};

beforeAll(async () => {
  scout = await createTestScout(admin, 'LinkKid');
  const { data, error } = await admin.from('households').insert({ label: 'ZZVITEST Link Household' }).select('id').single();
  if (error) throw new Error(error.message);
  householdId = data!.id;
  const { error: memberError } = await admin.from('household_members').insert({ household_id: householdId, person_id: scout.personId });
  if (memberError) throw new Error(memberError.message);
});

afterAll(async () => {
  if (created.length) {
    await admin.from('relationships').delete().in('person_id', created);
    await admin.from('household_members').delete().in('person_id', created);
    await admin.from('people').delete().in('id', created);
  }
  await admin.from('household_members').delete().eq('household_id', householdId);
  await admin.from('households').delete().eq('id', householdId);
  await deleteTestScout(admin, scout);
});

describe('createPerson into a household with a scout', () => {
  it('Leader_LeavingTheRelationUnanswered_CreatesNobody', async () => {
    const res = await createPerson(form({ last_name: 'Unanswered' }));
    const { count } = await admin.from('people').select('id', { count: 'exact', head: true }).eq('display_name', 'ZZLink Unanswered');
    expect([res.ok, count]).toEqual([false, 0]);
  });

  it('Leader_ChoosingParent_RecordsTheParentLink', async () => {
    const res = await createPerson(form({ last_name: 'Parent', [`relation_${scout.personId}`]: 'parent_of' }));
    if (res.personId) created.push(res.personId);
    const { data } = await admin.from('relationships').select('related_person_id, type').eq('person_id', res.personId!);
    expect(data).toEqual([{ related_person_id: scout.personId, type: 'parent_of' }]);
  });

  it('Leader_PostingALinkToAScoutOutsideTheHousehold_IsIgnored', async () => {
    const outsider = await createTestScout(admin, 'LinkOutsider');
    try {
      const res = await createPerson(form({ last_name: 'Forged', [`relation_${scout.personId}`]: 'none', [`relation_${outsider.personId}`]: 'parent_of' }));
      if (res.personId) created.push(res.personId);
      const { data } = await admin.from('relationships').select('id').eq('person_id', res.personId!);
      expect([res.ok, data]).toEqual([true, []]);
    } finally {
      await admin.from('relationships').delete().eq('related_person_id', outsider.personId);
      await deleteTestScout(admin, outsider);
    }
  });

  it('Leader_ChoosingNeither_RecordsNoLink', async () => {
    const res = await createPerson(form({ last_name: 'Neither', [`relation_${scout.personId}`]: 'none' }));
    if (res.personId) created.push(res.personId);
    const { data } = await admin.from('relationships').select('id').eq('person_id', res.personId!);
    expect([res.ok, data]).toEqual([true, []]);
  });
});
