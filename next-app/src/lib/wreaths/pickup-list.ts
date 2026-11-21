/**
 * Admin › Wreath Sale › Pickup list (Patrick, 2026-11-21 — distribution day): each scout's sheet lists EVERY order
 * credited to them, item by item, with a note on any order the scout isn't delivering (troop delivery, lot pickup,
 * another scout, donation) — scouts mixed those up, so the sheet shows the whole order and leaders sort it out by hand.
 * Then customer pickups at the lot, troop deliveries, and donated wreaths, by fulfillment, whoever is credited.
 * Pure: built from the admin order list, no database. Cancelled orders are left out everywhere; donated lines never
 * count toward a scout, pickup or delivery (they go to veterans) and are totalled on their own.
 */
import type { AdminOrder, AdminSeller } from './admin-data';

export interface PickupItem {
  catalogNumber: number;
  label: string;
  quantity: number;
}

export interface PickupOrder {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  address: string;
  items: PickupItem[];
  /** Donated wreaths on the order (they go to veterans, not to the customer). */
  donated: number;
  /** Still to collect on this order: 0 when paid or refunded. */
  due: number;
  note: string;
  /** On a scout's sheet: how the order goes out when the scout isn't delivering it; null when they are. */
  how: string | null;
}

export interface PickupScout {
  personId: number;
  name: string;
  items: PickupItem[];
  /** Donated wreaths across the scout's orders. */
  donated: number;
  orders: PickupOrder[];
  due: number;
}

export interface PickupTotal {
  catalogNumber: number;
  label: string;
  scouts: number;
  pickup: number;
  delivery: number;
  donated: number;
  total: number;
}

export interface PickupList {
  scouts: PickupScout[];
  lotPickups: PickupOrder[];
  troopDelivery: PickupOrder[];
  donated: PickupItem[];
  totals: PickupTotal[];
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

function sumItems(lines: { catalogNumber: number; label: string; quantity: number }[]): PickupItem[] {
  const m = new Map<number, PickupItem>();
  for (const l of lines) {
    const cur = m.get(l.catalogNumber);
    if (cur) cur.quantity += l.quantity;
    else m.set(l.catalogNumber, { catalogNumber: l.catalogNumber, label: l.label, quantity: l.quantity });
  }
  return [...m.values()].sort((a, b) => a.catalogNumber - b.catalogNumber);
}

function toPickupOrder(o: AdminOrder, how: string | null = null): PickupOrder {
  const cityZip = [o.customerCity, o.customerZip].filter(Boolean).join(' ');
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    address: [o.customerAddress, cityZip].filter(Boolean).join(', '),
    items: sumItems(o.lines.filter((l) => !l.donated)),
    donated: o.lines.filter((l) => l.donated).reduce((n, l) => n + l.quantity, 0),
    due: o.paymentStatus === 'unpaid' ? o.total : 0,
    note: o.customerNote,
    how
  };
}

/** How a credited order goes out, from its scout's point of view; null when the scout delivers it. */
function howFor(o: AdminOrder, names: Map<number, string>): string | null {
  if (!o.lines.some((l) => !l.donated)) return 'Donated to veterans';
  if (o.fulfillment === 'delivery') return 'The troop delivers this one';
  if (o.fulfillment === 'pickup') return 'Customer picks up at the lot';
  if (o.fulfillment === 'scout' && o.deliveringPersonId != null && o.deliveringPersonId !== o.creditedPersonId)
    return `${names.get(o.deliveringPersonId) ?? 'Another scout'} delivers this one`;
  return null;
}

export function buildPickupList({ orders, sellers }: { orders: AdminOrder[]; sellers: AdminSeller[] }): PickupList {
  const placed = orders.filter((o) => o.status === 'placed');
  const names = new Map(sellers.map((s) => [s.personId, s.name]));
  const hasItems = (o: AdminOrder) => o.lines.some((l) => !l.donated);

  const scoutMap = new Map<number, { name: string; orders: PickupOrder[] }>();
  for (const o of placed) {
    if (o.creditedPersonId == null) continue;
    const g = scoutMap.get(o.creditedPersonId) ?? { name: names.get(o.creditedPersonId) ?? o.creditedName, orders: [] };
    g.orders.push(toPickupOrder(o, howFor(o, names)));
    scoutMap.set(o.creditedPersonId, g);
  }
  const scouts: PickupScout[] = [...scoutMap.entries()]
    .map(([personId, g]) => {
      const list = g.orders.sort((a, b) => byName(a.customerName, b.customerName));
      return {
        personId,
        name: g.name,
        items: sumItems(list.flatMap((o) => o.items)),
        donated: list.reduce((n, o) => n + o.donated, 0),
        orders: list,
        due: list.reduce((n, o) => n + o.due, 0)
      };
    })
    .sort((a, b) => byName(a.name, b.name));

  const withItems = placed.filter(hasItems);
  const lotPickups = withItems.filter((o) => o.fulfillment === 'pickup').map((o) => toPickupOrder(o)).sort((a, b) => byName(a.customerName, b.customerName));
  const troopDelivery = withItems.filter((o) => o.fulfillment === 'delivery').map((o) => toPickupOrder(o)).sort((a, b) => byName(a.customerName, b.customerName));
  const scoutDelivered = withItems.filter((o) => o.fulfillment === 'scout').flatMap((o) => toPickupOrder(o).items);
  const donated = sumItems(placed.flatMap((o) => o.lines.filter((l) => l.donated)));

  const totals = new Map<number, PickupTotal>();
  const add = (items: PickupItem[], key: 'scouts' | 'pickup' | 'delivery' | 'donated') => {
    for (const i of items) {
      const t = totals.get(i.catalogNumber) ?? { catalogNumber: i.catalogNumber, label: i.label, scouts: 0, pickup: 0, delivery: 0, donated: 0, total: 0 };
      t[key] += i.quantity;
      t.total += i.quantity;
      totals.set(i.catalogNumber, t);
    }
  };
  add(scoutDelivered, 'scouts');
  add(lotPickups.flatMap((o) => o.items), 'pickup');
  add(troopDelivery.flatMap((o) => o.items), 'delivery');
  add(donated, 'donated');

  return { scouts, lotPickups, troopDelivery, donated, totals: [...totals.values()].sort((a, b) => a.catalogNumber - b.catalogNumber) };
}
