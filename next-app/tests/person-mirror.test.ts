import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { mirrorRosterFieldsToPerson } from '../src/lib/person-mirror';

/**
 * The people spine was bootstrapped once from scouts.* / leaders.* (migration
 * 20260720100000) and never synced after: the scout Edit form wrote
 * scouts.email while sign-in read people.primary_email. Found live
 * 2026-08-26 — Patrick changed a scout's email in the roster and the sign-in
 * picker kept offering the old one. Every roster save now mirrors the shared
 * demographic fields onto the linked people row.
 */
describe('mirrorRosterFieldsToPerson', () => {
  const personIds: number[] = [];
  afterEach(async () => {
    if (personIds.length > 0) await adminClient().from('people').delete().in('id', personIds);
    personIds.length = 0;
  });

  async function makePerson(): Promise<number> {
    const { data, error } = await adminClient()
      .from('people')
      .insert({ display_name: '[TEST] Mirror Person', primary_email: 'old@example.com', active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ${error?.message}`);
    personIds.push(data.id as number);
    return data.id as number;
  }

  it('RosterSave_MirrorsEmailPhoneAddressAndNames_OntoThePersonRow', async () => {
    const admin = adminClient();
    const id = await makePerson();
    await mirrorRosterFieldsToPerson(admin, id, {
      first_name: 'Charlie',
      last_name: 'Walters',
      email: 'New@Example.com ',
      phone: '414-555-0100',
      address_line1: '1 Trail Rd',
      city: 'Milwaukee',
      state: 'WI',
      zip: '53202',
      birthdate: '2012-04-01'
    });
    const { data } = await admin
      .from('people')
      .select('first_name, last_name, display_name, primary_email, primary_phone, address_line1, city, state, zip, birthdate')
      .eq('id', id)
      .single();
    expect(data).toMatchObject({
      first_name: 'Charlie',
      last_name: 'Walters',
      display_name: 'Charlie Walters',
      primary_email: 'new@example.com',
      primary_phone: '414-555-0100',
      address_line1: '1 Trail Rd',
      city: 'Milwaukee',
      state: 'WI',
      zip: '53202',
      birthdate: '2012-04-01'
    });
  });

  it('RosterSave_ClearsThePersonEmail_WhenTheFormClearsIt', async () => {
    // An explicit empty field means "no address" — a parent's stale address
    // must not survive on the person row after a leader blanks it.
    const admin = adminClient();
    const id = await makePerson();
    await mirrorRosterFieldsToPerson(admin, id, { email: null });
    const { data } = await admin.from('people').select('primary_email').eq('id', id).single();
    expect(data?.primary_email).toBeNull();
  });

  it('RosterSave_IsANoOp_WithoutAPersonLink', async () => {
    await expect(mirrorRosterFieldsToPerson(adminClient(), null, { email: 'x@example.com' })).resolves.toBeUndefined();
  });

  it('EveryRosterSaveAction_CallsTheMirror', () => {
    const src = readFileSync(
      new URL('../src/app/admin/(workspace)/advancement/lookups/actions.ts', import.meta.url),
      'utf8'
    );
    for (const name of ['createScout', 'updateScout', 'createLeader', 'updateLeader']) {
      const start = src.indexOf(`export async function ${name}`);
      expect(start, name).toBeGreaterThan(-1);
      const end = src.indexOf('\nexport async function', start + 1);
      expect(src.slice(start, end === -1 ? undefined : end), name).toMatch(/mirror(Scout|Leader)ToPerson\(/);
    }
  });
});
