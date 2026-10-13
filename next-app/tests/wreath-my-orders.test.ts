import { describe, it, expect } from 'vitest';
import { buildSellerView, isScoutDelivery, toMyOrder } from '../src/lib/wreaths/my-orders';
import type { AdminOrder } from '../src/lib/wreaths/admin-data';

/** "My wreath orders" — the pure half: what counts, what is delivered by the scout, what they earn. No database. */
const ME = 100;
const SIBLING = 200;

let n = 0;
function order(over: Partial<AdminOrder> = {}): AdminOrder {
  n += 1;
  return {
    id: n,
    orderNumber: `W-${1000 + n}`,
    placedAt: `2026-10-${String(10 + n).padStart(2, '0')}T15:00:00.000Z`,
    round: 1,
    source: 'scout_link',
    fulfillment: 'pickup',
    creditedPersonId: ME,
    creditedName: 'Me',
    deliveringPersonId: null,
    customerName: `Customer ${n}`,
    customerEmail: `c${n}@example.test`,
    customerPhone: '414-555-0100',
    customerAddress: '1 Main St',
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
    lines: [{ label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16.07 }],
    ...over
  };
}

describe('MyWreathOrders', () => {
  it('MyWreathOrders_ShowsOnlyOwnScoutsOrders_WhenTwoSellersShareTheData', () => {
    const mine = order();
    const theirs = order({ creditedPersonId: SIBLING });
    const view = buildSellerView(ME, 'Me', [mine, theirs], 0.3);
    expect(view.orders.map((o) => o.id)).toEqual([mine.id]);
  });

  it('MyWreathOrders_OmitsTroopCreditedOrders', () => {
    const troop = order({ creditedPersonId: null });
    expect(buildSellerView(ME, 'Me', [troop], 0.3).orders).toEqual([]);
  });

  it('MyWreathOrders_ExcludesCancelledFromTotals_ButListsThemMarkedCancelled', () => {
    const live = order({ itemsSubtotal: 52, total: 52 });
    const dead = order({ status: 'cancelled', itemsSubtotal: 100, total: 100 });
    const view = buildSellerView(ME, 'Me', [live, dead], 0.3);
    expect(view.summary.orders).toBe(1);
    expect(view.summary.sold).toBe(52);
    expect(view.orders.find((o) => o.id === dead.id)?.status).toBe('cancelled');
  });

  it('MyWreathOrders_SplitsPaidFromOwed_UsingOrderTotals', () => {
    const paid = order({ paymentStatus: 'paid', total: 52 });
    const owed = order({ total: 31 });
    const { summary } = buildSellerView(ME, 'Me', [paid, owed], 0.3);
    expect([summary.paid, summary.owed]).toEqual([52, 31]);
  });

  it('MyWreathOrders_CountsEveryWreath_IncludingDonated', () => {
    const o = order({
      lines: [
        { label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16.07 },
        { label: '20″ Wreath', catalogNumber: 1, quantity: 1, donated: true, amount: 26, unitPrice: 26, unitCost: 16.07 }
      ]
    });
    expect(buildSellerView(ME, 'Me', [o], 0.3).summary.items).toBe(3);
  });

  it('MyWreathOrders_EarnsShareOfProfit_NotOfSales_AndIgnoresGiftsAndFees', () => {
    const o = order({ gift: 20, deliveryFee: 5, feeCovered: 2, total: 79 });
    // profit = 2 x (26 - 16.07) = 19.86; 30% = 5.958 -> 5.96
    expect(buildSellerView(ME, 'Me', [o], 0.3).summary.earnings).toBe(5.96);
  });

  it('MyWreathOrders_EarningsSoFar_ExcludeCancelled_AndSplitOutThePaidPart', () => {
    const paid = order({ paymentStatus: 'paid' });
    const unpaid = order();
    const dead = order({ status: 'cancelled' });
    const { summary } = buildSellerView(ME, 'Me', [paid, unpaid, dead], 0.3);
    expect(summary.earnings).toBe(11.92);
    expect(summary.earningsOnPaid).toBe(5.96);
  });

  it('MyWreathOrders_ListsNewestFirst', () => {
    const a = order({ placedAt: '2026-10-11T00:00:00.000Z' });
    const b = order({ placedAt: '2026-10-12T00:00:00.000Z' });
    expect(buildSellerView(ME, 'Me', [a, b], 0.3).orders.map((o) => o.id)).toEqual([b.id, a.id]);
  });
});

describe('Delivery list', () => {
  const scoutDelivery = (over: Partial<AdminOrder> = {}) => order({ fulfillment: 'scout', deliveringPersonId: ME, ...over });

  it('DeliveryList_HoldsOnlyOrdersThisScoutDelivers', () => {
    const mine = scoutDelivery();
    const pickup = order({ fulfillment: 'pickup' });
    const troopDelivers = order({ fulfillment: 'delivery' });
    const siblingDelivers = scoutDelivery({ deliveringPersonId: SIBLING });
    const view = buildSellerView(ME, 'Me', [mine, pickup, troopDelivers, siblingDelivers], 0.3);
    expect(view.deliveries.map((o) => o.id)).toEqual([mine.id]);
  });

  it('DeliveryList_IncludesAnOrderCreditedElsewhere_WhenThisScoutDelivers', () => {
    const o = scoutDelivery({ creditedPersonId: null });
    const view = buildSellerView(ME, 'Me', [o], 0.3);
    expect(view.deliveries.map((d) => d.id)).toEqual([o.id]);
    expect(view.orders).toEqual([]);
  });

  it('DeliveryList_LeavesOutDonatedToVeteransLines_AndAnOrderThatIsAllDonated', () => {
    const mixed = scoutDelivery({
      lines: [
        { label: '20″ Wreath', catalogNumber: 1, quantity: 1, donated: false, amount: 26, unitPrice: 26, unitCost: 16.07 },
        { label: '26″ Wreath', catalogNumber: 2, quantity: 3, donated: true, amount: 96, unitPrice: 32, unitCost: 18.24 }
      ]
    });
    const allDonated = scoutDelivery({
      fulfillment: 'none',
      lines: [{ label: '20″ Wreath', catalogNumber: 1, quantity: 1, donated: true, amount: 26, unitPrice: 26, unitCost: 16.07 }]
    });
    const view = buildSellerView(ME, 'Me', [mixed, allDonated], 0.3);
    expect(view.deliveries).toHaveLength(1);
    expect(view.deliveries[0].lines.filter((l) => !l.donated)).toHaveLength(1);
    expect(view.deliveries[0].deliverLines).toEqual([{ label: '20″ Wreath', quantity: 1 }]);
  });

  it('DeliveryList_SkipsCancelledOrders', () => {
    expect(buildSellerView(ME, 'Me', [scoutDelivery({ status: 'cancelled' })], 0.3).deliveries).toEqual([]);
  });

  it('DeliveryList_ShowsAddressAndPhone_OnlyOnRowsThisScoutDelivers', () => {
    const delivered = scoutDelivery();
    const pickup = order({ fulfillment: 'pickup' });
    const view = buildSellerView(ME, 'Me', [delivered, pickup], 0.3);
    expect(view.deliveries[0].contact).toMatchObject({ address: '1 Main St', phone: '414-555-0100' });
    expect(view.orders.find((o) => o.id === pickup.id)?.contact).toBeNull();
  });

  it('DeliveryList_AmountOwed_IsZeroWhenPaid_AndTheTotalWhenNot', () => {
    const paid = scoutDelivery({ paymentStatus: 'paid', total: 52 });
    const owed = scoutDelivery({ total: 31 });
    const view = buildSellerView(ME, 'Me', [paid, owed], 0.3);
    expect(view.deliveries.map((d) => d.owed).sort()).toEqual([0, 31]);
  });

  it('IsScoutDelivery_RequiresPlacedScoutFulfillmentAndThisDeliverer', () => {
    const o = toMyOrder(order({ fulfillment: 'scout', deliveringPersonId: ME }), ME);
    expect(isScoutDelivery(o, ME)).toBe(true);
    expect(isScoutDelivery(o, SIBLING)).toBe(false);
  });
});
