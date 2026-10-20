import { describe, it, expect, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { latestRosterAsOf, loadRegistrationsFor, loadAllRegistrations, loadRosterPeople, saveRegistrations } from '../src/lib/bsa-roster-db';

/**
 * The five people.bsa_* columns: written only by saveRegistrations, read back
 * by the admin BSA Roster page and the member Registration page. Test-owned
 * people only (TEST_PREFIX display names).
 */
const admin = adminClient();
const P = `${TEST_PREFIX} BSA`;

async function person(label: string, extra: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ display_name: `${P} ${label}`, first_name: P, last_name: label, ...extra })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message);
  return data.id as number;
}

afterAll(async () => {
  await admin.from('people').update({ merged_into_person_id: null }).like('display_name', `${P}%`);
  await admin.from('people').delete().like('display_name', `${P}%`);
});

describe('saveRegistrations', () => {
  it('Leader_SavesARosterRegistration_AndItReadsBack', async () => {
    const id = await person('Saved');
    await saveRegistrations(admin, [
      { personId: id, expires: '2026-12-31', status: 'Multiple', positions: ['Scoutmaster', 'Key 3 Delegate'], autoRenewOptedOut: false, asOf: '2026-10-20' }
    ]);
    expect(await loadRegistrationsFor(admin, [id])).toEqual([
      { personId: id, name: `${P} Saved`, expires: '2026-12-31', status: 'Multiple', positions: ['Scoutmaster', 'Key 3 Delegate'], autoRenewOptedOut: false, asOf: '2026-10-20' }
    ]);
  });

  it('Leader_ResavingARoster_ReplacesTheEarlierRegistration', async () => {
    const id = await person('Resaved');
    const base = { personId: id, status: 'New', positions: ['Youth Member'], autoRenewOptedOut: null, asOf: '2026-10-20' };
    await saveRegistrations(admin, [{ ...base, expires: '2026-12-31' }]);
    await saveRegistrations(admin, [{ ...base, expires: '2027-12-31', asOf: '2027-01-05' }]);
    expect((await loadRegistrationsFor(admin, [id]))[0]).toMatchObject({ expires: '2027-12-31', asOf: '2027-01-05' });
  });
});

describe('loadAllRegistrations', () => {
  it('Leader_SeesOnlyPeopleWithASavedRegistration', async () => {
    const withReg = await person('Listed');
    const without = await person('Unlisted');
    await saveRegistrations(admin, [{ personId: withReg, expires: '2026-11-30', status: 'New', positions: [], autoRenewOptedOut: null, asOf: '2026-10-20' }]);
    const ids = (await loadAllRegistrations(admin)).map((r) => r.personId);
    expect([ids.includes(withReg), ids.includes(without)]).toEqual([true, false]);
  });
});

describe('loadRosterPeople', () => {
  it('Report_LeavesOutMergedPeople', async () => {
    const keep = await person('Keeper');
    const merged = await person('Merged', { merged_into_person_id: keep });
    const ids = (await loadRosterPeople(admin)).map((p) => p.id);
    expect([ids.includes(keep), ids.includes(merged)]).toEqual([true, false]);
  });
});

describe('loadRosterPeople test records', () => {
  it('Report_LeavesOutTestPeople', async () => {
    const t = await person('Tester', { is_test: true });
    expect((await loadRosterPeople(admin)).map((p) => p.id)).not.toContain(t);
  });
});

describe('latestRosterAsOf', () => {
  it('Leader_CannotUndoANewerRoster_BecauseTheNewestDateIsKnown', async () => {
    const id = await person('Newest');
    await saveRegistrations(admin, [{ personId: id, expires: '2099-12-31', status: 'New', positions: [], autoRenewOptedOut: null, asOf: '2099-01-01' }]);
    expect(await latestRosterAsOf(admin)).toBe('2099-01-01');
  });
});
