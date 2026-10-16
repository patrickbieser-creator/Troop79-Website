import { describe, it, expect } from 'vitest';
import {
  checkoutLineItems,
  checkoutIdempotencyKey,
  withCardFeeCover,
  cardLedgerRows,
  cardRefundRow,
  type CardOrder
} from '../src/lib/wreaths/card-checkout';

/**
 * Release B (Plans/Wreath-Stripe-Checkout.md): the pure half of paying by card. The Stripe charge is built only from
 * the order row, its line items must add up to the order total to the cent, and nothing that identifies the customer
 * goes into what Stripe sees (qa-lead, 2026-10-15). Ledger: gross income + a separate Stripe fee expense (Patrick).
 */
const order: CardOrder = {
  id: 14,
  orderNumber: 'W-1001',
  itemsSubtotal: 52,
  deliveryFee: 5,
  gift: 10,
  feeCovered: 2.44,
  total: 69.44,
  lines: [
    { name: 'WREATH', size: '20"', quantity: 2, unitPrice: 21, donated: false },
    { name: 'CANDLE RING', size: '', quantity: 1, unitPrice: 10, donated: true }
  ]
};
const rules = { feePercent: 2.9, feeFixed: 0.3 };

describe('checkoutLineItems', () => {
  it('Customer_SeesLinesThatAddUpToTheOrderTotal', () => {
    const items = checkoutLineItems(order);
    expect(items.reduce((s, i) => s + i.unitAmount * i.quantity, 0)).toBe(6944);
  });

  it('Customer_SeesEachWreathLineAtItsUnitPriceAndQuantity', () => {
    expect(checkoutLineItems(order)[0]).toEqual({ name: '20" Wreath', unitAmount: 2100, quantity: 2 });
  });

  it('Customer_SeesDonatedWreathsMarkedDonated', () => {
    expect(checkoutLineItems(order)[1].name).toBe('Candle ring (donated)');
  });

  it('Customer_SeesDeliveryGiftAndCardFeeAsTheirOwnLines', () => {
    expect(checkoutLineItems(order).slice(2).map((i) => [i.name, i.unitAmount])).toEqual([
      ['Delivery', 500],
      ['Gift to Troop 79', 1000],
      ['Card processing fee', 244]
    ]);
  });

  it('Customer_SeesNoZeroLines_WhenThereIsNoDeliveryGiftOrFee', () => {
    const plain = { ...order, deliveryFee: 0, gift: 0, feeCovered: 0, total: 52 };
    expect(checkoutLineItems(plain).map((i) => i.name)).toEqual(['20" Wreath', 'Candle ring (donated)']);
  });

  it('Treasurer_IsProtected_WhenTheLinesDoNotAddUpToTheTotal', () => {
    expect(() => checkoutLineItems({ ...order, total: 70 })).toThrow(/add up/i);
  });
});

describe('checkoutIdempotencyKey', () => {
  it('Stripe_GetsTheSameKey_ForTheSameOrderLinesAndAttempt', () => {
    expect(checkoutIdempotencyKey(order, 1)).toBe(checkoutIdempotencyKey({ ...order }, 1));
  });

  it('Stripe_GetsANewKey_WhenTheLinesChange', () => {
    expect(checkoutIdempotencyKey(order, 1)).not.toBe(checkoutIdempotencyKey({ ...order, feeCovered: 0, total: 67 }, 1));
  });

  // A session we expired must never come back: going back to the same lines later is a new attempt, a new key.
  it('Stripe_GetsANewKey_ForANewAttemptWithTheSameLines', () => {
    expect(checkoutIdempotencyKey(order, 1)).not.toBe(checkoutIdempotencyKey(order, 2));
  });
});

describe('withCardFeeCover', () => {
  it('Customer_CoveringTheFee_AddsItOnItemsGiftAndDelivery', () => {
    // 2.9% of $67.00 = $1.943 → $1.94, + $0.30 = $2.24.
    expect(withCardFeeCover(order, rules, true)).toEqual({ feeCovered: 2.24, total: 69.24 });
  });

  it('Customer_NotCoveringTheFee_DropsIt', () => {
    expect(withCardFeeCover(order, rules, false)).toEqual({ feeCovered: 0, total: 67 });
  });
});

describe('cardLedgerRows', () => {
  const base = { orderNumber: 'W-1001', customerName: 'Sara Zirbel', total: 69.44, fee: 2.31, saleYear: 2026, today: '2026-10-20' };

  it('Treasurer_SeesGrossIncomeAsAFundraiserCardRow', () => {
    const { income } = cardLedgerRows(base);
    expect([income.account, income.amount, income.kind, income.method, income.activity_label]).toEqual([
      'checking', 69.44, 'fundraiser', 'card', "Wreaths '26"
    ]);
  });

  it('Treasurer_SeesTheStripeFeeAsANegativeExpenseRow', () => {
    const { feeRow } = cardLedgerRows(base);
    expect([feeRow?.amount, feeRow?.kind, feeRow?.method, feeRow?.memo]).toEqual([
      -2.31, 'expense', 'card', 'Stripe fee · Wreath order W-1001'
    ]);
  });

  it('Treasurer_SeesNoFeeRow_WhenTheFeeIsNotKnownYet', () => {
    expect(cardLedgerRows({ ...base, fee: null }).feeRow).toBeNull();
  });

  it('Treasurer_SeesTheCustomerOnlyInTheLedgerMemo', () => {
    expect(cardLedgerRows(base).income.memo).toBe('Wreath order W-1001 · Sara Zirbel · Card');
  });
});

describe('cardRefundRow', () => {
  it('Treasurer_SeesAFullRefundAsNegativeFundraiserIncome', () => {
    const r = cardRefundRow({ orderNumber: 'W-1001', customerName: 'Sara Zirbel', amount: 69.44, saleYear: 2026, today: '2026-10-22' });
    expect([r.amount, r.kind, r.method, r.memo]).toEqual([-69.44, 'fundraiser', 'card', 'Refund · Wreath order W-1001 · Sara Zirbel']);
  });
});
