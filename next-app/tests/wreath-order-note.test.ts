import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, NOW_R1, type WreathFixture } from './helpers/wreath-fixture';
import { placeOrder, type PlaceOrderDeps, type ScoutEntryViewer } from '../src/lib/wreaths/place-order';
import { setOrderNote } from '../src/lib/wreaths/order-note-save';
import { loadAdminOrders, loadOrderHistory } from '../src/lib/wreaths/admin-data';
import { loadConfirmation } from '../src/lib/wreaths/public';
import { loadMyWreathOrders } from '../src/lib/wreaths/my-orders';
import { resolveFamilyScope } from '../src/lib/household-scope';

/**
 * W-1 (Patrick, 2026-10-19): one troop-only note on a wreath order. The treasurer and the family of the credited scout
 * read and edit it, last edit wins; the customer never sees it. Real local database, test-owned fixture sale.
 */
const admin = adminClient();
let fx: WreathFixture;
let seq = 0;
let kid: { personId: number; parentId: number; first: string; last: string };
let parentViewer: ScoutEntryViewer;
let otherFamily: ScoutEntryViewer;
const AT = Date.parse('2026-10-19T20:00:00.000Z');

function deps(): PlaceOrderDeps {
  seq += 1;
  return { supabase: admin, now: () => NOW_R1, ip: `10.9.${Math.floor(seq / 250)}.${(seq % 250) + 1}`, send: async () => ({}), householdEmails: async () => [], siteUrl: 'https://wreaths.test', replyTo: 'troop@example.test', saleId: fx.saleId };
}

/** An online order through a scout's link (not scout-entered): the note works on every source. */
async function makeOrder(slug: string | null): Promise<{ id: number; token: string }> {
  seq += 1;
  const res = await placeOrder(
    {
      idempotencyKey: `vitest-note-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      sellerSlug: slug,
      lines: [{ itemId: fx.item.w36, quantity: 1, donated: false }],
      gift: 0,
      coverFee: false,
      fulfillment: 'pickup',
      customer: { name: 'Vitest Note Buyer', email: `note-${seq}-${Math.random().toString(36).slice(2, 6)}@example.test`, phone: '414-555-0100', street: '1 Vitest Way', city: 'Milwaukee', zip: '53211' },
      outsideAreaRelative: false,
      startedAt: NOW_R1 - 120_000,
      mountedAt: NOW_R1 - 60_000,
      website: ''
    },
    deps()
  );
  if (!res.ok) throw new Error(`order: ${res.error}`);
  const { data } = await admin.from('wreath_orders').select('id').eq('public_token', res.token).single();
  return { id: (data as { id: number }).id, token: res.token };
}

const noteRow = async (id: number) =>
  (await admin.from('wreath_orders').select('order_note, order_note_updated_by_person_id, order_note_updated_at').eq('id', id).single()).data as {
    order_note: string | null;
    order_note_updated_by_person_id: number | null;
    order_note_updated_at: string | null;
  };
const asFamily = (viewer: ScoutEntryViewer) => ({ supabase: admin, now: () => AT, actor: { kind: 'family' as const, viewer } });
const asTreasurer = (personId: number | null) => ({ supabase: admin, now: () => AT, actor: { kind: 'admin' as const, personId, label: 'Vitest Treasurer' } });

beforeAll(async () => {
  fx = await makeWreathFixture('open');
  // A real parent whose child is an active scout, made a seller of the fixture sale (as tests/wreath-scout-entry does).
  const { data: rels } = await admin.from('relationships').select('person_id, related_person_id').eq('type', 'parent_of').limit(200);
  let found: { personId: number; parentId: number } | null = null;
  for (const r of (rels ?? []) as { person_id: number; related_person_id: number }[]) {
    if ([fx.sellerA.personId, fx.sellerB.personId].includes(r.related_person_id)) continue;
    const { data: sc } = await admin.from('scouts').select('person_id').eq('person_id', r.related_person_id).eq('active', true).maybeSingle();
    if (sc) {
      found = { personId: r.related_person_id, parentId: r.person_id };
      break;
    }
  }
  if (!found) throw new Error('needs a parent_of relationship to an active scout in the local DB');
  const { data: parent } = await admin.from('people').select('first_name, last_name').eq('id', found.parentId).single();
  kid = { ...found, first: (parent as { first_name: string }).first_name, last: (parent as { last_name: string }).last_name };
  await admin.from('wreath_sellers').insert({ sale_id: fx.saleId, person_id: kid.personId, slug: 'vitest-note-kid' });
  parentViewer = { personId: kid.parentId, name: 'Parent', scope: await resolveFamilyScope(admin, kid.parentId, 'adult') };
  otherFamily = { personId: fx.sellerB.personId, name: 'Scout B', scope: await resolveFamilyScope(admin, fx.sellerB.personId, 'scout') };
  if (otherFamily.scope.includes(kid.personId)) throw new Error('fixture: scout B must not be in the kid’s family');
});
afterAll(async () => {
  await fx.cleanup();
});

describe('who may write the note', () => {
  it('OrderNote_CreditedScoutsParent_MayWriteIt', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    expect(await setOrderNote(id, 'Leave on the side porch', asFamily(parentViewer))).toEqual({ ok: true });
    expect((await noteRow(id)).order_note).toBe('Leave on the side porch');
  });

  it('OrderNote_AnotherScoutsFamily_IsRefused', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    const res = await setOrderNote(id, 'Not mine to write', asFamily(otherFamily));
    expect([res.ok, (await noteRow(id)).order_note]).toEqual([false, null]);
  });

  it('OrderNote_AFamily_IsRefusedOnATroopStoreOrder', async () => {
    const { id } = await makeOrder(null);
    expect((await setOrderNote(id, 'Hello', asFamily(parentViewer))).ok).toBe(false);
  });

  it('OrderNote_AFamily_IsRefusedOnACancelledOrder', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    await admin.from('wreath_orders').update({ status: 'cancelled', cancelled_at: new Date(AT).toISOString() }).eq('id', id);
    expect((await setOrderNote(id, 'Too late', asFamily(parentViewer))).ok).toBe(false);
  });

  it('OrderNote_AFamily_MayWriteItOnAPaidOrder', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    await admin.from('wreath_orders').update({ payment_status: 'paid', paid_method: 'card', paid_amount: 42, paid_at: new Date(AT).toISOString() }).eq('id', id);
    expect((await setOrderNote(id, 'Paid at the door', asFamily(parentViewer))).ok).toBe(true);
  });

  it('OrderNote_TheTreasurer_MayWriteItOnATroopStoreOrder', async () => {
    const { id } = await makeOrder(null);
    expect((await setOrderNote(id, 'Customer called', asTreasurer(null))).ok).toBe(true);
  });
});

describe('what a save records', () => {
  it('OrderNote_Save_SetsWhoAndWhen', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    await setOrderNote(id, 'Ring twice', asFamily(parentViewer));
    const r = await noteRow(id);
    expect([r.order_note_updated_by_person_id, Date.parse(r.order_note_updated_at!)]).toEqual([kid.parentId, AT]);
  });

  it('OrderNote_LastEditWins_AndTheTreasurerBecomesTheEditor', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    await setOrderNote(id, 'First', asFamily(parentViewer));
    await setOrderNote(id, 'Second', asTreasurer(fx.sellerA.personId));
    const r = await noteRow(id);
    expect([r.order_note, r.order_note_updated_by_person_id]).toEqual(['Second', fx.sellerA.personId]);
  });

  it('OrderNote_Clearing_ClearsWhoAndWhen', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    await setOrderNote(id, 'Temporary', asFamily(parentViewer));
    await setOrderNote(id, '', asFamily(parentViewer));
    expect(await noteRow(id)).toEqual({ order_note: null, order_note_updated_by_person_id: null, order_note_updated_at: null });
  });

  it('OrderNote_IsAudited_InTheOrdersChanges', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    await setOrderNote(id, 'Audited note', asFamily(parentViewer));
    const history = (await loadOrderHistory(admin, [id])).get(id) ?? [];
    expect(history[0]?.changes).toEqual([{ field: 'Order note', from: '—', to: 'Audited note' }]);
  });

  it('OrderNote_AdminLoader_NamesTheEditorAsFirstNameAndInitial', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    await setOrderNote(id, 'Named', asFamily(parentViewer));
    const o = (await loadAdminOrders(admin, fx.saleId)).find((x) => x.id === id)!;
    expect([o.orderNote, o.orderNoteBy]).toEqual(['Named', `${kid.first} ${kid.last.charAt(0).toUpperCase()}`]);
  });

  it('OrderNote_FamilyLoader_CarriesTheNote', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    await setOrderNote(id, 'For the family too', asFamily(parentViewer));
    const mine = await loadMyWreathOrders(admin, parentViewer.scope, fx.saleId, NOW_R1);
    const o = mine.sellers.flatMap((s) => s.orders).find((x) => x.id === id);
    expect(o?.orderNote).toBe('For the family too');
  });
});

describe('the length cap', () => {
  it('OrderNote_Save_RefusesMoreThan500Characters', async () => {
    const { id } = await makeOrder('vitest-note-kid');
    const res = await setOrderNote(id, 'x'.repeat(501), asFamily(parentViewer));
    expect([res.ok, (await noteRow(id)).order_note]).toEqual([false, null]);
  });

  it('OrderNote_Database_RefusesMoreThan500Characters', async () => {
    const { id } = await makeOrder(null);
    const { error } = await admin.from('wreath_orders').update({ order_note: 'x'.repeat(501) }).eq('id', id);
    expect(error?.message).toMatch(/wreath_orders_order_note_len/);
  });
});

describe('the customer never sees it', () => {
  it('OrderNote_CustomerOrderPage_NeverCarriesTheNote', async () => {
    const { id, token } = await makeOrder('vitest-note-kid');
    await setOrderNote(id, 'SECRET-TROOP-NOTE-7781', asTreasurer(null));
    const page = await loadConfirmation(admin, token);
    expect(page).not.toBeNull();
    expect(JSON.stringify(page)).not.toContain('SECRET-TROOP-NOTE-7781');
  });

  it('OrderNote_CustomerOrderPage_HasNoNoteField', async () => {
    const { token } = await makeOrder(null);
    const page = (await loadConfirmation(admin, token)) as unknown as Record<string, unknown>;
    expect(Object.keys(page).filter((k) => /note/i.test(k))).toEqual([]);
  });
});
