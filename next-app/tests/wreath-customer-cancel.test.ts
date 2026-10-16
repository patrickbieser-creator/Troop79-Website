import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, NOW_R2, R1, R2, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps } from '../src/lib/wreaths/place-order';
import { cancelOrderByToken, customerCancelBlock, type CancelDeps } from '../src/lib/wreaths/customer-cancel';

/**
 * A customer cancels their own unpaid online order from the receipt page (Patrick, 2026-10-16: someone who walks away
 * from Stripe had no way to undo the order). The receipt link's token is the only credential. A paid order, a
 * scout-entered order and an order past its round's cutoff are not theirs to cancel. Any open card session is expired
 * first, so nothing can be paid on an order that is about to be cancelled.
 */
const admin = adminClient();
let fx: WreathFixture;
let seq = 0;
const ids: number[] = [];
const send = vi.fn(async () => ({ status: 'sent', to: [] as string[] }));

async function makeOrder() {
  seq += 1;
  const deps: PlaceOrderDeps = { supabase: admin, now: () => NOW_R1, ip: `10.9.${Math.floor(seq / 250)}.${(seq % 250) + 1}`, send, householdEmails: async () => [], siteUrl: 'https://wreaths.test', replyTo: 'troop@example.test', saleId: fx.saleId };
  const res = await placeOrder(
    {
      idempotencyKey: `vitest-cancel-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      sellerSlug: null,
      lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }],
      gift: 0,
      coverFee: false,
      fulfillment: 'pickup',
      customer: { name: 'Vitest Cancel Buyer', email: `cancel-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' },
      outsideAreaRelative: false,
      startedAt: NOW_R1 - 120_000,
      mountedAt: NOW_R1 - 60_000,
      website: ''
    },
    deps
  );
  if (!res.ok) throw new Error(`order: ${res.error}`);
  const { data } = await admin.from('wreath_orders').select('id, public_token').eq('public_token', res.token).single();
  const o = data as { id: number; public_token: string };
  ids.push(o.id);
  return o;
}

const statusOf = async (id: number) => ((await admin.from('wreath_orders').select('status').eq('id', id).single()).data as { status: string }).status;
const deps = (over: Partial<CancelDeps> = {}): CancelDeps => ({ supabase: admin, now: () => NOW_R1, closeCheckout: async () => 'clear', ...over });

beforeAll(async () => {
  fx = await makeWreathFixture('open');
});
afterAll(async () => {
  if (ids.length) await admin.from('audit_log').delete().eq('entity_type', 'wreath_order').in('entity_id', ids.map(String));
  await fx.cleanup();
});

describe('customerCancelBlock', () => {
  const sale = { status: 'open' as const, round1Cutoff: R1, round2Cutoff: R2 };
  const order = { status: 'placed' as const, paymentStatus: 'unpaid' as const, needsRefund: false, source: 'store' as const, round: 1 as const };

  it('CustomerCancel_IsAllowed_ForAnUnpaidOnlineOrderBeforeItsCutoff', () => {
    expect(customerCancelBlock(order, sale, NOW_R1)).toBeNull();
  });

  it('CustomerCancel_IsBlocked_AfterTheRoundCutoff', () => {
    expect(customerCancelBlock(order, sale, NOW_R2)).toMatch(/Round 1 closed/);
  });

  it('CustomerCancel_IsBlocked_ForAPaidOrder', () => {
    expect(customerCancelBlock({ ...order, paymentStatus: 'paid' }, sale, NOW_R1)).toMatch(/paid/);
  });

  it('CustomerCancel_IsBlocked_WhileACardPaymentAwaitsARefund', () => {
    expect(customerCancelBlock({ ...order, needsRefund: true }, sale, NOW_R1)).toMatch(/paid/);
  });

  it('CustomerCancel_IsBlocked_ForAScoutEnteredOrder', () => {
    expect(customerCancelBlock({ ...order, source: 'paper' }, sale, NOW_R1)).toMatch(/scout/);
  });

  it('CustomerCancel_IsBlocked_WhenTheSaleIsClosed', () => {
    expect(customerCancelBlock(order, { ...sale, status: 'closed' }, NOW_R1)).toMatch(/closed/);
  });
});

describe('cancelOrderByToken', () => {
  it('Customer_CancelsTheirUnpaidOrder_ByItsToken', async () => {
    const o = await makeOrder();
    const r = await cancelOrderByToken(o.public_token, deps());
    expect([r.ok, await statusOf(o.id)]).toEqual([true, 'cancelled']);
  });

  it('Customer_Cancel_ExpiresTheOpenCardSessionWhileTheOrderIsStillPlaced', async () => {
    const o = await makeOrder();
    const seen: string[] = [];
    await cancelOrderByToken(o.public_token, deps({ closeCheckout: async (id) => (seen.push(`${id}:${await statusOf(id)}`), 'clear') }));
    expect(seen).toEqual([`${o.id}:placed`]);
  });

  it('Customer_Cancel_IsInTheOrdersAuditTrail', async () => {
    const o = await makeOrder();
    await cancelOrderByToken(o.public_token, deps());
    const { data } = await admin.from('audit_log').select('action, actor_label').eq('entity_type', 'wreath_order').eq('entity_id', String(o.id));
    expect(data).toEqual([{ action: 'cancel', actor_label: 'Customer' }]);
  });

  it('Customer_CancellingTwice_IsStillOk', async () => {
    const o = await makeOrder();
    await cancelOrderByToken(o.public_token, deps());
    expect((await cancelOrderByToken(o.public_token, deps())).ok).toBe(true);
  });

  it('Customer_CannotCancel_APaidOrder', async () => {
    const o = await makeOrder();
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'venmo' }).eq('id', o.id);
    const r = await cancelOrderByToken(o.public_token, deps());
    expect([r.ok, await statusOf(o.id)]).toEqual([false, 'placed']);
  });

  it('Customer_CannotCancel_AfterTheRoundCutoff', async () => {
    const o = await makeOrder();
    const r = await cancelOrderByToken(o.public_token, deps({ now: () => NOW_R2 }));
    expect([r.ok, await statusOf(o.id)]).toEqual([false, 'placed']);
  });

  it('Customer_CannotCancel_AScoutEnteredOrder', async () => {
    const o = await makeOrder();
    await admin.from('wreath_orders').update({ source: 'paper' }).eq('id', o.id);
    const r = await cancelOrderByToken(o.public_token, deps());
    expect([r.ok, await statusOf(o.id)]).toEqual([false, 'placed']);
  });

  it('Customer_CannotCancel_WithAnUnknownOrMalformedToken', async () => {
    const r = [await cancelOrderByToken('00000000-0000-0000-0000-000000000000', deps()), await cancelOrderByToken('nope', deps()), await cancelOrderByToken(42, deps())];
    expect(r.map((x) => x.ok)).toEqual([false, false, false]);
  });

  it('Customer_Cancel_DoesNotExpireTheCardSession_WhenTheOrderCannotBeCancelled', async () => {
    const o = await makeOrder();
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'venmo' }).eq('id', o.id);
    const closeCheckout = vi.fn(async () => 'clear' as const);
    await cancelOrderByToken(o.public_token, deps({ closeCheckout }));
    expect(closeCheckout).not.toHaveBeenCalled();
  });

  // qa-lead, 2026-10-16: paid in one tab, cancelled in another before the webhook landed.
  it('Customer_CannotCancel_WhileACardPaymentIsGoingThrough', async () => {
    const o = await makeOrder();
    const r = await cancelOrderByToken(o.public_token, deps({ closeCheckout: async () => 'paying' }));
    expect([r.ok, !r.ok && r.error, await statusOf(o.id)]).toEqual([false, expect.stringMatching(/payment is going through/), 'placed']);
  });

  it('Customer_CancelsARound2Order_BeforeTheRound2Cutoff', async () => {
    const o = await makeOrder();
    await admin.from('wreath_orders').update({ round: 2 }).eq('id', o.id);
    const r = await cancelOrderByToken(o.public_token, deps({ now: () => NOW_R2 }));
    expect([r.ok, await statusOf(o.id)]).toEqual([true, 'cancelled']);
  });
});
