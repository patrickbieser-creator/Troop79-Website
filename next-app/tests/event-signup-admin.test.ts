import { describe, it, expect } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, createTestScout, deleteTestScout } from './helpers/signup-fixtures';
import { backfillEventPrices, slotClaimants, questionAnswers } from '../src/lib/event-signup-admin';

/**
 * Coverage for the event-builder warn/backfill logic added 2026-07-25:
 * adding a price tier can now retroactively price existing un-priced entries
 * when the choice is unambiguous, and deleting a slot/question now reports
 * exactly who/what is affected before the destructive delete runs.
 */
describe('backfillEventPrices', () => {
  it('BackfillEventPrices_AssignsTier_WhenExactlyOneEligible', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'BackfillSingle');

    const { data: price } = await admin
      .from('event_prices')
      .insert({ event_signup_id: event.eventSignupId, label: 'Everyone', amount: 450, per: 'event', applies_to: 'both' })
      .select('id')
      .single();
    const { data: entry } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'scout',
        person_id: scout.personId,
        status: 'yes'
      })
      .select('id')
      .single();

    try {
      const result = await backfillEventPrices(admin, event.eventSignupId);
      expect(result.applied).toBe(1);
      expect(result.skippedAmbiguous).toBe(0);
      expect(result.skippedPerDay).toBe(0);

      const { data: after } = await admin
        .from('signup_entries')
        .select('price_id')
        .eq('id', entry!.id)
        .single();
      expect(after?.price_id).toBe(price!.id);
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });

  it('BackfillEventPrices_SkipsAmbiguous_WhenTwoTiersEligibleForSameKind', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'BackfillAmbiguous');

    await admin.from('event_prices').insert([
      { event_signup_id: event.eventSignupId, label: 'Tier A', amount: 100, per: 'event', applies_to: 'scouts' },
      { event_signup_id: event.eventSignupId, label: 'Tier B', amount: 200, per: 'event', applies_to: 'both' }
    ]);
    const { data: entry } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'scout',
        person_id: scout.personId,
        status: 'yes'
      })
      .select('id')
      .single();

    try {
      const result = await backfillEventPrices(admin, event.eventSignupId);
      expect(result.applied).toBe(0);
      expect(result.skippedAmbiguous).toBe(1);

      const { data: after } = await admin.from('signup_entries').select('price_id').eq('id', entry!.id).single();
      expect(after?.price_id).toBeNull();
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });

  it('BackfillEventPrices_SkipsPerDayTier_EvenWhenUnambiguous', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'BackfillPerDay');

    await admin
      .from('event_prices')
      .insert({ event_signup_id: event.eventSignupId, label: 'Daily', amount: 50, per: 'day', applies_to: 'both' });
    const { data: entry } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'scout',
        person_id: scout.personId,
        status: 'yes'
      })
      .select('id')
      .single();

    try {
      const result = await backfillEventPrices(admin, event.eventSignupId);
      expect(result.applied).toBe(0);
      expect(result.skippedPerDay).toBe(1);

      const { data: after } = await admin.from('signup_entries').select('price_id').eq('id', entry!.id).single();
      expect(after?.price_id).toBeNull();
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });

  it('BackfillEventPrices_SkipsDriverOnlyAndContributor_NeverAttendingNeverCharged', async () => {
    // Caught live against production: a "Driver Only" adult (participation
    // != 'full') isn't attending the event and must never be billed for it,
    // even though person_kind/price_id alone would otherwise look eligible.
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const driver = await createTestScout(admin, 'BackfillDriverOnly');
    const contributor = await createTestScout(admin, 'BackfillContributor');

    await admin
      .from('event_prices')
      .insert({ event_signup_id: event.eventSignupId, label: 'Everyone', amount: 450, per: 'event', applies_to: 'both' });
    const { data: driverEntry, error: driverErr } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'adult',
        person_id: driver.personId,
        status: 'yes',
        participation: 'driver_only',
        // signup_entries_driver_only requires an actual leg driven.
        drives_out: true,
        seats_offered_out: 3
      })
      .select('id')
      .single();
    if (driverErr || !driverEntry) throw new Error(`fixture: driver entry insert failed: ${driverErr?.message}`);
    const { data: contributorEntry, error: contributorErr } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'scout',
        person_id: contributor.personId,
        status: 'yes',
        participation: 'contributor'
      })
      .select('id')
      .single();
    if (contributorErr || !contributorEntry) {
      throw new Error(`fixture: contributor entry insert failed: ${contributorErr?.message}`);
    }

    // A legitimately payable adult in the SAME event, sharing the same
    // per-kind batch update as the driver-only row above. Before the
    // participation filter, including a driver_only row in the 'adult'
    // update's .in(ids) would trip the DB's signup_entries_driver_only CHECK
    // (price_id must stay null for driver-only) and fail the WHOLE batched
    // update atomically — silently leaving this payable adult unpriced too.
    // Caught exactly this way in production (Jason Porter, Tesomas Summer
    // Camp, 2026-07-25).
    const payableAdult = await createTestScout(admin, 'BackfillPayableAdult');
    const { data: payableEntry, error: payableErr } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'adult',
        person_id: payableAdult.personId,
        status: 'yes',
        participation: 'full'
      })
      .select('id')
      .single();
    if (payableErr || !payableEntry) throw new Error(`fixture: payable adult insert failed: ${payableErr?.message}`);

    try {
      const result = await backfillEventPrices(admin, event.eventSignupId);
      expect(result.applied).toBe(1);

      const { data: after } = await admin
        .from('signup_entries')
        .select('id, price_id')
        .in('id', [driverEntry.id, contributorEntry.id, payableEntry.id]);
      const priceById = new Map((after ?? []).map((r) => [r.id, r.price_id]));
      expect(priceById.get(driverEntry.id)).toBeNull();
      expect(priceById.get(contributorEntry.id)).toBeNull();
      expect(priceById.get(payableEntry.id)).not.toBeNull();
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, driver);
      await deleteTestScout(admin, contributor);
      await deleteTestScout(admin, payableAdult);
    }
  });

  it('BackfillEventPrices_LeavesAlreadyPricedEntries_Untouched', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'BackfillAlreadyPriced');

    const { data: originalTier } = await admin
      .from('event_prices')
      .insert({ event_signup_id: event.eventSignupId, label: 'Original', amount: 10, per: 'event', applies_to: 'both' })
      .select('id')
      .single();
    await admin
      .from('event_prices')
      .insert({ event_signup_id: event.eventSignupId, label: 'New', amount: 20, per: 'event', applies_to: 'both' });
    const { data: entry } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'scout',
        person_id: scout.personId,
        status: 'yes',
        price_id: originalTier!.id
      })
      .select('id')
      .single();

    try {
      // Two tiers exist now (ambiguous), but this entry already has a price —
      // backfill must never overwrite an existing choice.
      const result = await backfillEventPrices(admin, event.eventSignupId);
      expect(result.applied).toBe(0);

      const { data: after } = await admin.from('signup_entries').select('price_id').eq('id', entry!.id).single();
      expect(after?.price_id).toBe(originalTier!.id);
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });
});

describe('slotClaimants', () => {
  it('SlotClaimants_ReturnsEmpty_WhenNoOneHasClaimedIt', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const { data: slot } = await admin
      .from('signup_slots')
      .insert({ event_signup_id: event.eventSignupId, kind: 'task', label: 'Bring napkins', eligibility: 'both' })
      .select('id')
      .single();

    try {
      const claimants = await slotClaimants(admin, slot!.id);
      expect(claimants).toEqual([]);
    } finally {
      await deleteTestEvent(admin, event);
    }
  });

  it('SlotClaimants_ReturnsName_ForEachActiveClaimant', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'SlotClaimant');
    const { data: slot } = await admin
      .from('signup_slots')
      .insert({ event_signup_id: event.eventSignupId, kind: 'task', label: 'Bring dessert', eligibility: 'both' })
      .select('id')
      .single();
    const { data: entry } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'scout',
        person_id: scout.personId,
        status: 'yes'
      })
      .select('id')
      .single();
    await admin.from('signup_slot_claims').insert({ slot_id: slot!.id, signup_entry_id: entry!.id });

    try {
      const claimants = await slotClaimants(admin, slot!.id);
      expect(claimants).toHaveLength(1);
      expect(claimants[0].name).toContain('Scout SlotClaimant');
      expect(claimants[0].status).toBe('yes');
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });
});

describe('questionAnswers', () => {
  it('QuestionAnswers_ReturnsEmpty_WhenNobodyHasAnswered', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const { data: question } = await admin
      .from('signup_questions')
      .insert({
        event_signup_id: event.eventSignupId,
        prompt: 'Shoe size?',
        input_type: 'text',
        applies_to: 'both',
        required: false
      })
      .select('id')
      .single();

    try {
      const answers = await questionAnswers(admin, question!.id);
      expect(answers).toEqual([]);
    } finally {
      await deleteTestEvent(admin, event);
    }
  });

  it('QuestionAnswers_ReturnsNameAndValue_ForEachRecordedAnswer', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'QuestionAnswer');
    const { data: question } = await admin
      .from('signup_questions')
      .insert({
        event_signup_id: event.eventSignupId,
        prompt: 'Shoe size?',
        input_type: 'text',
        applies_to: 'both',
        required: false
      })
      .select('id')
      .single();
    const { data: entry } = await admin
      .from('signup_entries')
      .insert({
        event_signup_id: event.eventSignupId,
        person_kind: 'scout',
        person_id: scout.personId,
        status: 'yes'
      })
      .select('id')
      .single();
    await admin.from('signup_answers').insert({ signup_entry_id: entry!.id, question_id: question!.id, value: '10.5' });

    try {
      const answers = await questionAnswers(admin, question!.id);
      expect(answers).toHaveLength(1);
      expect(answers[0].value).toBe('10.5');
      expect(answers[0].name).toContain('Scout QuestionAnswer');
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });
});
