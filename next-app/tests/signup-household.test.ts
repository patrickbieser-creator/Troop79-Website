import { describe, it, expect } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  createTestEvent,
  deleteTestEvent,
  createTestScout,
  deleteTestScout,
  createDualIdentityAdult,
  deleteDualIdentityAdult
} from './helpers/signup-fixtures';

/**
 * Acceptance tests for the last step of Plans/People-Identity-Model.md:
 * migrating submit_household_signup (and cancel_household_signup /
 * cancel_party_signup / promote_waitlist) from the four legacy nullable
 * identity columns to signup_entries.person_id.
 *
 * Test 1 is the genuinely NEW, currently-failing test — it is the exact
 * shape of the historical bug (D-042: one human reachable two ways gets
 * listed, and can sign up, twice). The two ways were legacy identity columns
 * until D-066 removed them; the dedup rule they proved still holds.
 * Tests 2 and 3 are REGRESSIONS: D-033's capacity lock and waitlist
 * promotion already work today and must keep working, unchanged, through
 * the person_id cutover.
 */
describe('submit_household_signup — person_id migration', () => {
  it('Signup_RejectsSecondEntry_WhenSamePersonAlreadyRegistered', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const adult = await createDualIdentityAdult(admin, 'Dedup');

    try {
      // Two separate submissions for the same human, arriving under different
      // entry keys — which is what two routes to the same person produced
      // before D-066 removed the columns that made those routes possible.
      // The dedup itself is unchanged and still worth pinning: one person,
      // one row, enforced by signup_entries_person_uniq and backstopped by
      // the RPC's own existing-row lookup.
      const { error: err1 } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [
          { key: 'first-route', person_kind: 'adult', person_id: adult.personId, status: 'yes' }
        ],
        p_actor: 'test:dedup',
        p_household_id: null
      });
      expect(err1).toBeNull();

      const { error: err2 } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [
          { key: 'second-route', person_kind: 'adult', person_id: adult.personId, status: 'yes' }
        ],
        p_actor: 'test:dedup',
        p_household_id: null
      });
      expect(err2).toBeNull();

      const { data: rows, error: readErr } = await admin
        .from('signup_entries')
        .select('id, person_id, status')
        .eq('event_signup_id', event.eventSignupId)
        .neq('status', 'cancelled');
      expect(readErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows?.[0].person_id).toBe(adult.personId);
    } finally {
      // Event FIRST: deleting it cascades away the signup_entries rows that
      // hold a RESTRICT FK on person_id — deleting the
      // scout/adult before that leaves those FKs dangling and the delete
      // silently fails (no error thrown), orphaning the test fixture.
      await deleteTestEvent(admin, event);
      await deleteDualIdentityAdult(admin, adult);
    }
  });

  it('Signup_HoldsCapacity_WhenTwoHouseholdsSubmitConcurrently', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin, { capacity: 1, waitlistEnabled: true });
    const scoutA = await createTestScout(admin, 'ConcurrentA');
    const scoutB = await createTestScout(admin, 'ConcurrentB');

    try {
      // Two independent clients submitting at once — this is the D-033
      // regression: the RPC's FOR UPDATE lock on event_signups must
      // serialize these so exactly one gets the seat and the other waits,
      // never both landing as 'yes' against a capacity of 1.
      const clientA = adminClient();
      const clientB = adminClient();

      const [resA, resB] = await Promise.all([
        clientA.rpc('submit_household_signup', {
          p_event_signup_id: event.eventSignupId,
          p_entries: [{ key: 's', person_kind: 'scout', person_id: scoutA.personId, status: 'yes' }],
          p_actor: 'test:concurrentA',
          p_household_id: null
        }),
        clientB.rpc('submit_household_signup', {
          p_event_signup_id: event.eventSignupId,
          p_entries: [{ key: 's', person_kind: 'scout', person_id: scoutB.personId, status: 'yes' }],
          p_actor: 'test:concurrentB',
          p_household_id: null
        })
      ]);
      expect(resA.error).toBeNull();
      expect(resB.error).toBeNull();

      const { data: rows } = await admin
        .from('signup_entries')
        .select('person_id, status')
        .eq('event_signup_id', event.eventSignupId)
        .neq('status', 'cancelled');

      const statuses = (rows ?? []).map((r) => r.status).sort();
      expect(statuses).toEqual(['waitlist', 'yes']);
    } finally {
      // Event first — see the comment in the test above for why.
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scoutA);
      await deleteTestScout(admin, scoutB);
    }
  });

  it('Signup_PromotesFromWaitlist_WhenEntryCancelled', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin, { capacity: 1, waitlistEnabled: true });
    const scoutA = await createTestScout(admin, 'PromoteA');
    const scoutB = await createTestScout(admin, 'PromoteB');

    try {
      await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', person_id: scoutA.personId, status: 'yes' }],
        p_actor: 'test:promoteA',
        p_household_id: null
      });
      await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', person_id: scoutB.personId, status: 'yes' }],
        p_actor: 'test:promoteB',
        p_household_id: null
      });

      const { data: before } = await admin
        .from('signup_entries')
        .select('person_id, status')
        .eq('event_signup_id', event.eventSignupId)
        .eq('person_id', scoutB.personId)
        .single();
      expect(before?.status).toBe('waitlist');

      const { error: cancelErr } = await admin.rpc('cancel_party_signup', {
        p_event_signup_id: event.eventSignupId,
        p_actor: 'test:promote-cancel',
        p_household_id: null,
        p_person_ids: [scoutA.personId]
      });
      expect(cancelErr).toBeNull();

      const { data: after } = await admin
        .from('signup_entries')
        .select('person_id, status')
        .eq('event_signup_id', event.eventSignupId)
        .eq('person_id', scoutB.personId)
        .single();
      expect(after?.status).toBe('yes');
    } finally {
      // Event first — see the comment in the test above for why.
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scoutA);
      await deleteTestScout(admin, scoutB);
    }
  });

  it('Signup_Cancels_ViaPersonId_WhichIsWhatProductionCodeActuallySends', async () => {
    // cancelSignupAction (actions.ts) always sends p_person_ids now — this is
    // the live path, not the legacy arrays, which is why it earns its own
    // test rather than relying on the coverage above.
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'CancelByPersonId');

    try {
      await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', person_id: scout.personId, status: 'yes' }],
        p_actor: 'test:cancel-by-person',
        p_household_id: null
      });

      const { error: cancelErr } = await admin.rpc('cancel_party_signup', {
        p_event_signup_id: event.eventSignupId,
        p_actor: 'test:cancel-by-person',
        p_household_id: null,
        p_person_ids: [scout.personId]
      });
      expect(cancelErr).toBeNull();

      const { data: after } = await admin
        .from('signup_entries')
        .select('status')
        .eq('event_signup_id', event.eventSignupId)
        .eq('person_id', scout.personId)
        .single();
      expect(after?.status).toBe('cancelled');
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });
});

/**
 * Acceptance tests for the household-membership validation added to
 * submit_household_signup on 2026-07-25 (qa-lead LOW finding on the D-048
 * review, closed as part of the signup-identity-cleanup session). Before this,
 * the RPC trusted a client-supplied person_id with no check that it belonged
 * to the submitting party at all.
 */
describe('submit_household_signup — party membership validation', () => {
  it('Signup_Rejects_WhenPersonIdNotInAllowedParty', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scoutA = await createTestScout(admin, 'PartyA');
    const scoutB = await createTestScout(admin, 'PartyB');

    try {
      const { error } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [
          { key: 's', person_kind: 'scout', person_id: scoutB.personId, status: 'yes' }
        ],
        p_actor: 'test:party-reject',
        p_household_id: null,
        p_allowed_person_ids: [scoutA.personId]
      });
      expect(error?.message).toContain('PERSON_NOT_IN_PARTY');

      // Whole-call atomicity: the rejected entry must not have been written.
      const { data: rows } = await admin
        .from('signup_entries')
        .select('id')
        .eq('event_signup_id', event.eventSignupId)
        .eq('person_id', scoutB.personId);
      expect(rows).toHaveLength(0);
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scoutA);
      await deleteTestScout(admin, scoutB);
    }
  });

  it('Signup_Accepts_WhenPersonIdInAllowedParty', async () => {
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scoutA = await createTestScout(admin, 'PartyAccept');

    try {
      const { error } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [
          { key: 's', person_kind: 'scout', person_id: scoutA.personId, status: 'yes' }
        ],
        p_actor: 'test:party-accept',
        p_household_id: null,
        p_allowed_person_ids: [scoutA.personId]
      });
      expect(error).toBeNull();

      const { data: rows } = await admin
        .from('signup_entries')
        .select('id, status')
        .eq('event_signup_id', event.eventSignupId)
        .eq('person_id', scoutA.personId);
      expect(rows).toHaveLength(1);
      expect(rows?.[0].status).toBe('yes');
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scoutA);
    }
  });

  it('Signup_Accepts_WhenAllowedPersonIdsOmitted', async () => {
    // Back-compat: a caller that hasn't been deployed with the new param yet
    // (default null) must not be rejected — this is what makes the migration
    // and the actions.ts change deployable in either order.
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'PartyOmitted');

    try {
      const { error } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', person_id: scout.personId, status: 'yes' }],
        p_actor: 'test:party-omitted',
        p_household_id: null
      });
      expect(error).toBeNull();
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });

  it('Signup_DedupesSamePersonId_AcrossTwoSubmissions', async () => {
    // The direct, simpler invariant Piece 2/3 introduce: two calls that both
    // send person_id straight (no legacy columns at all) for the same person
    // resolve to one row. Complements (not replaces) the legacy-column dedup
    // test above, which stays true as long as those columns exist.
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'PartyDedup');

    try {
      const { error: err1 } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', person_id: scout.personId, status: 'yes' }],
        p_actor: 'test:dedup1',
        p_household_id: null,
        p_allowed_person_ids: [scout.personId]
      });
      expect(err1).toBeNull();

      const { error: err2 } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', person_id: scout.personId, status: 'yes' }],
        p_actor: 'test:dedup2',
        p_household_id: null,
        p_allowed_person_ids: [scout.personId]
      });
      expect(err2).toBeNull();

      const { data: rows } = await admin
        .from('signup_entries')
        .select('id')
        .eq('event_signup_id', event.eventSignupId)
        .eq('person_id', scout.personId)
        .neq('status', 'cancelled');
      expect(rows).toHaveLength(1);
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });
});
