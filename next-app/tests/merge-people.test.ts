import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, TEST_PREFIX, type TestEvent } from './helpers/signup-fixtures';

/**
 * Regression coverage for the qa-lead finding (2026-07-20): merge_people
 * reassigned person_id everywhere EXCEPT signup_entries, which didn't exist
 * as a person_id-bearing table when merge_people was first written. Left
 * alone, a merge silently reopens D-042 — a signup submitted before the
 * merge keeps pointing at the loser's now-superseded person_id forever.
 */
describe('merge_people — signup_entries reassignment', () => {
  let event: TestEvent | null = null;
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    // Event first — deleting it cascades away any signup_entries rows that
    // hold an FK on these people; deleting people first would leave that FK
    // dangling and fail silently.
    if (event) await deleteTestEvent(admin, event);
    if (personIds.length > 0) {
      const { error } = await admin.from('people').delete().in('id', personIds);
      if (error) throw new Error(`fixture cleanup: people delete failed: ${error.message}`);
    }
    event = null;
    personIds = [];
  });

  async function makePerson(admin: ReturnType<typeof adminClient>, label: string) {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `${TEST_PREFIX} Merge ${label}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    personIds.push(data.id);
    return data.id as number;
  }

  it('Merge_ReassignsSignupEntries_WhenLoserHadPriorSignup', async () => {
    const admin = adminClient();
    event = await createTestEvent(admin);
    const survivor = await makePerson(admin, 'Survivor1');
    const loser = await makePerson(admin, 'Loser1');

    const { error: insertErr } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      person_kind: 'adult',
      person_id: loser,
      status: 'yes'
    });
    expect(insertErr).toBeNull();

    const { error: mergeErr } = await admin.rpc('merge_people', {
      p_survivor: survivor,
      p_loser: loser,
      p_decided_by: 'test:merge'
    });
    expect(mergeErr).toBeNull();

    const { data: entry } = await admin
      .from('signup_entries')
      .select('person_id')
      .eq('event_signup_id', event.eventSignupId)
      .single();
    expect(entry?.person_id).toBe(survivor);
  });

  it('Merge_Blocks_WhenBothSidesHaveLiveSignupForSameEvent', async () => {
    const admin = adminClient();
    event = await createTestEvent(admin);
    const survivor = await makePerson(admin, 'Survivor2');
    const loser = await makePerson(admin, 'Loser2');

    const { error: e1 } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      person_kind: 'adult',
      person_id: survivor,
      status: 'yes'
    });
    const { error: e2 } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      person_kind: 'adult',
      person_id: loser,
      status: 'yes'
    });
    expect(e1).toBeNull();
    expect(e2).toBeNull();

    const { error: mergeErr } = await admin.rpc('merge_people', {
      p_survivor: survivor,
      p_loser: loser,
      p_decided_by: 'test:merge'
    });
    expect(mergeErr).not.toBeNull();
    expect(mergeErr?.message).toContain('MERGE_BLOCKED_DUPLICATE_SIGNUP');

    // Blocked means blocked — nothing committed, not even the earlier steps.
    const { data: loserPerson } = await admin
      .from('people')
      .select('merged_into_person_id')
      .eq('id', loser)
      .single();
    expect(loserPerson?.merged_into_person_id).toBeNull();
  });
});
