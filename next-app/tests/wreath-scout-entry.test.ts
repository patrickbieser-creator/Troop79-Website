import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, NOW_R2, NOW_AFTER, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps, type ScoutEntryViewer } from '../src/lib/wreaths/place-order';
import { subjectText } from '../src/lib/wreaths/emails';
import { cancelScoutOrder, editScoutOrder, entryOffered, goalProgress, itemsSoldBy, lockReason, mayEnterFor, parseGoal, setScoutSettings } from '../src/lib/wreaths/scout-entry';
import { resolveFamilyScope } from '../src/lib/household-scope';
import { buildSellerView } from '../src/lib/wreaths/my-orders';
import { loadAdminOrders, loadAdminSellers, loadRoseOrder } from '../src/lib/wreaths/admin-data';

/**
 * Wreath sale — scout-entered orders ("Order for someone I know"), Plans/Wreath-Scout-Entered-Orders.md, against the
 * real local database. The server actions are thin shells that derive the viewer from the session; every rule they
 * lean on is here, driven with explicit viewers (a scout, a parent, another family, a leader proxying).
 */
const admin = adminClient();
let fx: WreathFixture;
let seq = 0;
let kid: { personId: number; parentId: number } | null = null;
const send = vi.fn(async (m: { to: string[]; subject: string; html: string; text: string }) => ({ status: 'sent', to: m.to }));
const householdEmails = vi.fn(async () => ['parent@example.test']);

let viewerA: ScoutEntryViewer; // the scout sellerA
let viewerB: ScoutEntryViewer; // another family's scout
let parentViewer: ScoutEntryViewer; // a real parent of a real scout, who is a seller in the fixture sale
let leaderProxy: ScoutEntryViewer; // a leader who is not a parent of anyone here: proxying gives no scope

function deps(over: Partial<PlaceOrderDeps> = {}): PlaceOrderDeps {
  return {
    supabase: admin,
    now: () => NOW_R1,
    ip: null,
    send,
    householdEmails,
    siteUrl: 'https://wreaths.test',
    replyTo: 'troop@example.test',
    saleId: fx.saleId,
    ...over
  };
}

function entry(over: Record<string, unknown> = {}, slug = fx.sellerA.slug) {
  seq += 1;
  return {
    idempotencyKey: `vitest-entry-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    sellerSlug: slug,
    lines: [{ itemId: fx.item.w20, quantity: 2, donated: false }],
    gift: 0,
    customer: { name: 'Grandma Sue', email: '', phone: '', note: '' },
    collected: false,
    paymentNote: '',
    startedAt: NOW_R1 - 120_000,
    mountedAt: NOW_R1 - 60_000,
    ...over
  };
}

const asScoutEntry = (viewer: ScoutEntryViewer, emails: string[] = ['enterer@example.test']) => ({ scoutEntry: { viewer, emails } });

async function place(over: Record<string, unknown> = {}, viewer = viewerA, d: Partial<PlaceOrderDeps> = {}, slug = fx.sellerA.slug) {
  const res = await placeOrder(entry(over, slug), deps({ ...asScoutEntry(viewer), ...d }));
  if (!res.ok) throw new Error(`entry: ${res.error}`);
  const { data } = await admin.from('wreath_orders').select('*, wreath_order_lines(*)').eq('public_token', res.token).single();
  return data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const edit = (order: Record<string, any>, over: Record<string, unknown> = {}) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  orderId: order.id,
  customer: { name: 'Grandma Sue', email: '', phone: '', note: '' },
  lines: [{ itemId: fx.item.w20, quantity: 2, donated: false }],
  gift: 0,
  collected: false,
  paymentNote: '',
  ...over
});
const eDeps = (viewer: ScoutEntryViewer | null, now = NOW_R1) => ({ supabase: admin, now: () => now, viewer });

async function row(id: number) {
  const { data } = await admin.from('wreath_orders').select('*, wreath_order_lines(*)').eq('id', id).single();
  return data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  fx = await makeWreathFixture('open');
  const scope = (id: number, kind: 'adult' | 'scout') => resolveFamilyScope(admin, id, kind);
  viewerA = { personId: fx.sellerA.personId, name: 'Scout A', scope: await scope(fx.sellerA.personId, 'scout') };
  viewerB = { personId: fx.sellerB.personId, name: 'Scout B', scope: await scope(fx.sellerB.personId, 'scout') };
  leaderProxy = { personId: 999999991, name: 'Leader', scope: [999999991] };

  // A real parent whose child is an active scout, made a seller of the fixture sale.
  const { data: rels } = await admin.from('relationships').select('person_id, related_person_id').eq('type', 'parent_of').limit(200);
  for (const r of (rels ?? []) as { person_id: number; related_person_id: number }[]) {
    if ([fx.sellerA.personId, fx.sellerB.personId].includes(r.related_person_id)) continue;
    const { data: sc } = await admin.from('scouts').select('person_id').eq('person_id', r.related_person_id).eq('active', true).maybeSingle();
    if (!sc) continue;
    kid = { personId: r.related_person_id, parentId: r.person_id };
    break;
  }
  if (!kid) throw new Error('needs a parent_of relationship to an active scout in the local DB');
  await admin.from('wreath_sellers').insert({ sale_id: fx.saleId, person_id: kid.personId, slug: 'vitest-kid' });
  parentViewer = { personId: kid.parentId, name: 'Parent', scope: await scope(kid.parentId, 'adult') };
});
afterAll(async () => {
  await fx.cleanup();
});
beforeEach(() => {
  send.mockClear();
  householdEmails.mockClear();
});

describe('who is offered the mode', () => {
  it('ScoutOrderMode_IsOffered_WhenTheViewerIsTheScout', () => {
    expect(entryOffered(viewerA, fx.sellerA.personId, true)).toBe(true);
  });
  it('ScoutOrderMode_IsOffered_WhenTheViewerIsAParentInTheScoutsHousehold', () => {
    expect(parentViewer.scope).toContain(kid!.personId);
    expect(entryOffered(parentViewer, kid!.personId, true)).toBe(true);
  });
  it('ScoutOrderMode_IsNotOffered_ToASignedOutVisitor', () => {
    expect(entryOffered(null, fx.sellerA.personId, true)).toBe(false);
  });
  it('ScoutOrderMode_IsNotOffered_ToAnotherFamily', () => {
    expect(entryOffered(viewerB, fx.sellerA.personId, true)).toBe(false);
  });
  it('ScoutOrderMode_IsNotOffered_ToALeaderProxyingAFamily', () => {
    expect(entryOffered(leaderProxy, fx.sellerA.personId, true)).toBe(false);
  });
  it('ScoutOrderMode_IsNotOffered_WhenTheSaleIsNotOpen', () => {
    expect(entryOffered(viewerA, fx.sellerA.personId, false)).toBe(false);
  });
  it('ScoutParentScope_DoesNotReachAnotherScoutInTheTroop', () => {
    expect(mayEnterFor(parentViewer, fx.sellerA.personId)).toBe(false);
  });
});

describe('placing', () => {
  it('PlaceScoutOrder_Refuses_WhenTheViewerHasNoRightToTheScout', async () => {
    const res = await placeOrder(entry({}, fx.sellerA.slug), deps(asScoutEntry(viewerB)));
    expect(res).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('PlaceScoutOrder_WritesNothing_WhenTheViewerHasNoRightToTheScout', async () => {
    const e = entry({}, fx.sellerA.slug);
    await placeOrder(e, deps(asScoutEntry(viewerB)));
    const { data } = await admin.from('wreath_orders').select('id').eq('idempotency_key', e.idempotencyKey);
    expect(data).toEqual([]);
  });
  it('PlaceScoutOrder_Refuses_AForgedSellerSlugOfAnotherFamilysScout', async () => {
    const res = await placeOrder(entry({}, fx.sellerB.slug), deps(asScoutEntry(viewerA)));
    expect(res).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('PlaceScoutOrder_Refuses_WithNoScoutLink', async () => {
    const res = await placeOrder(entry({ sellerSlug: null }), deps(asScoutEntry(viewerA)));
    expect(res.ok).toBe(false);
  });
  it('PlaceScoutOrder_RequiresACustomerName', async () => {
    const res = await placeOrder(entry({ customer: { name: '  ', email: '', phone: '', note: '' } }), deps(asScoutEntry(viewerA)));
    expect(res).toMatchObject({ ok: false, code: 'invalid', field: 'name' });
  });
  it.each([
    ['email', { name: 'Sue', email: 'not-an-email', phone: '', note: '' }],
    ['phone', { name: 'Sue', email: '', phone: '123', note: '' }]
  ])('PlaceScoutOrder_Refuses_ABadOptional_%s', async (field, customer) => {
    const res = await placeOrder(entry({ customer }), deps(asScoutEntry(viewerA)));
    expect(res).toMatchObject({ ok: false, field });
  });
  describe('a card-fee and delivery request, with a donated wreath and a gift', () => {
    let o: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    let donated: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    beforeAll(async () => {
      o = await place({ coverFee: true, fulfillment: 'delivery', lines: [{ itemId: fx.item.easel, quantity: 1, donated: false }] });
      donated = await place({ gift: 10, lines: [{ itemId: fx.item.w20, quantity: 1, donated: true }] });
    });
    it('PlaceScoutOrder_ChargesNoDeliveryFee', () => expect(Number(o.delivery_fee)).toBe(0));
    it('PlaceScoutOrder_ChargesNoCardFee', () => expect(Number(o.fee_covered)).toBe(0));
    it('PlaceScoutOrder_TotalsJustTheItems', () => expect(Number(o.total)).toBe(10));
    it('PlaceScoutOrder_AllowsADonatedWreath', () => expect(donated.wreath_order_lines[0].donated).toBe(true));
    it('PlaceScoutOrder_AllowsTheCashGift', () => expect(Number(donated.gift)).toBe(10));
    it('PlaceScoutOrder_AddsTheGiftToTheTotal', () => expect(Number(donated.total)).toBe(36));
  });
  it('PlaceScoutOrder_PricesFromTheCatalog_NotTheRequest', async () => {
    const o = await place({ lines: [{ itemId: fx.item.w20, quantity: 2, donated: false, unitPrice: 0.01 }], total: 0.02 });
    expect(Number(o.total)).toBe(52);
  });
  describe('a saved scout-entered order', () => {
    let o: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    let byParent: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    beforeAll(async () => {
      o = await place({ collected: true, paymentNote: 'Cash at the 10/18 meeting', customer: { name: 'Sue', email: '', phone: '', note: 'Leave on the porch' } });
      byParent = await place({}, parentViewer, {}, 'vitest-kid');
    });
    it.each([
      ['source', 'paper'],
      ['fulfillment', 'scout'],
      ['collected_by_scout', true],
      ['payment_note', 'Cash at the 10/18 meeting'],
      ['customer_note', 'Leave on the porch']
    ])('PlaceScoutOrder_Saves_%s', (col, want) => {
      expect(o[col]).toBe(want);
    });
    it('PlaceScoutOrder_CreditsTheScout', () => expect(o.credited_person_id).toBe(fx.sellerA.personId));
    it('PlaceScoutOrder_HasTheScoutDeliver', () => expect(o.delivering_person_id).toBe(fx.sellerA.personId));
    it('PlaceScoutOrder_RecordsWhoEnteredIt', () => expect(byParent.entered_by_person_id).toBe(parentViewer.personId));
    it('PlaceScoutOrder_NeedsNoEmailPhoneOrAddress', () => expect([o.customer_email, o.customer_phone, o.customer_address, o.customer_zip]).toEqual([null, null, null, null]));
  });
  it('PlaceScoutOrder_Refuses_AnOverlongPaymentNote', async () => {
    const res = await placeOrder(entry({ paymentNote: 'x'.repeat(201) }), deps(asScoutEntry(viewerA)));
    expect(res).toMatchObject({ ok: false, field: 'paymentNote' });
  });
  it('PlaceScoutOrder_Refuses_AnEmptyCart_AndAnUnknownItem', async () => {
    const empty = await placeOrder(entry({ lines: [] }), deps(asScoutEntry(viewerA)));
    const unknown = await placeOrder(entry({ lines: [{ itemId: 999999999, quantity: 1, donated: false }] }), deps(asScoutEntry(viewerA)));
    expect([empty.ok, unknown.ok]).toEqual([false, false]);
  });
  it('PlaceScoutOrder_TakesManyOrdersFromOneAddress_WithoutTheIpLimit', async () => {
    const results = [];
    for (let i = 0; i < 12; i += 1) results.push((await placeOrder(entry(), deps({ ...asScoutEntry(viewerA), ip: '10.77.0.1' }))).ok);
    expect(results.every(Boolean)).toBe(true);
  });
  describe('a retried submit', () => {
    let again: Awaited<ReturnType<typeof placeOrder>>;
    let sent = 0;
    beforeAll(async () => {
      send.mockClear();
      const e = entry();
      await placeOrder(e, deps(asScoutEntry(viewerA)));
      again = await placeOrder(e, deps(asScoutEntry(viewerA)));
      sent = send.mock.calls.length;
    });
    it('PlaceScoutOrder_Retry_ReturnsTheSameOrder_NotANewOne', () => expect(again.ok && again.created).toBe(false));
    it('PlaceScoutOrder_Retry_SendsNoSecondEmail', () => expect(sent).toBe(1));
  });
  it('PlaceScoutOrder_Refuses_AfterTheRoundCutoff', async () => {
    const res = await placeOrder(entry({ startedAt: NOW_AFTER - 60_000, mountedAt: NOW_AFTER - 60_000 }), deps({ ...asScoutEntry(viewerA), now: () => NOW_AFTER }));
    expect(res).toMatchObject({ ok: false, code: 'closed' });
  });
  it('PlaceScoutOrder_AfterRound1Cutoff_IsARound2Order_EvenIfTheFormWasOpenedBefore', async () => {
    const justAfter = Date.parse('2026-10-26T05:30:00.000Z');
    const o = await place({ startedAt: justAfter - 3600_000, mountedAt: justAfter - 3600_000 }, viewerA, { now: () => justAfter });
    expect(o.round).toBe(2);
  });
  it('PlaceOrder_IgnoresScoutEntryFields_OnThePublicStore', async () => {
    const res = await placeOrder(
      { ...entry(), fulfillment: null, customer: { name: 'Pat', email: 'pat@example.test', phone: '414-555-0100', street: '1 Test St', city: 'Milwaukee', zip: '53211', note: 'x' }, collected: true, paymentNote: 'forged', website: '' },
      deps({ ip: '10.88.0.1' })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const o = await admin.from('wreath_orders').select('*').eq('public_token', res.token).single();
    expect([o.data!.source, o.data!.collected_by_scout, o.data!.entered_by_person_id, o.data!.payment_note]).toEqual(['scout_link', false, null, null]);
  });
});

describe('the confirmation email', () => {
  it('PlaceScoutOrder_EmailsTheEnterer_AndNotTheCustomer', async () => {
    await place({ customer: { name: 'Sue', email: 'customer@example.test', phone: '', note: '' } }, parentViewer, {}, 'vitest-kid');
    expect(send.mock.calls.flatMap((c) => c[0].to)).toEqual(['enterer@example.test']);
  });
  it('PlaceScoutOrder_CopiesTheHouseholdParents_WhenTheScoutEnteredIt', async () => {
    await place({}, viewerA);
    expect(send.mock.calls[0][0].to.sort()).toEqual(['enterer@example.test', 'parent@example.test']);
  });
  it('PlaceScoutOrder_DoesNotLookUpParents_WhenAParentEnteredIt', async () => {
    await place({}, parentViewer, {}, 'vitest-kid');
    expect(householdEmails).not.toHaveBeenCalled();
  });
  it('PlaceScoutOrder_Email_HasNoPaymentInstructions', async () => {
    await place({}, viewerA);
    const m = send.mock.calls[0][0];
    expect(`${m.text}${m.html}`).not.toMatch(/venmo|paypal|friends and family/i);
  });
  it('PlaceScoutOrder_SendsNothing_WhenNobodyHasAnAddress', async () => {
    await place({}, parentViewer, { ...asScoutEntry(parentViewer, []), householdEmails: async () => [] }, 'vitest-kid');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('editing', () => {
  describe('a saved edit', () => {
    let after: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    let res: Awaited<ReturnType<typeof editScoutOrder>>;
    beforeAll(async () => {
      const o = await place();
      res = await editScoutOrder(edit(o, { customer: { name: 'Sue S', email: 'sue@example.test', phone: '', note: 'porch' }, lines: [{ itemId: fx.item.w36, quantity: 1, donated: false }], collected: true, paymentNote: 'Venmo 10/20' }), eDeps(viewerA));
      after = await row(o.id);
    });
    it('EditScoutOrder_Succeeds', () => expect(res.ok).toBe(true));
    it('EditScoutOrder_Saves_TheCustomerName', () => expect(after.customer_name).toBe('Sue S'));
    it('EditScoutOrder_Saves_TheReplacedItems', () => expect(after.wreath_order_lines.map((l: { item_id: number }) => l.item_id)).toEqual([fx.item.w36]));
    it('EditScoutOrder_Reprices_TheTotal', () => expect(Number(after.total)).toBe(42));
    it('EditScoutOrder_Saves_Collected', () => expect(after.collected_by_scout).toBe(true));
    it('EditScoutOrder_Saves_ThePaymentNote', () => expect(after.payment_note).toBe('Venmo 10/20'));
  });
  it('EditScoutOrder_Prices_FromTheCatalog_NotTheRequest', async () => {
    const o = await place();
    await editScoutOrder(edit(o, { lines: [{ itemId: fx.item.w36, quantity: 1, donated: false, unitPrice: 0.01 }], total: 0.01 }), eDeps(viewerA));
    expect(Number((await row(o.id)).total)).toBe(42);
  });
  it('EditScoutOrder_WritesAnAuditRow_WithTheEditorAsActor', async () => {
    const o = await place();
    await editScoutOrder(edit(o, { collected: true }), eDeps(viewerA));
    const { data } = await admin.from('audit_log').select('actor_person_id, summary').eq('area', 'wreaths').eq('entity_type', 'wreath_order').eq('entity_id', String(o.id));
    expect(data).toEqual([{ actor_person_id: viewerA.personId, summary: expect.stringContaining('Edited') }]);
  });
  it('EditScoutOrder_Refuses_AfterTheRoundCutoff', async () => {
    const o = await place();
    const res = await editScoutOrder(edit(o, { collected: true }), eDeps(viewerA, NOW_R2));
    expect(res).toMatchObject({ ok: false, code: 'locked' });
  });
  it('EditScoutOrder_AllowsARound2Order_UntilTheRound2Cutoff', async () => {
    const o = await place({ startedAt: NOW_R2 - 1000, mountedAt: NOW_R2 - 1000 }, viewerA, { now: () => NOW_R2 });
    expect((await editScoutOrder(edit(o, { collected: true }), eDeps(viewerA, NOW_R2))).ok).toBe(true);
  });
  it('EditScoutOrder_Refuses_WhenTheOrderIsPaid', async () => {
    const o = await place();
    await admin.from('wreath_orders').update({ payment_status: 'paid' }).eq('id', o.id);
    const res = await editScoutOrder(edit(o, { collected: true }), eDeps(viewerA));
    expect(res).toMatchObject({ ok: false, code: 'locked' });
  });
  it('EditScoutOrder_Refuses_WhenTheOrderIsCancelled', async () => {
    const o = await place();
    await admin.from('wreath_orders').update({ status: 'cancelled' }).eq('id', o.id);
    expect((await editScoutOrder(edit(o), eDeps(viewerA))).ok).toBe(false);
  });
  it('EditScoutOrder_Refuses_AnotherFamily', async () => {
    const o = await place();
    expect(await editScoutOrder(edit(o, { collected: true }), eDeps(viewerB))).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('EditScoutOrder_Refuses_ALeaderProxyingTheFamily', async () => {
    const o = await place();
    expect(await editScoutOrder(edit(o, { collected: true }), eDeps(leaderProxy))).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('EditScoutOrder_Refuses_ASignedOutCaller', async () => {
    const o = await place();
    expect(await editScoutOrder(edit(o), eDeps(null))).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('EditScoutOrder_LeavesTheOrderUntouched_WhenRefused', async () => {
    const o = await place();
    await editScoutOrder(edit(o, { customer: { name: 'Hacked', email: '', phone: '', note: '' } }), eDeps(viewerB));
    expect((await row(o.id)).customer_name).toBe('Grandma Sue');
  });
  it('EditScoutOrder_Refuses_AnOnlineOrderCreditedToTheScout', async () => {
    const res = await placeOrder(
      { ...entry(), fulfillment: null, customer: { name: 'Pat', email: `p${Date.now()}@example.test`, phone: '414-555-0100', street: '1 Test St', city: 'Milwaukee', zip: '53211' }, website: '' },
      deps({ ip: '10.88.1.1' })
    );
    if (!res.ok) throw new Error(res.error);
    const { data } = await admin.from('wreath_orders').select('id').eq('public_token', res.token).single();
    expect(await editScoutOrder({ orderId: data!.id, customer: { name: 'X' }, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] }, eDeps(viewerA))).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('EditScoutOrder_RequiresACustomerName_AndAtLeastOneItem', async () => {
    const o = await place();
    const noName = await editScoutOrder(edit(o, { customer: { name: '', email: '', phone: '', note: '' } }), eDeps(viewerA));
    const noItems = await editScoutOrder(edit(o, { lines: [] }), eDeps(viewerA));
    expect([noName.ok, noItems.ok]).toEqual([false, false]);
  });
  it('EditScoutOrder_Refuses_AnInvalidQuantity_OrADonatedLineOnANonDonatableItem', async () => {
    const o = await place();
    const q = await editScoutOrder(edit(o, { lines: [{ itemId: fx.item.w20, quantity: 51, donated: false }] }), eDeps(viewerA));
    const d = await editScoutOrder(edit(o, { lines: [{ itemId: fx.item.w36, quantity: 1, donated: true }] }), eDeps(viewerA));
    expect([q.ok, d.ok]).toEqual([false, false]);
  });
  it('EditScoutOrder_KeepsTheSoldAtPrice_OfALineAlreadyOnTheOrder', async () => {
    const o = await place();
    await admin.from('wreath_items').update({ price: 30 }).eq('id', fx.item.w20);
    await editScoutOrder(edit(o, { lines: [{ itemId: fx.item.w20, quantity: 3, donated: false }] }), eDeps(viewerA));
    await admin.from('wreath_items').update({ price: 26 }).eq('id', fx.item.w20);
    expect(Number((await row(o.id)).total)).toBe(78);
  });
});

describe('cancelling', () => {
  it('CancelScoutOrder_Cancels_AndItStaysInAdminAsCancelled', async () => {
    const o = await place();
    expect((await cancelScoutOrder(o.id, eDeps(viewerA))).ok).toBe(true);
    const all = await loadAdminOrders(admin, fx.saleId);
    expect(all.find((x) => x.id === o.id)?.status).toBe('cancelled');
  });
  it('CancelScoutOrder_Refuses_AfterTheRoundCutoff', async () => {
    const o = await place();
    expect(await cancelScoutOrder(o.id, eDeps(viewerA, NOW_R2))).toMatchObject({ ok: false, code: 'locked' });
  });
  it('CancelScoutOrder_Refuses_WhenPaid', async () => {
    const o = await place();
    await admin.from('wreath_orders').update({ payment_status: 'paid' }).eq('id', o.id);
    expect(await cancelScoutOrder(o.id, eDeps(viewerA))).toMatchObject({ ok: false, code: 'locked' });
  });
  it('CancelScoutOrder_Refuses_AnotherFamily_AndAProxyingLeader', async () => {
    const o = await place();
    const results = [await cancelScoutOrder(o.id, eDeps(viewerB)), await cancelScoutOrder(o.id, eDeps(leaderProxy)), await cancelScoutOrder(o.id, eDeps(null))];
    expect(results.map((r) => r.ok)).toEqual([false, false, false]);
    expect((await row(o.id)).status).toBe('placed');
  });
  it('CancelledOrders_StayOutOfSellerTotalsGoalAndTheRoseOrder', async () => {
    const before = { rose: (await loadRoseOrder(admin, fx.saleId)).reduce((n, r) => n + r.total, 0), sold: await itemsSoldBy(admin, fx.saleId, fx.sellerB.personId) };
    const o = await place({ lines: [{ itemId: fx.item.w20, quantity: 4, donated: false }] }, viewerB, {}, fx.sellerB.slug);
    expect(await itemsSoldBy(admin, fx.saleId, fx.sellerB.personId)).toBe(before.sold + 4);
    await cancelScoutOrder(o.id, eDeps(viewerB));
    const orders = await loadAdminOrders(admin, fx.saleId);
    const view = buildSellerView(fx.sellerB.personId, 'B', orders, 0.3);
    const rose = (await loadRoseOrder(admin, fx.saleId)).reduce((n, r) => n + r.total, 0);
    expect([await itemsSoldBy(admin, fx.saleId, fx.sellerB.personId), view.summary.items, rose]).toEqual([before.sold, before.sold, before.rose]);
  });
  it('CancelledOrders_StayOutOfTheAdminSellerOrderCount', async () => {
    const o = await place({}, viewerA);
    const counted = async () => (await loadAdminSellers(admin, fx.saleId)).find((s) => s.personId === fx.sellerA.personId)!.orders;
    const n = await counted();
    await cancelScoutOrder(o.id, eDeps(viewerA));
    expect(await counted()).toBe(n - 1);
  });
});

describe('the goal', () => {
  it.each([[null], [0]])('GoalThermometer_IsHidden_WhenTheGoalIs_%s', (goal) => {
    expect(goalProgress(goal, 5, 'Oliver')).toBeNull();
  });
  it('GoalThermometer_Reads_NOfGoalWreaths', () => {
    expect(goalProgress(25, 12, 'Oliver')).toMatchObject({ pct: 48, label: '12 of 25 wreaths toward Oliver’s goal' });
  });
  it('GoalThermometer_CapsTheBarAt100_AndKeepsCountingTheText', () => {
    expect(goalProgress(25, 27, 'Oliver')).toMatchObject({ pct: 100, label: '27 of 25 wreaths toward Oliver’s goal' });
  });
  it.each([
    ['', null],
    [null, null],
    ['0', 0],
    [12, 12],
    ['999', 999]
  ])('Goal_Parses_%s', (raw, goal) => {
    expect(parseGoal(raw)).toEqual({ ok: true, goal });
  });
  it.each(['-1', '1000', '1.5', 'abc', 12.5, {}])('Goal_Refuses_%s', (raw) => {
    expect(parseGoal(raw).ok).toBe(false);
  });
  it('GoalCount_IncludesDonatedWreaths_PaidOrNot_ButNotCancelledOrRefunded', async () => {
    const base = await itemsSoldBy(admin, fx.saleId, fx.sellerA.personId);
    const paid = await place({ lines: [{ itemId: fx.item.w20, quantity: 2, donated: true }] });
    await admin.from('wreath_orders').update({ payment_status: 'paid' }).eq('id', paid.id);
    const refunded = await place({ lines: [{ itemId: fx.item.w20, quantity: 5, donated: false }] });
    await admin.from('wreath_orders').update({ payment_status: 'refunded' }).eq('id', refunded.id);
    const cancelled = await place({ lines: [{ itemId: fx.item.w20, quantity: 7, donated: false }] });
    await cancelScoutOrder(cancelled.id, eDeps(viewerA));
    expect(await itemsSoldBy(admin, fx.saleId, fx.sellerA.personId)).toBe(base + 2);
  });
  it('SetScoutGoal_Saves_ForTheScout', async () => {
    expect((await setScoutSettings(fx.sellerA.personId, { goal: '25' }, eDeps(viewerA))).ok).toBe(true);
    const { data } = await admin.from('wreath_sellers').select('goal').eq('sale_id', fx.saleId).eq('person_id', fx.sellerA.personId).single();
    expect(data!.goal).toBe(25);
  });
  it('SetScoutGoal_Saves_ForAParent', async () => {
    expect((await setScoutSettings(kid!.personId, { goal: 40 }, eDeps(parentViewer))).ok).toBe(true);
    const { data } = await admin.from('wreath_sellers').select('goal').eq('sale_id', fx.saleId).eq('person_id', kid!.personId).single();
    expect(data!.goal).toBe(40);
  });
  it('SetScoutGoal_Clears_WhenEmpty', async () => {
    await setScoutSettings(fx.sellerA.personId, { goal: 10 }, eDeps(viewerA));
    await setScoutSettings(fx.sellerA.personId, { goal: '' }, eDeps(viewerA));
    const { data } = await admin.from('wreath_sellers').select('goal').eq('sale_id', fx.saleId).eq('person_id', fx.sellerA.personId).single();
    expect(data!.goal).toBeNull();
  });
  it('SetScoutGoal_Refuses_AnotherFamily', async () => {
    expect(await setScoutSettings(fx.sellerA.personId, { goal: 99 }, eDeps(viewerB))).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('SetScoutGoal_Refuses_AProxyingLeader_AndASignedOutCaller', async () => {
    const r = [await setScoutSettings(fx.sellerA.personId, { goal: 99 }, eDeps(leaderProxy)), await setScoutSettings(fx.sellerA.personId, { goal: 99 }, eDeps(null))];
    expect(r.map((x) => x.ok)).toEqual([false, false]);
  });
  it('SetScoutGoal_LeavesTheGoalAlone_WhenRefused', async () => {
    await setScoutSettings(fx.sellerB.personId, { goal: 15 }, eDeps(viewerB));
    await setScoutSettings(fx.sellerB.personId, { goal: 99 }, eDeps(viewerA));
    const { data } = await admin.from('wreath_sellers').select('goal').eq('sale_id', fx.saleId).eq('person_id', fx.sellerB.personId).single();
    expect(data!.goal).toBe(15);
  });
  it('SetScoutGoal_Refuses_ARetiredSeller', async () => {
    await admin.from('wreath_sellers').update({ active: false }).eq('sale_id', fx.saleId).eq('person_id', fx.sellerB.personId);
    const r = await setScoutSettings(fx.sellerB.personId, { goal: 20 }, eDeps(viewerB));
    await admin.from('wreath_sellers').update({ active: true }).eq('sale_id', fx.saleId).eq('person_id', fx.sellerB.personId);
    expect(r.ok).toBe(false);
  });
});

describe('locking', () => {
  const sale = { status: 'open' as const, round1Cutoff: '2026-10-26T04:59:00.000Z', round2Cutoff: '2026-11-16T05:59:00.000Z' };
  const o = { status: 'placed' as const, paymentStatus: 'unpaid' as const, round: 1 as const };
  it('LockReason_IsNull_WhileUnpaidAndBeforeItsRoundsCutoff', () => {
    expect(lockReason(o, sale, NOW_R1)).toBeNull();
  });
  it('LockReason_LocksARound1Order_OnceRound1HasClosed', () => {
    expect(lockReason(o, sale, NOW_R2)).toContain('Round 1 closed');
  });
  it('LockReason_LeavesARound2Order_OpenDuringRound2', () => {
    expect(lockReason({ ...o, round: 2 }, sale, NOW_R2)).toBeNull();
  });
  it.each([
    [{ ...o, paymentStatus: 'paid' as const }, 'Paid'],
    [{ ...o, status: 'cancelled' as const }, 'Cancelled'],
    [{ ...o, paymentStatus: 'refunded' as const }, 'Paid']
  ])('LockReason_Says_%#', (order, word) => {
    expect(lockReason(order, sale, NOW_R1)).toContain(word);
  });
  it('LockReason_Says_TheSaleIsClosed', () => {
    expect(lockReason(o, { ...sale, status: 'closed' }, NOW_R1)).toContain('closed');
  });
});

describe('the delivery message and settings together', () => {
  const msgOf = async (pid: number) => (await admin.from('wreath_sellers').select('delivery_message').eq('sale_id', fx.saleId).eq('person_id', pid).single()).data!.delivery_message;
  it('SetScoutSettings_SavesGoalAndDeliveryMessage_ForTheScout', async () => {
    const r = await setScoutSettings(fx.sellerA.personId, { goal: '20', deliveryMessage: ' I’ll bring it the week of Nov 22 ' }, eDeps(viewerA));
    expect([r.ok, await msgOf(fx.sellerA.personId)]).toEqual([true, 'I’ll bring it the week of Nov 22']);
  });
  it('SetScoutSettings_SavesTheDeliveryMessage_ForAParent', async () => {
    await setScoutSettings(kid!.personId, { deliveryMessage: 'Dropping off Sunday' }, eDeps(parentViewer));
    expect(await msgOf(kid!.personId)).toBe('Dropping off Sunday');
  });
  it('SetScoutSettings_Clears_AnEmptyMessage', async () => {
    await setScoutSettings(fx.sellerA.personId, { deliveryMessage: 'x' }, eDeps(viewerA));
    await setScoutSettings(fx.sellerA.personId, { deliveryMessage: '  ' }, eDeps(viewerA));
    expect(await msgOf(fx.sellerA.personId)).toBeNull();
  });
  it('SetScoutSettings_LeavesTheMessageAlone_WhenOnlyTheGoalIsSent', async () => {
    await setScoutSettings(fx.sellerA.personId, { deliveryMessage: 'keep me' }, eDeps(viewerA));
    await setScoutSettings(fx.sellerA.personId, { goal: 5 }, eDeps(viewerA));
    expect(await msgOf(fx.sellerA.personId)).toBe('keep me');
  });
  it('SetScoutSettings_Refuses_AMessageOver200Characters', async () => {
    const r = await setScoutSettings(fx.sellerA.personId, { deliveryMessage: 'x'.repeat(201) }, eDeps(viewerA));
    expect(r).toMatchObject({ ok: false, field: 'deliveryMessage' });
  });
  it('SetScoutSettings_Refuses_AnotherFamily_AProxyingLeader_AndSignedOut', async () => {
    const r = [viewerB, leaderProxy, null].map((v) => setScoutSettings(fx.sellerA.personId, { goal: 1, deliveryMessage: 'hijack' }, eDeps(v)));
    expect((await Promise.all(r)).map((x) => x.ok)).toEqual([false, false, false]);
    expect(await msgOf(fx.sellerA.personId)).not.toBe('hijack');
  });
  it('DeliveryMessageColumn_RejectsOver200Characters_InTheDatabase', async () => {
    const { error } = await admin.from('wreath_sellers').update({ delivery_message: 'x'.repeat(201) }).eq('sale_id', fx.saleId).eq('person_id', fx.sellerA.personId);
    expect(error?.message).toMatch(/delivery_message_len/);
  });
  it('ScoutLink_CarriesTheDeliveryMessage_ForThePublicPage', async () => {
    await setScoutSettings(fx.sellerA.personId, { deliveryMessage: 'Week of Nov 22' }, eDeps(viewerA));
    const { resolveScoutLink } = await import('../src/lib/wreaths/public');
    expect((await resolveScoutLink(admin, fx.saleId, fx.sellerA.slug))?.deliveryMessage).toBe('Week of Nov 22');
  });
});

describe('QA follow-ups', () => {
  it('PublicStore_IsNotLockedOut_ByScoutEnteredOrdersInTheGlobalHourlyCap', async () => {
    await place();
    await place();
    await place();
    const { count: publicNow } = await admin.from('wreath_orders').select('id', { count: 'exact', head: true }).neq('source', 'paper').gte('placed_at', new Date(NOW_R1 - 3600_000).toISOString());
    const res = await placeOrder(
      { ...entry(), sellerSlug: null, fulfillment: 'pickup', customer: { name: 'Pat', email: `cap${Date.now()}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' }, website: '' },
      deps({ ip: '10.55.0.1', limits: { globalHour: (publicNow ?? 0) + 1 } })
    );
    expect(res.ok).toBe(true);
  });
  it('ScoutEntry_IsNotBlockedBy_TheGlobalHourlyCap', async () => {
    const res = await placeOrder(entry(), deps({ ...asScoutEntry(viewerA), limits: { globalHour: 0 } }));
    expect(res.ok).toBe(true);
  });
  it('ScoutEntryEmail_SubjectCarriesNoLineBreaks_FromTheCustomerName', async () => {
    await place({ customer: { name: 'Sue\r\nBcc: evil@example.test\u2028\u202e', email: '', phone: '', note: '' } });
    expect(send.mock.calls[0][0].subject).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e]/);
  });
  it('ScoutEntryEmail_SubjectStillNamesTheCustomer_AfterCleaning', async () => {
    await place({ customer: { name: 'Sue\r\nSmith', email: '', phone: '', note: '' } });
    expect(send.mock.calls[0][0].subject).toContain('Sue Smith');
  });
  describe('wreath_place_order called the way production does today (none of the new fields)', () => {
    let error: unknown;
    let created: boolean | undefined;
    let o: Record<string, unknown> | null;
    beforeAll(async () => {
      const key = `vitest-old-shape-${Date.now()}`;
      const r = await admin.rpc('wreath_place_order', {
        p: {
          sale_id: fx.saleId, idempotency_key: key, placed_at: new Date(NOW_R1).toISOString(), credited_person_id: null, delivering_person_id: null, source: 'store', fulfillment: 'pickup', round: 1,
          customer_name: 'Old Shape', customer_email: 'old@example.test', customer_phone: '414-555-0100', customer_address: null, customer_city: null, customer_zip: null, outside_area_relative: false,
          items_subtotal: 26, delivery_fee: 0, fee_covered: 0, gift: 0, total: 26, created_ip: '10.44.0.1',
          lines: [{ item_id: fx.item.w20, quantity: 1, donated: false, unit_price: 26, unit_cost: 16.07 }]
        }
      });
      error = r.error;
      created = (r.data as { created: boolean }[] | null)?.[0]?.created;
      o = (await admin.from('wreath_orders').select('collected_by_scout, payment_note, customer_note, entered_by_person_id').eq('idempotency_key', key).single()).data;
    });
    it('WreathPlaceOrder_OldShape_Succeeds', () => expect([error, created]).toEqual([null, true]));
    it('WreathPlaceOrder_OldShape_LeavesCollectedFalse', () => expect(o?.collected_by_scout).toBe(false));
    it.each(['payment_note', 'customer_note', 'entered_by_person_id'])('WreathPlaceOrder_OldShape_Leaves_%s_Null', (col) => {
      expect(o?.[col]).toBeNull();
    });
  });
});

describe('subjectText', () => {
  it('SubjectText_ReplacesNulCrLfAndBidiMarksWithASpace', () => {
    expect(subjectText('A\u0000B\r\nC\u202eD')).toBe('A B C D');
  });
});
