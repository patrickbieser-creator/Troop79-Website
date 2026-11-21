/**
 * Admin › Wreath Sale › Pickup list (Patrick, 2026-11-21 — distribution day): what each scout takes home to deliver,
 * item by item, with their orders underneath; then customer pickups at the lot, troop deliveries, and donated wreaths.
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
  /** Still to collect on this order: 0 when paid or refunded. */
  due: number;
  note: string;
}

export interface PickupScout {
  personId: number;
  name: string;
  items: PickupItem[];
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

function toPickupOrder(o: AdminOrder): PickupOrder {
  const cityZip = [o.customerCity, o.customerZip].filter(Boolean).join(' ');
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    address: [o.customerAddress, cityZip].filter(Boolean).join(', '),
    items: sumItems(o.lines.filter((l) => !l.donated)),
    due: o.paymentStatus === 'unpaid' ? o.total : 0,
    note: o.customerNote
  };
}

export function buildPickupList({ orders, sellers }: { orders: AdminOrder[]; sellers: AdminSeller[] }): PickupList {
  const placed = orders.filter((o) => o.status === 'placed');
  const sellerName = new Map(sellers.map((s) => [s.personId, s.name]));

  const scoutMap = new Map<number, { name: string; orders: AdminOrder[] }>();
  const lot: AdminOrder[] = [];
  const troop: AdminOrder[] = [];
  for (const o of placed) {
    if (!o.lines.some((l) => !l.donated)) continue;
    if (o.fulfillment === 'scout' && o.deliveringPersonId != null) {
      const g = scoutMap.get(o.deliveringPersonId) ?? { name: sellerName.get(o.deliveringPersonId) ?? o.creditedName, orders: [] };
      g.orders.push(o);
      scoutMap.set(o.deliveringPersonId, g);
    } else if (o.fulfillment === 'pickup') lot.push(o);
    else if (o.fulfillment === 'delivery') troop.push(o);
  }

  const scouts: PickupScout[] = [...scoutMap.entries()]
    .map(([personId, g]) => {
      const list = g.orders.map(toPickupOrder).sort((a, b) => byName(a.customerName, b.customerName));
      return { personId, name: g.name, items: sumItems(list.flatMap((o) => o.items)), orders: list, due: list.reduce((n, o) => n + o.due, 0) };
    })
    .sort((a, b) => byName(a.name, b.name));

  const lotPickups = lot.map(toPickupOrder).sort((a, b) => byName(a.customerName, b.customerName));
  const troopDelivery = troop.map(toPickupOrder).sort((a, b) => byName(a.customerName, b.customerName));
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
  add(scouts.flatMap((s) => s.items), 'scouts');
  add(lotPickups.flatMap((o) => o.items), 'pickup');
  add(troopDelivery.flatMap((o) => o.items), 'delivery');
  add(donated, 'donated');

  return { scouts, lotPickups, troopDelivery, donated, totals: [...totals.values()].sort((a, b) => a.catalogNumber - b.catalogNumber) };
}
