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
import { loadCurrentSale, loadStoreItems, type PublicSale, type StoreItem } from './public';
import { paymentDifferenceText, sellerEarnings, toCents, fromCents, type ScoutShares } from './rules';

/** Lives in rules.ts so client components can use it (this module reaches server-only code). */
export { orderItemsText } from './rules';
import { goalProgress, lockReason, type GoalProgress, type LockSale } from './scout-entry';

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
  /** The order's cash donation (W-3); 0 = none. */
  gift: number;
  total: number;
  lines: { label: string; quantity: number; donated: boolean; amount: number }[];
  /** The wreaths the customer actually receives: donated lines are not delivered. */
  deliverLines: { label: string; quantity: number }[];
  /** Present only when THIS scout delivers the order. */
  contact: MyOrderContact | null;
  /** What the customer still owes: 0 once paid. */
  owed: number;
  /** The customer opened card payment and left without paying (online orders; see AdminOrder.cardStarted). */
  cardUnfinished: boolean;
  source: AdminOrder['source'];
  /** Scout-entered ("paper") orders only: who typed it in, whether the scout holds the money, and the notes. */
  enteredByName: string | null;
  collectedByScout: boolean;
  paymentNote: string;
  /**
   * What the family typed, for the edit form. Present only on a scout-entered order (the family's own entry, so its
   * email and phone are theirs to see); null on every online order.
   */
  entry: { email: string; phone: string; note: string; gift: number; lines: { itemId: number; quantity: number; donated: boolean }[] } | null;
  /** Why the family can no longer change this scout-entered order (Paid, past ITS round's cutoff, Cancelled); null = editable. */
  lock: string | null;
  /** The troop-only order note (W-1), on every order: the family and the treasurer share it. '' = none. */
  orderNote: string;
  orderNoteBy: string | null;
  orderNoteAt: string | null;
  /** Paid by hand for more or less than the total: "$5 short" / "$10 over" (W-2); null otherwise. */
  paidDifference: string | null;
}

export interface SellerSummary {
  orders: number;
  items: number;
  sold: number;
  /** Cash donations on the scout's counted orders (W-3). */
  donations: number;
  paid: number;
  owed: number;
  earnings: number;
  earningsOnPaid: number;
  /** Scout-entered orders (source paper) the troop hasn't marked paid: not yet collected / collected, to turn in. */
  toCollect: number;
  toTurnIn: number;
  hasScoutEntered: boolean;
}

export interface SellerView {
  personId: number;
  name: string;
  /** The scout's own link slug and goal in this sale (null = none). */
  slug: string | null;
  goal: number | null;
  /** The scout's delivery message (replaces the standard line on their public page); null = none. */
  deliveryMessage: string | null;
  /** The goal thermometer's numbers, or null when no goal is set. Items sold = summary.items (live orders only). */
  goalProgress: GoalProgress | null;
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
export function toMyOrder(o: AdminOrder, personId: number, lockCtx?: LockContext): MyOrder {
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
    gift: o.gift,
    total: o.total,
    lines: o.lines.map((l) => ({ label: l.label, quantity: l.quantity, donated: l.donated, amount: l.amount })),
    deliverLines: o.lines.filter((l) => !l.donated).map((l) => ({ label: l.label, quantity: l.quantity })),
    contact: delivers ? { phone: o.customerPhone, address: o.customerAddress, city: o.customerCity, zip: o.customerZip } : null,
    owed: o.paymentStatus === 'paid' ? 0 : o.total,
    cardUnfinished: o.cardStarted && o.status === 'placed' && o.paymentStatus === 'unpaid',
    source: o.source,
    enteredByName: o.source === 'paper' ? o.enteredByName : null,
    collectedByScout: o.source === 'paper' && o.collectedByScout,
    paymentNote: o.source === 'paper' ? o.paymentNote : '',
    entry:
      o.source === 'paper'
        ? { email: o.customerEmail, phone: o.customerPhone, note: o.customerNote, gift: o.gift, lines: o.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, donated: l.donated })) }
        : null,
    // Without a sale and a clock to judge by, nothing is editable.
    lock: o.source !== 'paper' ? null : lockCtx ? lockReason({ status: o.status, paymentStatus: o.paymentStatus, round: o.round }, lockCtx.sale, lockCtx.nowMs) : 'Locked.',
    orderNote: o.orderNote,
    orderNoteBy: o.orderNote ? o.orderNoteBy : null,
    orderNoteAt: o.orderNote ? o.orderNoteAt : null,
    paidDifference: paymentDifferenceText(o)
  };
}

/** The sale's cutoffs and the clock, so each scout-entered order can say whether it is still editable. */
export interface LockContext {
  sale: LockSale;
  nowMs: number;
}

const byNewest = (a: { placedAt: string; id: number }, b: { placedAt: string; id: number }) =>
  b.placedAt.localeCompare(a.placedAt) || b.id - a.id;

const sumDollars = (xs: number[]) => fromCents(xs.reduce((a, b) => a + toCents(b), 0));

export function buildSellerView(
  personId: number,
  name: string,
  orders: AdminOrder[],
  /** The profit share, or both shares (W-3: plus the share of cash donations). A bare number counts no donation share. */
  scoutShare: number | ScoutShares,
  extra: { slug?: string | null; goal?: number | null; deliveryMessage?: string | null; lock?: LockContext } = {}
): SellerView {
  const credited = orders.filter((o) => o.creditedPersonId === personId);
  const counted = credited.filter(isCounted);
  const paidOrders = counted.filter((o) => o.paymentStatus === 'paid');
  const unpaidOrders = counted.filter((o) => o.paymentStatus !== 'paid');
  const shares: ScoutShares = typeof scoutShare === 'number' ? { profit: scoutShare, donation: 0 } : scoutShare;
  const scoutHeld = unpaidOrders.filter((o) => o.source === 'paper');

  const deliveries = orders
    .map((o) => toMyOrder(o, personId, extra.lock))
    .filter((o) => isScoutDelivery(o, personId))
    .sort((a, b) => a.contact!.zip.localeCompare(b.contact!.zip) || a.contact!.address.localeCompare(b.contact!.address) || a.id - b.id);

  const summary: SellerSummary = {
      orders: counted.length,
      items: counted.reduce((n, o) => n + o.lines.reduce((m, l) => m + l.quantity, 0), 0),
      sold: sumDollars(counted.map((o) => o.itemsSubtotal)),
      donations: sumDollars(counted.map((o) => o.gift)),
      // What actually came in: an order accepted a little short counts what arrived (as the admin dashboard does).
      paid: sumDollars(paidOrders.map((o) => o.paidAmount ?? o.total)),
      owed: sumDollars(unpaidOrders.map((o) => o.total)),
      earnings: sellerEarnings(counted, shares),
      earningsOnPaid: sellerEarnings(paidOrders, shares),
      toCollect: sumDollars(scoutHeld.filter((o) => !o.collectedByScout).map((o) => o.total)),
      toTurnIn: sumDollars(scoutHeld.filter((o) => o.collectedByScout).map((o) => o.total)),
      hasScoutEntered: counted.some((o) => o.source === 'paper')
  };
  const goal = extra.goal ?? null;
  return {
    personId,
    name,
    slug: extra.slug ?? null,
    goal,
    deliveryMessage: extra.deliveryMessage ?? null,
    goalProgress: goalProgress(goal, summary.items, name.split(' ')[0]),
    orders: credited.map((o) => toMyOrder(o, personId, extra.lock)).sort(byNewest),
    deliveries,
    summary
  };
}

export interface MyWreathOrders {
  sale: PublicSale | null;
  sellers: SellerView[];
  /** The sale's active items, for the edit form's "add an item" list. */
  items: StoreItem[];
}

/**
 * The scouts a super user (W-4) typed paper orders in for, in the current sale (`saleId` pins one): added to their own
 * family on My wreath orders so they can change or cancel those orders as a family would. Credited ids only.
 */
export async function scoutsEnteredBy(sb: SupabaseClient, personId: number, saleId?: number): Promise<number[]> {
  const sale = await loadCurrentSale(sb, saleId);
  if (!sale) return [];
  const { data } = await sb.from('wreath_orders').select('credited_person_id').eq('sale_id', sale.id).eq('source', 'paper').eq('entered_by_person_id', personId);
  return [...new Set(((data ?? []) as { credited_person_id: number | null }[]).map((r) => r.credited_person_id).filter((id): id is number => id != null))];
}

/**
 * The wreath orders of the scouts among `personIds` (a family's scope) in the current sale: one SellerView per
 * wreath seller in that scope (`saleId` pins a sale; the default is the most recent year). A family with no seller gets an empty list. Service-role client; the caller has
 * already resolved who the viewer's family is.
 */
export async function loadMyWreathOrders(sb: SupabaseClient, personIds: number[], saleId?: number, nowMs: number = Date.now()): Promise<MyWreathOrders> {
  const sale = await loadCurrentSale(sb, saleId);
  // A draft sale's orders are setup or test data; families see nothing until it opens.
  if (!sale || personIds.length === 0 || sale.status === 'draft') return { sale, sellers: [], items: [] };

  const { data } = await sb
    .from('wreath_sellers')
    .select('person_id, slug, goal, delivery_message, active, people:person_id(display_name)')
    .eq('sale_id', sale.id)
    .in('person_id', personIds);
  const rows = (data ?? []) as unknown as { person_id: number; slug: string | null; goal: number | null; delivery_message: string | null; active: boolean; people: { display_name: string } | { display_name: string }[] | null }[];
  if (rows.length === 0) return { sale, sellers: [], items: [] };

  const orders = await loadAdminOrders(sb, sale.id, { involving: rows.map((r) => r.person_id) });
  const nameOf = (r: (typeof rows)[number]) => (Array.isArray(r.people) ? r.people[0] : r.people)?.display_name ?? `Scout ${r.person_id}`;
  const lock: LockContext = { sale: { status: sale.status, round1Cutoff: sale.round1Cutoff, round2Cutoff: sale.round2Cutoff }, nowMs };
  return {
    sale,
    items: await loadStoreItems(sb, sale.id),
    sellers: rows
      .map((r) => buildSellerView(r.person_id, nameOf(r), orders, { profit: sale.scoutShare, donation: sale.donationShare }, { slug: r.active ? r.slug : null, goal: r.goal, deliveryMessage: r.delivery_message, lock }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}
