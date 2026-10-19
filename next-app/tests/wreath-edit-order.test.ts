import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps } from '../src/lib/wreaths/place-order';
import type { Capability } from '../src/lib/capabilities';
import type { EditOrderInput } from '../src/app/admin/(workspace)/finance/wreaths/actions';

/**
 * The treasurer's full order edit (Patrick, 2026-10-18: a customer ordered the wrong item, then paid by Venmo for a
 * different one). One "Edit order" replaces Reassign: items, gift, contact, credit, delivery, and — on an order paid by
 * hand — the payment itself, rebooking the ledger. Real local database; only the actor, the cache and the mail are mocked.
 */
const admin = adminClient();
const state = vi.hoisted(() => ({ caps: new Set<string>(['finance.manage']) }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const mail = vi.hoisted(() => ({ send: vi.fn(async () => ({ status: 'sent', to: [] as string[] })) }));

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
const card = vi.hoisted(() => ({ expire: vi.fn(async () => undefined) }));
vi.mock('@/lib/wreaths/stripe-client', () => ({ expireOrderCheckout: card.expire, cardCheckoutLive: () => false, cardDeps: () => ({}) }));
vi.mock('@/lib/email', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/email')>()), sendEmail: mail.send }));

let fx: WreathFixture;
let seq = 0;

async function actions() {
  return import('../src/app/admin/(workspace)/finance/wreaths/actions');
}

function deps(): PlaceOrderDeps {
  seq += 1;
  return { supabase: admin, now: () => NOW_R1, ip: `10.8.${Math.floor(seq / 250)}.${(seq % 250) + 1}`, send: async () => ({}), householdEmails: async () => [], siteUrl: 'https://wreaths.test', replyTo: 'troop@example.test', saleId: fx.saleId };
}

async function makeOrder(over: Record<string, unknown> = {}) {
  seq += 1;
  const res = await placeOrder(
    {
      idempotencyKey: `vitest-edit-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      sellerSlug: null,
      lines: [{ itemId: fx.item.w36, quantity: 1, donated: false }],
      gift: 0,
      coverFee: false,
      fulfillment: 'pickup',
      customer: { name: 'Vitest Buyer', email: `edit-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '414-555-0100', street: '', city: '', zip: '' },
      outsideAreaRelative: false,
      startedAt: NOW_R1 - 120_000,
      mountedAt: NOW_R1 - 60_000,
      website: '',
      ...over
    },
    deps()
  );
  if (!res.ok) throw new Error(`order: ${res.error}`);
  const { data } = await admin.from('wreath_orders').select('id').eq('public_token', res.token).single();
  return (data as { id: number }).id;
}

/** The edit the dialog would send for the order as it stands now: change only what a test overrides. */
async function asIs(orderId: number): Promise<EditOrderInput> {
  const o = (await admin.from('wreath_orders').select('*, wreath_order_lines(item_id, quantity, donated)').eq('id', orderId).single()).data!;
  return {
    seen: { total: Number(o.total), paymentStatus: o.payment_status },
    lines: (o.wreath_order_lines as { item_id: number; quantity: number; donated: boolean }[]).map((l) => ({ itemId: l.item_id, quantity: l.quantity, donated: l.donated })),
    gift: Number(o.gift),
    customer: { name: o.customer_name, email: o.customer_email ?? '', phone: o.customer_phone ?? '', street: o.customer_address ?? '', city: o.customer_city ?? '', zip: o.customer_zip ?? '' },
    creditedPersonId: o.credited_person_id,
    fulfillment: o.fulfillment === 'none' ? 'pickup' : o.fulfillment,
    deliveringPersonId: o.delivering_person_id,
    ...(o.payment_status === 'paid' && o.paid_method !== 'card' ? { payment: { method: o.paid_method, received: Number(o.paid_amount), acceptShort: false } } : {}),
    notifyCustomer: false
  };
}

const orderRow = async (id: number) => (await admin.from('wreath_orders').select('*').eq('id', id).single()).data!;
const ledgerRows = async (id: number) =>
  ((await admin.from('financial_transactions').select('id, amount, method, memo, occurred_on, voided_at, bucket_id').eq('wreath_order_id', id).order('id')).data ?? []) as {
    id: number;
    amount: number;
    method: string;
    memo: string;
    occurred_on: string;
    voided_at: string | null;
    bucket_id: number;
  }[];
const editAudit = async (id: number) =>
  (((await admin.from('audit_log').select('action, summary, details').eq('area', 'wreaths').eq('entity_type', 'wreath_order').eq('entity_id', String(id)).order('id')).data ?? []) as { action: string; summary: string; details: unknown }[]).filter(
    (a) => a.action === 'edit'
  );

beforeAll(async () => {
  fx = await makeWreathFixture('open');
});
afterAll(async () => {
  await fx.cleanup();
});
beforeEach(() => {
  state.caps = new Set(['finance.manage']);
  mail.send.mockClear();
  card.expire.mockClear();
});

describe('editOrder', () => {
  it('EditOrder_RequiresFinanceManage', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    state.caps = new Set(['news.write']);
    await expect(editOrder(id, await asIs(id))).rejects.toThrow(/requires/i);
  });

  it('EditOrder_VenmoMixup_SwapsTheItem_SoTheTotalMatchesWhatCameIn', async () => {
    // Ordered a 36″ ($42), Venmo'd $26 for a 20″.
    const id = await makeOrder();
    const { editOrder, markPaid } = await actions();
    expect(await editOrder(id, { ...(await asIs(id)), lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] })).toMatchObject({ ok: true });
    expect(await markPaid(id, 'venmo', 26)).toMatchObject({ ok: true });
    const o = await orderRow(id);
    expect([Number(o.items_subtotal), Number(o.total), Number(o.paid_amount)]).toEqual([26, 26, 26]);
  });

  it('EditOrder_ATotalChange_ExpiresTheOpenCardSession', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    await editOrder(id, { ...(await asIs(id)), lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] });
    expect(card.expire).toHaveBeenCalledWith(id);
  });

  // qa-lead: a refused or contact-only edit must not kill the customer's live checkout.
  it('EditOrder_AContactOnlyOrRefusedEdit_LeavesTheCardSessionAlone', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    const base = await asIs(id);
    await editOrder(id, { ...base, customer: { ...base.customer, name: 'Renamed Buyer' } });
    await editOrder(id, { ...base, customer: { ...base.customer, name: ' ' } });
    expect(card.expire).not.toHaveBeenCalled();
  });

  // qa-lead: a card payment that covered its fee keeps that fee; a contact edit isn't read as a total change.
  it('EditOrder_CardPaidWithACoveredFee_TakesAContactChange', async () => {
    const id = await makeOrder();
    await admin.from('wreath_orders').update({ fee_covered: 1.35, total: 43.35, payment_status: 'paid', paid_method: 'card', paid_amount: 43.35, paid_at: new Date().toISOString() }).eq('id', id);
    const { editOrder } = await actions();
    const base = await asIs(id);
    expect(await editOrder(id, { ...base, customer: { ...base.customer, phone: '414-555-0177' } })).toMatchObject({ ok: true });
    expect([Number((await orderRow(id)).fee_covered), Number((await orderRow(id)).total)]).toEqual([1.35, 43.35]);
  });

  // An order marked paid before Mark paid booked the ledger (2026-10-15) has no linked line: the order is corrected,
  // nothing is booked, and the audit says to fix Finance by hand.
  it('EditOrder_PaidOrderWithNoLedgerLine_CorrectsTheOrder_AndSaysToFixFinanceByHand', async () => {
    const id = await makeOrder();
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'venmo', paid_amount: 42, paid_at: new Date().toISOString() }).eq('id', id);
    const { editOrder } = await actions();
    const base = await asIs(id);
    expect(await editOrder(id, { ...base, payment: { method: 'venmo', received: 40, acceptShort: true } })).toMatchObject({ ok: true });
    expect([Number((await orderRow(id)).paid_amount), (await ledgerRows(id)).length]).toEqual([40, 0]);
    expect(JSON.stringify((await editAudit(id))[0].details)).toContain('by hand');
  });

  it('EditOrder_RPC_RefusesWhenTheLedgerLineMovedUnderneath', async () => {
    const id = await makeOrder();
    const { markPaid } = await actions();
    await markPaid(id, 'venmo');
    const live = (await ledgerRows(id))[0];
    const { data } = await admin.rpc('wreath_edit_order', {
      p: { order_id: id, expect: { payment_status: 'paid', total: 42, paid_amount: 42, paid_method: 'venmo', ledger_id: live.id, ledger_amount: 41 }, order: {}, lines: [], ledger: null }
    });
    expect(data).toBe('changed');
  });

  it('EditOrder_KeptLine_KeepsItsLineIdAndPriceSnapshot', async () => {
    const id = await makeOrder({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] });
    const before = (await admin.from('wreath_order_lines').select('id').eq('order_id', id).single()).data!;
    await admin.from('wreath_order_lines').update({ unit_price: 24 }).eq('id', before.id);
    await admin.from('wreath_orders').update({ items_subtotal: 24, total: 24 }).eq('id', id);
    const { editOrder } = await actions();
    expect(await editOrder(id, { ...(await asIs(id)), lines: [{ itemId: fx.item.w20, quantity: 2, donated: false }] })).toMatchObject({ ok: true });
    const after = (await admin.from('wreath_order_lines').select('id, quantity, unit_price').eq('order_id', id).single()).data!;
    expect([after.id, after.quantity, Number(after.unit_price), Number((await orderRow(id)).total)]).toEqual([before.id, 2, 24, 48]);
  });

  it('EditOrder_PaidOrder_CorrectedAmount_VoidsAndRebooksTheLedger_OnTheSameDay', async () => {
    const id = await makeOrder();
    const { editOrder, markPaid } = await actions();
    await markPaid(id, 'venmo');
    await admin.from('financial_transactions').update({ occurred_on: '2026-10-17' }).eq('wreath_order_id', id);
    const base = await asIs(id);
    expect(
      await editOrder(id, { ...base, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], payment: { method: 'paypal', received: 26, acceptShort: false } })
    ).toMatchObject({ ok: true });
    const rows = await ledgerRows(id);
    expect(rows.map((r) => [Number(r.amount), r.method, r.occurred_on, r.voided_at == null])).toEqual([
      // [amount, method, day, live]: the old row voided, the corrected one on the day the money came in.
      [42, 'venmo', '2026-10-17', false],
      [26, 'paypal', '2026-10-17', true]
    ]);
    expect(rows[1].bucket_id).toBe(rows[0].bucket_id);
    expect(rows[1].memo).toContain('PayPal');
    const o = await orderRow(id);
    expect([o.payment_status, o.paid_method, Number(o.paid_amount), Number(o.total)]).toEqual(['paid', 'paypal', 26, 26]);
  });

  it('EditOrder_PaidOrder_PaymentUnchanged_LeavesTheLedgerAlone', async () => {
    const id = await makeOrder({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] });
    const { editOrder, markPaid } = await actions();
    await markPaid(id, 'venmo');
    const base = await asIs(id);
    expect(await editOrder(id, { ...base, customer: { ...base.customer, name: 'Vitest Buyer Renamed' } })).toMatchObject({ ok: true });
    expect((await ledgerRows(id)).map((r) => r.voided_at)).toEqual([null]);
  });

  it('EditOrder_RaisingTheTotalAboveWhatCameIn_IsRefused_UnlessTheShortfallIsAccepted', async () => {
    const id = await makeOrder({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] });
    const { editOrder, markPaid } = await actions();
    await markPaid(id, 'venmo');
    const more = { ...(await asIs(id)), lines: [{ itemId: fx.item.w36, quantity: 1, donated: false }] };
    expect(await editOrder(id, more)).toMatchObject({ ok: false, field: 'received' });
    expect(Number((await orderRow(id)).total)).toBe(26);
    expect(await editOrder(id, { ...more, payment: { ...more.payment!, acceptShort: true } })).toMatchObject({ ok: true });
    const o = await orderRow(id);
    expect([Number(o.total), Number(o.paid_amount)]).toEqual([42, 26]);
  });

  it('EditOrder_PaidMoreThanTheNewTotal_IsAllowed_AsOwedBack_OrAGift', async () => {
    const id = await makeOrder();
    const { editOrder, markPaid } = await actions();
    await markPaid(id, 'venmo');
    const smaller = { ...(await asIs(id)), lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] };
    expect(await editOrder(id, smaller)).toMatchObject({ ok: true });
    expect([Number((await orderRow(id)).total), Number((await orderRow(id)).paid_amount)]).toEqual([26, 42]);
    // The dialog's "count the extra as a gift": the $16 becomes a gift and the total meets the payment.
    expect(await editOrder(id, { ...(await asIs(id)), gift: 16 })).toMatchObject({ ok: true });
    expect([Number((await orderRow(id)).gift), Number((await orderRow(id)).total)]).toEqual([16, 42]);
  });

  it('EditOrder_RefusesAReceivedAmountOfZero', async () => {
    const id = await makeOrder();
    const { editOrder, markPaid } = await actions();
    await markPaid(id, 'venmo');
    const base = await asIs(id);
    expect(await editOrder(id, { ...base, payment: { ...base.payment!, received: 0 } })).toMatchObject({ ok: false, field: 'received' });
  });

  it('EditOrder_UnpaidOrder_RefusesPaymentFields', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    expect(await editOrder(id, { ...(await asIs(id)), payment: { method: 'venmo', received: 42, acceptShort: false } })).toMatchObject({ ok: false });
    expect((await orderRow(id)).payment_status).toBe('unpaid');
  });

  it('EditOrder_CardPaid_RefusesATotalChange_ButTakesAContactChange', async () => {
    const id = await makeOrder();
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'card', paid_amount: 42, paid_at: new Date().toISOString() }).eq('id', id);
    const { editOrder } = await actions();
    const base = await asIs(id);
    expect(await editOrder(id, { ...base, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] })).toMatchObject({ ok: false });
    expect(await editOrder(id, { ...base, customer: { ...base.customer, email: 'fixed@example.test' } })).toMatchObject({ ok: true });
    expect((await orderRow(id)).customer_email).toBe('fixed@example.test');
  });

  it('EditOrder_FromAStaleView_IsRefused', async () => {
    const id = await makeOrder();
    const { editOrder, markPaid } = await actions();
    const stale = await asIs(id);
    await markPaid(id, 'venmo');
    expect(await editOrder(id, { ...stale, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] })).toMatchObject({ ok: false });
    expect(Number((await orderRow(id)).total)).toBe(42);
  });

  it('EditOrder_RefusesACancelledOrder', async () => {
    const id = await makeOrder();
    const { editOrder, cancelOrder } = await actions();
    const base = await asIs(id);
    await cancelOrder(id);
    expect(await editOrder(id, base)).toMatchObject({ ok: false });
  });

  it('EditOrder_RefusesABadNameOrEmail', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    const base = await asIs(id);
    expect(await editOrder(id, { ...base, customer: { ...base.customer, name: ' ' } })).toMatchObject({ ok: false, field: 'name' });
    expect(await editOrder(id, { ...base, customer: { ...base.customer, email: 'not-an-email' } })).toMatchObject({ ok: false, field: 'email' });
  });

  it('EditOrder_AuditsOldAndNewItemsAndTotal_WithoutTheAddressOrPhone', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    const base = await asIs(id);
    await editOrder(id, { ...base, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }], customer: { ...base.customer, phone: '414-555-0199' } });
    const [a] = await editAudit(id);
    const blob = JSON.stringify(a.details);
    expect(blob).toContain('36″ Wreath');
    expect(blob).toContain('20″ Wreath');
    expect(blob).toContain('$42.00');
    expect(blob).toContain('$26.00');
    expect(JSON.stringify(a)).not.toContain('414-555');
    expect(a.summary).not.toContain('$');
  });

  it('EditOrder_NoChange_WritesNoAuditRow', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    expect(await editOrder(id, await asIs(id))).toMatchObject({ ok: true });
    expect(await editAudit(id)).toHaveLength(0);
  });

  it('EditOrder_EmailsTheCustomer_OnlyWhenAsked', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    const base = await asIs(id);
    await editOrder(id, { ...base, lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] });
    expect(mail.send).not.toHaveBeenCalled();
    await editOrder(id, { ...(await asIs(id)), notifyCustomer: true });
    const sent = (mail.send.mock.calls as unknown as [{ to: string[]; subject: string; text: string }][]).map((c) => c[0]);
    expect(sent.find((m) => m.to.includes(base.customer.email))?.text).toContain('$26.00');
  });

  it('EditOrder_NeverEmailsTheCustomerOfAScoutEnteredOrder', async () => {
    const id = await makeOrder();
    await admin.from('wreath_orders').update({ source: 'paper' }).eq('id', id);
    const { editOrder } = await actions();
    await editOrder(id, { ...(await asIs(id)), notifyCustomer: true });
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe('editOrder: credit and delivery (was Reassign)', () => {
  it('EditOrder_MovesCreditAndDelivery_ToAScoutAndBack', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    const base = await asIs(id);
    const addr = { ...base.customer, street: '1 A St', city: 'Milwaukee', zip: '53211' };
    expect(await editOrder(id, { ...base, customer: addr, creditedPersonId: fx.sellerA.personId, fulfillment: 'scout' })).toMatchObject({ ok: true });
    expect(await orderRow(id)).toMatchObject({ credited_person_id: fx.sellerA.personId, delivering_person_id: fx.sellerA.personId, fulfillment: 'scout' });
    expect(await editOrder(id, { ...(await asIs(id)), creditedPersonId: null, fulfillment: 'pickup', deliveringPersonId: null })).toMatchObject({ ok: true });
    expect(await orderRow(id)).toMatchObject({ credited_person_id: null, delivering_person_id: null, fulfillment: 'pickup' });
    const blob = JSON.stringify((await editAudit(id))[0].details);
    expect(blob).toContain('Troop store');
    expect(blob).toContain(fx.sellerA.first);
  });

  it('EditOrder_RepricesTheDeliveryFee_WithTheItems', async () => {
    const id = await makeOrder({ lines: [{ itemId: fx.item.w20, quantity: 1, donated: false }] });
    const { editOrder } = await actions();
    const base = await asIs(id);
    const addr = { ...base.customer, street: '9 Secret Lane', city: 'Milwaukee', zip: '53211' };
    expect(await editOrder(id, { ...base, customer: addr, fulfillment: 'delivery' })).toMatchObject({ ok: true });
    expect([Number((await orderRow(id)).delivery_fee), Number((await orderRow(id)).total)]).toEqual([5, 31]);
    // Two wreaths cross the $50 free-delivery line.
    expect(await editOrder(id, { ...(await asIs(id)), lines: [{ itemId: fx.item.w20, quantity: 2, donated: false }] })).toMatchObject({ ok: true });
    expect([Number((await orderRow(id)).delivery_fee), Number((await orderRow(id)).total)]).toEqual([0, 52]);
  });

  it('EditOrder_RefusesANonSeller_AndAnOutOfAreaTroopDelivery', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    const base = await asIs(id);
    const { data: other } = await admin.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null).neq('person_id', fx.sellerA.personId).neq('person_id', fx.sellerB.personId).limit(1).single();
    expect(await editOrder(id, { ...base, creditedPersonId: other!.person_id })).toMatchObject({ ok: false, field: 'creditedPersonId' });
    await admin.from('wreath_sellers').update({ active: false }).eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug);
    const retired = await editOrder(id, { ...base, creditedPersonId: fx.sellerB.personId });
    await admin.from('wreath_sellers').update({ active: true }).eq('sale_id', fx.saleId).eq('slug', fx.sellerB.slug);
    expect(retired).toMatchObject({ ok: false, field: 'creditedPersonId' });
    expect(await editOrder(id, { ...base, customer: { ...base.customer, street: '1 A St', city: 'Chicago', zip: '60601' }, fulfillment: 'delivery' })).toMatchObject({ ok: false, field: 'zip' });
  });

  it('EditOrder_AllDonated_BecomesDonatedOnly_WithNothingToDeliver', async () => {
    const id = await makeOrder();
    const { editOrder } = await actions();
    expect(await editOrder(id, { ...(await asIs(id)), lines: [{ itemId: fx.item.w20, quantity: 1, donated: true }] })).toMatchObject({ ok: true });
    expect(await orderRow(id)).toMatchObject({ fulfillment: 'none', delivering_person_id: null });
  });
});

describe('wreath_edit_order posture', () => {
  it('WreathEditOrder_CannotBeExecutedWithTheAnonKey', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.rpc('wreath_edit_order', { p: { order_id: 0 } });
    expect(error).not.toBeNull();
  });
});
