import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, TEST_PREFIX, type TestScout } from './helpers/signup-fixtures';
import { recipientsForScouts } from '../src/lib/email-recipients';
import { addPersonEmail } from '../src/lib/person-emails';

/**
 * recipientsForScouts — Plans/Retire-Roster-Contact-Columns.md Phase 2.
 * Addresses now come from `person_emails` (every deliverable row of every
 * parent), not the legacy scout_parent_emails, which this file used to seed
 * directly. Real local Postgres, no mocks (D-049).
 */
describe('recipientsForScouts — person_emails', () => {
  const scouts: TestScout[] = [];
  const parentPersonIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    for (const s of scouts.splice(0)) await deleteTestScout(admin, s);
    if (parentPersonIds.length > 0) {
      await admin.from('relationships').delete().in('person_id', parentPersonIds);
      await admin.from('person_emails').delete().in('person_id', parentPersonIds);
      await admin.from('people').delete().in('id', parentPersonIds);
    }
    parentPersonIds.length = 0;
  });

  async function makeParent(admin: ReturnType<typeof adminClient>, label: string, forScout: TestScout) {
    const { data: person, error: personErr } = await admin
      .from('people')
      .insert({ display_name: `${TEST_PREFIX} Parent ${label}` })
      .select('id')
      .single();
    if (personErr || !person) throw new Error(`fixture: people insert failed: ${personErr?.message}`);
    parentPersonIds.push(person.id);

    const { error: relErr } = await admin
      .from('relationships')
      .insert({ person_id: person.id, related_person_id: forScout.personId, type: 'parent_of' });
    if (relErr) throw new Error(`fixture: relationships insert failed: ${relErr.message}`);

    return person.id as number;
  }

  it('RecipientsForScouts_FindsThePrimaryEmail', async () => {
    const admin = adminClient();
    const scout = await createTestScout(admin, 'RecipPrimary');
    scouts.push(scout);
    const parentId = await makeParent(admin, 'Primary', scout);
    await addPersonEmail(admin, parentId, 'primary@example.test'); // first address -> primary

    const recipients = await recipientsForScouts([scout.scoutId]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe('primary@example.test');
    expect(recipients[0].scoutIds).toEqual([scout.scoutId]);
  });

  it('RecipientsForScouts_MailsEveryDeliverableAddress_NotJustThePrimary', async () => {
    const admin = adminClient();
    const scout = await createTestScout(admin, 'RecipMulti');
    scouts.push(scout);
    const parentId = await makeParent(admin, 'Multi', scout);
    await addPersonEmail(admin, parentId, 'home@example.test');
    await addPersonEmail(admin, parentId, 'work@example.test', 'work');

    const recipients = await recipientsForScouts([scout.scoutId]);
    const emails = recipients.map((r) => r.email).sort();
    expect(emails).toEqual(['home@example.test', 'work@example.test']);
    for (const r of recipients) expect(r.scoutIds).toEqual([scout.scoutId]);
  });

  it('RecipientsForScouts_SkipsBouncedAndUnsubscribed', async () => {
    const admin = adminClient();
    const scout = await createTestScout(admin, 'RecipBounce');
    scouts.push(scout);
    const parentId = await makeParent(admin, 'Bounce', scout);
    const bounced = await addPersonEmail(admin, parentId, 'bounced@example.test');
    await admin.from('person_emails').update({ bounced_at: new Date(2026, 0, 1).toISOString() }).eq('id', bounced.id);
    await addPersonEmail(admin, parentId, 'live@example.test', 'work');

    const recipients = await recipientsForScouts([scout.scoutId]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe('live@example.test');
  });

  it('RecipientsForScouts_DedupesSiblingsToOneRecipient', async () => {
    const admin = adminClient();
    const scoutA = await createTestScout(admin, 'RecipSibA');
    const scoutB = await createTestScout(admin, 'RecipSibB');
    scouts.push(scoutA, scoutB);

    // One parent, two parent_of edges (siblings sharing an adult) — the
    // real-world shape that made the re-key's dedup rule necessary.
    const { data: person, error: personErr } = await admin
      .from('people')
      .insert({ display_name: `${TEST_PREFIX} Parent SharedSibling` })
      .select('id')
      .single();
    if (personErr || !person) throw new Error(`fixture: people insert failed: ${personErr?.message}`);
    parentPersonIds.push(person.id);
    await admin
      .from('relationships')
      .insert([
        { person_id: person.id, related_person_id: scoutA.personId, type: 'parent_of' },
        { person_id: person.id, related_person_id: scoutB.personId, type: 'parent_of' }
      ]);
    await addPersonEmail(admin, person.id, 'shared@example.test');

    const recipients = await recipientsForScouts([scoutA.scoutId, scoutB.scoutId]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].scoutIds.sort()).toEqual([scoutA.scoutId, scoutB.scoutId].sort());
  });

  it('RecipientsForScouts_MergesTwoParentsWhoShareOneAddress_IntoOneRecipient', async () => {
    const admin = adminClient();
    const scout = await createTestScout(admin, 'RecipSharedAddr');
    scouts.push(scout);
    const parentA = await makeParent(admin, 'SharedA', scout);
    const parentB = await makeParent(admin, 'SharedB', scout);
    await addPersonEmail(admin, parentA, 'shared-inbox@example.test');
    await addPersonEmail(admin, parentB, 'shared-inbox@example.test');

    const recipients = await recipientsForScouts([scout.scoutId]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe('shared-inbox@example.test');
    expect(recipients[0].parentName).toContain('SharedA');
    expect(recipients[0].parentName).toContain('SharedB');
    expect(recipients[0].scoutIds).toEqual([scout.scoutId]);
  });

  it('RecipientsForScouts_WritingPrimaryEmailDirectly_StillProducesADeliverableAddress', async () => {
    // people.primary_email is a two-way cache (the migration's trigger),
    // so a writer that still sets it directly — a leader editing Demographics,
    // say — feeds person_emails automatically. This is the same fallback
    // this module has always had, now exercised through the live trigger
    // rather than a copy of the column.
    const admin = adminClient();
    const scout = await createTestScout(admin, 'RecipDirectPrimary');
    scouts.push(scout);
    const parentId = await makeParent(admin, 'DirectPrimary', scout);
    await admin.from('people').update({ primary_email: 'directwrite@example.test' }).eq('id', parentId);

    const recipients = await recipientsForScouts([scout.scoutId]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe('directwrite@example.test');
  });
});
