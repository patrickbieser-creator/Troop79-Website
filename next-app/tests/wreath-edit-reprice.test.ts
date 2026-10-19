import { describe, it, expect } from 'vitest';
import { repriceEdit, type PricedItem, type SaleRules } from '../src/lib/wreaths/rules';

/**
 * The treasurer's order edit reprices from the order's own snapshots, not today's catalog: a kept line keeps the
 * price the customer was quoted, a new line takes the catalog price (Patrick, 2026-10-18: a customer ordered the
 * wrong item and paid for a different one). Pure arithmetic, no database.
 */
const rules: SaleRules = {
  deliveryZipPrefix: '532',
  deliveryFee: 5,
  deliveryFreeAt: 50,
  feePercent: 1.99,
  feeFixed: 0.49,
  round1Cutoff: '2026-10-26T04:59:00.000Z',
  round2Cutoff: '2026-11-16T05:59:00.000Z'
};
const catalog: PricedItem[] = [
  { id: 1, catalogNumber: 1, price: 26, unitCost: 16.07, active: true, donatable: true },
  { id: 3, catalogNumber: 3, price: 42, unitCost: 27.87, active: true, donatable: false },
  { id: 15, catalogNumber: 15, price: 10, unitCost: 5.85, active: false, donatable: false }
];
const pickup = { fulfillment: 'pickup' as const, gift: 0, coverFee: false };

describe('repriceEdit', () => {
  it('RepriceEdit_KeptLine_KeepsItsOrderTimePrice', () => {
    // Quoted $24 when ordered; the catalog says $26 today.
    const res = repriceEdit(rules, catalog, [{ itemId: 1, donated: false, unitPrice: 24, unitCost: 15 }], [{ itemId: 1, quantity: 2, donated: false }], pickup);
    expect(res.ok && [res.order.lines[0].unitPrice, res.order.lines[0].unitCost, res.order.total]).toEqual([24, 15, 48]);
  });

  it('RepriceEdit_NewLine_TakesTheCatalogPrice', () => {
    const res = repriceEdit(rules, catalog, [{ itemId: 1, donated: false, unitPrice: 24, unitCost: 15 }], [{ itemId: 3, quantity: 1, donated: false }], pickup);
    expect(res.ok && [res.order.lines[0].unitPrice, res.order.lines[0].unitCost, res.order.total]).toEqual([42, 27.87, 42]);
  });

  it('RepriceEdit_SameItemDonatedInstead_IsANewLineAtTheCatalogPrice', () => {
    const res = repriceEdit(rules, catalog, [{ itemId: 1, donated: false, unitPrice: 24, unitCost: 15 }], [{ itemId: 1, quantity: 1, donated: true }], pickup);
    expect(res.ok && res.order.lines[0].unitPrice).toBe(26);
  });

  it('RepriceEdit_AllowsAnItemNoLongerOnSale', () => {
    const res = repriceEdit(rules, catalog, [], [{ itemId: 15, quantity: 1, donated: false }], pickup);
    expect(res.ok && res.order.total).toBe(10);
  });

  it('RepriceEdit_RefusesAnItemOutsideTheSale', () => {
    expect(repriceEdit(rules, catalog, [], [{ itemId: 99, quantity: 1, donated: false }], pickup)).toEqual({ ok: false, problem: { code: 'unknown_item', itemId: 99 } });
  });

  it('RepriceEdit_RefusesADonatedLineOnAnItemThatCantBeDonated', () => {
    expect(repriceEdit(rules, catalog, [], [{ itemId: 3, quantity: 1, donated: true }], pickup)).toEqual({ ok: false, problem: { code: 'not_donatable', itemId: 3 } });
  });

  it('RepriceEdit_RefusesNoLinesAndABadQuantity', () => {
    expect(repriceEdit(rules, catalog, [], [], pickup)).toEqual({ ok: false, problem: { code: 'empty' } });
    expect(repriceEdit(rules, catalog, [], [{ itemId: 1, quantity: 0, donated: false }], pickup)).toEqual({ ok: false, problem: { code: 'quantity', itemId: 1 } });
  });

  it('RepriceEdit_RepricesTheDeliveryFee_FromTheDeliveredItems', () => {
    const res = repriceEdit(rules, catalog, [], [{ itemId: 1, quantity: 1, donated: false }], { fulfillment: 'delivery', gift: 0, coverFee: false });
    expect(res.ok && [res.order.deliveryFee, res.order.total]).toEqual([5, 31]);
  });

  it('RepriceEdit_AddsTheGift_AndRecomputesACoveredFee', () => {
    const res = repriceEdit(rules, catalog, [], [{ itemId: 1, quantity: 1, donated: false }], { fulfillment: 'pickup', gift: 4, coverFee: true });
    // $30 base grossed up for 1.99% + $0.49: the troop keeps the whole $30.
    expect(res.ok && [res.order.gift, res.order.feeCovered, res.order.total]).toEqual([4, 1.11, 31.11]);
  });
});
