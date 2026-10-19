import { describe, it, expect } from 'vitest';
import { buildReconciliation, reconciliationCsv } from '../src/lib/wreaths/reconciliation';
import { buildSalesDashboard } from '../src/lib/wreaths/dashboard';
import type { AdminOrder, AdminSeller } from '../src/lib/wreaths/admin-data';

/** Admin › Wreath Sale › Reconciliation and the family Statement — the pure rollup (Patrick, 2026-10-19). No database. */
const LILY = 100;
const BEN = 200;

let n = 0;
function order(over: Partial<AdminOrder> = {}): AdminOrder {
  n += 1;
  return {
    id: n,
    orderNumber: `W-${1000 + n}`,
    placedAt: `2026-10-13T15:${String(n % 60).padStart(2, '0')}:00.000Z`,
    round: 1,
    source: 'scout_link',
    fulfillment: 'pickup',
    creditedPersonId: LILY,
    creditedName: 'Lily L',
    deliveringPersonId: null,
    customerName: `Customer ${n}`,
    customerEmail: `c${n}@example.test`,
    customerPhone: '414-555-0100',
    customerAddress: '1 Test St',
    customerCity: 'Milwaukee',
    customerZip: '53211',
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
    orderNote: '',
    orderNoteBy: null,
    orderNoteAt: null,
    lines: [{ itemId: 1, label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16.07 }],
    ...over
  };
}
const paid = (method: string, over: Partial<AdminOrder> = {}) => order({ paymentStatus: 'paid', paidMethod: method, paidAt: '2026-10-14T15:00:00.000Z', paidAmount: over.total ?? 52, ...over });

const seller = (personId: number, name: string): AdminSeller => ({ id: personId, personId, name, slug: null, active: true, orders: 0, goal: null, deliveryMessage: null });
const SELLERS = [seller(LILY, 'Lily L'), seller(BEN, 'Ben B')];
const ITEMS = [{ id: 1, price: 28 }];
const SALE = { year: 2026, scoutShare: 0.3, donationShare: 0.15, feePercent: 2.9, feeFixed: 0.3, round1Cutoff: '2026-10-21T04:59:00.000Z', round2Cutoff: '2026-11-11T05:59:00.000Z' };
const NOW = Date.parse('2026-10-19T17:00:00.000Z');
const build = (orders: AdminOrder[]) => buildReconciliation({ orders, sellers: SELLERS, items: ITEMS, sale: SALE, nowMs: NOW });
const lily = (orders: AdminOrder[]) => build(orders).sections.find((s) => s.personId === LILY)!;

describe('buildReconciliation per-line math', () => {
  it('Line_ShowsListPricePaidCostAndGrossProfit', () => {
    const l = lily([order()]).orders[0].lines[0];
    expect([l.listPrice, l.paid, l.cost, l.profit]).toEqual([56, 52, 32.14, 19.86]);
  });

  it('Line_SplitsProfitByTheSaleScoutShare', () => {
    const l = lily([order()]).orders[0].lines[0];
    expect([l.scoutPct, l.scout, l.troopPct, l.troop]).toEqual([30, 5.96, 70, 13.9]);
  });

  it('Lines_AddUpToTheScoutsRoundedShare_ToTheCent', () => {
    // Three lines of 1 × $0.05 profit: 30% each is 1.5¢; rounded once on the whole it's 5¢ (round(15 × 0.3) = 5 → 4.5 → 5).
    const tiny = { itemId: 2, label: 'Bow', catalogNumber: 2, quantity: 1, donated: false, amount: 1, unitPrice: 1, unitCost: 0.95 };
    const s = lily([order({ lines: [tiny, tiny, tiny], itemsSubtotal: 3, total: 3 })]);
    expect(s.orders[0].lines.reduce((c, l) => c + Math.round(l.scout * 100), 0)).toBe(Math.round(s.totals.scout * 100));
  });
});

describe('buildReconciliation donations and fees', () => {
  it('Donation_NetOfItsCardFeeShare_SplitByTheDonationShare', () => {
    // $52 wreaths + $48 gift = $100 by card, fee $3.20 → the gift's share is $1.54, net $46.46, scout 15% = $6.97.
    const d = lily([paid('card', { gift: 48, total: 100, paidAmount: 100, stripeFee: 3.2 })]).orders[0].donation!;
    expect([d.gift, d.cardFee, d.net, d.scoutPct, d.scout, d.troop]).toEqual([48, 1.54, 46.46, 15, 6.97, 39.49]);
  });

  it('CardFee_IsSplitBetweenWreathsAndDonation', () => {
    const o = lily([paid('card', { gift: 48, total: 100, paidAmount: 100, stripeFee: 3.2 })]).orders[0];
    expect(o.cardFee).toEqual({ total: 3.2, wreaths: 1.66, donation: 1.54 });
  });

  it('ShortPayment_DonationAbsorbsItFirst_ThenTheTroopTakesTheRest', () => {
    // $52 wreaths + $5 gift = $57, $50 came in: the gift goes to $0, $2 comes off the troop's wreath profit.
    const o = lily([paid('venmo', { gift: 5, total: 57, paidAmount: 50 })]).orders[0];
    expect([o.donation!.shortAbsorbed, o.donation!.net, o.shortOnWreaths, o.received, o.difference]).toEqual([5, 0, 2, 50, '$7 short']);
  });

  it('ShortPayment_TroopTotalDropsByShortOnWreaths_ScoutShareUnchanged', () => {
    const o = lily([paid('venmo', { total: 52, paidAmount: 50 })]).orders[0];
    expect([o.scout, o.troop]).toEqual([5.96, 11.9]);
  });

  it('DeliveryFee_IsShownOnTheOrder_AndKeptOutOfTheSplit', () => {
    const s = lily([order({ fulfillment: 'delivery', deliveryFee: 10, total: 62 })]);
    expect([s.orders[0].deliveryFee, Math.round((s.orders[0].scout + s.orders[0].troop) * 100) / 100, s.totals.deliveryFees, s.totals.grandTotal]).toEqual([10, 19.86, 10, 62]);
  });
});

describe('buildReconciliation sections and counting', () => {
  it('Unassigned_OrdersGoToTheirOwnSection_LastAndAtZeroScoutShare', () => {
    const r = build([order(), order({ creditedPersonId: null, creditedName: 'Troop store' })]);
    const last = r.sections.at(-1)!;
    expect([last.name, last.personId, last.totals.scout, last.orders[0].lines[0].troopPct]).toEqual(['Unassigned', null, 0, 100]);
  });

  it('CancelledAndRefunded_AreListed_ButCountInNothing', () => {
    const s = lily([order(), order({ status: 'cancelled' }), paid('card', { paymentStatus: 'refunded' })]);
    expect([s.orders.length, s.totals.orders, s.totals.notCounted, s.orders.filter((o) => !o.counted).map((o) => o.notCountedReason)]).toEqual([3, 1, 2, ['Cancelled', 'Refunded']]);
  });

  it('PaidAndPledged_AreTotalledApart', () => {
    const t = lily([order(), paid('cash')]).totals;
    expect([t.paidOrders, t.unpaidOrders, t.collected, t.owed]).toEqual([1, 1, 52, 52]);
  });
});

describe('buildReconciliation balances with the sales dashboard', () => {
  const FIXTURE = [
    order(),
    paid('venmo', { gift: 5, total: 57, paidAmount: 50 }),
    paid('card', { gift: 48, total: 100, paidAmount: 100, stripeFee: 3.2 }),
    order({ creditedPersonId: BEN, creditedName: 'Ben B', fulfillment: 'delivery', deliveryFee: 10, total: 62 }),
    order({ creditedPersonId: null, creditedName: 'Troop store', gift: 25, total: 77 }),
    paid('card', { creditedPersonId: BEN, creditedName: 'Ben B', feeCovered: 1.92, total: 53.92, paidAmount: 53.92, stripeFee: 1.86 }),
    order({ status: 'cancelled' }),
    paid('cash', { total: 52, paidAmount: 60 })
  ];

  it('Totals_EqualTheDashboards_ForTheSameOrders', () => {
    const r = build(FIXTURE);
    const d = buildSalesDashboard({ orders: FIXTURE, sellers: SELLERS, sale: SALE, nowMs: NOW }).totals;
    const t = r.totals;
    expect([t.orders, t.sales, t.profit, t.gifts, t.donationsNet, t.deliveryFees, t.cardFees, t.grandTotal, t.collected, t.owed, t.scout, t.troop]).toEqual([
      d.orders, d.sales, d.profit, d.gifts, d.donationsNet, d.deliveryFees, d.cardFees, d.grandTotal, d.collected, d.owed, d.scoutShare, d.troopShare
    ]);
  });

  it('Check_ReportsBalanced_WhenEveryFigureAgrees', () => {
    expect(build(FIXTURE).check).toEqual({ ok: true, mismatches: [] });
  });

  it('Settings_CarryTheSalesShares_AndCardFeeFormula', () => {
    expect(build([]).settings).toEqual({ scoutPct: 30, donationPct: 15, feePercent: 2.9, feeFixed: 0.3 });
  });
});

describe('buildReconciliation payload scope', () => {
  it('ScoutOnlyInput_HoldsNoOtherScoutsOrders', () => {
    // The family statement builds from the scout's own credited orders only (lib/wreaths/statement).
    const mine = [order(), paid('cash')];
    const r = build(mine);
    expect([r.sections.map((s) => s.personId), r.sections.flatMap((s) => s.orders.map((o) => o.customerName))]).toEqual([[LILY], mine.map((o) => o.customerName)]);
  });

  it('Payload_CarriesNoCustomerAddress', () => {
    expect(JSON.stringify(build([order()]))).not.toContain('1 Test St');
  });

  it('Csv_HasOneRowPerLineDonationFeeAndDelivery', () => {
    const csv = reconciliationCsv(build([paid('card', { gift: 48, total: 110, paidAmount: 110, stripeFee: 3.5, fulfillment: 'delivery', deliveryFee: 10 })]).sections);
    expect(csv.trim().split('\n').map((l) => l.split(',')[4])).toEqual(['Row', '20″ Wreath', 'Donation (net)', 'Card fee', 'Delivery fee (troop)']);
  });
});
