import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, NOW_R2, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps } from '../src/lib/wreaths/place-order';
import { resolveScoutLink } from '../src/lib/wreaths/public';
import { loadRoseOrder } from '../src/lib/wreaths/admin-data';
import type { Capability } from '../src/lib/capabilities';

/**
 * Wreath sale admin (Admin > Finance > Wreath Sale): the server actions against the real local database. Only
 * the framework edges are mocked — the signed-in actor and the cache calls — exactly like site-pages-actions.
 */
const admin = adminClient();
const state = vi.hoisted(() => ({ caps: new Set<string>(['finance.manage']) }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({
    kind: 'identity',
    label: 'Vitest Treasurer',
    personId: null,
    capabilities: state.caps as Set<Capability>,
    legacyRole: null,
    subjectKind: 'adult'
  }),
  actorHas: () => true
}));
vi.mock('next/cache', () => ({ revalidatePath: cache.revalidatePath, updateTag: cache.updateTag, unstable_cache: (fn: unknown) => fn }));
// Release B: every change to what an order owes, or whether it is payable, first expires its open card session.
const card = vi.hoisted(() => ({ expire: vi.fn(async () => undefined) }));
vi.mock('@/lib/wreaths/stripe-client', () => ({ expireOrderCheckout: card.expire, cardCheckoutLive: () => false, cardDeps: () => ({}) }));

let fx: WreathFixture;
let seq = 0;
const send = vi.fn(async () => ({ status: 'sent', to: [] as string[] }));

async function actions() {
  return import('../src/app/admin/(workspace)/finance/wreaths/actions');
}

function deps(over: Partial<PlaceOrderDeps> = {}): PlaceOrderDeps {
  seq += 1;
  return { supabase: admin, now: () => NOW_R1, ip: `10.9.${Math.floor(seq / 250)}.${(seq % 250) + 1}`, send, householdEmails: async () => [], siteUrl: 'https://wreaths.test', replyTo: 'troop@example.test', saleId: fx.saleId, ...over };
}

async function makeOrder(over: Record<string, unknown> = {}, d: Partial<PlaceOrderDeps> = {}) {
  seq += 1;
  const now = d.now ? d.now() : NOW_R1;
  const res = await placeOrder(
    {
      idempotencyKey: `vitest-admin-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      sellerSlug: null,
      lines: [{ itemId: fx.item.w20, quantity: 2, donated: false }],
      gift: 0,
      coverFee: false,
      fulfillment: 'pickup',
      customer: { name: 'Vitest Buyer', email: `admin-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' },
      outsideAreaRelative: false,
      startedAt: now - 120_000,
      mountedAt: now - 60_000,
      website: '',
      ...over
    },
    deps(d)
  );
  if (!res.ok) throw new Error(`order: ${res.error}`);
  const { data } = await admin.from('wreath_orders').select('id, public_token').eq('public_token', res.token).single();
  return data as { id: number; public_token: string };
}

const auditFor = async (type: string, id: number) =>
  ((await admin.from('audit_log').select('*').eq('area', 'wreaths').eq('entity_type', type).eq('entity_id', String(id)).order('id')).data ?? []) as {
    action: string;
    summary: string;
    details: unknown;
  }[];

beforeAll(async () => {
  fx = await makeWreathFixture('open');
});
afterAll(async () => {
  await fx.cleanup();
});
beforeEach(() => {
  state.caps = new Set(['finance.manage']);
  cache.revalidatePath.mockClear();
  send.mockClear();
});

describe('orders', () => {
  it('MarkPaid_RequiresFinanceManage_IsIdempotent_AndAudits', async () => {
    const order = await makeOrder();
    const { markPaid } = await actions();
    state.caps = new Set(['news.write']);
    await expect(markPaid(order.id, 'venmo')).rejects.toThrow(/requires/i);
    expect((await admin.from('wreath_orders').select('payment_status').eq('id', order.id).single()).data?.payment_status).toBe('unpaid');

    state.caps = new Set(['finance.manage']);
    const first = await markPaid(order.id, 'venmo');
    expect(first).toMatchObject({ ok: true });
    const paid = (await admin.from('wreath_orders').select('payment_status, paid_method, paid_at').eq('id', order.id).single()).data!;
    expect(paid.payment_status).toBe('paid');
    expect(paid.paid_method).toBe('venmo');

    const again = await markPaid(order.id, 'cash');
    expect(again).toMatchObject({ ok: true, already: true });
    const after = (await admin.from('wreath_orders').select('paid_method, paid_at').eq('id', order.id).single()).data!;
    // A second click changes nothing: same method, same moment, and no second audit row.
    expect(after.paid_method).toBe('venmo');
    expect(after.paid_at).toBe(paid.paid_at);
    const audit = await auditFor('wreath_order', order.id);
    expect(audit.filter((a) => a.action === 'mark_paid')).toHaveLength(1);
    expect(JSON.stringify(audit[0].details)).toContain('venmo');
    expect(JSON.stringify(audit[0].details)).toContain('52');
  });

  // Patrick, 2026-10-15: marking paid books the money into the finance ledger — once, however many clicks.
  it('MarkPaid_BooksOneCheckingFundraiserRow_LinkedToTheOrder', async () => {
    const order = await makeOrder();
    const { markPaid } = await actions();
    await markPaid(order.id, 'paypal');
    await markPaid(order.id, 'paypal');
    const rows = ((await admin.from('financial_transactions').select('account, amount, kind, method, activity_label, voided_at').eq('wreath_order_id', order.id)).data ?? []);
    expect(rows).toEqual([{ account: 'checking', amount: 52, kind: 'fundraiser', method: 'paypal', activity_label: `Wreaths '${String(fx.year).slice(-2)}`, voided_at: null }]);
  });

  it('MarkPaid_BooksNothing_WhenTheOrderIsCancelled', async () => {
    const order = await makeOrder();
    const { markPaid, cancelOrder } = await actions();
    await cancelOrder(order.id);
    await markPaid(order.id, 'cash');
    expect((await admin.from('financial_transactions').select('id').eq('wreath_order_id', order.id)).data).toEqual([]);
  });

  it('MarkPaid_RefusesCardMethod_OnlyTheStripeWebhookRecordsCard', async () => {
    const order = await makeOrder();
    const { markPaid } = await actions();
    expect([(await markPaid(order.id, 'card' as never)).ok, (await admin.from('wreath_orders').select('payment_status').eq('id', order.id).single()).data?.payment_status]).toEqual([false, 'unpaid']);
  });

  // qa-lead HIGH: the cover-the-card-fee amount belongs to card payment only — paid another way, it drops.
  it('MarkPaid_ByVenmo_DropsAnUnpaidCardFeeCover', async () => {
    const order = await makeOrder();
    await admin.from('wreath_orders').update({ fee_covered: 1.52, total: 53.52 }).eq('id', order.id);
    const { markPaid } = await actions();
    await markPaid(order.id, 'venmo');
    const row = (await admin.from('wreath_orders').select('fee_covered, total, paid_amount').eq('id', order.id).single()).data!;
    expect([Number(row.fee_covered), Number(row.total), Number(row.paid_amount)]).toEqual([0, 52, 52]);
  });

  it('MarkPaid_Cancel_Reassign_ExpireTheOpenCardSession', async () => {
    const order = await makeOrder();
    const { markPaid, cancelOrder, reassignOrder } = await actions();
    card.expire.mockClear();
    await reassignOrder(order.id, { creditedPersonId: null, fulfillment: 'pickup' });
    await markPaid(order.id, 'venmo');
    await cancelOrder(order.id);
    expect(card.expire.mock.calls.map((c) => (c as unknown[])[0])).toEqual([order.id, order.id, order.id]);
  });

  it('MarkPaid_RefusesAnUnknownMethodAndACancelledOrder', async () => {
    const order = await makeOrder();
    const { markPaid, cancelOrder } = await actions();
    expect((await markPaid(order.id, 'bitcoin' as never)).ok).toBe(false);
    expect(await cancelOrder(order.id)).toMatchObject({ ok: true });
    expect((await markPaid(order.id, 'cash')).ok).toBe(false);
    expect((await admin.from('wreath_orders').select('status').eq('id', order.id).single()).data?.status).toBe('cancelled');
    expect((await auditFor('wreath_order', order.id)).map((a) => a.action)).toContain('cancel');
  });

  it('Reassign_RequiresFinanceManage_AndAuditsOldAndNew', async () => {
    const order = await makeOrder();
    const { reassignOrder } = await actions();
    state.caps = new Set(['news.write']);
    await expect(reassignOrder(order.id, { creditedPersonId: fx.sellerA.personId, fulfillment: 'scout', street: '1 A St', city: 'Milwaukee', zip: '53211' })).rejects.toThrow(/requires/i);

    state.caps = new Set(['finance.manage']);
    // Troop store pickup -> credited to and delivered by a scout.
    const toScout = await reassignOrder(order.id, { creditedPersonId: fx.sellerA.personId, fulfillment: 'scout', street: '1 A St', city: 'Milwaukee', zip: '53211' });
    expect(toScout).toMatchObject({ ok: true });
    let row: Record<string, unknown> = (await admin.from('wreath_orders').select('credited_person_id, delivering_person_id, fulfillment, customer_zip').eq('id', order.id).single()).data!;
    expect(row).toMatchObject({ credited_person_id: fx.sellerA.personId, delivering_person_id: fx.sellerA.personId, fulfillment: 'scout', customer_zip: '53211' });

    // Scout -> scout.
    expect(await reassignOrder(order.id, { creditedPersonId: fx.sellerB.personId, fulfillment: 'scout' })).toMatchObject({ ok: true });
    row = (await admin.from('wreath_orders').select('credited_person_id, delivering_person_id, fulfillment, customer_zip').eq('id', order.id).single()).data!;
    expect(row.credited_person_id).toBe(fx.sellerB.personId);
    expect(row.delivering_person_id).toBe(fx.sellerB.personId);

    // Scout -> troop, back to pickup.
    expect(await reassignOrder(order.id, { creditedPersonId: null, fulfillment: 'pickup' })).toMatchObject({ ok: true });
    row = (await admin.from('wreath_orders').select('credited_person_id, delivering_person_id, fulfillment').eq('id', order.id).single()).data!;
    expect(row).toMatchObject({ credited_person_id: null, delivering_person_id: null, fulfillment: 'pickup' });

    const audit = (await auditFor('wreath_order', order.id)).filter((a) => a.action === 'reassign');
    expect(audit).toHaveLength(3);
    const first = JSON.stringify(audit[0].details);
    // Old and new, as readable values (the summary names fields, never values — D-257).
    expect(first).toContain('Credited to');
    expect(first).toContain('Troop store');
    expect(first).toContain(fx.sellerA.first);
    expect(first).toContain('Pickup');
    expect(audit[0].summary).not.toContain(fx.sellerA.first);
  });

  it('Reassign_RepricesTheDeliveryFee_KeepsAPaidOrderPaid_AndAuditsOldAndNewTotal_WithoutTheAddress', async () => {
    // $26 of wreaths on a store pickup order, then paid.
    const order = await makeOrder({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] });
    const { reassignOrder, markPaid } = await actions();
    await markPaid(order.id, 'venmo');
    // Pickup -> troop delivery: under $50 of delivered items, so the $5 fee applies.
    expect(await reassignOrder(order.id, { creditedPersonId: null, fulfillment: 'delivery', street: '9 Secret Lane', city: 'Milwaukee', zip: '53211' })).toMatchObject({ ok: true });
    let row: Record<string, unknown> = (await admin.from('wreath_orders').select('delivery_fee, total, payment_status, paid_amount').eq('id', order.id).single()).data!;
    expect([Number(row.delivery_fee), Number(row.total), row.payment_status, Number(row.paid_amount)]).toEqual([5, 31, 'paid', 26]);
    // Delivery -> a scout delivers: no fee again.
    expect(await reassignOrder(order.id, { creditedPersonId: fx.sellerA.personId, fulfillment: 'scout' })).toMatchObject({ ok: true });
    row = (await admin.from('wreath_orders').select('delivery_fee, total, paid_amount').eq('id', order.id).single()).data!;
    expect([Number(row.delivery_fee), Number(row.total), Number(row.paid_amount)]).toEqual([0, 26, 26]);

    const audit = (await auditFor('wreath_order', order.id)).filter((a) => a.action === 'reassign');
    const first = JSON.stringify(audit[0].details);
    expect(first).toContain('Total');
    expect(first).toContain('$26.00');
    expect(first).toContain('$31.00');
    // The customer's address and phone never go into the audit trail.
    for (const a of audit) {
      const blob = JSON.stringify(a);
      expect(blob).not.toContain('Secret Lane');
      expect(blob).not.toContain('53211');
      expect(blob).not.toContain('414-555');
    }
  });

  it('Reassign_RefusesANonSeller_ARetiredSeller_AndAnOutOfAreaTroopDelivery', async () => {
    const order = await makeOrder();
    const { reassignOrder } = await actions();
    const { data: other } = await admin.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null).neq('person_id', fx.sellerA.personId).neq('person_id', fx.sellerB.personId).limit(1).single();
    expect((await reassignOrder(order.id, { creditedPersonId: (other as { person_id: number }).person_id, fulfillment: 'scout', street: '1 St', city: 'Milwaukee', zip: '53211' })).ok).toBe(false);

    await admin.from('wreath_sellers').update({ active: false }).eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug);
    expect((await reassignOrder(order.id, { creditedPersonId: fx.sellerB.personId, fulfillment: 'scout', street: '1 St', city: 'Milwaukee', zip: '53211' })).ok).toBe(false);
    await admin.from('wreath_sellers').update({ active: true }).eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug);

    expect((await reassignOrder(order.id, { creditedPersonId: null, fulfillment: 'delivery', street: '1 St', city: 'Chicago', zip: '60601' })).ok).toBe(false);
    expect((await reassignOrder(order.id, { creditedPersonId: null, fulfillment: 'delivery', street: '1 St', city: 'Milwaukee', zip: '53211' })).ok).toBe(true);
    // The row is unchanged by every refusal above.
    const row = (await admin.from('wreath_orders').select('credited_person_id').eq('id', order.id).single()).data!;
    expect(row.credited_person_id).toBeNull();
  });
});

describe('every write needs finance.manage', () => {
  it('CancelOrder_SetSellerSlug_SetSellerActive_UploadItemImage_RequireFinanceManage', async () => {
    const order = await makeOrder();
    const { cancelOrder, setSellerSlug, setSellerActive, uploadItemImage } = await actions();
    const { data: s } = await admin.from('wreath_sellers').select('id, slug, active').eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug).single();
    const sellerId = (s as { id: number }).id;
    state.caps = new Set(['news.write']);
    await expect(cancelOrder(order.id)).rejects.toThrow(/requires/i);
    await expect(setSellerSlug(sellerId, 'hacked')).rejects.toThrow(/requires/i);
    await expect(setSellerActive(sellerId, false)).rejects.toThrow(/requires/i);
    await expect(uploadItemImage(new FormData())).rejects.toThrow(/requires/i);
    // Nothing changed.
    expect((await admin.from('wreath_orders').select('status').eq('id', order.id).single()).data?.status).toBe('placed');
    const after = (await admin.from('wreath_sellers').select('slug, active').eq('id', sellerId).single()).data!;
    expect(after).toMatchObject({ slug: fx.sellerB.slug, active: true });
    // With the capability, an empty upload is refused politely rather than thrown.
    state.caps = new Set(['finance.manage']);
    expect((await uploadItemImage(new FormData())).ok).toBe(false);
  });
});

describe('sellers', () => {
  it('SellerSlug_CollisionRefused', async () => {
    const { setSellerSlug } = await actions();
    const { data: b } = await admin.from('wreath_sellers').select('id').eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug).single();
    const id = (b as { id: number }).id;
    const clash = await setSellerSlug(id, fx.sellerA.slug);
    expect(clash).toMatchObject({ ok: false, field: 'slug' });
    // The two names a link can never take: they are the checkout and confirmation routes.
    expect((await setSellerSlug(id, 'checkout')).ok).toBe(false);
    expect((await setSellerSlug(id, 'order')).ok).toBe(false);
    expect((await setSellerSlug(id, 'Not A Slug')).ok).toBe(false);
    expect((await admin.from('wreath_sellers').select('slug').eq('id', id).single()).data?.slug).toBe(fx.sellerB.slug);
    // Clearing the link is allowed: the seller keeps selling through the troop store.
    expect(await setSellerSlug(id, null)).toMatchObject({ ok: true });
    expect(await resolveScoutLink(admin, fx.saleId, fx.sellerB.slug)).toBeNull();
    expect(await setSellerSlug(id, fx.sellerB.slug)).toMatchObject({ ok: true });
  });

  it('SellerSlug_StoredLowercase_WhenTypedWithCapitals', async () => {
    const { setSellerSlug } = await actions();
    const { data: b } = await admin.from('wreath_sellers').select('id').eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug).single();
    const id = (b as { id: number }).id;
    expect(await setSellerSlug(id, ` ${fx.sellerB.slug.toUpperCase()} `)).toMatchObject({ ok: true });
    expect((await admin.from('wreath_sellers').select('slug').eq('id', id).single()).data?.slug).toBe(fx.sellerB.slug);
  });

  it('Leader_CanAddAndRetireSeller', async () => {
    const { addSeller, setSellerActive } = await actions();
    state.caps = new Set(['news.write']);
    await expect(addSeller(fx.saleId, { personId: 1, slug: 'nope' })).rejects.toThrow(/requires/i);
    state.caps = new Set(['finance.manage']);

    const taken = [fx.sellerA.personId, fx.sellerB.personId];
    const { data: scouts } = await admin.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null).limit(6);
    const person = (scouts as { person_id: number }[]).map((s) => s.person_id).find((p) => !taken.includes(p))!;
    const added = await addSeller(fx.saleId, { personId: person, slug: 'vitest-new' });
    expect(added).toMatchObject({ ok: true });
    expect(await resolveScoutLink(admin, fx.saleId, 'vitest-new')).not.toBeNull();
    // The same scout cannot be added twice.
    expect((await addSeller(fx.saleId, { personId: person, slug: 'vitest-new-2' })).ok).toBe(false);

    const { data: row } = await admin.from('wreath_sellers').select('id').eq('sale_id', fx.saleId).eq('person_id', person).single();
    const id = (row as { id: number }).id;
    expect(await setSellerActive(id, false)).toMatchObject({ ok: true });
    expect(await resolveScoutLink(admin, fx.saleId, 'vitest-new')).toBeNull();
    expect(await setSellerActive(id, true)).toMatchObject({ ok: true });
    expect(await resolveScoutLink(admin, fx.saleId, 'vitest-new')).not.toBeNull();
    const audit = await auditFor('wreath_seller', id);
    expect(audit.map((a) => a.action)).toEqual(['add', 'retire', 'restore']);
  });

  it('AddSeller_RefusesAPersonWhoIsNotAnActiveScout', async () => {
    const { addSeller } = await actions();
    const { data: inactive } = await admin.from('scouts').select('person_id').eq('active', false).not('person_id', 'is', null).limit(1);
    const { data: adult } = await admin.from('leaders').select('person_id').not('person_id', 'is', null).limit(1);
    const candidates = [...(inactive ?? []), ...(adult ?? [])] as { person_id: number }[];
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) expect((await addSeller(fx.saleId, { personId: c.person_id, slug: 'vitest-bad' })).ok, `person ${c.person_id}`).toBe(false);
  });
});

describe('settings and items', () => {
  it('SaveSettings_RequiresFinanceManage_ValidatesAndAudits', async () => {
    const { saveSettings } = await actions();
    const ok = {
      status: 'open' as const,
      round1Date: '2026-10-25',
      round2Date: '2026-11-15',
      distributionDate: '2026-11-21',
      distributionWindow: '2:30 to 4:30 PM',
      distributionPlace: 'Test lot',
      deliveryZipPrefix: '532',
      deliveryFee: 5,
      deliveryFreeAt: 50,
      feePercent: 1.99,
      feeFixed: 0.49,
      scoutSharePercent: 30
    };
    state.caps = new Set(['news.write']);
    await expect(saveSettings(fx.saleId, ok)).rejects.toThrow(/requires/i);
    state.caps = new Set(['finance.manage']);
    expect((await saveSettings(fx.saleId, { ...ok, round2Date: '2026-10-20' })).ok).toBe(false);
    expect((await saveSettings(fx.saleId, { ...ok, deliveryZipPrefix: 'abc' })).ok).toBe(false);
    expect((await saveSettings(fx.saleId, { ...ok, scoutSharePercent: 101 })).ok).toBe(false);

    expect(await saveSettings(fx.saleId, { ...ok, deliveryFee: 6, scoutSharePercent: 25 })).toMatchObject({ ok: true });
    const row = (await admin.from('wreath_sales').select('delivery_fee, scout_share, round1_cutoff, round2_cutoff').eq('id', fx.saleId).single()).data!;
    expect(Number(row.delivery_fee)).toBe(6);
    expect(Number(row.scout_share)).toBe(0.25);
    // The cutoffs are end of day Central: Oct 25 is daylight time (UTC-5), Nov 15 is standard time (UTC-6).
    expect(new Date(row.round1_cutoff).toISOString()).toBe('2026-10-26T04:59:00.000Z');
    expect(new Date(row.round2_cutoff).toISOString()).toBe('2026-11-16T05:59:00.000Z');
    const audit = await auditFor('wreath_sale', fx.saleId);
    expect(JSON.stringify(audit[0].details)).toContain('Delivery fee');
    // A list of prefixes is stored normalized.
    expect(await saveSettings(fx.saleId, { ...ok, deliveryZipPrefix: '532,531 ' })).toMatchObject({ ok: true });
    expect((await admin.from('wreath_sales').select('delivery_zip_prefix').eq('id', fx.saleId).single()).data!.delivery_zip_prefix).toBe('532, 531');
    await saveSettings(fx.saleId, ok);
  });

  it('SaveItem_RequiresFinanceManage_ValidatesAndAudits', async () => {
    const { saveItem } = await actions();
    const v = { name: 'Wreath', size: '20″', description: 'Edited by a test.', price: 27, unitCost: 16.07, imageUrl: null, donatable: true, active: true };
    state.caps = new Set(['news.write']);
    await expect(saveItem(fx.item.w20, v)).rejects.toThrow(/requires/i);
    state.caps = new Set(['finance.manage']);
    expect((await saveItem(fx.item.w20, { ...v, price: -1 })).ok).toBe(false);
    expect((await saveItem(fx.item.w20, { ...v, name: '' })).ok).toBe(false);
    expect((await saveItem(fx.item.w20, { ...v, imageUrl: 'javascript:alert(1)' })).ok).toBe(false);
    expect(await saveItem(fx.item.w20, v)).toMatchObject({ ok: true });
    expect(Number((await admin.from('wreath_items').select('price').eq('id', fx.item.w20).single()).data?.price)).toBe(27);
    // Orders already placed keep the price they were placed at (the lines snapshot it).
    const audit = await auditFor('wreath_item', fx.item.w20);
    expect(JSON.stringify(audit[0].details)).toContain('Price');
    await saveItem(fx.item.w20, { ...v, price: 26 });
  });
});

describe('Rose order', () => {
  it('RoseOrder_CountsByCatalogNumber_PerRound', async () => {
    // A throwaway sale of its own, so the counts are exact whatever else the suite did.
    const own = await makeWreathFixture('open');
    try {
      const mk = async (lines: { itemId: number; quantity: number; donated: boolean }[], now: number) => {
        seq += 1;
        const res = await placeOrder(
          { idempotencyKey: `vitest-rose-${Date.now()}-${seq}`, sellerSlug: null, lines, gift: 0, coverFee: false, fulfillment: 'pickup', customer: { name: 'Vitest Buyer', email: `rose-${seq}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' }, outsideAreaRelative: false, startedAt: now - 120_000, mountedAt: now - 60_000, website: '' },
          { ...deps({ now: () => now, saleId: own.saleId }) }
        );
        if (!res.ok) throw new Error(res.error);
        return res.token;
      };
      await mk([{ itemId: own.item.w20, quantity: 3, donated: false }, { itemId: own.item.easel, quantity: 1, donated: false }], NOW_R1);
      await mk([{ itemId: own.item.w20, quantity: 2, donated: true }], NOW_R1);
      const cancelled = await mk([{ itemId: own.item.w20, quantity: 9, donated: false }], NOW_R1);
      await mk([{ itemId: own.item.w20, quantity: 1, donated: false }, { itemId: own.item.w36, quantity: 4, donated: false }], NOW_R2);
      await admin.from('wreath_orders').update({ status: 'cancelled' }).eq('public_token', cancelled);

      const rows = await loadRoseOrder(admin, own.saleId);
      // Donated wreaths count; a cancelled order does not; Round 2 is the "changes".
      expect(rows).toEqual([
        { catalogNumber: 1, name: 'Wreath', size: '20″', round1: 5, round2: 1, total: 6 },
        { catalogNumber: 3, name: 'Wreath', size: '36″', round1: 0, round2: 4, total: 4 },
        { catalogNumber: 15, name: 'Easel', size: '30″', round1: 1, round2: 0, total: 1 }
      ]);
    } finally {
      await own.cleanup();
    }
  });
});
