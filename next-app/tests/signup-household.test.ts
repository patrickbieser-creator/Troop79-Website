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
 * shape of the historical bug (D-042: one human reachable through two
 * different legacy identity columns gets listed, and can sign up, twice).
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
      const { error: err1 } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [
          { key: 'via-leader', person_kind: 'adult', leader_code: adult.leaderCode, status: 'yes' }
        ],
        p_actor: 'test:dedup',
        p_household_id: null
      });
      expect(err1).toBeNull();

      const { error: err2 } = await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [
          {
            key: 'via-parent',
            person_kind: 'adult',
            scout_parent_id: adult.scoutParentId,
            status: 'yes'
          }
        ],
        p_actor: 'test:dedup',
        p_household_id: null
      });
      expect(err2).toBeNull();

      // Same real human, reached through two different legacy identity
      // columns. Post-migration, both submissions must resolve to the SAME
      // signup_entries row via person_id — this is the DB-enforced half of
      // the fix (signup_entries_person_uniq), backstopping the RPC's own
      // person_id-aware existing-row lookup.
      const { data: rows, error: readErr } = await admin
        .from('signup_entries')
        .select('id, person_id, leader_code, scout_parent_id, status')
        .eq('event_signup_id', event.eventSignupId)
        .neq('status', 'cancelled');
      expect(readErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows?.[0].person_id).toBe(adult.personId);
    } finally {
      // Event FIRST: deleting it cascades away the signup_entries rows that
      // hold a FK on scout_id/scout_parent_id/leader_code — deleting the
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
          p_entries: [{ key: 's', person_kind: 'scout', scout_id: scoutA.scoutId, status: 'yes' }],
          p_actor: 'test:concurrentA',
          p_household_id: null
        }),
        clientB.rpc('submit_household_signup', {
          p_event_signup_id: event.eventSignupId,
          p_entries: [{ key: 's', person_kind: 'scout', scout_id: scoutB.scoutId, status: 'yes' }],
          p_actor: 'test:concurrentB',
          p_household_id: null
        })
      ]);
      expect(resA.error).toBeNull();
      expect(resB.error).toBeNull();

      const { data: rows } = await admin
        .from('signup_entries')
        .select('scout_id, status')
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
        p_entries: [{ key: 's', person_kind: 'scout', scout_id: scoutA.scoutId, status: 'yes' }],
        p_actor: 'test:promoteA',
        p_household_id: null
      });
      await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', scout_id: scoutB.scoutId, status: 'yes' }],
        p_actor: 'test:promoteB',
        p_household_id: null
      });

      const { data: before } = await admin
        .from('signup_entries')
        .select('scout_id, status')
        .eq('event_signup_id', event.eventSignupId)
        .eq('scout_id', scoutB.scoutId)
        .single();
      expect(before?.status).toBe('waitlist');

      const { error: cancelErr } = await admin.rpc('cancel_party_signup', {
        p_event_signup_id: event.eventSignupId,
        p_actor: 'test:promote-cancel',
        p_household_id: null,
        p_scout_ids: [scoutA.scoutId],
        p_scout_parent_ids: [],
        p_leader_codes: []
      });
      expect(cancelErr).toBeNull();

      const { data: after } = await admin
        .from('signup_entries')
        .select('scout_id, status')
        .eq('event_signup_id', event.eventSignupId)
        .eq('scout_id', scoutB.scoutId)
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
    // test rather than relying on the scout_ids coverage above.
    const admin = adminClient();
    const event = await createTestEvent(admin);
    const scout = await createTestScout(admin, 'CancelByPersonId');

    try {
      await admin.rpc('submit_household_signup', {
        p_event_signup_id: event.eventSignupId,
        p_entries: [{ key: 's', person_kind: 'scout', scout_id: scout.scoutId, status: 'yes' }],
        p_actor: 'test:cancel-by-person',
        p_household_id: null
      });

      const { error: cancelErr } = await admin.rpc('cancel_party_signup', {
        p_event_signup_id: event.eventSignupId,
        p_actor: 'test:cancel-by-person',
        p_household_id: null,
        p_scout_ids: [],
        p_scout_parent_ids: [],
        p_leader_codes: [],
        p_person_ids: [scout.personId]
      });
      expect(cancelErr).toBeNull();

      const { data: after } = await admin
        .from('signup_entries')
        .select('status')
        .eq('event_signup_id', event.eventSignupId)
        .eq('scout_id', scout.scoutId)
        .single();
      expect(after?.status).toBe('cancelled');
    } finally {
      await deleteTestEvent(admin, event);
      await deleteTestScout(admin, scout);
    }
  });
});
