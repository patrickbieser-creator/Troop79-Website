import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { mergeScoutRow, loadScoutRows, type ScoutCoreRow, type ScoutPersonContactRow } from '../src/lib/scout-row';

/**
 * The scout↔people join (Plans/Retire-Roster-Contact-Columns.md) — the
 * Roster's scout form/table read contact and demographic fields from the
 * linked `people` row, not from `scouts` directly.
 */
describe('mergeScoutRow', () => {
  const core: ScoutCoreRow = {
    id: 'ZZ01',
    first_name: 'Zed',
    last_name: 'Zephyr',
    display_name: 'Zed Zephyr',
    patrol: 'Hawk',
    current_rank: 'scout',
    active: true,
    inactive_reason: null,
    school: 'Test Middle',
    graduation_year: 2030,
    swim_class: 'swimmer',
    junior_leader_override: null,
    person_id: 42
  };

  it('ReadsContactAndDemographicFields_FromTheLinkedPerson', () => {
    const person: ScoutPersonContactRow = {
      id: 42,
      address_line1: '1 Trail Rd',
      address_line2: null,
      city: 'Milwaukee',
      state: 'WI',
      zip: '53202',
      primary_phone: '414-555-0100',
      primary_email: 'zed@example.com',
      birthdate: '2013-05-01',
      gender: 'M',
      bsa_member_id: '999888777',
      health_form_date: '2026-01-01',
      things_we_should_know: 'None'
    };
    const row = mergeScoutRow(core, person);
    expect(row).toMatchObject({
      person_id: 42,
      id: 'ZZ01',
      display_name: 'Zed Zephyr',
      patrol: 'Hawk',
      address_line1: '1 Trail Rd',
      city: 'Milwaukee',
      phone: '414-555-0100',
      email: 'zed@example.com',
      birthdate: '2013-05-01',
      gender: 'M',
      bsa_member_id: '999888777',
      health_form_date: '2026-01-01',
      things_we_should_know: 'None'
    });
  });

  it('LeavesContactFieldsNull_WhenNoLinkedPersonRow', () => {
    const row = mergeScoutRow({ ...core, person_id: null }, undefined);
    expect(row.address_line1).toBeNull();
    expect(row.email).toBeNull();
    expect(row.birthdate).toBeNull();
    expect(row.bsa_member_id).toBeNull();
    // Scout-only facts still come through even with no person link.
    expect(row.patrol).toBe('Hawk');
    expect(row.school).toBe('Test Middle');
  });
});

describe('loadScoutRows', () => {
  const scoutIds: string[] = [];
  const personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (scoutIds.length > 0) await admin.from('scouts').delete().in('id', scoutIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    scoutIds.length = 0;
    personIds.length = 0;
  });

  it('MergesARealScoutRow_WithItsLinkedPersonsContactFields', async () => {
    const admin = adminClient();
    const { data: person, error: pErr } = await admin
      .from('people')
      .insert({
        display_name: '[TEST] ScoutRow Person',
        first_name: 'Rowan',
        last_name: 'Testerson',
        primary_email: 'rowan@example.com',
        primary_phone: '414-555-0177',
        birthdate: '2012-01-01',
        active: true
      })
      .select('id')
      .single();
    if (pErr || !person) throw new Error(`fixture: ${pErr?.message}`);
    personIds.push(person.id as number);

    const id = `zztest-${Date.now()}`;
    scoutIds.push(id);
    const { error: sErr } = await admin.from('scouts').insert({
      id,
      first_name: 'Rowan',
      last_name: 'Testerson',
      display_name: 'Rowan Testerson',
      active: true,
      person_id: person.id
    });
    if (sErr) throw new Error(`fixture: ${sErr.message}`);

    const rows = await loadScoutRows(admin);
    const row = rows.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      email: 'rowan@example.com',
      phone: '414-555-0177',
      birthdate: '2012-01-01'
    });
  });
});
