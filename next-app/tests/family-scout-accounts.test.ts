import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, TEST_PREFIX, type TestEvent } from './helpers/signup-fixtures';
import { loadFamilyScoutAccounts, resolveScoutAccountPayer } from '../src/lib/family-scout-accounts';

/**
 * A scout's account can pay an event fee for anyone in the scout's family
 * (Patrick, 2026-10-05: Winnie's balance pays her dad's High Cliff fee).
 * The fixture is that family: a scout with $85, her dad with no account of
 * his own, a guest the household brought, and a stranger with money who must
 * never be offered.
 */
const admin = adminClient();
let event: TestEvent;
let householdId: number;
let scoutId: number;
let dadId: number;
let guestId: number;
let strangerId: number;

async function person(name: string, extra: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} ${name}`, ...extra })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  return data.id as number;
}
async function credit(personId: number, amount: number, extra: Record<string, unknown> = {}) {
  const { error } = await admin
    .from('financial_transactions')
    .insert({ occurred_on: '2026-09-01', account: 'scout_account', amount, kind: 'adjustment', method: 'other', person_id: personId, ...extra });
  if (error) throw new Error(`fixture: financial_transactions insert failed: ${error.message}`);
}

beforeAll(async () => {
  event = await createTestEvent(admin);
  const { data: hh, error } = await admin.from('households').insert({ label: `${TEST_PREFIX} family funds` }).select('id').single();
  if (error || !hh) throw new Error(`fixture: households insert failed: ${error?.message}`);
  householdId = hh.id as number;
  scoutId = await person('Funds Scout');
  dadId = await person('Funds Dad');
  strangerId = await person('Funds Stranger');
  guestId = await person('Funds Guest', { guest_host_household_id: householdId });
  const { error: memErr } = await admin.from('household_members').insert([
    { household_id: householdId, person_id: scoutId },
    { household_id: householdId, person_id: dadId }
  ]);
  if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);
});
afterEach(async () => {
  await admin.from('financial_transactions').delete().in('person_id', [scoutId, dadId, guestId, strangerId]);
  await admin.from('signup_entries').delete().eq('event_signup_id', event.eventSignupId);
});
afterAll(async () => {
  await deleteTestEvent(admin, event);
  await admin.from('household_members').delete().eq('household_id', householdId);
  await admin.from('people').delete().in('id', [scoutId, dadId, guestId, strangerId]);
  await admin.from('households').delete().eq('id', householdId);
});

describe('loadFamilyScoutAccounts', () => {
  it('FamilyScoutAccounts_OffersTheScoutsBalance_WhenTheAttendeeIsHerDad', async () => {
    await credit(scoutId, 85);
    const r = await loadFamilyScoutAccounts(admin, dadId);
    expect(r.family).toEqual([{ personId: scoutId, name: `${TEST_PREFIX} Funds Scout`, balance: 85 }]);
  });

  it('FamilyScoutAccounts_ReportsTheAttendeesOwnBalance_SeparatelyFromTheFamilys', async () => {
    await credit(scoutId, 85);
    await credit(dadId, 12.5);
    const r = await loadFamilyScoutAccounts(admin, scoutId);
    expect(r.ownBalance).toBe(85);
    expect(r.family).toEqual([{ personId: dadId, name: `${TEST_PREFIX} Funds Dad`, balance: 12.5 }]);
  });

  it('FamilyScoutAccounts_LeavesOutAFamilyMember_WhoHasNoScoutAccountHistory', async () => {
    const r = await loadFamilyScoutAccounts(admin, scoutId);
    expect(r.family).toEqual([]);
  });

  it('FamilyScoutAccounts_NeverOffersSomeoneOutsideTheHousehold', async () => {
    await credit(strangerId, 500);
    const r = await loadFamilyScoutAccounts(admin, dadId);
    expect(r.family.map((a) => a.personId)).not.toContain(strangerId);
  });

  it('FamilyScoutAccounts_IgnoresVoidedRows_WhenSummingAFamilyBalance', async () => {
    await credit(scoutId, 85);
    await credit(scoutId, 40, { voided_at: new Date().toISOString() });
    const r = await loadFamilyScoutAccounts(admin, dadId);
    expect(r.family[0].balance).toBe(85);
  });

  it('FamilyScoutAccounts_OffersTheHostFamilysAccounts_ToAGuest_WhoHasNoneOfTheirOwn', async () => {
    await credit(scoutId, 85);
    const r = await loadFamilyScoutAccounts(admin, guestId);
    expect(r.ownBalance).toBeNull();
    expect(r.family.map((a) => a.personId)).toEqual([scoutId]);
  });
});

describe('resolveScoutAccountPayer', () => {
  it('ScoutAccountPayer_IsTheAttendee_WhenNoOtherAccountIsNamed', async () => {
    expect(await resolveScoutAccountPayer(admin, dadId, null)).toEqual({ ok: true, personId: dadId, onBehalfOf: null });
  });

  it('ScoutAccountPayer_IsTheFamilyMember_AndNamesWhoTheFeeIsFor', async () => {
    await credit(scoutId, 85);
    expect(await resolveScoutAccountPayer(admin, dadId, scoutId)).toEqual({
      ok: true,
      personId: scoutId,
      onBehalfOf: `${TEST_PREFIX} Funds Dad`
    });
  });

  it('ScoutAccountPayer_IsRefused_WhenTheAccountBelongsToAnotherFamily', async () => {
    await credit(strangerId, 500);
    const r = await resolveScoutAccountPayer(admin, dadId, strangerId);
    expect(r.ok).toBe(false);
  });
});

describe('a family payment on the ledger', () => {
  it('FamilyPayment_LowersTheScoutsBalance_AndSettlesTheDadsEntry', async () => {
    await credit(scoutId, 85);
    const { data: price } = await admin
      .from('event_prices')
      .insert({ event_signup_id: event.eventSignupId, label: 'Adult', amount: 30, per: 'event', applies_to: 'both' })
      .select('id')
      .single();
    const { data: entry, error } = await admin
      .from('signup_entries')
      .insert({ event_signup_id: event.eventSignupId, status: 'yes', person_kind: 'adult', person_id: dadId, price_id: price!.id })
      .select('id')
      .single();
    if (error || !entry) throw new Error(error?.message);
    // The row recordEventFeePaymentAction writes: the SCOUT's account, the DAD's entry.
    await credit(scoutId, -30, { kind: 'event_fee', method: 'scout_account', signup_entry_id: entry.id });

    const { data: bal } = await admin.from('signup_entry_balances').select('paid, settled').eq('entry_id', entry.id).single();
    expect(Number(bal!.paid)).toBe(30);
    expect(bal!.settled).toBe(true);
    expect((await loadFamilyScoutAccounts(admin, dadId)).family[0].balance).toBe(55);
  });
});
