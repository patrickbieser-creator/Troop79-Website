import { describe, it, expect, afterEach } from 'vitest';
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
import { guestNeedsForgetNudge, buildGuestTabRows } from '../src/lib/guest-people';

/**
 * People → Guests tab (Plans/Guests-As-People.md Phase 2): the pure row
 * shaper + retention nudge, and the two writes the tab offers — Forget
 * (delete when unreferenced, deactivate when referenced) and Promote (merge
 * the guest into the member they became). The db half calls the same
 * statements guest-actions.ts does.
 */

describe('guest people — pure', () => {
  it('GuestNeedsForgetNudge_WhenNoSignupIn12Months_CountingFromLastEventOrCreation', () => {
    expect(guestNeedsForgetNudge('2025-08-01', '2024-01-01', '2026-08-23')).toBe(true);
    expect(guestNeedsForgetNudge('2025-09-01', '2024-01-01', '2026-08-23')).toBe(false);
    // Exactly 12 months counts.
    expect(guestNeedsForgetNudge('2025-08-23', '2024-01-01', '2026-08-23')).toBe(true);
    // Never signed up → from creation.
    expect(guestNeedsForgetNudge(null, '2025-08-22', '2026-08-23')).toBe(true);
    expect(guestNeedsForgetNudge(null, '2026-01-10', '2026-08-23')).toBe(false);
  });

  it('BuildGuestTabRows_JoinsLatestClassAndMostRecentEvent_AndShowsPhoneForAdultsOnly', () => {
    const rows = buildGuestTabRows({
      people: [
        { id: 1, display_name: 'Grandma Pat', primary_phone: '414-555-0100', guest_host_household_id: 7, created_at: '2026-01-01T00:00:00Z' },
        { id: 2, display_name: 'Webelos Wes', primary_phone: '414-555-0199', guest_host_household_id: 7, created_at: '2026-01-01T00:00:00Z' },
        { id: 3, display_name: 'Never Came', primary_phone: null, guest_host_household_id: 8, created_at: '2024-05-05T00:00:00Z' }
      ],
      entries: [
        { id: 20, person_id: 1, participant_class: 'adult_guest', event_signup_id: 200 },
        { id: 10, person_id: 1, participant_class: 'adult_guest', event_signup_id: 100 },
        { id: 11, person_id: 2, participant_class: 'webelos', event_signup_id: 100 }
      ],
      signups: [
        { id: 100, calendar_entry_id: 1000 },
        { id: 200, calendar_entry_id: 2000 }
      ],
      events: [
        { id: 1000, title: 'Fall Campout', entry_date: '2026-10-09' },
        { id: 2000, title: 'Court of Honor', entry_date: '2026-05-01' }
      ],
      householdLabels: new Map([[7, 'Bieser']]),
      today: '2026-08-23'
    });
    expect(rows.map((r) => r.name)).toEqual(['Grandma Pat', 'Webelos Wes', 'Never Came']);
    const [pat, wes, never] = rows;
    expect(pat.hostLabel).toBe('Bieser');
    expect(pat.lastClass).toBe('adult_guest');
    expect(pat.phone).toBe('414-555-0100');
    // Most recent EVENT DATE, not newest row: the campout (Oct) beats the CoH (May).
    expect(pat.lastEventTitle).toBe('Fall Campout');
    expect(pat.forgetNudge).toBe(false);
    expect(wes.lastClass).toBe('webelos');
    expect(wes.phone).toBeNull(); // youth guest: never contact info
    expect(never.hostLabel).toBe('—');
    expect(never.lastClass).toBeNull();
    expect(never.lastEventTitle).toBeNull();
    expect(never.forgetNudge).toBe(true);
  });
});

describe('guest people — forget + promote (db)', () => {
  let admin: ReturnType<typeof adminClient>;
  let event: TestEvent | null = null;
  let scout: TestScout | null = null;
  let household: number | null = null;

  afterEach(async () => {
    if (event) await deleteTestEvent(admin, event);
    if (household) {
      const { data } = await admin.from('people').select('id').eq('guest_host_household_id', household);
      const ids = ((data ?? []) as { id: number }[]).map((r) => r.id);
      if (ids.length) await admin.from('people').delete().in('id', ids);
      await admin.from('households').delete().eq('id', household);
    }
    if (scout) await deleteTestScout(admin, scout);
    event = null;
    scout = null;
    household = null;
  });

  async function makeHousehold(label: string) {
    const { data, error } = await admin.from('households').insert({ label: `${TEST_PREFIX} ${label}` }).select('id').single();
    if (error || !data) throw new Error(`fixture: households insert failed: ${error?.message}`);
    return data.id as number;
  }
  async function makeGuest(name: string) {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `${TEST_PREFIX} ${name}`, guest_host_household_id: household })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: guest insert failed: ${error?.message}`);
    return data.id as number;
  }

  it('ForgetGuest_DeletesWhenUnreferenced_ElseDeactivates', async () => {
    admin = adminClient();
    household = await makeHousehold('ForgetHH');
    event = await createTestEvent(admin, { guestMode: 'named' });
    const unreferenced = await makeGuest('Unreferenced');
    const referenced = await makeGuest('Referenced');
    const { error: entryErr } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId, person_id: referenced, person_kind: 'scout', participant_class: 'youth_guest', status: 'yes'
    });
    expect(entryErr).toBeNull();

    // Same decision the action makes: count references first.
    for (const id of [unreferenced, referenced]) {
      const { count } = await admin.from('signup_entries').select('id', { count: 'exact', head: true }).eq('person_id', id);
      if ((count ?? 0) === 0) {
        const { error } = await admin.from('people').delete().eq('id', id);
        expect(error).toBeNull();
      } else {
        const { error } = await admin.from('people').update({ active: false, inactive_reason: 'guest-forgotten' }).eq('id', id);
        expect(error).toBeNull();
      }
    }
    const { data: gone } = await admin.from('people').select('id').eq('id', unreferenced);
    expect(gone).toEqual([]);
    const { data: kept } = await admin.from('people').select('active, inactive_reason').eq('id', referenced).single();
    expect(kept).toEqual({ active: false, inactive_reason: 'guest-forgotten' });
    // And the forgotten-but-referenced guest's entry still stands (history).
    const { data: entry } = await admin.from('signup_entries').select('person_id').eq('event_signup_id', event.eventSignupId).single();
    expect(entry?.person_id).toBe(referenced);
  });

  it('PromoteGuest_MergesIntoTheMember_MovingHistoryAndClearingTheFlag', async () => {
    admin = adminClient();
    household = await makeHousehold('PromoteHH');
    event = await createTestEvent(admin, { guestMode: 'named' });
    const guest = await makeGuest('Crossed Over');
    const { error: entryErr } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId, person_id: guest, person_kind: 'scout', participant_class: 'webelos', status: 'yes'
    });
    expect(entryErr).toBeNull();
    scout = await createTestScout(admin, 'PRMT');

    const { error } = await admin.rpc('merge_people', { p_survivor: scout.personId, p_loser: guest, p_decided_by: 'test:promote' });
    expect(error).toBeNull();

    const { data: entry } = await admin.from('signup_entries').select('person_id').eq('event_signup_id', event.eventSignupId).single();
    expect(entry?.person_id).toBe(scout.personId);
    const { data: g } = await admin.from('people').select('guest_host_household_id, merged_into_person_id').eq('id', guest).single();
    expect(g).toEqual({ guest_host_household_id: null, merged_into_person_id: scout.personId });
    // The merged-away guest row is no longer a guest of the household — the
    // cleanup above won't find it, so remove it here.
    await admin.from('people').delete().eq('id', guest);
  });

  it('PromoteGuest_IsBlocked_WhenBothHoldALiveSignupForTheSameEvent', async () => {
    admin = adminClient();
    household = await makeHousehold('BlockHH');
    event = await createTestEvent(admin, { guestMode: 'named' });
    scout = await createTestScout(admin, 'PRBL');
    const guest = await makeGuest('Twin');
    const { error: e1 } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId, person_id: guest, person_kind: 'scout', participant_class: 'webelos', status: 'yes'
    });
    const { error: e2 } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId, person_id: scout.personId, person_kind: 'scout', status: 'yes'
    });
    expect(e1).toBeNull();
    expect(e2).toBeNull();
    const { error } = await admin.rpc('merge_people', { p_survivor: scout.personId, p_loser: guest, p_decided_by: 'test:promote' });
    expect(error?.message).toContain('MERGE_BLOCKED_DUPLICATE_SIGNUP');
  });
});
