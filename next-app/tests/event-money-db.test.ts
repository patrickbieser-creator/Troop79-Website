import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  createTestEvent,
  deleteTestEvent,
  createTestScout,
  deleteTestScout,
  type TestEvent,
  type TestScout
} from './helpers/signup-fixtures';

/**
 * Event Logistics Phase 3 — many payments per entry (Plans/Event-Logistics.md
 * §C): the one-payment unique index is gone; the balance view sums
 * installments, nets refunds, ignores voided rows; the idempotency key makes
 * a retried write a no-op; payment_received no longer exists.
 */
const admin = adminClient();
let event: TestEvent;
let scout: TestScout;
let priceId: number;

async function addEntry(): Promise<number> {
  const { data, error } = await admin
    .from('signup_entries')
    .insert({ event_signup_id: event.eventSignupId, status: 'yes', person_kind: 'scout', person_id: scout.personId, price_id: priceId })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message);
  return data.id as number;
}
async function pay(entryId: number, amount: number, extra: Record<string, unknown> = {}) {
  return admin
    .from('financial_transactions')
    .insert({
      occurred_on: '2026-09-01',
      account: 'checking',
      amount,
      kind: 'event_fee',
      method: 'venmo',
      person_id: scout.personId,
      signup_entry_id: entryId,
      ...extra
    })
    .select('id')
    .single();
}
async function balance(entryId: number) {
  const { data } = await admin.from('signup_entry_balances').select('owed, paid, balance, settled').eq('entry_id', entryId).single();
  return data as { owed: number; paid: number; balance: number; settled: boolean };
}

beforeAll(async () => {
  event = await createTestEvent(admin);
  scout = await createTestScout(admin, 'ManyPay');
  const { data } = await admin
    .from('event_prices')
    .insert({ event_signup_id: event.eventSignupId, label: 'Trek', amount: 840, per: 'event', applies_to: 'both' })
    .select('id')
    .single();
  priceId = data!.id;
});
afterEach(async () => {
  await admin.from('financial_transactions').delete().eq('person_id', scout.personId);
  await admin.from('signup_entries').delete().eq('event_signup_id', event.eventSignupId);
});
afterAll(async () => {
  await deleteTestEvent(admin, event);
  await deleteTestScout(admin, scout);
});

describe('many payments per entry', () => {
  it('RecordEventFeePayment_AllowsSecondPayment_AfterUniqueIndexDropped', async () => {
    const e = await addEntry();
    expect((await pay(e, 300)).error).toBeNull();
    expect((await pay(e, 540)).error).toBeNull();
    const b = await balance(e);
    expect(Number(b.paid)).toBe(840);
    expect(b.settled).toBe(true);
  });

  it('SignupEntryBalance_SumsManyPayments_AndRefunds', async () => {
    const e = await addEntry();
    await pay(e, 750.47);
    // Paid FROM the scout account: a −89.53 row on that account; the event sees +89.53 (20260823110000).
    await pay(e, -89.53, { method: 'scout_account', account: 'scout_account' });
    await pay(e, -100, { memo: 'refund' });
    const b = await balance(e);
    expect(Number(b.paid)).toBe(740);
    expect(Number(b.balance)).toBe(100);
    expect(b.settled).toBe(false);
  });

  it('VoidEventFeePayment_VoidsOnlySpecifiedTransaction_WhenManyPaymentsExist', async () => {
    const e = await addEntry();
    const { data: first } = await pay(e, 300);
    await pay(e, 540);
    await admin.from('financial_transactions').update({ voided_at: new Date().toISOString() }).eq('id', first!.id);
    const b = await balance(e);
    expect(Number(b.paid)).toBe(540);
    expect(b.settled).toBe(false);
  });

  it('RecordEventFeePayment_IsIdempotent_OnRetryWithSameKey', async () => {
    const e = await addEntry();
    expect((await pay(e, 300, { idempotency_key: 'vitest-key-1' })).error).toBeNull();
    const second = await pay(e, 300, { idempotency_key: 'vitest-key-1' });
    expect(second.error?.code).toBe('23505');
    expect(Number((await balance(e)).paid)).toBe(300);
  });

  it('LegacyReaders_UseBalancesView_NoPaymentReceivedColumnRemains', async () => {
    const { error } = await admin.from('signup_entries').select('payment_received').limit(1);
    expect(error).not.toBeNull();
  });
});
