import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, type TestScout } from './helpers/signup-fixtures';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/lib/require-capability', () => ({
  requireCapability: async () => ({ personId: null }),
  requireAnyOf: async () => ({ personId: null })
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { linkReimbursementPaymentAction, listReimbursementsAction, markReimbursementPaidAction } from '../src/app/admin/(workspace)/finance/actions';

/**
 * Patrick, 2026-10-18: Jason Porter's $140.43 Costco reimbursement was paid by Venmo and booked straight into the
 * ledger (#2159), so the queue still offered Mark paid — which would have booked it a second time. An approved request
 * can now be closed against the ledger row that already paid it, and a paid row shows how it was paid.
 */
const admin = adminClient();
let scout: TestScout;
const AMOUNT = 137.29;

beforeAll(async () => {
  scout = await createTestScout(admin, 'ReimbPay');
});
afterEach(async () => {
  await admin.from('financial_transactions').delete().eq('person_id', scout.personId);
  await admin.from('reimbursement_requests').delete().eq('requester_person_id', scout.personId);
});
afterAll(async () => {
  await deleteTestScout(admin, scout);
});

async function request(status = 'approved', amount = AMOUNT) {
  const { data } = await admin
    .from('reimbursement_requests')
    .insert({ requester_person_id: scout.personId, amount, description: 'Costco for the Brat Fry', status })
    .select('id')
    .single();
  return data!.id as number;
}

async function payout(over: Record<string, unknown> = {}) {
  const { data } = await admin
    .from('financial_transactions')
    .insert({ occurred_on: '2026-10-08', account: 'checking', amount: -AMOUNT, kind: 'expense', method: 'venmo', person_id: scout.personId, memo: 'Brat Fry Expense from Costco', ...over })
    .select('id')
    .single();
  return data!.id as number;
}

const mine = async () => (await listReimbursementsAction()).filter((r) => r.requester_person_id === scout.personId);

describe('reimbursement already paid in the ledger', () => {
  it('ReimbursementQueue_OffersTheUnlinkedLedgerPayout_OfTheSameAmount', async () => {
    await request();
    const match = await payout();
    await payout({ amount: -AMOUNT + 1 });
    await payout({ voided_at: new Date().toISOString() });
    await payout({ amount: AMOUNT });
    expect((await mine())[0].paymentCandidates.map((c) => c.id)).toEqual([match]);
  });

  // qa-lead 2026-10-18: same amount isn't enough — a transfer leg or a fee row is someone else's money.
  it('ReimbursementQueue_DoesNotOfferATransferLegOrANonExpenseRow', async () => {
    await request();
    await payout({ transfer_group: crypto.randomUUID() });
    await payout({ kind: 'adjustment' });
    expect((await mine())[0].paymentCandidates).toEqual([]);
  });

  it('LinkReimbursementPayment_RefusesATransferLeg', async () => {
    const id = await request();
    const txn = await payout({ transfer_group: crypto.randomUUID() });
    expect((await linkReimbursementPaymentAction(id, txn)).ok).toBe(false);
  });

  it('ReimbursementQueue_OffersNoCandidates_OnARequestThatIsNotApproved', async () => {
    await request('submitted');
    await payout();
    expect((await mine())[0].paymentCandidates).toEqual([]);
  });

  it('LinkReimbursementPayment_MarksItPaid_WithoutASecondLedgerRow', async () => {
    const id = await request();
    const txn = await payout();
    expect(await linkReimbursementPaymentAction(id, txn)).toEqual({ ok: true });
    const rows = (await admin.from('financial_transactions').select('id, reimbursement_id').eq('person_id', scout.personId)).data ?? [];
    const req = (await admin.from('reimbursement_requests').select('status, paid_at').eq('id', id).single()).data!;
    expect([rows, req.status, req.paid_at != null]).toEqual([[{ id: txn, reimbursement_id: id }], 'paid', true]);
  });

  it('LinkReimbursementPayment_RefusesARowOfADifferentAmount', async () => {
    const id = await request();
    const txn = await payout({ amount: -AMOUNT + 1 });
    expect((await linkReimbursementPaymentAction(id, txn)).ok).toBe(false);
  });

  it('LinkReimbursementPayment_RefusesAVoidedRow', async () => {
    const id = await request();
    const txn = await payout({ voided_at: new Date().toISOString() });
    expect((await linkReimbursementPaymentAction(id, txn)).ok).toBe(false);
  });

  it('LinkReimbursementPayment_RefusesARowAlreadyLinkedToAnotherRequest', async () => {
    const first = await request();
    const second = await request();
    const txn = await payout();
    await linkReimbursementPaymentAction(first, txn);
    expect((await linkReimbursementPaymentAction(second, txn)).ok).toBe(false);
  });

  it('LinkReimbursementPayment_RefusesARequestThatIsNotApproved', async () => {
    const id = await request('submitted');
    const txn = await payout();
    const res = await linkReimbursementPaymentAction(id, txn);
    const linked = (await admin.from('financial_transactions').select('reimbursement_id').eq('id', txn).single()).data!;
    expect([res.ok, linked.reimbursement_id]).toEqual([false, null]);
  });
});

describe('a paid reimbursement shows how it ended', () => {
  it('ReimbursementQueue_PaidRow_CarriesTheLedgerDateAndMethod', async () => {
    const id = await request();
    await linkReimbursementPaymentAction(id, await payout());
    expect((await mine())[0].payment).toEqual({ occurredOn: '2026-10-08', method: 'venmo' });
  });

  it('ReimbursementQueue_PaidThroughMarkPaid_CarriesItsMethod', async () => {
    const id = await request();
    await markReimbursementPaidAction(id, 'check');
    expect((await mine())[0].payment?.method).toBe('check');
  });
});
