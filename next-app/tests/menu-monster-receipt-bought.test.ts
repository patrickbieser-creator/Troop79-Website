import { describe, it, expect } from 'vitest';
import { addItem, receiptItem, removeItem } from '../src/lib/menu-monster/receipt-bought';
import { sanitizeItems, type BoughtLine } from '../src/lib/menu-monster/bought';

/**
 * How a confirmed receipt line lands on, and comes back off, the "What we bought" record. The item carries its
 * receipt line id, and ONLY that id takes it back off (qa-lead, 2026-10-08: a hand-entered "any brand at a price"
 * item can share the qty and price exactly).
 */
const stamp = { by: 'Mindy S.', personId: 1, at: '2026-10-08T23:30:00Z' };
const bought = (items: BoughtLine['items']): BoughtLine => ({ status: 'bought', items, ...stamp });
const oj = receiptItem({ id: 7, qty: 6, unitPrice: 4.15 });

describe('Receipt lines on the bought record', () => {
  it('ReceiptItem_CarriesItsReceiptLineId', () => {
    expect(oj).toEqual({ brandId: null, packageId: null, qty: 6, pricePaid: 4.15, receiptLineId: 7 });
  });

  it('AddItem_ReplacesTheVirtualDefault_WhenNothingIsRecorded', () => {
    expect(addItem(undefined, oj)).toEqual({ status: 'bought', items: [oj] });
  });

  it('AddItem_ReplacesANotBoughtLine', () => {
    expect(addItem({ status: 'not_bought', items: [], ...stamp }, oj)).toEqual({ status: 'bought', items: [oj] });
  });

  it('AddItem_AppendsToARecordedLine', () => {
    const other = receiptItem({ id: 8, qty: 1, unitPrice: 2 });
    expect(addItem(bought([other]), oj)).toEqual({ status: 'bought', items: [other, oj] });
  });

  it('AddItem_SaysFull_AtTheItemCap', () => {
    const full = bought(Array.from({ length: 8 }, (_, i) => receiptItem({ id: 100 + i, qty: 1, unitPrice: i + 1 })));
    expect(addItem(full, oj)).toBe('full');
  });

  it('RemoveItem_ClearsTheLine_WhenItWasTheOnlyItem', () => {
    expect(removeItem(bought([oj]), 7)).toBeNull();
  });

  it('RemoveItem_KeepsTheOtherItems', () => {
    const other = receiptItem({ id: 8, qty: 1, unitPrice: 2 });
    expect(removeItem(bought([other, oj]), 7)).toEqual({ status: 'bought', items: [other] });
  });

  it('RemoveItem_LeavesAHandEnteredItem_WithTheSameQtyAndPrice_Alone', () => {
    const typed = { brandId: null, packageId: null, qty: 6, pricePaid: 4.15 };
    expect(removeItem(bought([typed]), 7)).toBe('same');
    expect(removeItem(bought([typed, oj]), 7)).toEqual({ status: 'bought', items: [typed] });
  });

  it('RemoveItem_LeavesAnItemWithAPackage_Alone', () => {
    const named = { brandId: 'b', packageId: 'p', qty: 6, pricePaid: 4.15 };
    expect(removeItem(bought([named]), 7)).toBe('same');
  });

  it('RemoveItem_IsASameNoOp_WhenNothingIsRecorded', () => {
    expect(removeItem(undefined, 7)).toBe('same');
  });

  it('SanitizeItems_KeepsTheReceiptLineId_AndDropsABadOne', () => {
    expect(sanitizeItems([oj, { brandId: null, packageId: null, qty: 1, pricePaid: 2, receiptLineId: -1 }, { brandId: null, packageId: null, qty: 1, pricePaid: 2, receiptLineId: '7' }])).toEqual([
      oj,
      { brandId: null, packageId: null, qty: 1, pricePaid: 2 },
      { brandId: null, packageId: null, qty: 1, pricePaid: 2 }
    ]);
  });
});
