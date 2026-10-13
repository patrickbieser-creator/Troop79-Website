import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type ScoutEntryViewer } from '../src/lib/wreaths/place-order';
import { loadAdminOrders, loadAdminSellers } from '../src/lib/wreaths/admin-data';
import type { Capability } from '../src/lib/capabilities';

/**
 * Admin side of scout-entered orders: the Orders loader carries who entered it, "Collected by scout" and the notes;
 * marking Paid also sets collected; the treasurer can edit the payment note; a seller's goal is set under finance.manage.
 */
const admin = adminClient();
const state = vi.hoisted(() => ({ caps: new Set<string>(['finance.manage']) }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => ({ kind: 'identity', label: 'Vitest Treasurer', personId: null, capabilities: state.caps as Set<Capability>, legacyRole: null, subjectKind: 'adult' }),
  actorHas: () => true
}));
vi.mock('next/cache', () => ({ revalidatePath: cache.revalidatePath, updateTag: cache.updateTag, unstable_cache: (fn: unknown) => fn }));

let fx: WreathFixture;
let viewer: ScoutEntryViewer;
let seq = 0;
const actions = () => import('../src/app/admin/(workspace)/finance/wreaths/actions');

async function entered(over: Record<string, unknown> = {}) {
  seq += 1;
  const res = await placeOrder(
    {
      idempotencyKey: `vitest-entry-admin-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      sellerSlug: fx.sellerA.slug,
      lines: [{ itemId: fx.item.w20, quantity: 2, donated: false }],
      customer: { name: 'Grandma Sue', email: '', phone: '', note: 'Leave on the porch' },
      collected: true,
      paymentNote: 'Cash at the 10/18 meeting',
      ...over
    },
    { supabase: admin, now: () => NOW_R1, ip: null, send: async () => ({}), householdEmails: async () => [], siteUrl: 'https://w.test', replyTo: 'troop@example.test', saleId: fx.saleId, scoutEntry: { viewer, emails: [] } }
  );
  if (!res.ok) throw new Error(res.error);
  return (await admin.from('wreath_orders').select('id').eq('public_token', res.token).single()).data!.id as number;
}
const row = async (id: number) => (await admin.from('wreath_orders').select('*').eq('id', id).single()).data!;

beforeAll(async () => {
  fx = await makeWreathFixture('open');
  viewer = { personId: fx.sellerA.personId, name: 'Scout A', scope: [fx.sellerA.personId] };
});
afterAll(async () => {
  await fx.cleanup();
});
beforeEach(() => {
  state.caps = new Set(['finance.manage']);
});

describe('admin orders for scout-entered orders', () => {
  it('AdminOrders_ShowsCollectedByScoutAndThePaymentNote', async () => {
    const id = await entered();
    const o = (await loadAdminOrders(admin, fx.saleId)).find((x) => x.id === id)!;
    expect([o.source, o.collectedByScout, o.paymentNote, o.customerNote]).toEqual(['paper', true, 'Cash at the 10/18 meeting', 'Leave on the porch']);
  });
  it('AdminOrders_ShowsWhoEnteredIt', async () => {
    const { data } = await admin.from('people').select('display_name').eq('id', fx.sellerA.personId).single();
    const id = await entered();
    expect((await loadAdminOrders(admin, fx.saleId)).find((x) => x.id === id)!.enteredByName).toBe(data!.display_name);
  });
  it('AdminOrders_ShowsAnOnlineOrderAsNotScoutEntered', async () => {
    const res = await placeOrder(
      { idempotencyKey: `vitest-online-${Date.now()}-${Math.random()}`, sellerSlug: null, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], gift: 0, coverFee: false, fulfillment: 'pickup', customer: { name: 'Pat', email: `pat${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' }, startedAt: NOW_R1 - 120_000, mountedAt: NOW_R1 - 60_000, website: '' },
      { supabase: admin, now: () => NOW_R1, ip: '10.66.0.1', send: async () => ({}), householdEmails: async () => [], siteUrl: 'https://w.test', replyTo: 'troop@example.test', saleId: fx.saleId }
    );
    if (!res.ok) throw new Error(res.error);
    const o = (await loadAdminOrders(admin, fx.saleId)).find((x) => x.orderNumber && x.source === 'store')!;
    expect([o.enteredByName, o.collectedByScout, o.paymentNote]).toEqual([null, false, '']);
  });
  it('MarkPaid_AlsoSetsCollectedByScout_WhenTheScoutHadNotMarkedIt', async () => {
    const id = await entered({ collected: false, paymentNote: '' });
    const { markPaid } = await actions();
    await markPaid(id, 'cash');
    expect((await row(id)).collected_by_scout).toBe(true);
  });
  it('SetPaymentNote_LetsTheTreasurerEditIt_AndAudits', async () => {
    const id = await entered();
    const { setPaymentNote } = await actions();
    expect(await setPaymentNote(id, '  Venmo’d Patrick 10/20 ')).toMatchObject({ ok: true });
    const { data } = await admin.from('audit_log').select('summary').eq('area', 'wreaths').eq('entity_id', String(id));
    expect([(await row(id)).payment_note, data!.length]).toEqual(['Venmo’d Patrick 10/20', 1]);
  });
  it('SetPaymentNote_RequiresFinanceManage', async () => {
    const id = await entered();
    const { setPaymentNote } = await actions();
    state.caps = new Set(['news.write']);
    await expect(setPaymentNote(id, 'x')).rejects.toThrow(/requires/i);
  });
  it('SetPaymentNote_Refuses_AnOverlongNote', async () => {
    const id = await entered();
    const { setPaymentNote } = await actions();
    expect(await setPaymentNote(id, 'x'.repeat(201))).toMatchObject({ ok: false, field: 'paymentNote' });
  });
  it('SetPaymentNote_Clears_WhenEmpty', async () => {
    const id = await entered();
    const { setPaymentNote } = await actions();
    await setPaymentNote(id, '');
    expect((await row(id)).payment_note).toBeNull();
  });
});

describe('admin sets a seller goal', () => {
  const sellerRow = async () => (await loadAdminSellers(admin, fx.saleId)).find((s) => s.personId === fx.sellerA.personId)!;
  it('SetSellerGoal_Saves_AndShowsInTheSellersList', async () => {
    const { setSellerGoal } = await actions();
    expect(await setSellerGoal((await sellerRow()).id, '30')).toMatchObject({ ok: true });
    expect((await sellerRow()).goal).toBe(30);
  });
  it('SetSellerGoal_RequiresFinanceManage', async () => {
    const { setSellerGoal } = await actions();
    state.caps = new Set(['news.write']);
    await expect(setSellerGoal((await sellerRow()).id, '30')).rejects.toThrow(/requires/i);
  });
  it.each(['1000', '-3', 'many'])('SetSellerGoal_Refuses_%s', async (bad) => {
    const { setSellerGoal } = await actions();
    expect(await setSellerGoal((await sellerRow()).id, bad)).toMatchObject({ ok: false, field: 'goal' });
  });
  it('SetSellerGoal_Clears_WhenEmpty', async () => {
    const { setSellerGoal } = await actions();
    const id = (await sellerRow()).id;
    await setSellerGoal(id, '12');
    await setSellerGoal(id, '');
    expect((await sellerRow()).goal).toBeNull();
  });
});

describe('admin sets a seller delivery message', () => {
  const sellerRow = async () => (await loadAdminSellers(admin, fx.saleId)).find((s) => s.personId === fx.sellerA.personId)!;
  it('SetSellerDeliveryMessage_Saves_AndShowsInTheSellersList', async () => {
    const { setSellerDeliveryMessage } = await actions();
    expect(await setSellerDeliveryMessage((await sellerRow()).id, ' Week of Nov 22 ')).toMatchObject({ ok: true });
    expect((await sellerRow()).deliveryMessage).toBe('Week of Nov 22');
  });
  it('SetSellerDeliveryMessage_Clears_WhenEmpty', async () => {
    const { setSellerDeliveryMessage } = await actions();
    const id = (await sellerRow()).id;
    await setSellerDeliveryMessage(id, 'x');
    await setSellerDeliveryMessage(id, '');
    expect((await sellerRow()).deliveryMessage).toBeNull();
  });
  it('SetSellerDeliveryMessage_Refuses_Over200Characters', async () => {
    const { setSellerDeliveryMessage } = await actions();
    expect(await setSellerDeliveryMessage((await sellerRow()).id, 'x'.repeat(201))).toMatchObject({ ok: false, field: 'deliveryMessage' });
  });
  it('SetSellerDeliveryMessage_RequiresFinanceManage', async () => {
    const { setSellerDeliveryMessage } = await actions();
    state.caps = new Set(['news.write']);
    await expect(setSellerDeliveryMessage((await sellerRow()).id, 'x')).rejects.toThrow(/requires/i);
  });
});
