import { describe, it, expect } from 'vitest';
import {
  CUTOFF_GRACE_MS,
  coverFeeFor,
  decideRound,
  deliveryFeeFor,
  inDeliveryArea,
  mergeLines,
  orderProfit,
  priceCart,
  roseOrder,
  scoutEarnings,
  zipFormatOk,
  type Fulfillment,
  type PricedItem,
  type SaleRules
} from '../src/lib/wreaths/rules';

/** The pure arithmetic of the wreath sale: no database, so these run anywhere. */
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
  { id: 2, catalogNumber: 3, price: 42, unitCost: 27.87, active: true, donatable: false },
  { id: 3, catalogNumber: 15, price: 10, unitCost: 5.85, active: false, donatable: false }
];

describe('delivery area', () => {
  it('Zip_53211Passes_53012And60601Fail', () => {
    expect(inDeliveryArea(rules, '53211')).toBe(true);
    expect(inDeliveryArea(rules, '53012')).toBe(false);
    expect(inDeliveryArea(rules, '60601')).toBe(false);
    expect(inDeliveryArea(rules, '5321')).toBe(false);
    expect(zipFormatOk('53211')).toBe(true);
    expect(zipFormatOk('53211-1234')).toBe(false);
  });
});

describe('fees', () => {
  it('DeliveryFee_IsFiveUnderFifty_AndFreeAtExactlyFifty', () => {
    expect(deliveryFeeFor(rules, 'delivery', 49.99)).toBe(5);
    expect(deliveryFeeFor(rules, 'delivery', 50)).toBe(0);
    expect(deliveryFeeFor(rules, 'scout', 10)).toBe(0);
    expect(deliveryFeeFor(rules, 'pickup', 10)).toBe(0);
  });

  it('CoverFee_IsPercentOfBasePlusFixed_AndNothingForAnEmptyBase', () => {
    expect(coverFeeFor(rules, 36)).toBe(1.21);
    expect(coverFeeFor(rules, 0)).toBe(0);
  });
});

describe('priceCart', () => {
  const opts: { fulfillment: Fulfillment; gift: number; coverFee: boolean } = { fulfillment: 'pickup', gift: 0, coverFee: false };
  const ok = (lines: { itemId: number; quantity: number; donated: boolean }[], o = opts) => priceCart(rules, catalog, lines, o);

  it('Cart_MergesRepeatedLines_BeforeBoundingQuantity', () => {
    expect(mergeLines([{ itemId: 1, quantity: 30, donated: false }, { itemId: 1, quantity: 30, donated: false }])).toEqual([{ itemId: 1, quantity: 60, donated: false }]);
    expect(ok([{ itemId: 1, quantity: 30, donated: false }, { itemId: 1, quantity: 30, donated: false }]).ok).toBe(false);
  });

  it('Cart_KeepsDonatedAndPurchasedLinesApart', () => {
    const r = ok([{ itemId: 1, quantity: 1, donated: false }, { itemId: 1, quantity: 2, donated: true }]);
    expect(r.ok && r.order.lines).toHaveLength(2);
    expect(r.ok && r.order.itemsSubtotal).toBe(78);
  });

  it('Cart_NamesTheProblem', () => {
    const code = (r: ReturnType<typeof ok>) => (r.ok ? 'ok' : r.problem.code);
    expect(code(ok([]))).toBe('empty');
    expect(code(ok([{ itemId: 9, quantity: 1, donated: false }]))).toBe('unknown_item');
    expect(code(ok([{ itemId: 3, quantity: 1, donated: false }]))).toBe('inactive_item');
    expect(code(ok([{ itemId: 2, quantity: 1, donated: true }]))).toBe('not_donatable');
    expect(code(ok([{ itemId: 1, quantity: 51, donated: false }]))).toBe('quantity');
    expect(code(ok([{ itemId: 1, quantity: 1, donated: false }], { ...opts, gift: 501 }))).toBe('gift');
  });

  it('Cart_TotalsDollarsExactly_WithoutFloatDrift', () => {
    const r = ok([{ itemId: 1, quantity: 3, donated: false }], { fulfillment: 'delivery', gift: 0.1, coverFee: true });
    // 78 (free delivery over $50) + 0.10 gift = 78.10; fee = 1.99% of 78.10 = 1.55 + 0.49 = 2.04
    expect(r.ok && r.order.deliveryFee).toBe(0);
    expect(r.ok && r.order.feeCovered).toBe(2.04);
    expect(r.ok && r.order.total).toBe(80.14);
  });
});

describe('cutoffs', () => {
  const r1 = Date.parse(rules.round1Cutoff);
  const r2 = Date.parse(rules.round2Cutoff);

  it('DecideRound_FollowsTheClock_AndClosesAfterTheSecondCutoff', () => {
    expect(decideRound(rules, r1 - 1000, null)).toBe(1);
    expect(decideRound(rules, r1 + 1000, null)).toBe(2);
    expect(decideRound(rules, r2 + 1000, null)).toBeNull();
  });

  it('DecideRound_GivesAnOpenCheckoutTwoHoursOfGrace_InTheRoundItBegan', () => {
    expect(decideRound(rules, r1 + 1000, r1 - 1000)).toBe(1);
    expect(decideRound(rules, r1 + CUTOFF_GRACE_MS + 1000, r1 - 1000)).toBe(2);
    expect(decideRound(rules, r2 + 1000, r2 - 1000)).toBe(2);
    expect(decideRound(rules, r2 + CUTOFF_GRACE_MS + 1000, r2 - 1000)).toBeNull();
  });

  it('DecideRound_IgnoresAStartTimeFromTheFuture', () => {
    expect(decideRound(rules, r1 + 1000, r1 + 3_600_000)).toBe(2);
  });
});

describe('Rose order', () => {
  it('RoseOrder_SumsRoundOne_ThenRoundTwoAsChanges', () => {
    const rows = roseOrder([
      { catalogNumber: 3, round: 1, quantity: 2 },
      { catalogNumber: 1, round: 1, quantity: 4 },
      { catalogNumber: 1, round: 2, quantity: 1 },
      { catalogNumber: 1, round: 1, quantity: 3 }
    ]);
    expect(rows).toEqual([
      { catalogNumber: 1, round1: 7, round2: 1, total: 8 },
      { catalogNumber: 3, round1: 2, round2: 0, total: 2 }
    ]);
  });
});

describe('scout earnings', () => {
  it('OrderProfit_IsSellMinusCost_PerLine_DonatedIncluded', () => {
    expect(
      orderProfit([
        { quantity: 2, unitPrice: 26, unitCost: 16.07 },
        { quantity: 1, unitPrice: 10, unitCost: 5.85 }
      ])
    ).toBe(24.01);
  });

  it('OrderProfit_IsZero_ForNoLines', () => {
    expect(orderProfit([])).toBe(0);
  });

  it('ScoutEarnings_IsThirtyPercentOfProfit_RoundedToTheCent', () => {
    expect(scoutEarnings(24.01, 0.3)).toBe(7.2);
    expect(scoutEarnings(0, 0.3)).toBe(0);
  });
});
