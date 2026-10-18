import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, createTestScout, deleteTestScout, TEST_PREFIX, type TestEvent, type TestScout } from './helpers/signup-fixtures';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/require-capability', () => ({
  requireCapability: async () => ({ personId: null }),
  requireAnyOf: async () => ({ personId: null })
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { addEventExpenseAction, getEventMoneyAction } from '../src/app/admin/(workspace)/finance/actions';

/** The Money tab's rows through the shared money scope (Plans/Buckets-Lookup.md) — qa-lead W1, 2026-10-17. */
const admin = adminClient();
let event: TestEvent;
let scout: TestScout;

beforeAll(async () => {
  event = await createTestEvent(admin);
  scout = await createTestScout(admin, 'MoneyScope');
});
afterEach(async () => {
  await admin.from('financial_transactions').delete().eq('person_id', scout.personId);
  await admin.from('signup_entries').delete().eq('event_signup_id', event.eventSignupId);
  await admin.from('calendar_entries').update({ bucket_id: null }).eq('id', event.calendarEntryId);
  await admin.from('buckets').delete().like('name', `${TEST_PREFIX}%`);
});
afterAll(async () => {
  await deleteTestEvent(admin, event);
  await deleteTestScout(admin, scout);
});

describe('getEventMoneyAction scope', () => {
  it('MoneyTab_LeavesACancelledSignupsFeeRows_OutOfOtherMoney', async () => {
    const { data: e } = await admin
      .from('signup_entries')
      .insert({ event_signup_id: event.eventSignupId, status: 'cancelled', person_kind: 'scout', person_id: scout.personId })
      .select('id')
      .single();
    await admin.from('financial_transactions').insert({
      occurred_on: '2026-09-01', account: 'checking', amount: 40, kind: 'event_fee', method: 'venmo', person_id: scout.personId, signup_entry_id: e!.id
    });
    const data = await getEventMoneyAction(event.eventSignupId);
    expect(data!.expenses).toHaveLength(0);
  });
});

/** Buckets Release 2 (qa-lead 2026-10-18): only a sign-up's fee row claims a bucket for its event — an expense keeps
 *  the old sync-trigger rule and never links the event. */
describe('an event expense and its bucket', () => {
  const expense = () =>
    addEventExpenseAction({ signupId: event.eventSignupId, calendarEntryId: event.calendarEntryId, occurredOn: '2026-09-01', amount: 12, memo: 'Gas', paidBy: 'troop', payerPersonId: scout.personId, method: 'bank' });

  it('EventExpense_GoesInTheEventsBucket_WhenItHasOne', async () => {
    const { data: b } = await admin.from('buckets').insert({ name: `${TEST_PREFIX} expense bucket` }).select('id').single();
    await admin.from('calendar_entries').update({ bucket_id: b!.id }).eq('id', event.calendarEntryId);
    await expense();
    const { data } = await admin.from('financial_transactions').select('bucket_id').eq('person_id', scout.personId).single();
    expect(data?.bucket_id).toBe(b!.id);
  });

  it('EventExpense_OnAnEventWithNoBucket_DoesNotClaimABucketForTheEvent', async () => {
    await expense();
    const { data } = await admin.from('calendar_entries').select('bucket_id').eq('id', event.calendarEntryId).single();
    expect(data?.bucket_id).toBeNull();
  });
});
