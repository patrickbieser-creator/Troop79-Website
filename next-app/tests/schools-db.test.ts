import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Schools as a lookup table (Plans/Person-Record-One-Save.md, step 1 "Schools data";
 * migration 20270105100000_schools.sql). The leader-side actions run for real against local Postgres
 * with the same request-glue mocks as person-record-writes.test.ts.
 *
 * Fixtures are test-owned: every school this file makes is named "ZZVITEST School …" and cleaned up by
 * that name, the scout by its own fixed id — never by an id prefix the app mints.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import {
  addSchool,
  deleteSchool,
  listSchools,
  mergeSchool,
  renameSchool,
  setSchoolActive
} from '../src/app/admin/(workspace)/advancement/lookups/school-actions';
import { approveChangeRequest } from '../src/app/admin/(workspace)/advancement/roster/change-request-actions';
import { updateScoutFields } from '../src/app/admin/(workspace)/advancement/lookups/actions';

const admin = adminClient();
const PREFIX = 'ZZVITEST School';
const SCOUT_ID = 'ZZSCH1';
let scoutPersonId = 0;

async function schoolId(name: string): Promise<number> {
  const { data, error } = await admin.from('schools').insert({ name }).select('id').single();
  if (error || !data) throw new Error(`fixture: schools insert failed: ${error?.message}`);
  return (data as { id: number }).id;
}

async function scoutSchoolId(): Promise<number | null> {
  const { data } = await admin.from('scouts').select('school_id').eq('id', SCOUT_ID).single();
  return (data as { school_id: number | null }).school_id;
}

async function cleanSchools() {
  await admin.from('scouts').update({ school_id: null }).eq('id', SCOUT_ID);
  await admin.from('schools').delete().ilike('name', `${PREFIX}%`);
}

beforeAll(async () => {
  const { data: person, error } = await admin
    .from('people')
    .insert({ first_name: 'ZZSchool', last_name: 'Scout', display_name: 'ZZSchool Scout', active: true })
    .select('id')
    .single();
  if (error || !person) throw new Error(`fixture: people insert failed: ${error?.message}`);
  scoutPersonId = (person as { id: number }).id;
  const { error: scoutErr } = await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZSchool',
    last_name: 'Scout',
    display_name: 'ZZSchool Scout',
    active: true,
    person_id: scoutPersonId
  });
  if (scoutErr) throw new Error(`fixture: scouts insert failed: ${scoutErr.message}`);
});

afterEach(cleanSchools);

afterAll(async () => {
  await cleanSchools();
  await admin.from('change_requests').delete().eq('entity_type', 'scout').eq('entity_id', SCOUT_ID);
  await admin.from('audit_log').delete().in('entity_type', ['school', 'scout', 'change_request']).ilike('summary', '%ZZ%');
  await admin.from('audit_log').delete().eq('entity_type', 'scout').eq('entity_id', SCOUT_ID);
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
  if (scoutPersonId) await admin.from('people').delete().eq('id', scoutPersonId);
});

describe('the schools migration', () => {
  it('Migration_BackfillsSchoolId_ForEveryScoutWithSchoolText', async () => {
    // The old text column stays until a later migration drops it; every non-blank value must have a school,
    // except plain "Shorewood", a stopgap Patrick mapped to no school and fixes by hand (2026-11-15).
    const { data, error } = await admin.from('scouts').select('id, school, school_id').not('school', 'is', null).is('school_id', null);
    expect(error).toBeNull();
    const unmapped = (data ?? []).map((r) => String((r as { school: string }).school).trim()).filter((t) => t !== '' && t.toLowerCase() !== 'shorewood');
    expect(unmapped).toEqual([]);
  });

  it('SchoolsIndex_RefusesARawDuplicate_WhatEverItsCase', async () => {
    await schoolId(`${PREFIX} Alpha`);
    const { error } = await admin.from('schools').insert({ name: `  ${PREFIX.toLowerCase()} alpha ` });
    expect(error?.code).toBe('23505');
  });
});

describe('addSchool / listSchools', () => {
  it('Leader_AddsSchoolOnce_WhenNameMatchesCaseInsensitively', async () => {
    const first = await addSchool(`${PREFIX} Beta`);
    const again = await addSchool(`  ${PREFIX.toLowerCase()}   beta `);
    expect([first.ok, again.ok, again.school?.id]).toEqual([true, true, first.school?.id]);
  });

  it('AddSchool_TrimsAndCollapsesSpaces_WhenInserting', async () => {
    const res = await addSchool(`  ${PREFIX}    Gamma  `);
    expect(res.school?.name).toBe(`${PREFIX} Gamma`);
  });

  it('AddSchool_Refuses_WhenNameIsBlank', async () => {
    expect((await addSchool('   ')).ok).toBe(false);
  });

  it('AddSchool_UnhidesAHiddenSchool_WhenItsNameIsAddedAgain', async () => {
    const id = await schoolId(`${PREFIX} Delta`);
    await admin.from('schools').update({ active: false }).eq('id', id);
    const res = await addSchool(`${PREFIX} delta`);
    expect([res.school?.id, res.school?.active]).toEqual([id, true]);
  });

  it('ListSchools_IncludesHiddenSchools_WithTheirFlag', async () => {
    const id = await schoolId(`${PREFIX} Epsilon`);
    await admin.from('schools').update({ active: false }).eq('id', id);
    const list = await listSchools();
    expect(list.find((s) => s.id === id)?.active).toBe(false);
  });
});

describe('Lookups › Schools', () => {
  it('RenameSchool_ChangesTheName', async () => {
    const id = await schoolId(`${PREFIX} Zeta`);
    const res = await renameSchool(id, `${PREFIX} Zeta Academy`, 'ZA');
    const { data } = await admin.from('schools').select('name, short_name').eq('id', id).single();
    expect([res.ok, data]).toEqual([true, { name: `${PREFIX} Zeta Academy`, short_name: 'ZA' }]);
  });

  it('RenameSchool_Refuses_WhenAnotherSchoolHasThatName', async () => {
    await schoolId(`${PREFIX} Eta`);
    const id = await schoolId(`${PREFIX} Theta`);
    const res = await renameSchool(id, `${PREFIX} ETA`, null);
    expect(res.ok).toBe(false);
  });

  it('Leader_MergesSchool_RepointingScoutsAndDeletingTheLoser', async () => {
    const loser = await schoolId(`${PREFIX} Iota HS`);
    const survivor = await schoolId(`${PREFIX} Iota High School`);
    await admin.from('scouts').update({ school_id: loser }).eq('id', SCOUT_ID);
    const res = await mergeSchool(loser, survivor);
    const { data: gone } = await admin.from('schools').select('id').eq('id', loser);
    expect([res.ok, await scoutSchoolId(), gone]).toEqual([true, survivor, []]);
  });

  it('MergeSchool_Refuses_WhenMergingASchoolIntoItself', async () => {
    const id = await schoolId(`${PREFIX} Kappa`);
    expect((await mergeSchool(id, id)).ok).toBe(false);
  });

  it('Leader_CannotDeleteSchool_WhileAScoutUsesIt', async () => {
    const id = await schoolId(`${PREFIX} Lambda`);
    await admin.from('scouts').update({ school_id: id }).eq('id', SCOUT_ID);
    const res = await deleteSchool(id);
    const { data: still } = await admin.from('schools').select('id').eq('id', id);
    expect([res.ok, still?.length]).toEqual([false, 1]);
  });

  it('Leader_DeletesSchool_WhenNoScoutUsesIt', async () => {
    const id = await schoolId(`${PREFIX} Mu`);
    const res = await deleteSchool(id);
    const { data: gone } = await admin.from('schools').select('id').eq('id', id);
    expect([res.ok, gone]).toEqual([true, []]);
  });

  it('SetSchoolActive_HidesAndUnhides', async () => {
    const id = await schoolId(`${PREFIX} Nu`);
    await setSchoolActive(id, false);
    const { data: hidden } = await admin.from('schools').select('active').eq('id', id).single();
    await setSchoolActive(id, true);
    const { data: shown } = await admin.from('schools').select('active').eq('id', id).single();
    expect([hidden, shown]).toEqual([{ active: false }, { active: true }]);
  });
});

describe('scouts point at a school', () => {
  it('UpdateScoutFields_WritesSchoolId', async () => {
    const id = await schoolId(`${PREFIX} Xi`);
    const res = await updateScoutFields(SCOUT_ID, { school_id: id });
    expect([res.ok, await scoutSchoolId()]).toEqual([true, id]);
  });

  it('ChangeRequestApproval_ResolvesTheSchoolName_ToAnExistingSchool', async () => {
    const id = await schoolId(`${PREFIX} Omicron`);
    const { data: req } = await admin
      .from('change_requests')
      .insert({ entity_type: 'scout', entity_id: SCOUT_ID, proposed_changes: { school: `${PREFIX.toUpperCase()} OMICRON` } })
      .select('id')
      .single();
    const res = await approveChangeRequest((req as { id: number }).id);
    expect([res.ok, await scoutSchoolId()]).toEqual([true, id]);
  });

  it('ChangeRequestApproval_AddsTheSchool_WhenTheFamilyTypedANewOne', async () => {
    const { data: req } = await admin
      .from('change_requests')
      .insert({ entity_type: 'scout', entity_id: SCOUT_ID, proposed_changes: { school: `${PREFIX} Pi Charter` } })
      .select('id')
      .single();
    const res = await approveChangeRequest((req as { id: number }).id);
    const { data: made } = await admin.from('schools').select('id').eq('name', `${PREFIX} Pi Charter`).single();
    expect([res.ok, await scoutSchoolId()]).toEqual([true, (made as { id: number }).id]);
  });
});
