import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { groupStaleClaimsByEntry } from '../src/lib/event-signup';
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
 * Batched stale-claim delete (Plans/Performance-Review-2026-08-27.md #12).
 *
 * submitSignupAction used to issue one `.delete()` per stale (slot, entry)
 * pair. groupStaleClaimsByEntry collapses a person's stale claims into one
 * group so the caller can drop them with a single `.in('slot_id', …)` call —
 * this exercises that grouping against real rows across two slots for one
 * entry, the shape a submit produces when someone unchecks two jobs at once.
 */
describe('Batched stale-claim delete', () => {
  const admin = adminClient();
  let event: TestEvent;
  let scout: TestScout;
  let slotAId: number;
  let slotBId: number;
  let entryId: number;

  beforeAll(async () => {
    event = await createTestEvent(admin);
    scout = await createTestScout(admin, 'ClaimBatch');

    const { data: slots, error: slotErr } = await admin
      .from('signup_slots')
      .insert([
        { event_signup_id: event.eventSignupId, kind: 'task', label: `${TEST_PREFIX} Setup`, eligibility: 'both', attendance_required: false, needed: 5 },
        { event_signup_id: event.eventSignupId, kind: 'task', label: `${TEST_PREFIX} Cleanup`, eligibility: 'both', attendance_required: false, needed: 5 }
      ])
      .select('id');
    if (slotErr || !slots) throw new Error(`fixture: slots insert failed: ${slotErr?.message}`);
    slotAId = slots[0].id;
    slotBId = slots[1].id;

    const { data: entry, error: entryErr } = await admin
      .from('signup_entries')
      .insert({ event_signup_id: event.eventSignupId, person_kind: 'scout', person_id: scout.personId, status: 'yes', participation: 'full' })
      .select('id')
      .single();
    if (entryErr || !entry) throw new Error(`fixture: entry insert failed: ${entryErr?.message}`);
    entryId = entry.id;

    // Claim both jobs the way the app does — through the RPC, not a raw insert.
    for (const slotId of [slotAId, slotBId]) {
      const { error } = await admin.rpc('claim_signup_slot', { p_slot_id: slotId, p_signup_entry_id: entryId });
      if (error) throw new Error(`fixture: claim_signup_slot failed: ${error.message}`);
    }
  });

  afterAll(async () => {
    await deleteTestEvent(admin, event);
    await deleteTestScout(admin, scout);
  });

  it('Grouping_PutsBothSlotsForOneEntry_InASingleGroup', () => {
    const stale = [
      { entryId, slotId: slotAId },
      { entryId, slotId: slotBId }
    ];
    const groups = groupStaleClaimsByEntry(stale);
    // One group covering both slots — this is what lets the caller delete
    // with one `.in('slot_id', …)` call instead of two `.eq()` calls.
    expect(groups).toEqual([{ entryId, slotIds: [slotAId, slotBId] }]);
  });

  it('DeletingByTheGroupedShape_RemovesBothClaims_InOneCall', async () => {
    const stale = [
      { entryId, slotId: slotAId },
      { entryId, slotId: slotBId }
    ];
    const [group] = groupStaleClaimsByEntry(stale);
    const { error } = await admin.from('signup_slot_claims').delete().eq('signup_entry_id', group.entryId).in('slot_id', group.slotIds);
    expect(error).toBeNull();

    const { data: remaining } = await admin.from('signup_slot_claims').select('slot_id').eq('signup_entry_id', entryId);
    expect(remaining ?? []).toEqual([]);
  });
});
