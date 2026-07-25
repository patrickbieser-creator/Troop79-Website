import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, TEST_PREFIX, type TestScout } from './helpers/signup-fixtures';
import { recipientsForScouts } from '../src/lib/email-recipients';

/**
 * Regression coverage for the scout_parent_emails re-key to person_id
 * (2026-07-25). Before this, deliverability tracking (bounce/unsubscribe,
 * primary address) was keyed on scout_parent_id and email-recipients.ts had
 * to join through scout_parents to reach it — one of the two FKs blocking a
 * future scout_parents drop (held for a later session).
 */
describe('recipientsForScouts — person_id-keyed scout_parent_emails', () => {
  const scouts: TestScout[] = [];
  const parentPersonIds: number[] = [];
  const emailIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (emailIds.length > 0) await admin.from('scout_parent_emails').delete().in('id', emailIds);
    for (const s of scouts.splice(0)) await deleteTestScout(admin, s);
    if (parentPersonIds.length > 0) {
      await admin.from('relationships').delete().in('person_id', parentPersonIds);
      await admin.from('people').delete().in('id', parentPersonIds);
    }
    parentPersonIds.length = 0;
    emailIds.length = 0;
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

  async function addEmail(
    admin: ReturnType<typeof adminClient>,
    personId: number,
    email: string,
    opts: { isPrimary?: boolean; bouncedAt?: string } = {}
  ) {
    const { data, error } = await admin
      .from('scout_parent_emails')
      .insert({
        person_id: personId,
        email,
        is_primary: opts.isPrimary ?? false,
        bounced_at: opts.bouncedAt ?? null
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: scout_parent_emails insert failed: ${error?.message}`);
    emailIds.push(data.id);
  }

  it('RecipientsForScouts_FindsPrimaryEmail_ByPersonId', async () => {
    const admin = adminClient();
    const scout = await createTestScout(admin, 'RecipPrimary');
    scouts.push(scout);
    const parentId = await makeParent(admin, 'Primary', scout);
    await addEmail(admin, parentId, 'primary@example.test', { isPrimary: true });
    await addEmail(admin, parentId, 'secondary@example.test');

    const recipients = await recipientsForScouts([scout.scoutId]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe('primary@example.test');
    expect(recipients[0].scoutIds).toEqual([scout.scoutId]);
  });

  it('RecipientsForScouts_SkipsBouncedAndUnsubscribed', async () => {
    const admin = adminClient();
    const scout = await createTestScout(admin, 'RecipBounce');
    scouts.push(scout);
    const parentId = await makeParent(admin, 'Bounce', scout);
    await addEmail(admin, parentId, 'bounced@example.test', {
      isPrimary: true,
      bouncedAt: new Date(2026, 0, 1).toISOString()
    });
    await addEmail(admin, parentId, 'live@example.test');

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
    await addEmail(admin, person.id, 'shared@example.test', { isPrimary: true });

    const recipients = await recipientsForScouts([scoutA.scoutId, scoutB.scoutId]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].scoutIds.sort()).toEqual([scoutA.scoutId, scoutB.scoutId].sort());
  });
});
