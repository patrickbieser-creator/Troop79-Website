import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Person Editor Rethink, Phase 2 (Plans/Person-Editor-Rethink.md) — the
 * per-section writes behind the record page. Each section's Save calls ONE
 * action with ONLY that section's fields, and every action reads the row
 * before writing so its audit row carries a field-level from→to diff in
 * `details` (the summary names people and field NAMES only, D-257):
 *
 *   updateScoutIdentity      scouts (name, patrol) + people (name, BSA id)
 *   updateScoutFields        scouts only (school, grade, swim, JL override)
 *   updatePersonDemographics people, only the keys the form sent
 *   setHousehold             household_members, Household from→to labels
 *
 * Same request-glue mocks as person-record-load.test.ts; the DB is real.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import { updateScoutFields, updateScoutIdentity } from '../src/app/admin/(workspace)/advancement/lookups/actions';
import { setHousehold, updatePersonDemographics } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

const admin = adminClient();
const SCOUT_ID = 'ZZWRT1';
let adultId = 0;
let scoutPersonId = 0;
let houseA = 0;
let houseB = 0;

interface AuditRow {
  summary: string;
  details: { field: string; from: string; to: string }[] | null;
}

async function insertPerson(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin.from('people').insert(row).select('id').single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  return (data as { id: number }).id;
}

async function insertHousehold(label: string): Promise<number> {
  const { data, error } = await admin.from('households').insert({ label }).select('id').single();
  if (error || !data) throw new Error(`fixture: households insert failed: ${error?.message}`);
  return (data as { id: number }).id;
}

async function latestAudit(entityType: string, entityId: string): Promise<AuditRow> {
  const { data, error } = await admin
    .from('audit_log')
    .select('summary, details')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`no audit row for ${entityType} ${entityId}: ${error?.message}`);
  return data as AuditRow;
}

beforeAll(async () => {
  adultId = await insertPerson({
    first_name: 'ZZWrite',
    last_name: 'Adult',
    display_name: 'ZZWrite Adult',
    primary_phone: '(414) 555-0100',
    city: 'Milwaukee',
    birthdate: '1980-05-04',
    active: true
  });
  scoutPersonId = await insertPerson({
    first_name: 'ZZWrite',
    last_name: 'Scout',
    display_name: 'ZZWrite Scout',
    birthdate: '2012-09-01',
    active: true
  });
  const { error: scoutErr } = await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZWrite',
    last_name: 'Scout',
    display_name: 'ZZWrite Scout',
    patrol: 'ZZ Patrol',
    active: true,
    person_id: scoutPersonId
  });
  if (scoutErr) throw new Error(`fixture: scouts insert failed: ${scoutErr.message}`);
  houseA = await insertHousehold('ZZWrite House A');
  houseB = await insertHousehold('ZZWrite House B');
  const { error: memErr } = await admin
    .from('household_members')
    .insert({ household_id: houseA, person_id: adultId });
  if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);
});

afterAll(async () => {
  const ids = [adultId, scoutPersonId].filter(Boolean);
  await admin
    .from('audit_log')
    .delete()
    .in('entity_id', [SCOUT_ID, ...ids.map(String)]);
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
  await admin.from('households').delete().in('id', [houseA, houseB].filter(Boolean));
  if (ids.length) await admin.from('people').delete().in('id', ids);
});

describe('Phase 2 section writes — one section, one action, field-level audit details', () => {
  it('UpdateScoutIdentity_WritesScoutsAndPeople_AndAuditDetails', async () => {
    const res = await updateScoutIdentity(SCOUT_ID, {
      first_name: 'ZZWritten',
      last_name: 'Scout',
      patrol: 'ZZ Owls',
      bsa_member_id: '999000111'
    });
    expect(res).toEqual({ ok: true });

    const { data: scout } = await admin
      .from('scouts')
      .select('first_name, last_name, display_name, patrol')
      .eq('id', SCOUT_ID)
      .single();
    expect(scout).toEqual({ first_name: 'ZZWritten', last_name: 'Scout', display_name: 'ZZWritten Scout', patrol: 'ZZ Owls' });

    const { data: person } = await admin
      .from('people')
      .select('first_name, last_name, display_name, bsa_member_id')
      .eq('id', scoutPersonId)
      .single();
    expect(person).toEqual({
      first_name: 'ZZWritten',
      last_name: 'Scout',
      display_name: 'ZZWritten Scout',
      bsa_member_id: '999000111'
    });

    const audit = await latestAudit('scout', SCOUT_ID);
    expect(audit.details).toEqual([
      { field: 'First name', from: 'ZZWrite', to: 'ZZWritten' },
      { field: 'Patrol', from: 'ZZ Patrol', to: 'ZZ Owls' },
      { field: 'BSA member ID', from: '—', to: '999000111' }
    ]);
    // Values live in details only — never in the summary (D-257).
    expect(audit.summary).not.toContain('ZZ Owls');
    expect(audit.summary).not.toContain('999000111');
  });

  it('UpdateScoutFields_WritesOnlyScoutColumns', async () => {
    const { data: personBefore } = await admin
      .from('people')
      .select('first_name, birthdate, updated_at')
      .eq('id', scoutPersonId)
      .single();

    const res = await updateScoutFields(SCOUT_ID, {
      school: 'ZZ Middle School',
      graduation_year: 2031,
      swim_class: 'beginner',
      junior_leader_override: 'yes'
    });
    expect(res).toEqual({ ok: true });

    const { data: scout } = await admin
      .from('scouts')
      .select('school, graduation_year, swim_class, junior_leader_override')
      .eq('id', SCOUT_ID)
      .single();
    expect(scout).toEqual({
      school: 'ZZ Middle School',
      graduation_year: 2031,
      swim_class: 'beginner',
      junior_leader_override: 'yes'
    });

    // The person row is untouched — not even its updated_at.
    const { data: personAfter } = await admin
      .from('people')
      .select('first_name, birthdate, updated_at')
      .eq('id', scoutPersonId)
      .single();
    expect(personAfter).toEqual(personBefore);

    const audit = await latestAudit('scout', SCOUT_ID);
    expect(audit.details).toEqual(
      expect.arrayContaining([
        { field: 'School', from: '—', to: 'ZZ Middle School' },
        { field: 'Swim class', from: '—', to: 'Beginner' },
        { field: 'Junior leader', from: 'Derived from grade', to: 'Yes (override)' }
      ])
    );
    expect(audit.details?.find((d) => d.field === 'Grade')?.to).toContain('class of 2031');
    expect(audit.summary).not.toContain('ZZ Middle School');
  });

  it('UpdatePersonDemographics_RecordsFieldLevelDetails', async () => {
    // The Contact section sends ONLY its own keys — the rest must survive.
    const fd = new FormData();
    fd.set('primary_phone', '(414) 555-0199');
    fd.set('city', 'Wauwatosa');
    const res = await updatePersonDemographics(adultId, fd);
    expect(res).toEqual({ ok: true });

    const { data: person } = await admin
      .from('people')
      .select('first_name, last_name, primary_phone, city, birthdate')
      .eq('id', adultId)
      .single();
    expect(person).toEqual({
      first_name: 'ZZWrite',
      last_name: 'Adult',
      primary_phone: '(414) 555-0199',
      city: 'Wauwatosa',
      birthdate: '1980-05-04'
    });

    const audit = await latestAudit('person', String(adultId));
    expect(audit.details).toEqual([
      { field: 'Phone', from: '(414) 555-0100', to: '(414) 555-0199' },
      { field: 'City', from: 'Milwaukee', to: 'Wauwatosa' }
    ]);
    expect(audit.summary).toContain('primary_phone');
    expect(audit.summary).not.toContain('Wauwatosa');
  });

  it('UpdatePersonDemographics_RefusesBlankName_WhenNamesAreSent', async () => {
    const fd = new FormData();
    fd.set('first_name', 'ZZWrite');
    fd.set('last_name', '');
    const res = await updatePersonDemographics(adultId, fd);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/First and last name are required/);
  });

  it('SetHousehold_RecordsFromToLabels', async () => {
    const moved = await setHousehold(adultId, houseB);
    expect(moved).toEqual({ ok: true });
    const { data: members } = await admin.from('household_members').select('household_id').eq('person_id', adultId);
    expect(members).toEqual([{ household_id: houseB }]);

    const first = await latestAudit('household_membership', String(adultId));
    expect(first.details).toEqual([{ field: 'Household', from: 'ZZWrite House A', to: 'ZZWrite House B' }]);
    expect(first.summary).not.toContain('ZZWrite House B');

    const removed = await setHousehold(adultId, null);
    expect(removed).toEqual({ ok: true });
    const second = await latestAudit('household_membership', String(adultId));
    expect(second.details).toEqual([{ field: 'Household', from: 'ZZWrite House B', to: '—' }]);
  });
});
