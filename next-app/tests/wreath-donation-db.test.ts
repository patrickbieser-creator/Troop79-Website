import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps } from '../src/lib/wreaths/place-order';
import { loadAdminOrders } from '../src/lib/wreaths/admin-data';
import { buildSellerView } from '../src/lib/wreaths/my-orders';
import { handleStripeEvent, startCardCheckout, type StripeEventLike, type StripeLike } from '../src/lib/wreaths/card-payments';
import type { Capability } from '../src/lib/capabilities';

/**
 * W-3, "Donate to Troop 79" (Plans/Wreath-Sale.md, Patrick 2026-10-19), against the real local database: a donation-only
 * order places with nothing to deliver, the donation books as its own ledger row (Mark paid, card, the late card fee,
 * a refund, Edit order), the card total carries no fee on the donation, and the settings save the scouts' share.
 * Framework edges are mocked as in tests/wreath-admin.test.ts.
 */
const admin = adminClient();
const state = vi.hoisted(() => ({ caps: new Set<string>(['finance.manage']) }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({ kind: 'identity', label: 'Vitest Treasurer', personId: null, capabilities: state.caps as Set<Capability>, legacyRole: null, subjectKind: 'adult' }),
  actorHas: () => true
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/wreaths/stripe-client', () => ({ expireOrderCheckout: vi.fn(async () => undefined), cardCheckoutLive: () => false, cardDeps: () => ({}) }));

let fx: WreathFixture;
let seq = 0;
const send = vi.fn<(m: { subject: string; text: string }) => Promise<{ status: string; to: string[] }>>(async () => ({ status: 'sent', to: [] }));
const EVT = () => `evt_vitest_don_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const actions = () => import('../src/app/admin/(workspace)/finance/wreaths/actions');

function deps(): PlaceOrderDeps {
  seq += 1;
  return { supabase: admin, now: () => NOW_R1, ip: `10.7.${Math.floor(seq / 250)}.${(seq % 250) + 1}`, send, householdEmails: async () => [], siteUrl: 'https://wreaths.test', replyTo: 'troop@example.test', saleId: fx.saleId };
}

function input(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    idempotencyKey: `vitest-don-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    sellerSlug: null,
    lines: [],
    gift: 25,
    coverFee: false,
    fulfillment: null,
    customer: { name: 'Vitest Giver', email: `giver-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '', street: '', city: '', zip: '' },
    outsideAreaRelative: false,
    startedAt: NOW_R1 - 120_000,
    mountedAt: NOW_R1 - 60_000,
    website: '',
    ...over
  };
}

async function place(over: Record<string, unknown> = {}) {
  const res = await placeOrder(input(over), deps());
  if (!res.ok) throw new Error(`order: ${res.error}`);
  const { data } = await admin.from('wreath_orders').select('*, wreath_order_lines(*)').eq('public_token', res.token).single();
  return data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const ledger = async (id: number) =>
  ((await admin.from('financial_transactions').select('amount, kind, method, ledger_role, voided_at').eq('wreath_order_id', id).order('id')).data ?? []).map((r) => ({
    amount: Number(r.amount),
    kind: r.kind as string,
    role: r.ledger_role as string,
    live: r.voided_at == null
  }));

function fakeStripe(fee: number | null) {
  const sessions = new Map<string, { id: string; url: string; status: string; amount_total: number; currency: string; client_reference_id: string; metadata: Record<string, string>; line_items: unknown }>();
  let n = 0;
  const s: StripeLike & { sessions: typeof sessions } = {
    sessions,
    checkout: {
      sessions: {
        create: async (params) => {
          n += 1;
          const items = params.line_items as { price_data: { unit_amount: number }; quantity: number }[];
          const session = { id: `cs_don_${Date.now()}_${n}`, url: `https://checkout.stripe.test/d${n}`, status: 'open', amount_total: items.reduce((t, i) => t + i.price_data.unit_amount * i.quantity, 0), currency: 'usd', client_reference_id: String(params.client_reference_id), metadata: params.metadata as Record<string, string>, line_items: params.line_items };
          sessions.set(session.id, session);
          return session;
        },
        retrieve: async (id) => sessions.get(id)!,
        expire: async () => undefined
      }
    },
    paymentIntents: { retrieve: async (id) => ({ id, metadata: {}, latest_charge: fee == null ? { balance_transaction: null } : { balance_transaction: { fee: Math.round(fee * 100) } } }) },
    balanceTransactions: { retrieve: async () => ({ fee: Math.round((fee ?? 0) * 100) }) },
    refunds: { create: async () => ({ id: 're_don' }) }
  };
  return s;
}
const cardDeps = (stripe: StripeLike) => ({ supabase: admin, stripe, live: true, siteUrl: 'https://wreaths.test', today: () => '2026-10-20', ip: null });

async function payByCard(order: Record<string, any>, fee: number | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = fakeStripe(fee);
  const started = await startCardCheckout({ token: order.public_token, coverFee: true }, cardDeps(s));
  if (!started.ok) throw new Error(started.error);
  const { data } = await admin.from('wreath_orders').select('stripe_session_id').eq('id', order.id).single();
  const session = s.sessions.get((data as { stripe_session_id: string }).stripe_session_id)!;
  const ev: StripeEventLike = { id: EVT(), type: 'checkout.session.completed', data: { object: { ...session, payment_intent: `pi_don_${session.id}`, payment_status: 'paid' } } };
  await handleStripeEvent(ev, cardDeps(s));
  return { s, session, pi: `pi_don_${session.id}` };
}

beforeAll(async () => {
  fx = await makeWreathFixture('open');
});
afterAll(async () => {
  await fx.cleanup();
});
beforeEach(() => {
  state.caps = new Set(['finance.manage']);
  send.mockClear();
});

describe('a donation-only order', () => {
  it('DonationOnly_PlacesAnOrder_WithNothingToDeliver', async () => {
    const o = await place();
    expect([o.fulfillment, o.wreath_order_lines.length, Number(o.gift), Number(o.total), Number(o.delivery_fee), o.customer_address, o.delivering_person_id]).toEqual(['none', 0, 25, 25, 0, null, null]);
  });

  it('DonationOnly_NeedsNoPhone', async () => {
    const o = await place({ customer: { name: 'No Phone', email: `np-${Date.now()}@example.test`, phone: '', street: '', city: '', zip: '' } });
    expect(o.customer_phone ?? '').toBe('');
  });

  it('DonationOnly_FromAScoutLink_IsCreditedToTheScout_AndTheScoutDoesNotDeliver', async () => {
    const o = await place({ sellerSlug: fx.sellerA.slug });
    expect([o.credited_person_id, o.fulfillment, o.delivering_person_id, o.source]).toEqual([fx.sellerA.personId, 'none', null, 'scout_link']);
  });

  it('DonationOnly_RefusesNoAmount_AndOverTheMax', async () => {
    const none = await placeOrder(input({ gift: 0 }), deps());
    const big = await placeOrder(input({ gift: 501 }), deps());
    expect([none.ok, big.ok]).toEqual([false, false]);
  });

  // qa-lead, 2026-10-19: a donation is $1 at least, on the server too (Stripe's floor is $0.50).
  it('Donation_UnderOneDollar_IsRefused_OnTheServer', async () => {
    const tiny = await placeOrder(input({ gift: 0.5 }), deps());
    const mixedTiny = await placeOrder(input({ gift: 0.5, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], fulfillment: 'pickup', customer: { name: 'Tiny', email: `t-${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' } }), deps());
    expect([tiny.ok || tiny.field, mixedTiny.ok || mixedTiny.field]).toEqual(['gift', 'gift']);
  });

  it('DonationOnly_ConfirmationIsADonationReceipt', async () => {
    await place();
    const mail = send.mock.calls[0][0];
    expect([mail.subject.startsWith('Your donation to Troop 79'), mail.text.includes('No goods or services were provided in exchange for this donation.')]).toEqual([true, true]);
  });

  it('MixedOrder_ConfirmationStatesTheDonationApart', async () => {
    await place({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 10, fulfillment: 'pickup', customer: { name: 'Mixed Buyer', email: `mx-${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' } });
    const mail = send.mock.calls[0][0];
    expect([mail.text.includes('Donation to Troop 79 — $10.00'), mail.text.includes('No goods or services')]).toEqual([true, false]);
  });
});

describe('Mark paid books a Donation line', () => {
  it('MarkPaid_DonationOnly_BooksOneDonationRow', async () => {
    const o = await place();
    const { markPaid } = await actions();
    expect(await markPaid(o.id, 'venmo')).toMatchObject({ ok: true });
    expect(await ledger(o.id)).toEqual([{ amount: 25, kind: 'donation', role: 'donation', live: true }]);
  });

  it('MarkPaid_Mixed_BooksTheWreathsAndTheDonationApart', async () => {
    const o = await place({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 20, fulfillment: 'pickup', customer: { name: 'Mixed', email: `m2-${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' } });
    const { markPaid } = await actions();
    await markPaid(o.id, 'cash');
    expect(await ledger(o.id)).toEqual([
      { amount: 26, kind: 'fundraiser', role: 'payment', live: true },
      { amount: 20, kind: 'donation', role: 'donation', live: true }
    ]);
  });

  it('MarkPaid_Short_TheDonationAbsorbsTheShortfall', async () => {
    const o = await place({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 20, fulfillment: 'pickup', customer: { name: 'Short', email: `s2-${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' } });
    const { markPaid } = await actions();
    await markPaid(o.id, 'cash', 40);
    expect((await ledger(o.id)).map((r) => [r.role, r.amount])).toEqual([
      ['payment', 26],
      ['donation', 14]
    ]);
  });

  it('EditOrder_ChangingTheDonation_RebooksTheDonationRow', async () => {
    const o = await place({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 20, fulfillment: 'pickup', customer: { name: 'Edit Me', email: `e2-${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' } });
    const { markPaid, editOrder } = await actions();
    await markPaid(o.id, 'venmo');
    const res = await editOrder(o.id, {
      seen: { total: 46, paymentStatus: 'paid' },
      lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }],
      gift: 30,
      customer: { name: 'Edit Me', email: '', phone: '414-555-0100', street: '', city: '', zip: '' },
      creditedPersonId: null,
      fulfillment: 'pickup',
      payment: { method: 'venmo', received: 56, acceptShort: false }
    });
    expect(res).toMatchObject({ ok: true });
    expect((await ledger(o.id)).filter((r) => r.live).map((r) => [r.role, r.amount])).toEqual([
      ['payment', 26],
      ['donation', 30]
    ]);
  });
});

describe('card payments with a donation', () => {
  it('CardTotal_DonationOnly_IsTheDonation_WithNoFeeEvenWhenCovered', async () => {
    const o = await place();
    const { s } = await payByCard(o, 1.03);
    const sent = [...s.sessions.values()][0];
    expect([sent.amount_total, (sent.line_items as { price_data: { product_data: { name: string } } }[]).map((l) => l.price_data.product_data.name)]).toEqual([2500, ['Donation to Troop 79']]);
  });

  it('Card_DonationOnly_BooksTheDonationNetOfTheFee', async () => {
    const o = await place();
    await payByCard(o, 1.03);
    expect(await ledger(o.id)).toEqual([{ amount: 23.97, kind: 'donation', role: 'donation', live: true }]);
  });

  it('Card_Mixed_SplitsTheFee_AndTheRowsMatchTheBank', async () => {
    const o = await place({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 25, fulfillment: 'pickup', customer: { name: 'Card Mixed', email: `cm-${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' } });
    await payByCard(o, 1.84);
    const rows = await ledger(o.id);
    const { data } = await admin.from('wreath_orders').select('total').eq('id', o.id).single();
    const bank = Math.round((Number((data as { total: number }).total) - 1.84) * 100);
    expect([rows.map((r) => r.role), rows.reduce((n, r) => n + Math.round(r.amount * 100), 0) === bank]).toEqual([['payment', 'donation', 'fee'], true]);
  });

  it('Card_FeeArrivesLater_NetsTheDonationRow', async () => {
    const o = await place();
    const { pi } = await payByCard(o, null);
    const before = (await ledger(o.id)).map((r) => r.amount);
    await handleStripeEvent({ id: EVT(), type: 'charge.updated', data: { object: { id: 'ch_don', payment_intent: pi, balance_transaction: 'txn_don' } } }, cardDeps(fakeStripe(1.03)));
    expect([before, (await ledger(o.id)).map((r) => r.amount)]).toEqual([[25], [23.97]]);
  });

  it('Card_Refund_ReversesTheDonationGross', async () => {
    const o = await place();
    const { pi } = await payByCard(o, 1.03);
    await handleStripeEvent({ id: EVT(), type: 'charge.refunded', data: { object: { payment_intent: pi, amount_refunded: 2500 } } }, cardDeps(fakeStripe(1.03)));
    expect((await ledger(o.id)).map((r) => [r.role, r.amount])).toEqual([
      ['donation', 23.97],
      ['donation_refund', -25]
    ]);
  });

  it('EditOrder_CardPaid_RefusesADonationChange', async () => {
    const o = await place({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 10, fulfillment: 'pickup', customer: { name: 'Card Edit', email: `ce-${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' } });
    await payByCard(o, 1.5);
    const { data } = await admin.from('wreath_orders').select('total').eq('id', o.id).single();
    const total = Number((data as { total: number }).total);
    const { editOrder } = await actions();
    // The same total, with the money moved from the fee cover to the donation: still refused.
    const res = await editOrder(o.id, { seen: { total, paymentStatus: 'paid' }, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 11, customer: { name: 'Card Edit', email: '', phone: '', street: '', city: '', zip: '' }, creditedPersonId: null, fulfillment: 'pickup' });
    expect(res.ok).toBe(false);
  });
});

describe('the scouts’ share of donations', () => {
  it('Settings_SavesTheShare_AndLoadsItBack', async () => {
    const { saveSettings } = await actions();
    const res = await saveSettings(fx.saleId, {
      status: 'open', round1Date: '2026-10-25', round2Date: '2026-11-15', distributionDate: '2026-11-21', distributionWindow: '2:30 to 4:30 PM', distributionPlace: 'Test lot',
      deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 2.9, feeFixed: 0.3, scoutSharePercent: 30, donationSharePercent: 20, orderCc: []
    });
    const { data } = await admin.from('wreath_sales').select('donation_scout_share').eq('id', fx.saleId).single();
    expect([res.ok, Number((data as { donation_scout_share: number }).donation_scout_share)]).toEqual([true, 0.2]);
  });

  it('Settings_RefusesAShareOutside0To100', async () => {
    const { saveSettings } = await actions();
    const v = { status: 'open' as const, round1Date: '2026-10-25', round2Date: '2026-11-15', distributionDate: '', distributionWindow: '', distributionPlace: '', deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 2.9, feeFixed: 0.3, scoutSharePercent: 30, orderCc: [] };
    const results = [await saveSettings(fx.saleId, { ...v, donationSharePercent: -1 }), await saveSettings(fx.saleId, { ...v, donationSharePercent: 101 })];
    expect(results.map((r) => [r.ok, r.field])).toEqual([
      [false, 'donationSharePercent'],
      [false, 'donationSharePercent']
    ]);
  });

  it('NewSale_DefaultsTheShareTo15Percent', async () => {
    const { data } = await admin.from('wreath_sales').insert({ year: 9999 - Math.floor(Math.random() * 900), status: 'draft', round1_cutoff: '2026-10-26T04:59:00.000Z', round2_cutoff: '2026-11-16T05:59:00.000Z' }).select('id, donation_scout_share').single();
    const row = data as { id: number; donation_scout_share: number };
    await admin.from('wreath_sales').delete().eq('id', row.id);
    expect(Number(row.donation_scout_share)).toBe(0.15);
  });

  it('SellerView_CountsAPaidDonation_InTheScoutsEarnings', async () => {
    const o = await place({ sellerSlug: fx.sellerB.slug, gift: 40 });
    const { markPaid } = await actions();
    await markPaid(o.id, 'venmo');
    const orders = await loadAdminOrders(admin, fx.saleId, { involving: [fx.sellerB.personId] });
    const mine = orders.filter((x) => x.id === o.id);
    expect(buildSellerView(fx.sellerB.personId, 'B', mine, { profit: 0.3, donation: 0.15 }).summary.earnings).toBe(6);
  });
});
