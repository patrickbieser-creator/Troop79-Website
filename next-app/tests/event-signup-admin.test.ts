import { describe, it, expect } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, createTestScout, deleteTestScout } from './helpers/signup-fixtures';
import { backfillEventPrices, slotClaimants, questionAnswers, diffClaimEdits, signupEntryInsertRow, addCandidatesFor } from '../src/lib/event-signup-admin';

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

/**
 * Roster row "Edit" for jobs & commitments (Patrick, 2026-08-21: "these jobs
 * and commitments often fluctuate widely between when people sign up and the
 * day of need"). The dialog edits a whole set of claims at once; this pure
 * diff turns before/after into the minimal claimSlotFor/unclaimSlotFor calls.
 */
describe('diffClaimEdits (pure)', () => {
  it('DiffClaimEdits_AddsNewSlots_AndRemovesDroppedOnes', () => {
    const d = diffClaimEdits(
      [{ slotId: 1, comment: null }, { slotId: 2, comment: 'bringing two' }],
      [{ slotId: 2, comment: 'bringing two' }, { slotId: 3, comment: null }]
    );
    expect(d.upsert).toEqual([{ slotId: 3, comment: null }]);
    expect(d.remove).toEqual([1]);
  });

  it('DiffClaimEdits_UpsertsWhenOnlyTheCommentChanged', () => {
    const d = diffClaimEdits([{ slotId: 2, comment: 'one table' }], [{ slotId: 2, comment: 'two tables' }]);
    expect(d.upsert).toEqual([{ slotId: 2, comment: 'two tables' }]);
    expect(d.remove).toEqual([]);
  });

  it('DiffClaimEdits_TreatsBlankAndNullComments_AsTheSame', () => {
    const d = diffClaimEdits([{ slotId: 2, comment: null }], [{ slotId: 2, comment: '   ' }]);
    expect(d.upsert).toEqual([]);
    expect(d.remove).toEqual([]);
  });

  it('DiffClaimEdits_IsEmpty_WhenNothingChanged', () => {
    const same = [{ slotId: 1, comment: 'x' }, { slotId: 4, comment: null }];
    expect(diffClaimEdits(same, [...same].reverse())).toEqual({ upsert: [], remove: [] });
  });
});

/**
 * Leader "Add a person" (builder/roster) — the insert payload must match the
 * live signup_entries columns. Regression for 2026-08-21: the action still
 * wrote scout_id + adult_name after the scout_parents retirement dropped
 * them, so every Add failed with "could not find the adult_name column".
 */
describe('signupEntryInsertRow (pure)', () => {
  it('InsertRow_UsesPersonIdAndKindOnly_NeverTheRetiredIdentityColumns', () => {
    const row = signupEntryInsertRow({
      signupId: 5, personId: 77, isScout: false, status: 'yes', participation: 'full', updatedBy: 'Test'
    });
    expect(row).toEqual({
      event_signup_id: 5, person_id: 77, person_kind: 'adult', status: 'yes', participation: 'full', updated_by: 'Test'
    });
    expect(Object.keys(row)).not.toContain('adult_name');
    expect(Object.keys(row)).not.toContain('scout_id');
  });

  it('InsertRow_MarksAScout_AsPersonKindScout', () => {
    expect(signupEntryInsertRow({
      signupId: 5, personId: 8, isScout: true, status: 'waitlist', participation: 'full', updatedBy: 'T'
    }).person_kind).toBe('scout');
  });

  it('SignupEntries_SchemaHasNoAdultNameColumn_SoTheOldPayloadCannotComeBack', async () => {
    const { error } = await adminClient().from('signup_entries').select('adult_name').limit(1);
    expect(error).not.toBeNull();
  });
});

/**
 * "Add a person" candidate list (Patrick, 2026-08-21: "only allows one add…
 * if a user clicks done they can not add another"). The live failure was
 * v1.69's dropped-column insert; the remaining trap was DESIGN: anyone the
 * leader had Removed was hidden from Add (only Restore offered them back),
 * even though addSignupEntry already reinstates a cancelled entry safely.
 * Removed people are now offered, flagged, so Add always has a way forward.
 */
describe('addCandidatesFor (pure)', () => {
  const directory = [
    { person_id: 1, display_name: 'Adi Alfred', scout_id: 'S1' },
    { person_id: 2, display_name: 'Ben Bieser', scout_id: 'S2' },
    { person_id: 3, display_name: 'Nina Bendre', scout_id: null }
  ];

  it('AddCandidates_ExcludesPeopleWithALiveEntry', () => {
    const out = addCandidatesFor(directory, [{ person_id: 1, status: 'yes' }]);
    expect(out.map((c) => c.personId)).toEqual([2, 3]);
  });

  it('AddCandidates_OffersRemovedPeople_FlaggedAsRemoved', () => {
    const out = addCandidatesFor(directory, [{ person_id: 2, status: 'cancelled' }]);
    const ben = out.find((c) => c.personId === 2);
    expect(ben?.removed).toBe(true);
    expect(out.find((c) => c.personId === 1)?.removed).toBe(false);
  });

  it('AddCandidates_MarksScoutsAndAdults_AndSkipsGuestRowsWithoutAPerson', () => {
    const out = addCandidatesFor(directory, [{ person_id: null, status: 'yes' }]);
    expect(out.map((c) => [c.personId, c.isScout])).toEqual([[1, true], [2, true], [3, false]]);
  });
});
