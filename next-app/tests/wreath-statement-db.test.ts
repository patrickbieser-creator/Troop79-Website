import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { makeWreathFixture, type WreathFixture } from './helpers/wreath-fixture';
import { canViewStatement, loadScoutStatement } from '../src/lib/wreaths/statement';

/**
 * The family Statement's loader against the real local database and a throwaway sale (test-owned ids only; the fixture
 * removes everything through the sale). Every call pins fx.saleId.
 */
const admin = adminClient();
let fx: WreathFixture;
let seq = 0;

async function insertOrder(over: Record<string, unknown>) {
  seq += 1;
  const { data, error } = await admin
    .from('wreath_orders')
    .insert({
      sale_id: fx.saleId,
      idempotency_key: `vitest-stmt-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      source: 'scout_link',
      fulfillment: 'pickup',
      round: 1,
      customer_name: `Statement buyer ${seq}`,
      customer_phone: '414-555-0100',
      items_subtotal: 52,
      total: 52,
      ...over
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`order: ${error?.message}`);
  const { error: le } = await admin.from('wreath_order_lines').insert({ order_id: data.id, item_id: fx.item.w20, quantity: 2, donated: false, unit_price: 26, unit_cost: 16.07 });
  if (le) throw new Error(`line: ${le.message}`);
  return data.id as number;
}

let mine: number;
let theirs: number;
let deliveredByMe: number;

beforeAll(async () => {
  fx = await makeWreathFixture();
  mine = await insertOrder({ credited_person_id: fx.sellerA.personId });
  theirs = await insertOrder({ credited_person_id: fx.sellerB.personId });
  // Credited to B, delivered by A: it belongs to B's account, not A's.
  deliveredByMe = await insertOrder({ credited_person_id: fx.sellerB.personId, fulfillment: 'scout', delivering_person_id: fx.sellerA.personId });
});
afterAll(async () => {
  await fx.cleanup();
});

describe('loadScoutStatement', () => {
  it('Statement_HoldsOnlyTheScoutsOwnCreditedOrders', async () => {
    const s = await loadScoutStatement(admin, fx.sellerA.personId, fx.saleId);
    expect(s?.section?.orders.map((o) => o.id)).toEqual([mine]);
  });

  it('Statement_PayloadHasNoOtherScoutsOrders', async () => {
    const json = JSON.stringify(await loadScoutStatement(admin, fx.sellerA.personId, fx.saleId));
    expect([theirs, deliveredByMe].some((id) => json.includes(`"id":${id},`))).toBe(false);
  });

  it('Statement_UsesTheListPriceFromTheCatalog', async () => {
    const s = await loadScoutStatement(admin, fx.sellerA.personId, fx.saleId);
    expect(s?.section?.orders[0].lines[0].listPrice).toBe(52);
  });

  it('Statement_IsNullForSomeoneWhoIsNotASeller', async () => {
    expect(await loadScoutStatement(admin, -1, fx.saleId)).toBeNull();
  });
});

describe('canViewStatement', () => {
  it('Family_CanViewOnlyScoutsInItsScope', () => {
    const scope = { scope: [fx.sellerA.personId], proxyPersonId: null };
    expect([canViewStatement(scope, fx.sellerA.personId), canViewStatement(scope, fx.sellerB.personId), canViewStatement(null, fx.sellerA.personId)]).toEqual([true, false, false]);
  });
});
