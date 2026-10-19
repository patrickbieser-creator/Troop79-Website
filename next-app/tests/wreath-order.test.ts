import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, NOW_R2, NOW_AFTER, R1, R2, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps } from '../src/lib/wreaths/place-order';

/**
 * Wreath sale, Release A — the customer order action's rules against the real local database
 * (Plans/Wreath-Sale.md, "Release A build spec"). The action is a thin shell around placeOrder(); everything it
 * decides is tested here with an injected clock, IP and mailer, so no test can reach Resend.
 */
const admin = adminClient();
let fx: WreathFixture;
const send = vi.fn(async () => ({ status: 'sent', to: [] as string[] }));
const householdEmails = vi.fn(async () => ['family@example.test']);
let seq = 0;
let ipSeq = 0;

/** A fresh documentation-range address per call, so the per-IP hourly limit only bites in the tests that ask for it. */
const freshIp = () => `10.${Math.floor(++ipSeq / 250)}.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;

function deps(over: Partial<PlaceOrderDeps> = {}): PlaceOrderDeps {
  return {
    supabase: admin,
    now: () => NOW_R1,
    ip: freshIp(),
    send,
    householdEmails,
    siteUrl: 'https://wreaths.test',
    replyTo: 'troop@example.test',
    saleId: fx.saleId,
    ...over
  };
}

function input(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    idempotencyKey: `vitest-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    sellerSlug: null,
    lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }],
    gift: 0,
    coverFee: false,
    fulfillment: 'pickup',
    customer: { name: 'Vitest Buyer', email: `buyer-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' },
    outsideAreaRelative: false,
    startedAt: NOW_R1 - 120_000,
    mountedAt: NOW_R1 - 60_000,
    website: '',
    ...over
  };
}

const delivery = (zip: string, over: Record<string, unknown> = {}) =>
  input({ fulfillment: 'delivery', customer: { name: 'Vitest Buyer', email: `d-${++seq}@example.test`, phone: '414-555-0100', street: '1 Test St', city: 'Milwaukee', zip }, ...over });

async function orderRow(token: string) {
  const { data } = await admin.from('wreath_orders').select('*, wreath_order_lines(*)').eq('public_token', token).single();
  return data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  fx = await makeWreathFixture('open');
});
afterAll(async () => {
  await fx.cleanup();
});
beforeEach(() => {
  send.mockClear();
  householdEmails.mockClear();
});

describe('pricing is the server’s', () => {
  it('Order_PriceComesFromServer_NotClient', async () => {
    const res = await placeOrder(
      input({ lines: [{ itemId: fx.item.w20, quantity: 2, donated: false, unitPrice: 0.01, price: 0.01 }], total: 0.02, itemsSubtotal: 0.02, deliveryFee: 0 }),
      deps()
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await orderRow(res.token);
    expect(Number(row.items_subtotal)).toBe(52);
    expect(Number(row.total)).toBe(52);
    expect(Number(row.wreath_order_lines[0].unit_price)).toBe(26);
    expect(Number(row.wreath_order_lines[0].unit_cost)).toBe(16.07);
  });

  it('Order_RejectsQuantityOutOfBounds_AndInactiveItem', async () => {
    for (const quantity of [0, 51, -1, 1.5]) {
      const res = await placeOrder(input({ lines: [{ itemId: fx.item.w20, quantity, donated: false }] }), deps());
      expect(res.ok, `quantity ${quantity}`).toBe(false);
    }
    const unknown = await placeOrder(input({ lines: [{ itemId: 999999999, quantity: 1, donated: false }] }), deps());
    expect(unknown.ok).toBe(false);
    const tooMany = await placeOrder(input({ lines: Array.from({ length: 26 }, (_, i) => ({ itemId: fx.item.w20 + (i % 3), quantity: 1, donated: false })) }), deps());
    expect(tooMany.ok).toBe(false);

    await admin.from('wreath_items').update({ active: false }).eq('id', fx.item.easel);
    const inactive = await placeOrder(input({ lines: [{ itemId: fx.item.easel, quantity: 1, donated: false }] }), deps());
    await admin.from('wreath_items').update({ active: true }).eq('id', fx.item.easel);
    expect(inactive.ok).toBe(false);
  });

  it('Order_RejectsAnItemFromAnotherSale', async () => {
    const { data: other } = await admin.from('wreath_items').select('id').neq('sale_id', fx.saleId).limit(1).single();
    const res = await placeOrder(input({ lines: [{ itemId: (other as { id: number }).id, quantity: 1, donated: false }] }), deps());
    expect(res.ok).toBe(false);
  });

  it('DonatedLine_RejectedOnNonDonatableItem', async () => {
    const bad = await placeOrder(input({ lines: [{ itemId: fx.item.w36, quantity: 1, donated: true }] }), deps());
    expect(bad.ok).toBe(false);
    const good = await placeOrder(input({ lines: [{ itemId: fx.item.w20, quantity: 2, donated: true }] }), deps());
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const row = await orderRow(good.token);
    // An all-donated order has nothing to deliver, so it asks for no address and carries no delivery.
    expect(row.fulfillment).toBe('none');
    expect(row.wreath_order_lines[0].donated).toBe(true);
  });

  it('DeliveryFee_FiveUnderFifty_FreeAtFifty_NeverOnScoutDelivery', async () => {
    const under = await placeOrder(delivery('53211'), deps());
    const atFifty = await placeOrder(delivery('53211', { lines: [{ itemId: fx.item.easel, quantity: 5, donated: false }] }), deps());
    const over = await placeOrder(delivery('53211', { lines: [{ itemId: fx.item.w36, quantity: 1, donated: false }, { itemId: fx.item.easel, quantity: 1, donated: false }] }), deps());
    const scout = await placeOrder(delivery('53211', { sellerSlug: fx.sellerA.slug }), deps());
    const pickup = await placeOrder(input(), deps());
    const fee = async (r: Awaited<ReturnType<typeof placeOrder>>) => {
      if (!r.ok) throw new Error(r.error);
      return Number((await orderRow(r.token)).delivery_fee);
    };
    expect(await fee(under)).toBe(5);
    expect(await fee(atFifty)).toBe(0);
    expect(await fee(over)).toBe(0);
    expect(await fee(scout)).toBe(0);
    expect(await fee(pickup)).toBe(0);
    if (under.ok) expect(Number((await orderRow(under.token)).total)).toBe(31);
  });

  it('DeliveryFee_IgnoresDonatedLines_BecauseTheyAreNeverDelivered', async () => {
    // Two donated 20" wreaths ($52) plus one $10 easel by troop delivery: only the easel is delivered, so the fee applies.
    const res = await placeOrder(
      delivery('53211', { lines: [{ itemId: fx.item.w20, quantity: 2, donated: true }, { itemId: fx.item.easel, quantity: 1, donated: false }] }),
      deps()
    );
    if (!res.ok) throw new Error(res.error);
    const row = await orderRow(res.token);
    expect(Number(row.delivery_fee)).toBe(5);
    expect(Number(row.total)).toBe(67);
  });

  it('CoverFee_AddsFee_OnlyWhenTicked', async () => {
    const off = await placeOrder(input({ coverFee: false, gift: 10 }), deps());
    const on = await placeOrder(input({ coverFee: true, gift: 10 }), deps());
    if (!off.ok || !on.ok) throw new Error('orders should place');
    const a = await orderRow(off.token);
    const b = await orderRow(on.token);
    expect(Number(a.fee_covered)).toBe(0);
    expect(Number(a.total)).toBe(36);
    // W-3 (2026-10-19): no fee on the donation, so the cover is on the $26 wreath only — grossed up so the troop nets
    // it: ceil(($26.00 + $0.49) / 0.9801) = $27.03, a $1.03 cover; the $10 donation is added after.
    expect(Number(b.fee_covered)).toBe(1.03);
    expect(Number(b.total)).toBe(37.03);
    expect(Number(b.gift)).toBe(10);
  });

  it('Gift_IsBoundedAndNeverNegative', async () => {
    for (const gift of [-1, 501, Number.NaN]) {
      expect((await placeOrder(input({ gift }), deps())).ok, `gift ${gift}`).toBe(false);
    }
    expect((await placeOrder(input({ gift: 500 }), deps())).ok).toBe(true);
  });
});

describe('who the order is credited to', () => {
  it('Customer_CanOrderFromScoutLink_CreditsThatScout', async () => {
    const res = await placeOrder(
      input({ sellerSlug: fx.sellerA.slug, fulfillment: 'whatever', customer: { name: 'Vitest Buyer', email: 'link@example.test', phone: '414-555-0100', street: '5 Link Ave', city: 'Milwaukee', zip: '53211' } }),
      deps()
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await orderRow(res.token);
    expect(row.credited_person_id).toBe(fx.sellerA.personId);
    expect(row.delivering_person_id).toBe(fx.sellerA.personId);
    expect(row.source).toBe('scout_link');
    expect(row.fulfillment).toBe('scout');
    // The scout's household is told, at addresses on file — and the customer's own address is never a recipient of that note.
    expect(householdEmails).toHaveBeenCalledWith(fx.sellerA.personId);
    const recipients = send.mock.calls.map((c) => (c as unknown as [{ to: string[] }])[0].to).flat();
    expect(recipients).toContain('family@example.test');
    expect(recipients).toContain('link@example.test');
  });

  it('ScoutHouseholdNotice_IsCappedPerSellerPerDay_ButTheOrderStillSaves', async () => {
    householdEmails.mockClear();
    const limits = { perSellerNoticeDay: 2 };
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await placeOrder(
        delivery('53211', { sellerSlug: fx.sellerB.slug }),
        deps({ limits })
      );
      results.push(r.ok);
    }
    expect(results).toEqual([true, true, true, true]);
    const { count } = await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).eq('sale_id', fx.saleId).eq('credited_person_id', fx.sellerB.personId);
    expect(count).toBeGreaterThanOrEqual(4);
    // Only the first two notices reached the household.
    expect(householdEmails).toHaveBeenCalledTimes(2);
  });

  it('GeneralStoreOrder_IsCreditedToTheTroop_WhateverTheClientSends', async () => {
    const res = await placeOrder(input({ creditedPersonId: fx.sellerA.personId, credited_person_id: fx.sellerA.personId }), deps());
    if (!res.ok) throw new Error(res.error);
    const row = await orderRow(res.token);
    expect(row.credited_person_id).toBeNull();
    expect(row.source).toBe('store');
    expect(householdEmails).not.toHaveBeenCalled();
  });

  it('RetiredOrUnknownLink_RefusesTheOrder_WithoutCreatingOne', async () => {
    await admin.from('wreath_sellers').update({ active: false }).eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug);
    const before = (await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).eq('sale_id', fx.saleId)).count;
    const retired = await placeOrder(input({ sellerSlug: fx.sellerB.slug }), deps());
    const unknown = await placeOrder(input({ sellerSlug: 'no-such-link' }), deps());
    await admin.from('wreath_sellers').update({ active: true }).eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug);
    expect(retired.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    // The two refusals read identically: a retired link must not be distinguishable from one that never existed.
    if (!retired.ok && !unknown.ok) expect(retired.error).toBe(unknown.error);
    const after = (await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).eq('sale_id', fx.saleId)).count;
    expect(after).toBe(before);
  });
});

describe('the delivery area', () => {
  it('Zip_RejectsNonFiveDigit_AndNon532_ServerSide', async () => {
    for (const zip of ['5321', '532111', '53a11', '', '53012', '60601']) {
      const res = await placeOrder(delivery(zip), deps());
      expect(res.ok, `zip "${zip}"`).toBe(false);
      if (!res.ok) expect(res.field).toBe('zip');
    }
    expect((await placeOrder(delivery('53211'), deps())).ok).toBe(true);
    // A scout delivery needs a real zip too.
    const scoutBad = await placeOrder(delivery('abcde', { sellerSlug: fx.sellerA.slug }), deps());
    expect(scoutBad.ok).toBe(false);
  });

  it('Relative_CanOrderOutsideArea_FromScoutLink_WhenTicked', async () => {
    const unticked = await placeOrder(delivery('60601', { sellerSlug: fx.sellerA.slug }), deps());
    expect(unticked.ok).toBe(false);
    if (!unticked.ok) expect(unticked.field).toBe('relative');
    const ticked = await placeOrder(delivery('60601', { sellerSlug: fx.sellerA.slug, outsideAreaRelative: true }), deps());
    expect(ticked.ok).toBe(true);
    if (ticked.ok) {
      const row = await orderRow(ticked.token);
      expect(row.outside_area_relative).toBe(true);
      expect(row.customer_zip).toBe('60601');
    }
    // The box means nothing for an address inside the area, so it is not recorded there.
    const inside = await placeOrder(delivery('53211', { sellerSlug: fx.sellerA.slug, outsideAreaRelative: true }), deps());
    if (inside.ok) expect((await orderRow(inside.token)).outside_area_relative).toBe(false);
  });

  it('Customer_CannotOrderOutsideArea_FromGeneralStore', async () => {
    const res = await placeOrder(delivery('60601', { outsideAreaRelative: true }), deps());
    expect(res.ok).toBe(false);
    // Pickup is how a store customer outside the area orders.
    expect((await placeOrder(input(), deps())).ok).toBe(true);
  });

  it('Order_NeedsAFulfillmentChoice_OnTheGeneralStore', async () => {
    const res = await placeOrder(input({ fulfillment: null }), deps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.field).toBe('method');
  });
});

describe('retries and abuse', () => {
  it('Submit_IsIdempotent_OnDuplicateKey', async () => {
    const body = input();
    const first = await placeOrder(body, deps());
    const second = await placeOrder(body, deps());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.token).toBe(first.token);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const { count } = await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).eq('idempotency_key', body.idempotencyKey);
    expect(count).toBe(1);
    // One confirmation for the order, not one per click.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('ConfirmationEmail_RateLimited_PerIpAndPerEmail', async () => {
    const limits = { perIpHour: 2, perEmailDay: 2, globalHour: 1000 };
    const ip = '198.51.100.9';
    const placed: boolean[] = [];
    for (let i = 0; i < 3; i++) placed.push((await placeOrder(input(), deps({ ip, limits }))).ok);
    expect(placed).toEqual([true, true, false]);
    expect(send).toHaveBeenCalledTimes(2);

    send.mockClear();
    const email = `same-${Date.now()}@example.test`;
    const customer = { name: 'Vitest Buyer', email, phone: '414-555-0100', street: '', city: '', zip: '' };
    const byEmail: boolean[] = [];
    for (let i = 0; i < 3; i++) byEmail.push((await placeOrder(input({ customer }), deps({ ip: `198.51.100.${20 + i}`, limits }))).ok);
    expect(byEmail).toEqual([true, true, false]);
    expect(send).toHaveBeenCalledTimes(2);

    const refused = await placeOrder(input({ customer }), deps({ ip: '198.51.100.99', limits }));
    // Generic: it never says which limit was hit.
    if (!refused.ok) expect(refused.code).toBe('unavailable');
    const { count } = await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).eq('customer_email', email);
    expect(count).toBe(2);
  });

  it('GlobalHourlyCap_RefusesEveryone_Generically', async () => {
    const res = await placeOrder(input(), deps({ ip: '198.51.100.200', limits: { perIpHour: 100, perEmailDay: 100, globalHour: 0 } }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unavailable');
  });

  it('Honeypot_FilledOrTooFast_CreatesNoOrderAndSendsNoEmail', async () => {
    const before = (await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).eq('sale_id', fx.saleId)).count;
    const filled = await placeOrder(input({ website: 'http://spam.example' }), deps());
    const tooFast = await placeOrder(input({ mountedAt: NOW_R1 - 1000 }), deps());
    const noTimer = await placeOrder(input({ mountedAt: null }), deps());
    for (const r of [filled, tooFast, noTimer]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('unavailable');
    }
    const after = (await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).eq('sale_id', fx.saleId)).count;
    expect(after).toBe(before);
    expect(send).not.toHaveBeenCalled();
  });

  it('Order_StoresTheCallerIp_FromTheTrustedHeader', async () => {
    const res = await placeOrder(input(), deps({ ip: '192.0.2.44' }));
    if (!res.ok) throw new Error(res.error);
    expect((await orderRow(res.token)).created_ip).toBe('192.0.2.44');
  });

  it('Order_RefusesOverlongAndMalformedFields', async () => {
    const mk = (customer: Record<string, string>) => input({ customer: { name: 'Vitest Buyer', email: 'ok@example.test', phone: '414-555-0100', street: '', city: '', zip: '', ...customer } });
    expect((await placeOrder(mk({ name: 'x'.repeat(101) }), deps())).ok).toBe(false);
    expect((await placeOrder(mk({ name: '   ' }), deps())).ok).toBe(false);
    expect((await placeOrder(mk({ email: 'not-an-email' }), deps())).ok).toBe(false);
    expect((await placeOrder(mk({ phone: '12345' }), deps())).ok).toBe(false);
    const res = await placeOrder(mk({ email: ' MiXed@Example.TEST ' }), deps());
    if (!res.ok) throw new Error(res.error);
    expect((await orderRow(res.token)).customer_email).toBe('mixed@example.test');
  });
});

describe('cutoffs', () => {
  it('StoreRefuses_NewCartAfterCutoff_ButAllowsOpenCheckout', async () => {
    const afterR1 = Date.parse(R1) + 30 * 60_000;
    // A checkout begun before the Round 1 cutoff finishes half an hour after it, and counts in Round 1.
    const grace = await placeOrder(input({ startedAt: Date.parse(R1) - 10 * 60_000, mountedAt: afterR1 - 60_000 }), deps({ now: () => afterR1 }));
    expect(grace.ok).toBe(true);
    if (grace.ok) expect((await orderRow(grace.token)).round).toBe(1);
    // A cart begun after it is a Round 2 order.
    const fresh = await placeOrder(input({ startedAt: afterR1 - 60_000, mountedAt: afterR1 - 30_000 }), deps({ now: () => afterR1 }));
    if (!fresh.ok) throw new Error(fresh.error);
    expect((await orderRow(fresh.token)).round).toBe(2);
    // Grace is bounded: three hours after Round 1 closed, the old checkout is a Round 2 order too.
    const late = Date.parse(R1) + 3 * 3600_000;
    const stale = await placeOrder(input({ startedAt: Date.parse(R1) - 10 * 60_000, mountedAt: late - 60_000 }), deps({ now: () => late }));
    if (!stale.ok) throw new Error(stale.error);
    expect((await orderRow(stale.token)).round).toBe(2);
  });

  it('Store_RefusesOrders_AfterFinalCutoff', async () => {
    const end = Date.parse(R2);
    const graceOk = await placeOrder(input({ startedAt: end - 5 * 60_000, mountedAt: end + 25 * 60_000 }), deps({ now: () => end + 30 * 60_000 }));
    expect(graceOk.ok).toBe(true);
    const closed = await placeOrder(input({ startedAt: end - 5 * 60_000, mountedAt: NOW_AFTER - 60_000 }), deps({ now: () => NOW_AFTER }));
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe('closed');
    // A forged start time cannot reach past the grace window.
    const forged = await placeOrder(input({ startedAt: end - 1000, mountedAt: end + 3 * 3600_000 - 60_000 }), deps({ now: () => end + 3 * 3600_000 }));
    expect(forged.ok).toBe(false);
  });

  it('Store_RefusesOrders_WhenTheSaleIsDraftOrClosed', async () => {
    for (const status of ['draft', 'closed']) {
      await admin.from('wreath_sales').update({ status }).eq('id', fx.saleId);
      const res = await placeOrder(input(), deps());
      expect(res.ok, status).toBe(false);
      if (!res.ok) expect(res.code).toBe('closed');
    }
    await admin.from('wreath_sales').update({ status: 'open' }).eq('id', fx.saleId);
  });

  it('Round2Orders_AreRound2_BetweenTheCutoffs', async () => {
    const res = await placeOrder(input({ startedAt: NOW_R2 - 60_000, mountedAt: NOW_R2 - 30_000 }), deps({ now: () => NOW_R2 }));
    if (!res.ok) throw new Error(res.error);
    expect((await orderRow(res.token)).round).toBe(2);
  });
});

describe('order copies (Settings › Order copies)', () => {
  beforeAll(async () => {
    await admin.from('wreath_sales').update({ order_cc: ['treasurer@example.test', 'cubmaster@example.test'] }).eq('id', fx.saleId);
  });
  afterAll(async () => {
    await admin.from('wreath_sales').update({ order_cc: [] }).eq('id', fx.saleId);
  });

  const sent = () => send.mock.calls.map((c) => (c as unknown as [{ to: string[]; subject: string; text: string }])[0]);
  const copy = () => sent().find((m) => m.to.includes('treasurer@example.test'));

  it('OrderCopies_GetTheCustomersConfirmation', async () => {
    send.mockClear();
    const res = await placeOrder(input(), deps());
    expect([res.ok, copy()?.to]).toEqual([true, ['treasurer@example.test', 'cubmaster@example.test']]);
  });

  it('OrderCopies_GoInTheirOwnMessage_NotTheCustomers', async () => {
    send.mockClear();
    const buyer = input();
    await placeOrder(buyer, deps());
    expect(sent()[0].to).toEqual([(buyer.customer as { email: string }).email]);
  });

  it('OrderCopies_SayTheyAreACopy_InTheSubject', async () => {
    send.mockClear();
    await placeOrder(input(), deps());
    expect(copy()?.subject).toMatch(/^Copy: /);
  });

  it('OrderCopies_SayWhoTheOriginalWentTo_AtTheTop', async () => {
    send.mockClear();
    await placeOrder(input(), deps());
    expect(copy()?.text.split('\n')[0]).toMatch(/^Copy for the troop/);
  });

  it('OrderCopies_AreNotAddedToTheScoutsHouseholdNotice', async () => {
    await placeOrder(input({ sellerSlug: fx.sellerA.slug, customer: { name: 'Vitest Buyer', email: 'copy@example.test', phone: '414-555-0100', street: '5 Link Ave', city: 'Milwaukee', zip: '53211' } }), deps());
    expect(sent().filter((m) => !/^Copy: /.test(m.subject)).flatMap((m) => m.to)).not.toContain('treasurer@example.test');
  });
});
