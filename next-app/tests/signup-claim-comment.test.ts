import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  createTestEvent,
  deleteTestEvent,
  createTestScout,
  deleteTestScout,
  TEST_PREFIX,
  type TestEvent,
  type TestScout
} from './helpers/signup-fixtures';

/**
 * Per-claim comments (2026-08-08).
 *
 * The comment rides on signup_slot_claims, whose PK is
 * (slot_id, signup_entry_id) — one note per person per job. Exercised through
 * the claim_signup_slot RPC, which is the only way the app writes a claim, so
 * these also pin the signature change: p_comment was added and the 2-argument
 * overload dropped in the same migration.
 */
describe('Per-claim comment', () => {
  const admin = adminClient();
  let event: TestEvent;
  let scout: TestScout;
  let slotId: number;
  let entryId: number;

  beforeAll(async () => {
    event = await createTestEvent(admin);
    scout = await createTestScout(admin, 'ClaimComment');

    const { data: slot, error: slotErr } = await admin
      .from('signup_slots')
      .insert({
        event_signup_id: event.eventSignupId,
        kind: 'task',
        label: `${TEST_PREFIX} Tables`,
        eligibility: 'both',
        attendance_required: false,
        needed: 5
      })
      .select('id')
      .single();
    if (slotErr || !slot) throw new Error(`fixture: slot insert failed: ${slotErr?.message}`);
    slotId = slot.id;

    const { data: entry, error: entryErr } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'scout',
        person_id: scout.personId,
        status: 'yes',
        participation: 'full'
      })
      .select('id')
      .single();
    if (entryErr || !entry) throw new Error(`fixture: entry insert failed: ${entryErr?.message}`);
    entryId = entry.id;
  });

  afterAll(async () => {
    await deleteTestEvent(admin, event);
    await deleteTestScout(admin, scout);
  });

  const commentOnClaim = async (): Promise<string | null> => {
    const { data } = await admin
      .from('signup_slot_claims')
      .select('comment')
      .eq('slot_id', slotId)
      .eq('signup_entry_id', entryId)
      .maybeSingle();
    return (data as { comment: string | null } | null)?.comment ?? null;
  };

  it('Comment_IsStored_WhenClaimingAJob', async () => {
    const { data, error } = await admin.rpc('claim_signup_slot', {
      p_slot_id: slotId,
      p_signup_entry_id: entryId,
      p_comment: '  I have a 6ft table  '
    });
    expect(error).toBeNull();
    expect(data).toBe('claimed');
    // Trimmed server-side, not just in the input's maxLength.
    expect(await commentOnClaim()).toBe('I have a 6ft table');
  });

  it('Comment_IsUpdated_WhenTheSameClaimIsResubmitted', async () => {
    // A family editing their signup resubmits every claim they already hold,
    // so the 'already' branch has to apply the new text — otherwise an edited
    // note is silently dropped on every job except newly added ones.
    const { data } = await admin.rpc('claim_signup_slot', {
      p_slot_id: slotId,
      p_signup_entry_id: entryId,
      p_comment: 'Can only stay until noon'
    });
    expect(data).toBe('already');
    expect(await commentOnClaim()).toBe('Can only stay until noon');
  });

  it('Comment_IsCleared_WhenResubmittedEmpty', async () => {
    await admin.rpc('claim_signup_slot', {
      p_slot_id: slotId,
      p_signup_entry_id: entryId,
      p_comment: '   '
    });
    expect(await commentOnClaim()).toBeNull();
  });

  it('Claim_StillWorks_WhenNoCommentIsGiven', async () => {
    // p_comment defaults, so a caller that never passes one behaves exactly
    // as before the column existed.
    const { data: second } = await admin.rpc('claim_signup_slot', {
      p_slot_id: slotId,
      p_signup_entry_id: entryId
    });
    expect(second).toBe('already');
    expect(await commentOnClaim()).toBeNull();
  });
});
