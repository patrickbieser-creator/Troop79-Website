/**
 * "My wreath orders" (Members › Wreath sale) — what a scout's family sees about the orders credited to, or delivered
 * by, their scout. The pure half (buildSellerView and friends) takes the admin loader's orders and returns ONLY what
 * the family may see: a customer's address and phone ride on the rows the scout delivers themself and nowhere else
 * (Plans/Wreath-Sale.md, Technical Approach: contact details are seen only by the delivering scout's family and
 * leaders). Unit costs never leave this module; they only feed the earnings.
 *
 * Counting rules: a cancelled (or refunded) order is listed, muted, and counted in nothing. Donated wreaths are sales
 * (they count toward items, sold and earnings) but are never delivered, so they are left off the delivery list.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdminOrders, type AdminOrder } from './admin-data';
import { loadCurrentSale, type PublicSale } from './public';
import { orderProfit, scoutEarnings, toCents, fromCents } from './rules';

export interface MyOrderContact {
  phone: string;
  address: string;
  city: string;
  zip: string;
}

export interface MyOrder {
  id: number;
  orderNumber: string;
  placedAt: string;
  status: 'placed' | 'cancelled';
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  fulfillment: AdminOrder['fulfillment'];
  creditedPersonId: number | null;
  deliveringPersonId: number | null;
  customerName: string;
  itemsSubtotal: number;
  total: number;
  lines: { label: string; quantity: number; donated: boolean; amount: number }[];
  /** The wreaths the customer actually receives: donated lines are not delivered. */
  deliverLines: { label: string; quantity: number }[];
  /** Present only when THIS scout delivers the order. */
  contact: MyOrderContact | null;
  /** What the customer still owes: 0 once paid. */
  owed: number;
}

export interface SellerSummary {
  orders: number;
  items: number;
  sold: number;
  paid: number;
  owed: number;
  earnings: number;
  earningsOnPaid: number;
}

export interface SellerView {
  personId: number;
  name: string;
  /** Credited to this scout, newest first, cancelled ones included (marked). */
  orders: MyOrder[];
  /** The scout's distribution-day list: counted, scout-delivered by them, sorted by zip then street. */
  deliveries: MyOrder[];
  summary: SellerSummary;
}

/** Counts toward totals: placed and not refunded. */
export function isCounted(o: { status: string; paymentStatus: string }): boolean {
  return o.status === 'placed' && o.paymentStatus !== 'refunded';
}

/** On this scout's delivery list: a counted order they deliver, with at least one wreath that is not donated. */
export function isScoutDelivery(
  o: Pick<MyOrder, 'status' | 'paymentStatus' | 'fulfillment' | 'deliveringPersonId' | 'lines'>,
  personId: number
): boolean {
  return isCounted(o) && o.fulfillment === 'scout' && o.deliveringPersonId === personId && o.lines.some((l) => !l.donated);
}

/** The family-safe shape of an order, from one scout's point of view. */
export function toMyOrder(o: AdminOrder, personId: number): MyOrder {
  const delivers = o.fulfillment === 'scout' && o.deliveringPersonId === personId;
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    placedAt: o.placedAt,
    status: o.status,
    paymentStatus: o.paymentStatus,
    fulfillment: o.fulfillment,
    creditedPersonId: o.creditedPersonId,
    deliveringPersonId: o.deliveringPersonId,
    customerName: o.customerName,
    itemsSubtotal: o.itemsSubtotal,
    total: o.total,
    lines: o.lines.map((l) => ({ label: l.label, quantity: l.quantity, donated: l.donated, amount: l.amount })),
    deliverLines: o.lines.filter((l) => !l.donated).map((l) => ({ label: l.label, quantity: l.quantity })),
    contact: delivers ? { phone: o.customerPhone, address: o.customerAddress, city: o.customerCity, zip: o.customerZip } : null,
    owed: o.paymentStatus === 'paid' ? 0 : o.total
  };
}

const byNewest = (a: { placedAt: string; id: number }, b: { placedAt: string; id: number }) =>
  b.placedAt.localeCompare(a.placedAt) || b.id - a.id;

const sumDollars = (xs: number[]) => fromCents(xs.reduce((a, b) => a + toCents(b), 0));

export function buildSellerView(personId: number, name: string, orders: AdminOrder[], scoutShare: number): SellerView {
  const credited = orders.filter((o) => o.creditedPersonId === personId);
  const counted = credited.filter(isCounted);
  const paidOrders = counted.filter((o) => o.paymentStatus === 'paid');
  const unpaidOrders = counted.filter((o) => o.paymentStatus !== 'paid');
  const profitOf = (xs: AdminOrder[]) => orderProfit(xs.flatMap((o) => o.lines));

  const deliveries = orders
    .map((o) => toMyOrder(o, personId))
    .filter((o) => isScoutDelivery(o, personId))
    .sort((a, b) => a.contact!.zip.localeCompare(b.contact!.zip) || a.contact!.address.localeCompare(b.contact!.address) || a.id - b.id);

  return {
    personId,
    name,
    orders: credited.map((o) => toMyOrder(o, personId)).sort(byNewest),
    deliveries,
    summary: {
      orders: counted.length,
      items: counted.reduce((n, o) => n + o.lines.reduce((m, l) => m + l.quantity, 0), 0),
      sold: sumDollars(counted.map((o) => o.itemsSubtotal)),
      paid: sumDollars(paidOrders.map((o) => o.total)),
      owed: sumDollars(unpaidOrders.map((o) => o.total)),
      earnings: scoutEarnings(profitOf(counted), scoutShare),
      earningsOnPaid: scoutEarnings(profitOf(paidOrders), scoutShare)
    }
  };
}

export interface MyWreathOrders {
  sale: PublicSale | null;
  sellers: SellerView[];
}

/**
 * The wreath orders of the scouts among `personIds` (a family's scope) in the current sale: one SellerView per
 * wreath seller in that scope (`saleId` pins a sale; the default is the most recent year). A family with no seller gets an empty list. Service-role client; the caller has
 * already resolved who the viewer's family is.
 */
export async function loadMyWreathOrders(sb: SupabaseClient, personIds: number[], saleId?: number): Promise<MyWreathOrders> {
  const sale = await loadCurrentSale(sb, saleId);
  // A draft sale's orders are setup or test data; families see nothing until it opens.
  if (!sale || personIds.length === 0 || sale.status === 'draft') return { sale, sellers: [] };

  const { data } = await sb
    .from('wreath_sellers')
    .select('person_id, people:person_id(display_name)')
    .eq('sale_id', sale.id)
    .in('person_id', personIds);
  const rows = (data ?? []) as unknown as { person_id: number; people: { display_name: string } | { display_name: string }[] | null }[];
  if (rows.length === 0) return { sale, sellers: [] };

  const orders = await loadAdminOrders(sb, sale.id, { involving: rows.map((r) => r.person_id) });
  const nameOf = (r: (typeof rows)[number]) => (Array.isArray(r.people) ? r.people[0] : r.people)?.display_name ?? `Scout ${r.person_id}`;
  return {
    sale,
    sellers: rows.map((r) => buildSellerView(r.person_id, nameOf(r), orders, sale.scoutShare)).sort((a, b) => a.name.localeCompare(b.name))
  };
}
