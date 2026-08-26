import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { writePersonDemographics } from '../src/lib/write-person-demographics';

/**
 * The one writer for a scout's or adult's contact/demographic facts on
 * `people` (Plans/Retire-Roster-Contact-Columns.md) — replaces the
 * `scouts`/`leaders` copies createScout/updateScout used to write directly.
 */
describe('writePersonDemographics', () => {
  const personIds: number[] = [];
  afterEach(async () => {
    if (personIds.length > 0) await adminClient().from('people').delete().in('id', personIds);
    personIds.length = 0;
  });

  async function makePerson(): Promise<number> {
    const { data, error } = await adminClient()
      .from('people')
      .insert({ display_name: '[TEST] Demographics Person', primary_email: 'old@example.com', active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ${error?.message}`);
    personIds.push(data.id as number);
    return data.id as number;
  }

  it('WritesEveryGivenField_OntoThePersonRow', async () => {
    const admin = adminClient();
    const id = await makePerson();
    const result = await writePersonDemographics(admin, id, {
      primary_email: 'new@example.com',
      primary_phone: '414-555-0100',
      address_line1: '1 Trail Rd',
      city: 'Milwaukee',
      state: 'WI',
      zip: '53202',
      birthdate: '2012-04-01',
      gender: 'M',
      bsa_member_id: '123456789',
      health_form_date: '2026-01-01',
      things_we_should_know: 'Peanut allergy'
    });
    expect(result.error).toBeNull();

    const { data } = await admin
      .from('people')
      .select(
        'primary_email, primary_phone, address_line1, city, state, zip, birthdate, gender, bsa_member_id, health_form_date, things_we_should_know'
      )
      .eq('id', id)
      .single();
    expect(data).toMatchObject({
      primary_email: 'new@example.com',
      primary_phone: '414-555-0100',
      address_line1: '1 Trail Rd',
      city: 'Milwaukee',
      state: 'WI',
      zip: '53202',
      birthdate: '2012-04-01',
      gender: 'M',
      bsa_member_id: '123456789',
      health_form_date: '2026-01-01',
      things_we_should_know: 'Peanut allergy'
    });
  });

  it('LeavesOmittedFields_Alone', async () => {
    const admin = adminClient();
    const id = await makePerson();
    await writePersonDemographics(admin, id, { primary_phone: '414-555-0199' });
    const { data } = await admin.from('people').select('primary_email, primary_phone').eq('id', id).single();
    // primary_email was never mentioned — the fixture's value survives.
    expect(data).toMatchObject({ primary_email: 'old@example.com', primary_phone: '414-555-0199' });
  });

  it('ClearsAField_WhenExplicitlyGivenNull', async () => {
    const admin = adminClient();
    const id = await makePerson();
    await writePersonDemographics(admin, id, { primary_email: null });
    const { data } = await admin.from('people').select('primary_email').eq('id', id).single();
    expect(data?.primary_email).toBeNull();
  });
});
