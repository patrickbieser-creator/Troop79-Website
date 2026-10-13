import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps } from '../src/lib/wreaths/place-order';
import { createSellerSearchLimiter, searchSellers } from '../src/lib/wreaths/seller-search';
import { LINK_NOT_FOUND } from '../src/lib/wreaths/copy';
import { resolveScoutLink } from '../src/lib/wreaths/public';

/**
 * Optional scout credit on the general-store checkout (Plans/Wreath-Sale.md, "Optional scout credit at checkout"):
 * a customer may name a scout to credit without that scout delivering, found by typing a first name. The search is
 * server-side and shows first name + last initial only.
 */
const admin = adminClient();
let fx: WreathFixture;
let sellerBId = 0;
let sellerAId = 0;
const send = vi.fn(async () => ({ status: 'sent', to: [] as string[] }));
const householdEmails = vi.fn(async () => ['family@example.test']);
let seq = 0;
type Sent = { to: string[]; text: string };
const sent = () => (send.mock.calls as unknown as [Sent][]).map((c) => c[0]);

function deps(over: Partial<PlaceOrderDeps> = {}): PlaceOrderDeps {
  seq += 1;
  return { supabase: admin, now: () => NOW_R1, ip: `10.7.${Math.floor(seq / 250)}.${(seq % 250) + 1}`, send, householdEmails, siteUrl: 'https://w.test', replyTo: 't@example.test', saleId: fx.saleId, ...over };
}
function input(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    idempotencyKey: `vitest-credit-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    sellerSlug: null,
    creditSellerId: sellerAId,
    lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }],
    gift: 0,
    coverFee: false,
    fulfillment: 'pickup',
    customer: { name: 'Vitest Buyer', email: `credit-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' },
    outsideAreaRelative: false,
    startedAt: NOW_R1 - 120_000,
    mountedAt: NOW_R1 - 60_000,
    website: '',
    ...over
  };
}
const row = async (token: string) => (await admin.from('wreath_orders').select('*').eq('public_token', token).single()).data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  fx = await makeWreathFixture('open');
  const { data } = await admin.from('wreath_sellers').select('id, slug').eq('sale_id', fx.saleId);
  const by = Object.fromEntries((data as { id: number; slug: string }[]).map((s) => [s.slug, s.id]));
  sellerAId = by[fx.sellerA.slug];
  sellerBId = by[fx.sellerB.slug];
});
afterAll(async () => {
  await fx.cleanup();
});
beforeEach(() => {
  send.mockClear();
  householdEmails.mockClear();
});

describe('picking a scout to credit', () => {
  it('CheckoutCredit_DefaultsToTroop_AndIsOptional', async () => {
    const res = await placeOrder(input({ creditSellerId: null }), deps());
    if (!res.ok) throw new Error(res.error);
    expect((await row(res.token)).credited_person_id).toBeNull();
    expect(householdEmails).not.toHaveBeenCalled();
  });

  it('CheckoutCredit_PickedScout_IsCreditedNotDelivering', async () => {
    const res = await placeOrder(
      input({ fulfillment: 'delivery', customer: { name: 'Vitest Buyer', email: 'pick@example.test', phone: '414-555-0100', street: '5 Pick St', city: 'Milwaukee', zip: '53211' } }),
      deps()
    );
    if (!res.ok) throw new Error(res.error);
    const r = await row(res.token);
    expect(r.credited_person_id).toBe(fx.sellerA.personId);
    expect(r.delivering_person_id).toBeNull();
    expect(r.source).toBe('store');
    // The customer's own pickup / delivery choice and the troop-delivery fee rules are untouched.
    expect(r.fulfillment).toBe('delivery');
    expect(Number(r.delivery_fee)).toBe(5);
    // The household is told it was credited and that the troop delivers: no customer phone or address in that note.
    expect(householdEmails).toHaveBeenCalledWith(fx.sellerA.personId);
    const note = sent().find((m) => m.to.includes('family@example.test'))!;
    expect(note.text).toMatch(/credited to you/i);
    expect(note.text).toMatch(/troop (handles|delivers)/i);
    expect(note.text).not.toContain('414-555-0100');
    expect(note.text).not.toContain('5 Pick St');
    // The customer's receipt names the scout.
    expect(sent().find((m) => m.to.includes('pick@example.test'))!.text).toContain('Credited to');
  });

  it('CheckoutCredit_RejectsRetiredOrForeignSeller', async () => {
    await admin.from('wreath_sellers').update({ active: false }).eq('id', sellerBId);
    const retired = await placeOrder(input({ creditSellerId: sellerBId }), deps());
    await admin.from('wreath_sellers').update({ active: true }).eq('id', sellerBId);
    const { data: foreign } = await admin.from('wreath_sellers').select('id').neq('sale_id', fx.saleId).limit(1).single();
    const other = await placeOrder(input({ creditSellerId: (foreign as { id: number }).id }), deps());
    const junk = await placeOrder(input({ creditSellerId: 'abc' }), deps());
    for (const r of [retired, other, junk]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe('credit');
    }
    // Identical wording whichever way it failed.
    if (!retired.ok && !other.ok) expect(retired.error).toBe(other.error);
  });

  it('CheckoutCredit_ScoutLinkOrder_IgnoresAPickedScout', async () => {
    const res = await placeOrder(
      input({ sellerSlug: fx.sellerB.slug, creditSellerId: sellerAId, customer: { name: 'Vitest Buyer', email: 'link2@example.test', phone: '414-555-0100', street: '1 St', city: 'Milwaukee', zip: '53211' } }),
      deps()
    );
    if (!res.ok) throw new Error(res.error);
    const r = await row(res.token);
    expect(r.credited_person_id).toBe(fx.sellerB.personId);
    expect(r.delivering_person_id).toBe(fx.sellerB.personId);
  });

  it('CheckoutCredit_HouseholdNotice_SharesTheDailyCapWithScoutLinkOrders', async () => {
    const limits = { perSellerNoticeDay: 1 };
    const before = (await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).eq('sale_id', fx.saleId).eq('credited_person_id', fx.sellerB.personId)).count ?? 0;
    for (let i = 0; i < 3; i++) await placeOrder(input({ creditSellerId: sellerBId }), deps({ limits }));
    // Already-credited orders count toward the cap, however they were credited.
    expect(householdEmails.mock.calls.length).toBe(before >= 1 ? 0 : 1);
  });
});

describe('the type-ahead', () => {
  const first = () => fx.sellerA.first.slice(0, 3);

  it('CheckoutCredit_TypeAheadNeedsTwoLetters_ReturnsFirstNameAndInitialOnly', async () => {
    const limiter = createSellerSearchLimiter();
    expect(await searchSellers(admin, fx.saleId, 'R', { ip: '1.1.1.1', limiter })).toEqual([]);
    expect(await searchSellers(admin, fx.saleId, ' ', { ip: '1.1.1.1', limiter })).toEqual([]);
    const hits = await searchSellers(admin, fx.saleId, first(), { ip: '1.1.1.2', limiter });
    expect(hits.length).toBeGreaterThan(0);
    const mine = hits.find((h) => h.id === sellerAId)!;
    expect(mine).toEqual({ id: sellerAId, name: `${fx.sellerA.first} ${fx.sellerA.last[0]}.` });
    // Nothing but id + display name, and never the surname.
    expect(JSON.stringify(hits)).not.toContain(fx.sellerA.last);
    expect(Object.keys(mine).sort()).toEqual(['id', 'name']);
  });

  it('CheckoutCredit_TypeAhead_MatchesAPrefixOnly_ActiveSellersOnly_AtMostEight', async () => {
    const limiter = createSellerSearchLimiter();
    expect(await searchSellers(admin, fx.saleId, fx.sellerA.first.slice(1, 4), { ip: '1.1.1.3', limiter })).toEqual([]);
    await admin.from('wreath_sellers').update({ active: false }).eq('id', sellerAId);
    const retired = await searchSellers(admin, fx.saleId, fx.sellerA.first, { ip: '1.1.1.4', limiter });
    await admin.from('wreath_sellers').update({ active: true }).eq('id', sellerAId);
    expect(retired.find((h) => h.id === sellerAId)).toBeUndefined();
    // Wildcards typed by a visitor are not wildcards.
    expect(await searchSellers(admin, fx.saleId, '%%', { ip: '1.1.1.5', limiter })).toEqual([]);
    expect(await searchSellers(admin, fx.saleId, '__', { ip: '1.1.1.5', limiter })).toEqual([]);
    // The real 2026 sale has many sellers: still capped.
    const { data: sale } = await admin.from('wreath_sales').select('id').eq('year', 2026).single();
    const many = await searchSellers(admin, (sale as { id: number }).id, 'ol', { ip: '1.1.1.6', limiter });
    expect(many.length).toBeLessThanOrEqual(8);
  });

  it('CheckoutCredit_TypeAhead_IsRateLimitedPerIp', async () => {
    const limiter = createSellerSearchLimiter({ max: 3, windowMs: 60_000 });
    const results: number[] = [];
    for (let i = 0; i < 5; i++) results.push((await searchSellers(admin, fx.saleId, first(), { ip: '9.9.9.9', limiter, now: 1000 })).length > 0 ? 1 : 0);
    expect(results).toEqual([1, 1, 1, 0, 0]);
    // Another visitor is unaffected, and the window slides.
    expect((await searchSellers(admin, fx.saleId, first(), { ip: '9.9.9.8', limiter, now: 1000 })).length).toBeGreaterThan(0);
    expect((await searchSellers(admin, fx.saleId, first(), { ip: '9.9.9.9', limiter, now: 1000 + 61_000 })).length).toBeGreaterThan(0);
  });
});

describe('link not found', () => {
  it('LinkNotFound_FriendlyMessage_SameForUnknownAndRetired', async () => {
    await admin.from('wreath_sellers').update({ active: false }).eq('id', sellerBId);
    const retired = await resolveScoutLink(admin, fx.saleId, fx.sellerB.slug);
    const unknown = await resolveScoutLink(admin, fx.saleId, 'never-existed');
    await admin.from('wreath_sellers').update({ active: true }).eq('id', sellerBId);
    // Both resolve to nothing, so the page shows the one message below for either.
    expect(retired).toBeNull();
    expect(unknown).toBeNull();
    expect(LINK_NOT_FOUND).toMatch(/couldn’t find a scout with that link/i);
    expect(LINK_NOT_FOUND).toMatch(/spelling/i);
    expect(LINK_NOT_FOUND).toMatch(/credit/i);
    expect(LINK_NOT_FOUND).not.toMatch(/active|retired|this year/i);
  });
});
