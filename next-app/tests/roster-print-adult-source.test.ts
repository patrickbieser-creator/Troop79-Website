import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadRosterPrintData } from '../src/lib/roster-print-data';

/**
 * People-model audit (2026-08-26): the printed adult roster read
 * leaders.email/phone/address — columns nothing has written since the leader
 * edit form was retired on 2026-08-17 — so an adult's corrections on the
 * people spine never reached the one document leaders actually print. The
 * loader now prefers people.* and keeps leaders.* only as a fallback.
 */
describe('loadRosterPrintData — adult contact source', () => {
  const personIds: number[] = [];
  const householdIds: number[] = [];
  const leaderCodes: string[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (leaderCodes.length) await admin.from('leaders').delete().in('code', leaderCodes);
    if (personIds.length) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length) await admin.from('households').delete().in('id', householdIds);
    personIds.length = 0; householdIds.length = 0; leaderCodes.length = 0;
  });

  it('PrintedAdult_UsesThePeopleAddressAndPhone_OverStaleLeadersColumns', async () => {
    const admin = adminClient();
    const { data: hh } = await admin.from('households').insert({ label: '[TEST] Printsource' }).select('id').single();
    householdIds.push(hh!.id as number);
    const { data: p } = await admin
      .from('people')
      .insert({
        display_name: '[TEST] Printsource Parent',
        primary_email: 'printsource@example.com',
        primary_phone: '414-555-0199',
        address_line1: '9 Spine St',
        city: 'Milwaukee',
        state: 'WI',
        zip: '53211',
        active: true
      })
      .select('id')
      .single();
    personIds.push(p!.id as number);
    await admin.from('household_members').insert({ household_id: hh!.id, person_id: p!.id });
    const code = `ZZ${String(Date.now()).slice(-6)}`;
    leaderCodes.push(code);
    await admin.from('leaders').insert({
      code,
      name: '[TEST] Printsource Parent',
      is_person: true,
      person_id: p!.id,
      phone: '000-000-0000',
      email: 'stale@example.com',
      address_line1: '1 Old Leaders Rd',
      city: 'Nowhere',
      state: 'XX',
      zip: '00000'
    });

    const data = await loadRosterPrintData();
    const adult = data.adults.find((a) => a.personId === p!.id);
    expect(adult).toMatchObject({
      phone: '414-555-0199',
      email: 'printsource@example.com',
      address_line1: '9 Spine St',
      city: 'Milwaukee',
      state: 'WI',
      zip: '53211'
    });
  });
});
