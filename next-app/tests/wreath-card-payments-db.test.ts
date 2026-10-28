import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps } from '../src/lib/wreaths/place-order';
import { loadAdminOrders } from '../src/lib/wreaths/admin-data';
import { cancelOrderByToken } from '../src/lib/wreaths/customer-cancel';
import {
  startCardCheckout,
  expireOpenCheckout,
  closeCheckoutForCancel,
  handleStripeEvent,
  refundCardOrderCore,
  MAX_CHECKOUTS_PER_ORDER,
  type StripeLike,
  type StripeEventLike
} from '../src/lib/wreaths/card-payments';

/**
 * Release B card payments against the real local database (Plans/Wreath-Stripe-Checkout.md). Stripe itself is a
 * fake at the module edge that behaves like the real API where it matters here: idempotency keys return the same
 * session, sessions open → expired / complete, the PaymentIntent carries the settled fee.
 */
const admin = adminClient();
let fx: WreathFixture;
let seq = 0;
const send = vi.fn(async () => ({ status: 'sent', to: [] as string[] }));
const EVT = () => `evt_vitest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

type FakeSession = { id: string; url: string; status: 'open' | 'expired' | 'complete'; amount_total: number; currency: string; payment_status: string; client_reference_id: string; metadata: Record<string, string>; params: Record<string, unknown> };

function fakeStripe(opts: { fee?: number | null } = {}) {
  const sessions = new Map<string, FakeSession>();
  const byKey = new Map<string, FakeSession>();
  const refundsByKey = new Map<string, { id: string; payment_intent: string }>();
  // The PaymentIntent of a session is `pi_test_<session id>` (see completed()); it carries the session's metadata.
  const piMeta = new Map<string, Record<string, string>>();
  let n = 0;
  const stripe: StripeLike & { sessions: typeof sessions; creates: number; refundCalls: number; refundIntents: string[] } = {
    sessions,
    refundIntents: [],
    creates: 0,
    refundCalls: 0,
    checkout: {
      sessions: {
        create: async (params, o) => {
          const hit = byKey.get(o.idempotencyKey);
          if (hit) return hit;
          stripe.creates += 1;
          n += 1;
          const items = params.line_items as { price_data: { unit_amount: number }; quantity: number }[];
          const s: FakeSession = {
            id: `cs_test_${Date.now()}_${n}`,
            url: `https://checkout.stripe.test/${n}`,
            status: 'open',
            amount_total: items.reduce((t, i) => t + i.price_data.unit_amount * i.quantity, 0),
            currency: 'usd',
            payment_status: 'unpaid',
            client_reference_id: String(params.client_reference_id),
            metadata: params.metadata as Record<string, string>,
            params
          };
          sessions.set(s.id, s);
          byKey.set(o.idempotencyKey, s);
          piMeta.set(`pi_test_${s.id}`, ((params.payment_intent_data as { metadata?: Record<string, string> } | undefined)?.metadata ?? {}));
          return s;
        },
        retrieve: async (id) => {
          const s = sessions.get(id);
          if (!s) throw new Error('No such checkout.session');
          return s;
        },
        expire: async (id) => {
          const s = sessions.get(id);
          if (!s || s.status !== 'open') throw new Error('Only open sessions can be expired');
          s.status = 'expired';
          return s;
        }
      }
    },
    paymentIntents: {
      retrieve: async (id) => ({
        id,
        metadata: piMeta.get(id) ?? {},
        latest_charge: opts.fee === null ? { id: 'ch_x', balance_transaction: null } : { id: 'ch_x', balance_transaction: { fee: opts.fee ?? 231 } }
      })
    },
    balanceTransactions: { retrieve: async () => ({ fee: opts.fee ?? 231 }) },
    refunds: {
      create: async (params, o) => {
        stripe.refundCalls += 1;
        (stripe as unknown as { refundIntents: string[] }).refundIntents.push(params.payment_intent);
        const hit = refundsByKey.get(o.idempotencyKey);
        if (hit) return hit;
        const r = { id: `re_test_${stripe.refundCalls}`, payment_intent: params.payment_intent };
        refundsByKey.set(o.idempotencyKey, r);
        return r;
      }
    }
  };
  return stripe;
}

async function makeOrder(over: Record<string, unknown> = {}) {
  seq += 1;
  const deps: PlaceOrderDeps = { supabase: admin, now: () => NOW_R1, ip: `10.8.${Math.floor(seq / 250)}.${(seq % 250) + 1}`, send, householdEmails: async () => [], siteUrl: 'https://wreaths.test', replyTo: 'troop@example.test', saleId: fx.saleId };
  const res = await placeOrder(
    {
      idempotencyKey: `vitest-card-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      sellerSlug: null,
      lines: [{ itemId: fx.item.w20, quantity: 2, donated: false }],
      gift: 0,
      coverFee: false,
      fulfillment: 'pickup',
      customer: { name: 'Vitest Card Buyer', email: `card-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' },
      outsideAreaRelative: false,
      startedAt: NOW_R1 - 120_000,
      mountedAt: NOW_R1 - 60_000,
      website: '',
      ...over
    },
    deps
  );
  if (!res.ok) throw new Error(`order: ${res.error}`);
  const { data } = await admin.from('wreath_orders').select('id, public_token, total').eq('public_token', res.token).single();
  return data as { id: number; public_token: string; total: number };
}

const orderRow = async (id: number) =>
  (await admin.from('wreath_orders').select('*').eq('id', id).single()).data as Record<string, unknown> & {
    payment_status: string; status: string; total: number; fee_covered: number; stripe_session_id: string | null; stripe_checkout_count: number;
    needs_refund: string | null; paid_method: string | null; stripe_fee: number | null; collected_by_scout: boolean;
  };
const ledger = async (id: number) =>
  ((await admin.from('financial_transactions').select('amount, kind, method, ledger_role').eq('wreath_order_id', id).order('id')).data ?? []) as {
    amount: number; kind: string; method: string; ledger_role: string;
  }[];

const deps = (stripe: StripeLike, live = true, ip: string | null = null, limits?: { perIpHour?: number; globalHour?: number }) => ({
  supabase: admin, stripe, live, siteUrl: 'https://wreaths.test', today: () => '2026-10-20', ip, limits
});

function completed(session: FakeSession, over: Partial<{ amount_total: number; payment_status: string; currency: string }> = {}): StripeEventLike {
  return {
    id: EVT(),
    type: 'checkout.session.completed',
    data: { object: { ...session, payment_intent: `pi_test_${session.id}`, payment_status: 'paid', ...over } }
  };
}

beforeAll(async () => {
  fx = await makeWreathFixture('open');
});
afterAll(async () => {
  await admin.from('stripe_events').delete().like('id', 'evt_vitest_%');
  await fx.cleanup();
});

describe('startCardCheckout', () => {
  it('StartCardCheckout_RefusesWhenCardPaymentIsNotLive', async () => {
    const o = await makeOrder();
    expect((await startCardCheckout({ token: o.public_token, coverFee: false }, deps(fakeStripe(), false))).ok).toBe(false);
  });

  it('StartCardCheckout_RefusesAnUnknownToken', async () => {
    expect((await startCardCheckout({ token: '00000000-0000-0000-0000-000000000000', coverFee: false }, deps(fakeStripe()))).ok).toBe(false);
  });

  it('StartCardCheckout_RefusesAPaidOrCancelledOrder', async () => {
    const paid = await makeOrder();
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'venmo' }).eq('id', paid.id);
    const cancelled = await makeOrder();
    await admin.from('wreath_orders').update({ status: 'cancelled' }).eq('id', cancelled.id);
    const s = fakeStripe();
    const r = [await startCardCheckout({ token: paid.public_token, coverFee: false }, deps(s)), await startCardCheckout({ token: cancelled.public_token, coverFee: false }, deps(s))];
    expect(r.map((x) => x.ok)).toEqual([false, false]);
  });

  it('StartCardCheckout_CreatesASessionForTheOrderTotal_AndStoresIt', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    const r = await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const row = await orderRow(o.id);
    const session = s.sessions.get(row.stripe_session_id ?? '')!;
    expect([r.ok, r.ok && r.url, session.amount_total, row.stripe_checkout_count]).toEqual([true, session.url, 5200, 1]);
  });

  it('StartCardCheckout_SendsOnlyTheEmail_NoNameOrAddress', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id ?? '')!;
    expect(JSON.stringify(session.params)).not.toContain('Vitest Card Buyer');
  });

  it('StartCardCheckout_OmitsPaymentMethodTypes_SoDynamicMethodsApply', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id ?? '')!;
    expect('payment_method_types' in session.params).toBe(false);
  });

  // Leaving Stripe without paying lands on the receipt, which then says the card payment wasn't finished (2026-10-16).
  it('StartCardCheckout_SendsALeftWithoutPaying_ReturnToTheReceipt', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id ?? '')!;
    expect([session.params.cancel_url, session.params.success_url]).toEqual([
      `https://wreaths.test/wreaths/order/${o.public_token}?card=cancelled`,
      `https://wreaths.test/wreaths/order/${o.public_token}?card=return`
    ]);
  });

  it('AdminOrders_KnowACardPaymentWasStarted_OnTheOrder', async () => {
    const started = await makeOrder();
    const untouched = await makeOrder();
    await startCardCheckout({ token: started.public_token, coverFee: false }, deps(fakeStripe()));
    const byId = new Map((await loadAdminOrders(admin, fx.saleId)).map((o) => [o.id, o.cardStarted]));
    expect([byId.get(started.id), byId.get(untouched.id)]).toEqual([true, false]);
  });

  it('StartCardCheckout_CoveringTheFee_UpdatesTheOrderTotal', async () => {
    const o = await makeOrder();
    await startCardCheckout({ token: o.public_token, coverFee: true }, deps(fakeStripe()));
    // Fixture sale 1.99% + $0.49, grossed up: ceil(($52 + $0.49) / 0.9801) = $53.56, which nets the troop exactly $52.
    const row = await orderRow(o.id);
    expect([Number(row.fee_covered), Number(row.total)]).toEqual([1.56, 53.56]);
  });

  it('StartCardCheckout_SameChoiceTwice_ReusesTheOpenSession', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    expect([s.creates, (await orderRow(o.id)).stripe_checkout_count]).toEqual([1, 1]);
  });

  it('StartCardCheckout_ChangingTheFeeChoice_ExpiresTheOldSession', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const first = (await orderRow(o.id)).stripe_session_id!;
    await startCardCheckout({ token: o.public_token, coverFee: true }, deps(s));
    expect([s.sessions.get(first)!.status, (await orderRow(o.id)).stripe_session_id !== first]).toEqual(['expired', true]);
  });

  it('StartCardCheckout_RateLimited_PerIpPerHour', async () => {
    const ip = `10.250.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const a = await makeOrder();
    const b = await makeOrder();
    const s = fakeStripe();
    const first = await startCardCheckout({ token: a.public_token, coverFee: false }, deps(s, true, ip, { perIpHour: 1 }));
    const second = await startCardCheckout({ token: b.public_token, coverFee: false }, deps(s, true, ip, { perIpHour: 1 }));
    expect([first.ok, second.ok]).toEqual([true, false]);
  });

  it('StartCardCheckout_RateLimited_AfterTheCapOfSessionsPerOrder', async () => {
    const o = await makeOrder();
    await admin.from('wreath_orders').update({ stripe_checkout_count: MAX_CHECKOUTS_PER_ORDER }).eq('id', o.id);
    expect((await startCardCheckout({ token: o.public_token, coverFee: false }, deps(fakeStripe()))).ok).toBe(false);
  });
});

describe('expireOpenCheckout', () => {
  it('Reprice_ExpiresOpenSession_AndClearsIt', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const id = (await orderRow(o.id)).stripe_session_id!;
    await expireOpenCheckout(o.id, deps(s));
    expect([s.sessions.get(id)!.status, (await orderRow(o.id)).stripe_session_id]).toEqual(['expired', null]);
  });

  it('ExpireOpenCheckout_IsANoOp_WithoutASession', async () => {
    const o = await makeOrder();
    await expect(expireOpenCheckout(o.id, deps(fakeStripe()))).resolves.toBeUndefined();
  });
});

describe('closeCheckoutForCancel', () => {
  // A customer's own cancel (lib/wreaths/customer-cancel.ts) must not go ahead while a payment is going through
  // (qa-lead, 2026-10-16: paid in one tab, cancelled in another before the webhook landed).
  const start = async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    return { o, s, id: (await orderRow(o.id)).stripe_session_id! };
  };

  it('CloseForCancel_ExpiresAnOpenSession_AndForgetsIt', async () => {
    const { o, s, id } = await start();
    const r = await closeCheckoutForCancel(o.id, deps(s));
    expect([r, s.sessions.get(id)!.status, (await orderRow(o.id)).stripe_session_id]).toEqual(['clear', 'expired', null]);
  });

  it('CloseForCancel_SaysPaying_WhenTheSessionAlreadyCompleted', async () => {
    const { o, s, id } = await start();
    s.sessions.get(id)!.status = 'complete';
    const r = await closeCheckoutForCancel(o.id, deps(s));
    expect([r, (await orderRow(o.id)).stripe_session_id]).toEqual(['paying', id]);
  });

  it('CloseForCancel_SaysPaying_WhenStripeCannotBeReached', async () => {
    const { o, s } = await start();
    s.checkout.sessions.retrieve = async () => {
      throw new Error('connection');
    };
    expect(await closeCheckoutForCancel(o.id, deps(s))).toBe('paying');
  });

  it('CloseForCancel_IsClear_WhenNoCardPaymentWasStarted', async () => {
    const o = await makeOrder();
    expect(await closeCheckoutForCancel(o.id, deps(fakeStripe()))).toBe('clear');
  });

  it('CustomerCancel_ThenAPaymentThatSlippedIn_IsFlaggedForARefund', async () => {
    const { o, s, id } = await start();
    await cancelOrderByToken(o.public_token, { supabase: admin, now: () => NOW_R1, closeCheckout: async () => 'clear' });
    const r = await handleStripeEvent(completed(s.sessions.get(id)!), deps(s));
    const row = await orderRow(o.id);
    expect([r, row.status, row.needs_refund !== null]).toEqual(['flagged_cancelled', 'cancelled', true]);
  });
});

describe('handleStripeEvent — payments', () => {
  async function openSession(over: Record<string, unknown> = {}) {
    const o = await makeOrder(over);
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    return { o, s, session };
  }

  it('Webhook_CompletedSession_MarksPaidByCard_NotCollectedByTheScout', async () => {
    const { o, s, session } = await openSession();
    expect(await handleStripeEvent(completed(session), deps(s))).toBe('paid');
    const row = await orderRow(o.id);
    expect([row.payment_status, row.paid_method, row.collected_by_scout, Number(row.stripe_fee), row.stripe_session_id]).toEqual(['paid', 'card', false, 2.31, null]);
  });

  it('Webhook_CompletedSession_BooksIncomeAndFeeRows', async () => {
    const { o, s, session } = await openSession();
    await handleStripeEvent(completed(session), deps(s));
    expect(await ledger(o.id)).toEqual([
      { amount: 52, kind: 'fundraiser', method: 'card', ledger_role: 'payment' },
      { amount: -2.31, kind: 'expense', method: 'card', ledger_role: 'fee' }
    ]);
  });

  it('Webhook_DuplicateEvent_ChangesNothing', async () => {
    const { o, s, session } = await openSession();
    const ev = completed(session);
    await handleStripeEvent(ev, deps(s));
    expect([await handleStripeEvent(ev, deps(s)), (await ledger(o.id)).length]).toEqual(['duplicate', 2]);
  });

  it('Webhook_UnpaidCompletedSession_DoesNothingYet', async () => {
    const { o, s, session } = await openSession();
    expect([await handleStripeEvent(completed(session, { payment_status: 'unpaid' }), deps(s)), (await orderRow(o.id)).payment_status]).toEqual(['ignored', 'unpaid']);
  });

  it('Webhook_AmountMismatch_LeavesUnpaid_AndFlagsRefund', async () => {
    const { o, s, session } = await openSession();
    const r = await handleStripeEvent(completed(session, { amount_total: 100 }), deps(s));
    const row = await orderRow(o.id);
    expect([r, row.payment_status, row.needs_refund !== null, (await ledger(o.id)).length]).toEqual(['flagged_mismatch', 'unpaid', true, 0]);
  });

  it('Webhook_PaidOnCancelledOrder_FlagsRefund', async () => {
    const { o, s, session } = await openSession();
    await admin.from('wreath_orders').update({ status: 'cancelled' }).eq('id', o.id);
    expect([await handleStripeEvent(completed(session), deps(s)), (await orderRow(o.id)).needs_refund !== null]).toEqual(['flagged_cancelled', true]);
  });

  it('Webhook_LostClaimAfterMarkPaid_FlagsRefund', async () => {
    const { o, s, session } = await openSession();
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'venmo' }).eq('id', o.id);
    const r = await handleStripeEvent(completed(session), deps(s));
    const row = await orderRow(o.id);
    expect([r, row.paid_method, row.needs_refund !== null]).toEqual(['flagged_paid_otherwise', 'venmo', true]);
  });

  it('Webhook_FeeNotSettledYet_BooksIncomeNow_AndTheFeeFromChargeUpdated', async () => {
    const o = await makeOrder();
    const pending = fakeStripe({ fee: null });
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(pending));
    const session = pending.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    await handleStripeEvent(completed(session), deps(pending));
    const before = (await ledger(o.id)).map((l) => l.ledger_role);
    const charge: StripeEventLike = { id: EVT(), type: 'charge.updated', data: { object: { id: 'ch_x', payment_intent: `pi_test_${session.id}`, balance_transaction: 'txn_x' } } };
    await handleStripeEvent(charge, deps(fakeStripe({ fee: 231 })));
    expect([before, (await ledger(o.id)).map((l) => l.ledger_role)]).toEqual([['payment'], ['payment', 'fee']]);
  });

  // qa-lead HIGH: a fee cover chosen for a card session that was never paid must not stick to the Venmo / PayPal total.
  it('Webhook_SessionExpired_DropsTheUnpaidCardFeeCover', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: true }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    await handleStripeEvent({ id: EVT(), type: 'checkout.session.expired', data: { object: session } }, deps(s));
    const row = await orderRow(o.id);
    expect([Number(row.fee_covered), Number(row.total)]).toEqual([0, 52]);
  });

  it('Webhook_SessionForAnotherOrder_IsIgnored', async () => {
    const { o, s, session } = await openSession();
    const ev = completed(session);
    (ev.data.object as Record<string, unknown>).metadata = { order_id: String(o.id), order_number: 'W-0000' };
    expect([await handleStripeEvent(ev, deps(s)), (await orderRow(o.id)).payment_status]).toEqual(['ignored', 'unpaid']);
  });

  // Production, 2026-10-16: Stripe sent charge.updated BEFORE checkout.session.completed, so the fee event found no
  // paid order and was ignored for good. Now it asks Stripe to retry until the order is paid, then books the fee.
  it('Webhook_FeeEventBeforeThePayment_Retries_ThenBooksTheFee', async () => {
    const o = await makeOrder();
    const s = fakeStripe({ fee: null });
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    const pi = `pi_test_${session.id}`;
    const early: StripeEventLike = { id: EVT(), type: 'charge.updated', data: { object: { id: 'ch_x', payment_intent: pi, balance_transaction: { fee: 231 } } } };
    await expect(handleStripeEvent(early, deps(s))).rejects.toThrow(/not paid yet/);
    await handleStripeEvent(completed(session), deps(s));
    expect([await handleStripeEvent(early, deps(s)), (await ledger(o.id)).map((l) => l.ledger_role)]).toEqual(['booked', ['payment', 'fee']]);
  });

  it('Webhook_SessionExpired_ClearsTheStoredSession', async () => {
    const { o, s, session } = await openSession();
    await handleStripeEvent({ id: EVT(), type: 'checkout.session.expired', data: { object: session } }, deps(s));
    expect((await orderRow(o.id)).stripe_session_id).toBeNull();
  });

  it('Webhook_DatabaseFailure_Throws_SoStripeRetries_AndTheRetryIsProcessed', async () => {
    const { o, s, session } = await openSession();
    const ev = completed(session);
    const failing = { ...deps(s), supabase: new Proxy(admin, { get: (t, k) => (k === 'rpc' ? async () => ({ data: null, error: { message: 'boom' } }) : Reflect.get(t, k)) }) };
    await expect(handleStripeEvent(ev, failing)).rejects.toThrow(/boom/);
    expect(await handleStripeEvent(ev, deps(s))).toBe('paid');
    expect((await orderRow(o.id)).payment_status).toBe('paid');
  });
});

// Patrick, 2026-10-27: once Stripe confirms, the customer gets "Paid by credit card" from the troop.
describe('handleStripeEvent — paid by credit card email', () => {
  const mail = vi.fn(async () => ({ status: 'sent', to: [] as string[] }));
  const mailed = () => mail.mock.calls.map((c) => (c as unknown as [{ to: string[]; subject: string; text: string }])[0]);
  const withMail = (s: StripeLike) => ({ ...deps(s), send: mail, replyTo: 'troop@example.test' });
  async function openSession() {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    const { data } = await admin.from('wreath_orders').select('customer_email').eq('id', o.id).single();
    return { o, s, session, email: (data as { customer_email: string }).customer_email };
  }
  beforeAll(async () => {
    await admin.from('wreath_sales').update({ order_cc: ['treasurer@example.test'] }).eq('id', fx.saleId);
  });
  afterAll(async () => {
    await admin.from('wreath_sales').update({ order_cc: [] }).eq('id', fx.saleId);
  });

  it('PaidEmail_GoesToTheCustomer_OnceTheCardPaymentIsRecorded', async () => {
    const { s, session, email } = await openSession();
    mail.mockClear();
    await handleStripeEvent(completed(session), withMail(s));
    expect(mailed().filter((m) => m.to.includes(email)).map((m) => m.subject)).toEqual([expect.stringMatching(/^Paid by credit card: /)]);
  });

  it('PaidEmail_OrderCopies_GetTheirOwnCopy', async () => {
    const { s, session } = await openSession();
    mail.mockClear();
    await handleStripeEvent(completed(session), withMail(s));
    expect(mailed().find((m) => m.to.includes('treasurer@example.test'))?.subject).toMatch(/^Copy: /);
  });

  it('PaidEmail_IsNotSentAgain_WhenStripeConfirmsTheSamePaymentTwice', async () => {
    const { s, session } = await openSession();
    await handleStripeEvent(completed(session), withMail(s));
    mail.mockClear();
    const again = { ...completed(session), type: 'checkout.session.async_payment_succeeded' };
    expect([await handleStripeEvent(again, withMail(s)), mail.mock.calls.length]).toEqual(['already_paid', 0]);
  });

  it('PaidEmail_IsNotSent_WhenThePaymentIsFlaggedForARefund', async () => {
    const { s, session } = await openSession();
    mail.mockClear();
    await handleStripeEvent(completed(session, { amount_total: 1 }), withMail(s));
    expect(mail).not.toHaveBeenCalled();
  });

  it('PaidEmail_ThatFailsToSend_StillRecordsThePayment', async () => {
    const { o, s, session } = await openSession();
    const broken = { ...withMail(s), send: async () => { throw new Error('resend down'); } };
    expect([await handleStripeEvent(completed(session), broken), (await orderRow(o.id)).payment_status]).toEqual(['paid', 'paid']);
  });
});

describe('handleStripeEvent — refunds', () => {
  async function paidOrder() {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    await handleStripeEvent(completed(session), deps(s));
    return { o, s, pi: `pi_test_${session.id}` };
  }
  const refunded = (pi: string, cents: number): StripeEventLike => ({ id: EVT(), type: 'charge.refunded', data: { object: { id: 'ch_x', payment_intent: pi, amount_refunded: cents } } });

  it('Webhook_ChargeRefunded_Full_MarksRefunded_AndBooksTheReversal', async () => {
    const { o, s, pi } = await paidOrder();
    expect(await handleStripeEvent(refunded(pi, 5200), deps(s))).toBe('refunded');
    const row = await orderRow(o.id);
    expect([row.payment_status, row.status, (await ledger(o.id)).map((l) => [l.ledger_role, l.amount])]).toEqual([
      'refunded', 'cancelled', [['payment', 52], ['fee', -2.31], ['refund', -52]]
    ]);
  });

  it('Webhook_PartialRefund_AuditsOnly_BooksNothing', async () => {
    const { o, s, pi } = await paidOrder();
    expect([await handleStripeEvent(refunded(pi, 1000), deps(s)), (await orderRow(o.id)).payment_status, (await ledger(o.id)).length]).toEqual(['partial', 'paid', 2]);
  });

  // A duplicate card payment on an order already paid by Venmo: refunding the card returns only the duplicate — the
  // order stays paid by Venmo, uncancelled, and no card reversal is booked (the card income never was).
  it('Webhook_RefundOfAFlaggedDuplicate_KeepsTheVenmoPayment', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'venmo', paid_amount: 52 }).eq('id', o.id);
    await handleStripeEvent(completed(session), deps(s));
    expect((await refundCardOrderCore(o.id, deps(s))).ok).toBe(true);
    const r = await handleStripeEvent(refunded(`pi_test_${session.id}`, 5200), deps(s));
    const row = await orderRow(o.id);
    expect([r, row.payment_status, row.paid_method, row.status, row.needs_refund, (await ledger(o.id)).length]).toEqual(['flag_refunded', 'paid', 'venmo', 'placed', null, 0]);
  });

  // qa-lead HIGH: a SECOND card payment on an order already paid by card must be the one refunded — never the original.
  it('Webhook_SecondCardPayment_RefundsTheStrayOne_NotTheOriginal', async () => {
    const { o, s, pi } = await paidOrder();
    const stray = { ...(await orderRow(o.id)), id: 'cs_test_stray' } as unknown as FakeSession;
    const ev: StripeEventLike = { id: EVT(), type: 'checkout.session.completed', data: { object: { id: 'cs_test_stray', client_reference_id: String(o.id), metadata: { order_id: String(o.id), order_number: (await orderRow(o.id)).order_number as string }, payment_intent: 'pi_test_stray_' + o.id, payment_status: 'paid', amount_total: 5200, currency: 'usd' } } };
    void stray;
    expect(await handleStripeEvent(ev, deps(s))).toBe('flagged_paid_otherwise');
    const refund = await refundCardOrderCore(o.id, deps(s));
    const refundedIntents = (s as unknown as { refundIntents: string[] }).refundIntents;
    expect([refund.ok, refundedIntents, (await orderRow(o.id)).payment_status]).toEqual([true, ['pi_test_stray_' + o.id], 'paid']);
    void pi;
  });

  it('Webhook_RefundedEvent_ForUnknownIntent_IsNoOp', async () => {
    expect(await handleStripeEvent(refunded('pi_test_nobody', 5200), deps(fakeStripe()))).toBe('unknown_intent');
  });
});

describe('refundCardOrderCore', () => {
  it('RefundCardOrder_RefusesAnOrderNotPaidByCard', async () => {
    const o = await makeOrder();
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'venmo' }).eq('id', o.id);
    expect((await refundCardOrderCore(o.id, deps(fakeStripe()))).ok).toBe(false);
  });

  it('RefundCardOrder_RefundsThePaymentIntentFromTheDatabase', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    await handleStripeEvent(completed(session), deps(s));
    expect((await refundCardOrderCore(o.id, deps(s))).ok).toBe(true);
  });

  it('Refund_Repeat_IsIdempotent', async () => {
    const o = await makeOrder();
    const s = fakeStripe();
    await startCardCheckout({ token: o.public_token, coverFee: false }, deps(s));
    const session = s.sessions.get((await orderRow(o.id)).stripe_session_id!)!;
    await handleStripeEvent(completed(session), deps(s));
    const a = await refundCardOrderCore(o.id, deps(s));
    const b = await refundCardOrderCore(o.id, deps(s));
    expect([a.ok && a.refundId, b.ok && b.refundId].every((x) => x === (a.ok && a.refundId))).toBe(true);
  });
});
