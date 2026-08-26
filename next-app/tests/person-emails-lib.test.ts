import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  listPersonEmails,
  addPersonEmail,
  setPrimaryEmail,
  removePersonEmail,
  emailsForPeople
} from '../src/lib/person-emails';

/**
 * lib/person-emails.ts — Plans/Retire-Roster-Contact-Columns.md Phase 2.
 * Real local Postgres, no mocks (D-049) — the partial unique index on
 * (person_id) where is_primary is a real DB constraint, so the swap-order
 * test below is only meaningful against the real thing.
 */
describe('person-emails lib', () => {
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (personIds.length > 0) {
      await admin.from('person_emails').delete().in('person_id', personIds);
      await admin.from('people').delete().in('id', personIds);
    }
    personIds = [];
  });

  async function makePerson(admin: ReturnType<typeof adminClient>, label: string): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `[TEST] ${label}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    personIds.push(data.id as number);
    return data.id as number;
  }

  it('AddPersonEmail_FirstAddressBecomesPrimary', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'FirstAddress');

    const row = await addPersonEmail(admin, personId, 'First@Example.com', 'home');
    expect(row.isPrimary).toBe(true);
    expect(row.email).toBe('first@example.com'); // normalized lowercase

    const { data: person } = await admin.from('people').select('primary_email').eq('id', personId).single();
    expect((person as { primary_email: string }).primary_email).toBe('first@example.com');
  });

  it('AddPersonEmail_SecondAddressIsNotPrimary', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'SecondAddress');
    await addPersonEmail(admin, personId, 'one@example.com');
    const second = await addPersonEmail(admin, personId, 'two@example.com', 'work');
    expect(second.isPrimary).toBe(false);
    expect(second.label).toBe('work');
  });

  it('AddPersonEmail_RefusesADuplicateAddress', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'Duplicate');
    await addPersonEmail(admin, personId, 'dup@example.com');
    await expect(addPersonEmail(admin, personId, 'DUP@example.com')).rejects.toThrow(
      /already on file/i
    );
  });

  it('ListPersonEmails_OrdersPrimaryFirst', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'Ordering');
    await addPersonEmail(admin, personId, 'zzz-primary@example.com');
    await addPersonEmail(admin, personId, 'aaa-other@example.com');

    const rows = await listPersonEmails(admin, personId);
    expect(rows).toHaveLength(2);
    expect(rows[0].isPrimary).toBe(true);
    expect(rows[0].email).toBe('zzz-primary@example.com');
  });

  it('SetPrimary_SwapsWithoutViolatingTheOnePrimaryIndex', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'SwapPrimary');
    const first = await addPersonEmail(admin, personId, 'first@example.com');
    const second = await addPersonEmail(admin, personId, 'second@example.com');

    await setPrimaryEmail(admin, personId, second.id);

    const rows = await listPersonEmails(admin, personId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(first.id)?.isPrimary).toBe(false);
    expect(byId.get(second.id)?.isPrimary).toBe(true);

    // people.primary_email tracks the new primary — the two-way trigger.
    const { data: person } = await admin.from('people').select('primary_email').eq('id', personId).single();
    expect((person as { primary_email: string }).primary_email).toBe('second@example.com');
  });

  it('SetPrimary_IsANoOp_WhenAlreadyPrimary', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'AlreadyPrimary');
    const first = await addPersonEmail(admin, personId, 'first@example.com');

    await expect(setPrimaryEmail(admin, personId, first.id)).resolves.toBeUndefined();
    const rows = await listPersonEmails(admin, personId);
    expect(rows.find((r) => r.id === first.id)?.isPrimary).toBe(true);
  });

  it('SetPrimary_RefusesAnAddressThatBelongsToSomeoneElse', async () => {
    const admin = adminClient();
    const personA = await makePerson(admin, 'OwnerA');
    const personB = await makePerson(admin, 'OwnerB');
    const addrOfB = await addPersonEmail(admin, personB, 'ownerb@example.com');

    await expect(setPrimaryEmail(admin, personA, addrOfB.id)).rejects.toThrow(
      /does not belong to this person/i
    );
  });

  it('Profile_CannotRemoveTheLastAddress', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'LastAddress');
    await addPersonEmail(admin, personId, 'only@example.com');

    const rows = await listPersonEmails(admin, personId);
    await expect(removePersonEmail(admin, personId, rows[0].id)).rejects.toThrow(/only address/i);

    // Refused, not partially applied.
    expect(await listPersonEmails(admin, personId)).toHaveLength(1);
  });

  it('RemovePersonEmail_RefusesThePrimary_EvenWithMoreThanOneAddress', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'RefusePrimary');
    const primary = await addPersonEmail(admin, personId, 'primary@example.com');
    await addPersonEmail(admin, personId, 'secondary@example.com');

    await expect(removePersonEmail(admin, personId, primary.id)).rejects.toThrow(/primary address/i);
    expect(await listPersonEmails(admin, personId)).toHaveLength(2);
  });

  it('RemovePersonEmail_RemovesANonPrimaryAddress', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'RemoveSecondary');
    await addPersonEmail(admin, personId, 'primary@example.com');
    const secondary = await addPersonEmail(admin, personId, 'secondary@example.com');

    await removePersonEmail(admin, personId, secondary.id);

    const rows = await listPersonEmails(admin, personId);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('primary@example.com');
  });

  it('EmailsForPeople_BatchesAcrossMultiplePeople', async () => {
    const admin = adminClient();
    const personA = await makePerson(admin, 'BatchA');
    const personB = await makePerson(admin, 'BatchB');
    await addPersonEmail(admin, personA, 'a1@example.com');
    await addPersonEmail(admin, personA, 'a2@example.com');
    await addPersonEmail(admin, personB, 'b1@example.com');

    const map = await emailsForPeople(admin, [personA, personB]);
    expect(map.get(personA)).toHaveLength(2);
    expect(map.get(personB)).toHaveLength(1);
  });

  it('EmailsForPeople_OmitsPeopleWithNoAddresses', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'NoAddresses');

    const map = await emailsForPeople(admin, [personId]);
    expect(map.get(personId) ?? []).toHaveLength(0);
  });
});
