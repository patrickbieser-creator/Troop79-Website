import { describe, it, expect } from 'vitest';
import { buildPickupList } from '../src/lib/wreaths/pickup-list';
import type { AdminOrder, AdminOrderLine, AdminSeller } from '../src/lib/wreaths/admin-data';

/** Admin › Wreath Sale › Pickup list — the pure rollup behind it (Patrick, 2026-11-21, pickup day). No database. */
const ANNA = 100;
const BEN = 200;

let n = 0;
function line(catalogNumber: number, quantity: number, over: Partial<AdminOrderLine> = {}): AdminOrderLine {
  return { itemId: catalogNumber, label: `Item ${catalogNumber}`, catalogNumber, quantity, donated: false, amount: quantity * 26, unitPrice: 26, unitCost: 16, ...over };
}
function order(over: Partial<AdminOrder> = {}): AdminOrder {
  n += 1;
  return {
    id: n,
    orderNumber: `W-${1000 + n}`,
    placedAt: '2026-10-13T15:00:00.000Z',
    round: 1,
    source: 'scout_link',
    fulfillment: 'scout',
    creditedPersonId: ANNA,
    creditedName: 'Anna Able',
    deliveringPersonId: ANNA,
    customerName: `Customer ${n}`,
    customerEmail: '',
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
    paymentStatus: 'paid',
    paidMethod: 'venmo',
    paidAt: '2026-10-14T15:00:00.000Z',
    paidAmount: 52,
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
    lines: [line(1, 2)],
    ...over
  };
}
function seller(personId: number, name: string): AdminSeller {
  return { id: personId, personId, name, slug: null, active: true, orders: 0, goal: null, deliveryMessage: null };
}
const SELLERS = [seller(ANNA, 'Anna Able'), seller(BEN, 'Ben Baker')];

describe('buildPickupList — scouts', () => {
  it('totals each item a scout hands out across their orders', () => {
    const p = buildPickupList({ orders: [order({ lines: [line(1, 2)] }), order({ lines: [line(1, 1), line(3, 4)] })], sellers: SELLERS });
    expect(p.scouts[0].items).toEqual([
      { catalogNumber: 1, label: 'Item 1', quantity: 3 },
      { catalogNumber: 3, label: 'Item 3', quantity: 4 }
    ]);
  });

  it('groups by the credited scout, whoever delivers', () => {
    const p = buildPickupList({ orders: [order({ creditedPersonId: ANNA, deliveringPersonId: BEN })], sellers: SELLERS });
    expect(p.scouts.map((s) => s.name)).toEqual(['Anna Able']);
  });

  it('puts a troop-delivery order on the credited scout’s sheet', () => {
    const p = buildPickupList({ orders: [order({ fulfillment: 'delivery', deliveringPersonId: null })], sellers: SELLERS });
    expect(p.scouts[0].orders).toHaveLength(1);
  });

  it('counts a troop-delivery order in the scout’s items', () => {
    const p = buildPickupList({ orders: [order({ lines: [line(1, 1)] }), order({ fulfillment: 'delivery', deliveringPersonId: null, lines: [line(1, 2)] })], sellers: SELLERS });
    expect(p.scouts[0].items).toEqual([{ catalogNumber: 1, label: 'Item 1', quantity: 3 }]);
  });

  it('notes how an order is delivered when the scout isn’t delivering it', () => {
    const p = buildPickupList({
      orders: [
        order({ customerName: 'A', fulfillment: 'delivery', deliveringPersonId: null }),
        order({ customerName: 'B', fulfillment: 'pickup', deliveringPersonId: null }),
        order({ customerName: 'C', deliveringPersonId: BEN }),
        order({ customerName: 'D' })
      ],
      sellers: SELLERS
    });
    expect(p.scouts[0].orders.map((o) => o.how)).toEqual(['The troop delivers this one', 'Customer picks up at the lot', 'Ben Baker delivers this one', null]);
  });

  it('leaves orders with no scout credit off every scout sheet', () => {
    const p = buildPickupList({ orders: [order({ fulfillment: 'pickup', creditedPersonId: null, deliveringPersonId: null })], sellers: SELLERS });
    expect(p.scouts).toEqual([]);
  });

  it('lists scouts by name', () => {
    const p = buildPickupList({ orders: [order({ creditedPersonId: BEN, deliveringPersonId: BEN }), order()], sellers: SELLERS });
    expect(p.scouts.map((s) => s.name)).toEqual(['Anna Able', 'Ben Baker']);
  });

  it('leaves cancelled orders out', () => {
    const p = buildPickupList({ orders: [order({ status: 'cancelled' })], sellers: SELLERS });
    expect(p.scouts).toEqual([]);
  });

  it('keeps donated wreaths out of the scout’s count', () => {
    const p = buildPickupList({ orders: [order({ lines: [line(1, 2), line(1, 5, { donated: true })] })], sellers: SELLERS });
    expect(p.scouts[0].items).toEqual([{ catalogNumber: 1, label: 'Item 1', quantity: 2 }]);
  });

  it('keeps a donation-only order on the scout’s sheet, marked as donated', () => {
    const p = buildPickupList({ orders: [order({ fulfillment: 'none', deliveringPersonId: null, lines: [line(1, 5, { donated: true })] })], sellers: SELLERS });
    expect(p.scouts[0].orders[0]).toMatchObject({ items: [], donated: 5, how: 'Donated to veterans' });
  });

  it('totals the donated wreaths a scout sold', () => {
    const p = buildPickupList({ orders: [order({ lines: [line(1, 2), line(1, 3, { donated: true })] }), order({ lines: [line(2, 1, { donated: true })] })], sellers: SELLERS });
    expect(p.scouts[0].donated).toBe(4);
  });

  it('lists each order under the scout with customer, items and what is still owed', () => {
    const o = order({ customerName: 'Jane Doe', paymentStatus: 'unpaid', paidAmount: null, paidMethod: null, paidAt: null, total: 78, lines: [line(2, 3)] });
    const p = buildPickupList({ orders: [o], sellers: SELLERS });
    expect(p.scouts[0].orders[0]).toMatchObject({ orderNumber: o.orderNumber, customerName: 'Jane Doe', due: 78, items: [{ catalogNumber: 2, label: 'Item 2', quantity: 3 }] });
  });

  it('owes nothing on a paid order', () => {
    const p = buildPickupList({ orders: [order()], sellers: SELLERS });
    expect(p.scouts[0].orders[0].due).toBe(0);
  });

  it('totals what a scout still has to collect', () => {
    const unpaid = { paymentStatus: 'unpaid' as const, paidAmount: null, paidMethod: null, paidAt: null };
    const p = buildPickupList({ orders: [order({ ...unpaid, total: 52 }), order({ ...unpaid, total: 26 }), order()], sellers: SELLERS });
    expect(p.scouts[0].due).toBe(78);
  });

  it('falls back to the credited name when the scout is not a seller', () => {
    const p = buildPickupList({ orders: [order({ creditedPersonId: 999, deliveringPersonId: 999, creditedName: 'Old Scout' })], sellers: SELLERS });
    expect(p.scouts[0].name).toBe('Old Scout');
  });
});

describe('buildPickupList — lot pickups and troop delivery', () => {
  it('puts customer pickups at the lot in their own list', () => {
    const p = buildPickupList({ orders: [order({ fulfillment: 'pickup', deliveringPersonId: null, customerName: 'Pat Pickup' })], sellers: SELLERS });
    expect(p.lotPickups.map((o) => o.customerName)).toEqual(['Pat Pickup']);
  });

  it('puts troop deliveries in their own list with the address', () => {
    const o = order({ fulfillment: 'delivery', deliveringPersonId: null, customerAddress: '1 Main St', customerCity: 'Milwaukee', customerZip: '53211' });
    const p = buildPickupList({ orders: [o], sellers: SELLERS });
    expect(p.troopDelivery[0].address).toBe('1 Main St, Milwaukee 53211');
  });

  it('keeps scout-credited pickups and deliveries on the troop lists too', () => {
    const p = buildPickupList({ orders: [order({ fulfillment: 'pickup' }), order({ fulfillment: 'delivery' })], sellers: SELLERS });
    expect([p.lotPickups.length, p.troopDelivery.length]).toEqual([1, 1]);
  });

  it('lists pickups by customer name', () => {
    const p = buildPickupList({ orders: [order({ fulfillment: 'pickup', customerName: 'Zed' }), order({ fulfillment: 'pickup', customerName: 'Amy' })], sellers: SELLERS });
    expect(p.lotPickups.map((o) => o.customerName)).toEqual(['Amy', 'Zed']);
  });
});

describe('buildPickupList — donated and totals', () => {
  it('totals donated wreaths by item across every kind of order', () => {
    const p = buildPickupList({
      orders: [order({ lines: [line(1, 2, { donated: true })] }), order({ fulfillment: 'none', deliveringPersonId: null, lines: [line(1, 3, { donated: true }), line(4, 1, { donated: true })] })],
      sellers: SELLERS
    });
    expect(p.donated).toEqual([
      { catalogNumber: 1, label: 'Item 1', quantity: 5 },
      { catalogNumber: 4, label: 'Item 4', quantity: 1 }
    ]);
  });

  it('sums every item across scouts, pickups, deliveries and donations', () => {
    const p = buildPickupList({
      orders: [
        order({ lines: [line(1, 2), line(1, 1, { donated: true })] }),
        order({ fulfillment: 'pickup', lines: [line(1, 4)] }),
        order({ fulfillment: 'delivery', lines: [line(1, 8)] })
      ],
      sellers: SELLERS
    });
    expect(p.totals).toEqual([{ catalogNumber: 1, label: 'Item 1', scouts: 2, pickup: 4, delivery: 8, donated: 1, total: 15 }]);
  });
});
