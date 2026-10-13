import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, type WreathFixture } from './helpers/wreath-fixture';
import { loadMyWreathOrders } from '../src/lib/wreaths/my-orders';

/**
 * The loader behind Members > Wreath sale, against the real local database and a throwaway sale (test-owned ids
 * only; the fixture removes everything through the sale). Every call pins fx.saleId so a parallel fixture can't win
 * the loader's "most recent year" default.
 */
const admin = adminClient();
let fx: WreathFixture;
let seq = 0;

async function insertOrder(over: Record<string, unknown>, qty = 2) {
  seq += 1;
  const { data, error } = await admin
    .from('wreath_orders')
    .insert({
      sale_id: fx.saleId,
      idempotency_key: `vitest-my-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      source: 'scout_link',
      fulfillment: 'pickup',
      round: 1,
      customer_name: `Buyer ${seq}`,
      customer_phone: '414-555-0100',
      customer_address: `${seq} Test St`,
      customer_city: 'Milwaukee',
      customer_zip: '53211',
      items_subtotal: 26 * qty,
      total: 26 * qty,
      ...over
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`order: ${error?.message}`);
  const { error: le } = await admin.from('wreath_order_lines').insert({ order_id: data.id, item_id: fx.item.w20, quantity: qty, donated: false, unit_price: 26, unit_cost: 16.07 });
  if (le) throw new Error(`line: ${le.message}`);
  return data.id as number;
}

beforeAll(async () => {
  fx = await makeWreathFixture();
});
afterAll(async () => {
  await fx.cleanup();
});

describe('MyWreathOrders loader', () => {
  it('MyWreathOrders_ShowsOnlyOwnScoutsOrders_WhenFamilyHasTwoSellers', async () => {
    const a = await insertOrder({ credited_person_id: fx.sellerA.personId });
    const b = await insertOrder({ credited_person_id: fx.sellerB.personId });
    const mineOnly = await loadMyWreathOrders(admin, [fx.sellerA.personId], fx.saleId);
    expect(mineOnly.sellers.map((s) => s.personId)).toEqual([fx.sellerA.personId]);
    expect(mineOnly.sellers[0].orders.map((o) => o.id)).toEqual([a]);

    const both = await loadMyWreathOrders(admin, [fx.sellerA.personId, fx.sellerB.personId], fx.saleId);
    expect(both.sellers.map((s) => s.personId).sort()).toEqual([fx.sellerA.personId, fx.sellerB.personId].sort());
    expect(both.sellers.find((s) => s.personId === fx.sellerB.personId)?.orders.map((o) => o.id)).toEqual([b]);
  });

  it('MyWreathOrders_ExcludesTroopStoreOrders_FromEveryScoutsList', async () => {
    const troop = await insertOrder({ credited_person_id: null, source: 'store' });
    const view = await loadMyWreathOrders(admin, [fx.sellerA.personId, fx.sellerB.personId], fx.saleId);
    const ids = view.sellers.flatMap((s) => [...s.orders, ...s.deliveries]).map((o) => o.id);
    expect(ids).not.toContain(troop);
  });

  it('MyWreathOrders_GivesAFamilyWithNoSeller_AnEmptyList', async () => {
    const view = await loadMyWreathOrders(admin, [-1], fx.saleId);
    expect(view.sellers).toEqual([]);
    expect(view.sale?.id).toBe(fx.saleId);
  });

  it('MyWreathOrders_DeliveryList_CarriesContactOnlyForOrdersThisScoutDelivers', async () => {
    const delivered = await insertOrder({ credited_person_id: fx.sellerA.personId, fulfillment: 'scout', delivering_person_id: fx.sellerA.personId });
    const siblingsRun = await insertOrder({ credited_person_id: fx.sellerB.personId, fulfillment: 'scout', delivering_person_id: fx.sellerB.personId });
    const view = await loadMyWreathOrders(admin, [fx.sellerA.personId], fx.saleId);
    const mine = view.sellers[0];
    expect(mine.deliveries.map((o) => o.id)).toEqual([delivered]);
    expect(mine.deliveries[0].contact?.address).toMatch(/Test St/);
    expect([...mine.orders, ...mine.deliveries].map((o) => o.id)).not.toContain(siblingsRun);
    expect(mine.orders.every((o) => o.creditedPersonId === fx.sellerA.personId)).toBe(true);
  });

  it('MyWreathOrders_EarningsSoFar_UseTheSaleShare_AndSkipCancelled', async () => {
    const view = await loadMyWreathOrders(admin, [fx.sellerA.personId], fx.saleId);
    const live = view.sellers[0].orders.filter((o) => o.status === 'placed').length;
    const gone = await insertOrder({ credited_person_id: fx.sellerA.personId, status: 'cancelled', cancelled_at: new Date().toISOString() });
    const after = await loadMyWreathOrders(admin, [fx.sellerA.personId], fx.saleId);
    expect(after.sellers[0].orders.map((o) => o.id)).toContain(gone);
    expect(after.sellers[0].summary.orders).toBe(live);
    // each order is 2 x (26 - 16.07) = 19.86 profit; 30% of that is 5.96 (default scout_share 0.300)
    expect(after.sellers[0].summary.earnings).toBe(Math.round(live * 19.86 * 0.3 * 100) / 100);
  });

  it('MyWreathOrders_ShowsNothing_WhenTheSaleIsStillADraft', async () => {
    const { data: before } = await admin.from('wreath_sales').select('status').eq('id', fx.saleId).single();
    await admin.from('wreath_sales').update({ status: 'draft' }).eq('id', fx.saleId);
    try {
      const view = await loadMyWreathOrders(admin, [fx.sellerA.personId], fx.saleId);
      expect(view.sellers).toEqual([]);
    } finally {
      await admin.from('wreath_sales').update({ status: before!.status }).eq('id', fx.saleId);
    }
  });
});
