import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Plans/Retire-Roster-Contact-Columns.md Phase 2 — person_emails, with
 * people.primary_email as a two-way cache of the is_primary row so every
 * pre-existing reader/writer keeps working while the app moves over.
 */
describe('person_emails <-> people.primary_email', () => {
  const personIds: number[] = [];
  afterEach(async () => {
    if (personIds.length) await adminClient().from('people').delete().in('id', personIds);
    personIds.length = 0;
  });
  async function makePerson(email: string | null): Promise<number> {
    const { data, error } = await adminClient()
      .from('people')
      .insert({ display_name: '[TEST] Emails Person', primary_email: email, active: true })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ${error?.message}`);
    personIds.push(data.id as number);
    return data.id as number;
  }

  it('PersonEmails_ExactlyOnePrimary_PerPerson', async () => {
    const admin = adminClient();
    const id = await makePerson('one@example.com');
    const { error } = await admin.from('person_emails').insert({ person_id: id, email: 'two@example.com', is_primary: true });
    expect(error?.message ?? '').toMatch(/person_emails_one_primary|duplicate|unique/i);
  });

  it('PrimaryEmailCache_FollowsThePrimaryRow', async () => {
    const admin = adminClient();
    const id = await makePerson('first@example.com');
    await admin.from('person_emails').insert({ person_id: id, email: 'second@example.com', is_primary: false });
    // Promote: demote the old row, promote the new — the cache follows.
    await admin.from('person_emails').update({ is_primary: false }).eq('person_id', id).eq('is_primary', true);
    await admin.from('person_emails').update({ is_primary: true }).eq('person_id', id).eq('email', 'second@example.com');
    const { data } = await admin.from('people').select('primary_email').eq('id', id).single();
    expect(data?.primary_email).toBe('second@example.com');
  });

  it('WritingPeoplePrimaryEmail_UpsertsThePrimaryRow_AndKeepsTheOldAddress', async () => {
    const admin = adminClient();
    const id = await makePerson('old@example.com');
    await admin.from('people').update({ primary_email: 'New@Example.com' }).eq('id', id);
    const { data } = await admin.from('person_emails').select('email, is_primary').eq('person_id', id).order('email');
    expect(data).toEqual([
      { email: 'new@example.com', is_primary: true },
      { email: 'old@example.com', is_primary: false }
    ]);
  });

  it('NewPerson_WithAnEmail_GetsItsPrimaryRow', async () => {
    const id = await makePerson('fresh@example.com');
    const { data } = await adminClient().from('person_emails').select('email, is_primary').eq('person_id', id);
    expect(data).toEqual([{ email: 'fresh@example.com', is_primary: true }]);
  });
});
