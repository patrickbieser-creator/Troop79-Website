import { describe, it, expect } from 'vitest';
import { buildSalesDashboard } from '../src/lib/wreaths/dashboard';
import type { AdminOrder, AdminSeller } from '../src/lib/wreaths/admin-data';

/** Admin › Wreath Sale › Dashboard — the pure rollup behind it (Patrick, 2026-10-16). No database. */
const ANNA = 100;
const BEN = 200;

let n = 0;
function order(over: Partial<AdminOrder> = {}): AdminOrder {
  n += 1;
  return {
    id: n,
    orderNumber: `W-${1000 + n}`,
    placedAt: '2026-10-13T15:00:00.000Z',
    round: 1,
    source: 'scout_link',
    fulfillment: 'pickup',
    creditedPersonId: ANNA,
    creditedName: 'Anna A',
    deliveringPersonId: null,
    customerName: `Customer ${n}`,
    customerEmail: `c${n}@example.test`,
    customerPhone: '',
    customerAddress: '',
    customerCity: '',
    customerZip: '',
    outsideAreaRelative: false,
    itemsSubtotal: 52,
    deliveryFee: 0,
    feeCovered: 0,
    gift: 0,
    total: 52,
    paymentStatus: 'unpaid',
    paidMethod: null,
    paidAt: null,
    paidAmount: null,
    status: 'placed',
    stripeFee: null,
    refundedAt: null,
    needsRefund: null,
    cardStarted: false,
    enteredByPersonId: null,
    enteredByName: null,
    collectedByScout: false,
    paymentNote: '',
    customerNote: '',
    lines: [{ itemId: 1, label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16 }],
    ...over
  };
}

const paid = (method: string, over: Partial<AdminOrder> = {}) => order({ paymentStatus: 'paid', paidMethod: method, paidAt: '2026-10-14T15:00:00.000Z', paidAmount: 52, ...over });

function seller(personId: number, name: string, goal: number | null = null): AdminSeller {
  return { id: personId, personId, name, slug: null, active: true, orders: 0, goal, deliveryMessage: null };
}

const SELLERS = [seller(ANNA, 'Anna A', 10), seller(BEN, 'Ben B')];
const NOW = Date.parse('2026-10-16T17:00:00.000Z');
// Round 1 closes Tue Oct 20, 11:59 PM Central.
const SALE = { scoutShare: 0.3, round1Cutoff: '2026-10-21T04:59:00.000Z', round2Cutoff: '2026-11-11T05:59:00.000Z' };
const build = (orders: AdminOrder[], sellers = SELLERS) => buildSalesDashboard({ orders, sellers, sale: SALE, nowMs: NOW });

describe('buildSalesDashboard totals', () => {
  it('Dashboard_CountsPlacedOrders_AndLeavesCancelledOnesOut', () => {
    const d = build([order(), order({ status: 'cancelled' })]);
    expect([d.totals.orders, d.totals.cancelled]).toEqual([1, 1]);
  });

  it('Dashboard_LeavesRefundedOrdersOutOfTheTotals', () => {
    expect(build([order(), paid('card', { paymentStatus: 'refunded' })]).totals.orders).toBe(1);
  });

  it('Dashboard_CountsWreaths_IncludingDonatedOnes', () => {
    const d = build([order({ lines: [{ itemId: 1, label: 'W', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16 }, { itemId: 1, label: 'W', catalogNumber: 1, quantity: 1, donated: true, amount: 26, unitPrice: 26, unitCost: 16 }] })]);
    expect([d.totals.items, d.totals.donated]).toEqual([3, 1]);
  });

  it('Dashboard_SplitsMoneyIntoCollectedAndStillOwed', () => {
    const d = build([paid('venmo'), order({ total: 30 })]);
    expect([d.totals.collected, d.totals.owed]).toEqual([52, 30]);
  });

  // Patrick, 2026-10-18: an order accepted a little short counts what actually came in.
  it('Dashboard_ShortPaidOrder_CollectedIsWhatCameIn', () => {
    const d = build([paid('venmo', { paidAmount: 50 })]);
    expect([d.totals.collected, d.totals.shortAccepted]).toEqual([50, 2]);
  });

  it('Dashboard_ShortPaidOrder_TheTroopAbsorbsTheShortfall', () => {
    const d = build([paid('venmo', { paidAmount: 50 })]);
    expect([d.totals.profit, d.totals.scoutShare, d.totals.troopShare]).toEqual([18, 6, 12]);
  });

  it('Dashboard_ByMethod_CountsWhatCameIn', () => {
    expect(build([paid('venmo', { paidAmount: 50 })]).byMethod).toEqual([{ method: 'venmo', orders: 1, amount: 50 }]);
  });

  it('Dashboard_Profit_IsPriceLessCostOnEveryWreath', () => {
    expect(build([order(), order()]).totals.profit).toBe(40);
  });

  it('Dashboard_ScoutShare_IsTheShareOfCreditedOrdersOnly', () => {
    const d = build([order(), order({ creditedPersonId: null, creditedName: 'Troop store', source: 'store' })]);
    expect([d.totals.scoutShare, d.totals.troopShare]).toEqual([6, 34]);
  });

  it('Dashboard_GiftsAndCardFees_AreTotalledApart', () => {
    const d = build([paid('card', { gift: 10, stripeFee: 1.99, feeCovered: 1.99 }), paid('card', { stripeFee: 1.8 })]);
    expect([d.totals.gifts, d.totals.cardFees, d.totals.feesCovered]).toEqual([10, 3.79, 1.99]);
  });
});

describe('buildSalesDashboard attention', () => {
  it('Dashboard_Attention_NamesUnpaidOrdersAndTheOldestOnesAge', () => {
    const d = build([order({ placedAt: '2026-10-12T17:00:00.000Z' }), order({ placedAt: '2026-10-15T17:00:00.000Z' }), paid('venmo')]);
    expect([d.attention.unpaid, d.attention.oldestUnpaidDays]).toEqual([2, 4]);
  });

  it('Dashboard_Attention_CountsCardNotFinishedAndRefundsDue', () => {
    const d = build([order({ cardStarted: true }), order({ status: 'cancelled', paymentStatus: 'paid', needsRefund: 'cancelled' })]);
    expect([d.attention.cardUnfinished, d.attention.needsRefund]).toEqual([1, 1]);
  });

  it('Dashboard_Attention_TotalsMoneyScoutsHoldToTurnIn', () => {
    const d = build([order({ source: 'paper', collectedByScout: true, total: 40 }), order({ source: 'paper', total: 25 })]);
    expect([d.attention.toTurnIn, d.attention.toCollect]).toEqual([40, 25]);
  });
});

describe('buildSalesDashboard breakdowns', () => {
  it('Dashboard_ByDay_RunsEveryCentralDayFromTheFirstOrderToToday', () => {
    // 10-14 02:00Z is still 10-13 in Milwaukee.
    const d = build([order({ placedAt: '2026-10-14T02:00:00.000Z' }), order({ placedAt: '2026-10-15T15:00:00.000Z' })]);
    expect(d.byDay.map((x) => [x.date, x.orders])).toEqual([
      ['2026-10-13', 1],
      ['2026-10-14', 0],
      ['2026-10-15', 1],
      ['2026-10-16', 0]
    ]);
  });

  it('Dashboard_ByDay_IsEmpty_WithNoOrders', () => {
    expect(build([]).byDay).toEqual([]);
  });

  it('Dashboard_ByMethod_GroupsPaidOrdersAndShowsUnpaid', () => {
    const d = build([paid('venmo'), paid('venmo'), paid('card'), order()]);
    expect(d.byMethod.map((m) => [m.method, m.orders])).toEqual([
      ['venmo', 2],
      ['card', 1],
      ['unpaid', 1]
    ]);
  });

  it('Dashboard_ByChannel_SeparatesScoutLinksStoreAndScoutEntered', () => {
    const d = build([order(), order({ source: 'store', creditedPersonId: null }), order({ source: 'paper' }), order({ source: 'paper' })]);
    expect(d.byChannel.map((c) => [c.key, c.orders])).toEqual([
      ['paper', 2],
      ['scout_link', 1],
      ['store', 1]
    ]);
  });

  it('Dashboard_ByFulfillment_CountsHowOrdersReachCustomers', () => {
    const d = build([order({ fulfillment: 'scout' }), order({ fulfillment: 'delivery' }), order({ fulfillment: 'delivery' })]);
    expect(d.byFulfillment.map((c) => [c.key, c.orders])).toEqual([
      ['delivery', 2],
      ['scout', 1]
    ]);
  });

  it('Dashboard_ByRound_CountsWreathsPerRound', () => {
    const d = build([order(), order({ round: 2 })]);
    expect(d.byRound.map((r) => [r.round, r.orders, r.items])).toEqual([
      [1, 1, 2],
      [2, 1, 2]
    ]);
  });

  it('Dashboard_ByRound_SaysHowManyDaysAreLeft_AndNullOnceClosed', () => {
    const open = build([]).byRound[0].daysLeft;
    const closed = buildSalesDashboard({ orders: [], sellers: [], sale: SALE, nowMs: Date.parse('2026-10-22T12:00:00.000Z') }).byRound[0].daysLeft;
    expect([open, closed]).toEqual([4, null]);
  });

  it('Dashboard_Items_RankBestSellersFirst_WithTheirProfit', () => {
    const big = { itemId: 2, label: '27″ Tree', catalogNumber: 9, quantity: 3, donated: false, amount: 228, unitPrice: 76, unitCost: 56.05 };
    const d = build([order(), order({ lines: [big] })]);
    expect(d.items.map((i) => [i.catalogNumber, i.quantity, i.profit])).toEqual([
      [9, 3, 59.85],
      [1, 2, 20]
    ]);
  });
});

describe('buildSalesDashboard sellers', () => {
  it('Dashboard_Sellers_RankBySales_WithTheTroopStoreOnItsOwnRow', () => {
    const d = build([order(), order({ creditedPersonId: BEN, itemsSubtotal: 100 }), order({ creditedPersonId: null, source: 'store' })]);
    expect(d.sellers.map((s) => s.name)).toEqual(['Ben B', 'Anna A', 'Troop store']);
  });

  it('Dashboard_Sellers_ListScoutsWithNoSalesYet', () => {
    const d = build([order()]);
    expect(d.sellers.find((s) => s.personId === BEN)?.orders).toBe(0);
  });

  it('Dashboard_Sellers_CarryEarningsAndGoalProgress', () => {
    const anna = build([order(), order()]).sellers.find((s) => s.personId === ANNA)!;
    expect([anna.items, anna.earnings, anna.goal, anna.goalPct]).toEqual([4, 12, 10, 0.4]);
  });

  it('Dashboard_Sellers_CountScoutsWhoHaveSold', () => {
    expect(build([order()]).totals.sellersSelling).toBe(1);
  });
});
