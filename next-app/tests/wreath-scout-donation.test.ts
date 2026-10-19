import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps, type ScoutEntryViewer } from '../src/lib/wreaths/place-order';
import { editScoutOrder } from '../src/lib/wreaths/scout-entry';
import { resolveFamilyScope } from '../src/lib/household-scope';
import { loadAdminOrders } from '../src/lib/wreaths/admin-data';
import { buildSellerView } from '../src/lib/wreaths/my-orders';
import type { Capability } from '../src/lib/capabilities';

/**
 * Patrick, 2026-10-19 (Lily P's page, live): a customer gave $100 with no wreath, and "Order for someone I know"
 * refused it as an empty order. A scout's family, and a super user entering for a scout (W-4), can now enter a
 * donation-only paper order: credited to the scout, nothing to deliver, collected / not yet as usual, and Mark paid
 * books it as a Donation line. Against the real local database; admin edges mocked as in tests/wreath-admin.test.ts.
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
let family: ScoutEntryViewer;
let superUser: ScoutEntryViewer;
const send = vi.fn(async () => ({ status: 'sent', to: [] as string[] }));

const deps = (viewer: ScoutEntryViewer): PlaceOrderDeps => ({
  supabase: admin, now: () => NOW_R1, ip: null, send, householdEmails: async () => [], siteUrl: 'https://wreaths.test', replyTo: 'troop@example.test', saleId: fx.saleId,
  scoutEntry: { viewer, emails: ['enterer@example.test'] }
});

function entry(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    idempotencyKey: `vitest-sdon-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    sellerSlug: fx.sellerA.slug,
    lines: [],
    gift: 100,
    customer: { name: 'Aunt Jo', email: '', phone: '', note: '' },
    collected: true,
    paymentNote: 'Cash at the meeting',
    ...over
  };
}

async function place(viewer: ScoutEntryViewer, over: Record<string, unknown> = {}) {
  const res = await placeOrder(entry(over), deps(viewer));
  if (!res.ok) throw new Error(`entry: ${res.error}`);
  const { data } = await admin.from('wreath_orders').select('*, wreath_order_lines(*)').eq('public_token', res.token).single();
  return data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  fx = await makeWreathFixture('open');
  family = { personId: fx.sellerA.personId, name: 'Scout A', scope: await resolveFamilyScope(admin, fx.sellerA.personId, 'scout') };
  const { data } = await admin.from('person_capabilities').select('person_id').eq('capability', 'finance.manage').limit(1);
  const id = ((data ?? [])[0] as { person_id: number }).person_id;
  const household = await resolveFamilyScope(admin, id, 'adult');
  superUser = { personId: id, name: 'Super User', scope: [...new Set([...household, fx.sellerA.personId, fx.sellerB.personId])], household };
});
afterAll(async () => {
  await fx.cleanup();
});

describe('a donation-only order entered for a scout', () => {
  it('Family_CanEnterADonationOnlyPaperOrder_CreditedToTheScout_NothingToDeliver', async () => {
    const o = await place(family);
    expect([o.source, o.credited_person_id, o.fulfillment, o.delivering_person_id, o.wreath_order_lines.length, Number(o.gift), Number(o.total), o.collected_by_scout, o.payment_note]).toEqual([
      'paper', fx.sellerA.personId, 'none', null, 0, 100, 100, true, 'Cash at the meeting'
    ]);
  });

  it('SuperUser_CanEnterADonationOnlyPaperOrder', async () => {
    const o = await place(superUser, { sellerSlug: fx.sellerB.slug });
    expect([o.source, o.credited_person_id, o.fulfillment, o.entered_by_person_id]).toEqual(['paper', fx.sellerB.personId, 'none', superUser.personId]);
  });

  it('EmptyOrder_WithNoDonation_IsStillRefused', async () => {
    const res = await placeOrder(entry({ gift: 0 }), deps(family));
    expect(res.ok ? 'placed' : [res.field, res.error]).toEqual(['cart', 'The order is empty. Add a wreath or a donation.']);
  });

  it('DonationOnly_UnderOneDollar_IsRefused', async () => {
    const res = await placeOrder(entry({ gift: 0.5 }), deps(family));
    expect(res.ok || res.field).toBe('gift');
  });

  it('ScoutsEarnings_Include15PercentOfTheDonation', async () => {
    const o = await place(superUser, { sellerSlug: fx.sellerB.slug, gift: 40 });
    const orders = (await loadAdminOrders(admin, fx.saleId, { involving: [fx.sellerB.personId] })).filter((x) => x.id === o.id);
    expect(buildSellerView(fx.sellerB.personId, 'B', orders, { profit: 0.3, donation: 0.15 }).summary.earnings).toBe(6);
  });

  it('MarkPaid_BooksTheCollectedDonationAsADonationLine', async () => {
    const o = await place(family);
    const { markPaid } = await import('../src/app/admin/(workspace)/finance/wreaths/actions');
    expect(await markPaid(o.id, 'cash')).toMatchObject({ ok: true });
    const rows = (await admin.from('financial_transactions').select('amount, kind, ledger_role, bucket:buckets(name)').eq('wreath_order_id', o.id)).data ?? [];
    expect(rows).toEqual([{ amount: 100, kind: 'donation', ledger_role: 'donation', bucket: { name: `Wreaths '${String(fx.year).slice(-2)}` } }]);
  });
});

describe('editing a scout-entered order between donation-only and wreaths', () => {
  const eDeps = (viewer: ScoutEntryViewer) => ({ supabase: admin, now: () => NOW_R1, viewer });

  it('Edit_ToDonationOnly_IsAllowed_AndHasNothingToDeliver', async () => {
    const o = await place(family, { lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 0, collected: false });
    const res = await editScoutOrder({ orderId: o.id, customer: { name: 'Aunt Jo', email: '', phone: '', note: '' }, lines: [], gift: 30, collected: false, paymentNote: '' }, eDeps(family));
    const { data } = await admin.from('wreath_orders').select('fulfillment, delivering_person_id, total').eq('id', o.id).single();
    expect([res.ok, data]).toEqual([true, { fulfillment: 'none', delivering_person_id: null, total: 30 }]);
  });

  it('Edit_AddingAWreath_ToADonationOnlyOrder_MakesTheScoutDeliver', async () => {
    const o = await place(family, { collected: false });
    const res = await editScoutOrder({ orderId: o.id, customer: { name: 'Aunt Jo', email: '', phone: '', note: '' }, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 100, collected: false, paymentNote: '' }, eDeps(family));
    const { data } = await admin.from('wreath_orders').select('fulfillment, delivering_person_id').eq('id', o.id).single();
    expect([res.ok, data]).toEqual([true, { fulfillment: 'scout', delivering_person_id: fx.sellerA.personId }]);
  });

  it('Edit_ToNothingAtAll_IsRefused', async () => {
    const o = await place(family, { collected: false });
    const res = await editScoutOrder({ orderId: o.id, customer: { name: 'Aunt Jo', email: '', phone: '', note: '' }, lines: [], gift: 0, collected: false, paymentNote: '' }, eDeps(family));
    expect(res.ok ? 'saved' : res.error).toBe('The order is empty. Add a wreath or a donation.');
  });
});

describe('the donations a scout has raised (their public page)', () => {
  it('SellerTotals_CountLiveDonations_AndLeaveCancelledOnesOut', async () => {
    const { sellerTotals } = await import('../src/lib/wreaths/scout-entry');
    const before = await sellerTotals(admin, fx.saleId, fx.sellerA.personId);
    const kept = await place(family, { gift: 30 });
    const dropped = await place(family, { gift: 70 });
    await admin.from('wreath_orders').update({ status: 'cancelled' }).eq('id', dropped.id);
    const after = await sellerTotals(admin, fx.saleId, fx.sellerA.personId);
    expect([kept.id > 0, Math.round((after.donations - before.donations) * 100) / 100, after.items - before.items]).toEqual([true, 30, 0]);
  });
});
