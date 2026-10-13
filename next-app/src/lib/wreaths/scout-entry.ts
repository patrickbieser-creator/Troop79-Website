/**
 * Wreath sale — scout-entered orders, after they are placed (Plans/Wreath-Scout-Entered-Orders.md). Placing one is a
 * mode of lib/wreaths/place-order.ts (deps.scoutEntry); this module is the rest of the life of such an order — edit,
 * cancel — and the scout's goal. Every function takes the VIEWER the server action derived from the session
 * (lib/wreaths/scout-entry-viewer.ts) and never a person id from the request as authority:
 *
 *   - the viewer may act on an order only if it is source 'paper' and credited to someone in their scope (themself
 *     as a scout, or their children as a parent; resolveFamilyScope, the Members page's notion of "own family");
 *   - an order locks when it is Paid, cancelled, past ITS round's cutoff, or the sale is not open (lockReason);
 *   - the final write is conditional in the database too (wreath_replace_order / the cancel update), so a treasurer
 *     marking it Paid in the same instant wins and the family's edit is refused.
 *
 * Pure rules (offer, lock, goal) are exported separately so tests and the page components share one definition.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtDay } from '@/lib/format-date';
import { recordAuditAs, type AuditDetail } from '@/lib/audit';
import { loadCurrentSale } from './public';
import type { ScoutEntryViewer } from './place-order';
import { EMAIL_RE, MAX_QTY, fmtMoney2, itemLabel, phoneOk, priceCart, type CartLine, type PricedItem } from './rules';

export type { ScoutEntryViewer } from './place-order';

/* ── who may enter orders for a scout ─────────────────────────────────────── */

/** May this signed-in viewer enter and manage orders as this scout? The public link never reaches here with a viewer. */
export function mayEnterFor(viewer: ScoutEntryViewer | null, sellerPersonId: number): boolean {
  return !!viewer && viewer.scope.includes(sellerPersonId);
}

/** Whether the "Order for someone I know" switch is shown on a scout's page: a right to that scout, and an open sale. */
export function entryOffered(viewer: ScoutEntryViewer | null, sellerPersonId: number | null, saleOpen: boolean): boolean {
  return saleOpen && sellerPersonId != null && mayEnterFor(viewer, sellerPersonId);
}

/* ── when an order locks ──────────────────────────────────────────────────── */

export interface LockOrder {
  status: 'placed' | 'cancelled';
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  round: 1 | 2;
}
export interface LockSale {
  status: 'draft' | 'open' | 'closed';
  round1Cutoff: string;
  round2Cutoff: string;
}

/** Why a scout-entered order can no longer be changed by its family, or null while it can. */
export function lockReason(o: LockOrder, sale: LockSale, nowMs: number): string | null {
  if (o.status === 'cancelled') return 'Cancelled.';
  if (o.paymentStatus !== 'unpaid') return 'Paid. Ask a troop leader to change it.';
  const cutoff = o.round === 1 ? sale.round1Cutoff : sale.round2Cutoff;
  if (sale.status !== 'open') return 'The sale is closed. Ask a troop leader to change it.';
  if (nowMs > Date.parse(cutoff)) return `Round ${o.round} closed ${fmtDay(cutoff)}. Ask a troop leader to change it.`;
  return null;
}

/* ── the goal ─────────────────────────────────────────────────────────────── */

export interface GoalProgress {
  goal: number;
  sold: number;
  /** 0..100, capped: a scout past the goal gets a full bar and a number that keeps counting. */
  pct: number;
  firstName: string;
  label: string;
}

/** The thermometer's numbers, or null when no goal is set (null or 0 reads as none). `sold` counts items in live orders. */
export function goalProgress(goal: number | null, sold: number, firstName: string): GoalProgress | null {
  if (goal == null || goal <= 0) return null;
  return { goal, sold, pct: Math.max(0, Math.min(100, Math.round((sold / goal) * 100))), firstName, label: `${sold} of ${goal} wreaths toward ${firstName}’s goal` };
}

/** "" / null clears the goal; otherwise a whole number 0..999. */
export function parseGoal(raw: unknown): { ok: true; goal: number | null } | { ok: false; error: string } {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, goal: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,4}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(n) || n < 0 || n > 999) return { ok: false, error: 'A goal is a whole number from 0 to 999. Leave it empty for no goal.' };
  return { ok: true, goal: n };
}

/** The scout's delivery message: plain text, 1..200 characters after trimming; empty clears it. */
export function parseDeliveryMessage(raw: unknown): { ok: true; message: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, message: null };
  if (typeof raw !== 'string') return { ok: false, error: 'That message isn’t text.' };
  const t = raw.trim();
  if (t.length > 200) return { ok: false, error: `That message is ${t.length} characters. 200 at most.` };
  return { ok: true, message: t || null };
}

/**
 * Wreaths sold by a scout in a sale: the items on orders credited to them that are neither cancelled nor refunded, paid
 * or not, donated wreaths included. The same rule as my-orders' isCounted, so the Members totals and the goal agree.
 */
export async function itemsSoldBy(sb: SupabaseClient, saleId: number, personId: number): Promise<number> {
  const { data } = await sb
    .from('wreath_orders')
    .select('wreath_order_lines(quantity)')
    .eq('sale_id', saleId)
    .eq('credited_person_id', personId)
    .eq('status', 'placed')
    .neq('payment_status', 'refunded');
  let n = 0;
  for (const o of (data ?? []) as unknown as { wreath_order_lines: { quantity: number }[] }[]) for (const l of o.wreath_order_lines) n += l.quantity;
  return n;
}

/* ── actions on an existing order ─────────────────────────────────────────── */

export interface EntryDeps {
  supabase: SupabaseClient;
  now: () => number;
  /** Derived from the session by the server action. Null = nobody signed in. */
  viewer: ScoutEntryViewer | null;
}

export type EntryResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'locked' | 'invalid'; error: string; field?: string };

const FORBIDDEN: EntryResult = { ok: false, code: 'forbidden', error: 'You can change only your own scout’s orders.' };
const bad = (field: string, error: string): EntryResult => ({ ok: false, code: 'invalid', error, field });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? (v.trim().length > max ? null : v.trim()) : v == null ? '' : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN);

interface OrderRow {
  id: number;
  order_number: string;
  sale_id: number;
  round: 1 | 2;
  source: string;
  status: 'placed' | 'cancelled';
  payment_status: 'unpaid' | 'paid' | 'refunded';
  credited_person_id: number | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_note: string | null;
  collected_by_scout: boolean;
  payment_note: string | null;
  gift: number;
  total: number;
  wreath_order_lines: { item_id: number; quantity: number; donated: boolean; unit_price: number; unit_cost: number; wreath_items: { name: string; size: string } | { name: string; size: string }[] | null }[];
}

/** The order if it is a paper order credited to someone the viewer acts for; null for anything else (same answer either way). */
async function loadOwnedOrder(sb: SupabaseClient, viewer: ScoutEntryViewer, orderId: unknown): Promise<OrderRow | null> {
  const id = num(orderId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { data } = await sb
    .from('wreath_orders')
    .select(
      'id, order_number, sale_id, round, source, status, payment_status, credited_person_id, customer_name, customer_email, customer_phone, customer_note, collected_by_scout, payment_note, gift, total, wreath_order_lines(item_id, quantity, donated, unit_price, unit_cost, wreath_items(name, size))'
    )
    .eq('id', id)
    .maybeSingle();
  const row = data as unknown as OrderRow | null;
  if (!row || row.source !== 'paper' || row.credited_person_id == null || !viewer.scope.includes(row.credited_person_id)) return null;
  return row;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const linesText = (r: OrderRow['wreath_order_lines']) =>
  r
    .map((l) => {
      const it = one(l.wreath_items);
      return `${l.quantity} × ${it ? itemLabel(it) : 'Item'}${l.donated ? ' (donated)' : ''}`;
    })
    .sort()
    .join(', ');

const actorOf = (v: ScoutEntryViewer) => ({ personId: v.personId, label: v.name });

/**
 * Saves an edit to a scout-entered order: customer, note, items, gift, collected and the payment note. The whole order
 * is re-validated and re-priced here (item ids, quantities and amounts from the catalog, as the store does; a line
 * already on the order keeps the price it was sold at). No email goes out on an edit.
 */
export async function editScoutOrder(raw: unknown, deps: EntryDeps): Promise<EntryResult> {
  const { supabase: sb, viewer } = deps;
  if (!viewer || !isObj(raw)) return FORBIDDEN;
  const order = await loadOwnedOrder(sb, viewer, raw.orderId);
  if (!order) return FORBIDDEN;

  const sale = await loadCurrentSale(sb, order.sale_id);
  if (!sale) return FORBIDDEN;
  const reason = lockReason({ status: order.status, paymentStatus: order.payment_status, round: order.round }, sale, deps.now());
  if (reason) return { ok: false, code: 'locked', error: reason };

  const cust = isObj(raw.customer) ? raw.customer : {};
  const name = str(cust.name, 100);
  const email = str(cust.email, 254);
  const phone = str(cust.phone, 30);
  const note = str(cust.note, 300);
  const paymentNote = str(raw.paymentNote, 200);
  if (name === null) return bad('name', 'That name is too long.');
  if (!name) return bad('name', 'Add the customer’s name, like “Grandma Sue”.');
  if (email === null || (email && !EMAIL_RE.test(email.toLowerCase()))) return bad('email', 'This email is missing something, like the @ or the .com.');
  if (phone === null || (phone && !phoneOk(phone))) return bad('phone', 'A phone number is 10 digits.');
  if (note === null) return bad('note', 'That note is too long. 300 characters at most.');
  if (paymentNote === null) return bad('paymentNote', 'That payment note is too long. 200 characters at most.');

  const lines: CartLine[] = [];
  if (Array.isArray(raw.lines)) {
    for (const l of raw.lines.slice(0, 200)) if (isObj(l)) lines.push({ itemId: num(l.itemId), quantity: num(l.quantity), donated: l.donated === true });
  }
  const { data: itemRows } = await sb.from('wreath_items').select('id, catalog_number, price, unit_cost, active, donatable').eq('sale_id', order.sale_id);
  const onOrder = new Map(order.wreath_order_lines.map((l) => [l.item_id, l]));
  const catalog: PricedItem[] = ((itemRows ?? []) as { id: number; catalog_number: number; price: number; unit_cost: number; active: boolean; donatable: boolean }[]).map((i) => {
    const had = onOrder.get(i.id);
    // An item already on the order keeps its sold-at price and stays editable even if it was retired since.
    return { id: i.id, catalogNumber: i.catalog_number, price: had ? Number(had.unit_price) : Number(i.price), unitCost: had ? Number(had.unit_cost) : Number(i.unit_cost), active: i.active || !!had, donatable: i.donatable };
  });
  const gift = raw.gift == null || raw.gift === '' ? 0 : num(raw.gift);
  const priced = priceCart({ deliveryZipPrefix: '', deliveryFee: 0, deliveryFreeAt: 0, feePercent: 0, feeFixed: 0, round1Cutoff: sale.round1Cutoff, round2Cutoff: sale.round2Cutoff }, catalog, lines, { fulfillment: 'scout', gift, coverFee: false });
  if (!priced.ok) {
    const code = priced.problem.code;
    return bad(
      code === 'gift' ? 'gift' : 'cart',
      code === 'empty' ? 'The order is empty. Add an item, or cancel the order.' : code === 'gift' ? 'A gift can be from $0 to $500.' : code === 'quantity' ? `Each item can be ordered 1 to ${MAX_QTY} at a time.` : 'Something in this order is no longer available. Please remove it and try again.'
    );
  }
  const o = priced.order;
  const collected = raw.collected === true;
  const { data: ok, error } = await sb.rpc('wreath_replace_order', {
    p: {
      order_id: order.id,
      credited_person_id: order.credited_person_id,
      customer_name: name,
      customer_email: email ? email.toLowerCase() : '',
      customer_phone: phone,
      customer_note: note,
      collected_by_scout: collected,
      payment_note: paymentNote,
      items_subtotal: o.itemsSubtotal,
      gift: o.gift,
      total: o.total,
      lines: o.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, donated: l.donated, unit_price: l.unitPrice, unit_cost: l.unitCost }))
    }
  });
  if (error) return { ok: false, code: 'invalid', error: 'Couldn’t save that. Please try again.' };
  if (ok !== true) return { ok: false, code: 'locked', error: 'This order was just marked paid or cancelled, so it can no longer be changed here.' };

  const after = o.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, donated: l.donated }));
  const { data: names } = await sb.from('wreath_items').select('id, name, size').in('id', after.map((l) => l.item_id));
  const nameOf = new Map(((names ?? []) as { id: number; name: string; size: string }[]).map((n) => [n.id, n]));
  const afterText = after
    .map((l) => `${l.quantity} × ${itemLabel(nameOf.get(l.item_id) ?? { name: 'Item', size: '' })}${l.donated ? ' (donated)' : ''}`)
    .sort()
    .join(', ');
  const changes: AuditDetail[] = [];
  const diff = (field: string, from: string, to: string) => {
    if (from !== to) changes.push({ field, from: from || '—', to: to || '—' });
  };
  diff('Customer', order.customer_name, name);
  diff('Items', linesText(order.wreath_order_lines), afterText);
  diff('Total', fmtMoney2(Number(order.total)), fmtMoney2(o.total));
  diff('Collected by scout', order.collected_by_scout ? 'Yes' : 'No', collected ? 'Yes' : 'No');
  diff('Payment note', order.payment_note ?? '', paymentNote);
  // Deliberately no phone or email: the audit trail is read by more people than the order screen is.
  await recordAuditAs(sb, actorOf(viewer), {
    area: 'wreaths',
    action: 'update',
    entityType: 'wreath_order',
    entityId: order.id,
    summary: `Edited scout-entered order ${order.order_number}`,
    details: changes
  });
  return { ok: true };
}

/** Cancels a scout-entered order. It stays in admin as Cancelled and drops out of every total, the Rose order included. */
export async function cancelScoutOrder(orderId: unknown, deps: EntryDeps): Promise<EntryResult> {
  const { supabase: sb, viewer } = deps;
  if (!viewer) return FORBIDDEN;
  const order = await loadOwnedOrder(sb, viewer, orderId);
  if (!order) return FORBIDDEN;
  const sale = await loadCurrentSale(sb, order.sale_id);
  if (!sale) return FORBIDDEN;
  const reason = lockReason({ status: order.status, paymentStatus: order.payment_status, round: order.round }, sale, deps.now());
  if (reason) return { ok: false, code: 'locked', error: reason };
  const { data: row } = await sb
    .from('wreath_orders')
    .update({ status: 'cancelled', cancelled_at: new Date(deps.now()).toISOString() })
    .eq('id', order.id)
    .eq('source', 'paper')
    .eq('status', 'placed')
    .eq('payment_status', 'unpaid')
    .in('credited_person_id', viewer.scope)
    .select('order_number')
    .maybeSingle();
  if (!row) return { ok: false, code: 'locked', error: 'This order was just marked paid or cancelled, so it can no longer be changed here.' };
  await recordAuditAs(sb, actorOf(viewer), {
    area: 'wreaths',
    action: 'cancel',
    entityType: 'wreath_order',
    entityId: order.id,
    summary: `Cancelled scout-entered order ${order.order_number}`,
    details: [{ field: 'Status', from: 'Placed', to: 'Cancelled' }]
  });
  return { ok: true };
}

/**
 * Sets or clears a scout's goal and delivery message for the current sale. Same right as entering orders: the scout,
 * or a parent in the household. A field left out of `raw` is not touched. Live when saved; no approval.
 */
export async function setScoutSettings(sellerPersonId: unknown, raw: { goal?: unknown; deliveryMessage?: unknown }, deps: EntryDeps): Promise<EntryResult> {
  const { supabase: sb, viewer } = deps;
  const pid = num(sellerPersonId);
  if (!viewer || !Number.isInteger(pid) || !mayEnterFor(viewer, pid)) return FORBIDDEN;
  const goal = 'goal' in raw ? parseGoal(raw.goal) : null;
  if (goal && !goal.ok) return bad('goal', goal.error);
  const msg = 'deliveryMessage' in raw ? parseDeliveryMessage(raw.deliveryMessage) : null;
  if (msg && !msg.ok) return bad('deliveryMessage', msg.error);
  const sale = await loadCurrentSale(sb);
  if (!sale) return FORBIDDEN;
  const { data: before } = await sb.from('wreath_sellers').select('id, goal, delivery_message').eq('sale_id', sale.id).eq('person_id', pid).eq('active', true).maybeSingle();
  if (!before) return FORBIDDEN;
  const b = before as { id: number; goal: number | null; delivery_message: string | null };
  const patch: Record<string, unknown> = {};
  const changes: AuditDetail[] = [];
  if (goal?.ok && goal.goal !== b.goal) {
    patch.goal = goal.goal;
    changes.push({ field: 'Goal', from: b.goal == null ? '—' : String(b.goal), to: goal.goal == null ? '—' : String(goal.goal) });
  }
  if (msg?.ok && msg.message !== b.delivery_message) {
    patch.delivery_message = msg.message;
    changes.push({ field: 'Delivery message', from: b.delivery_message ?? '—', to: msg.message ?? '—' });
  }
  if (changes.length === 0) return { ok: true };
  const { error } = await sb.from('wreath_sellers').update(patch).eq('id', b.id);
  if (error) return { ok: false, code: 'invalid', error: 'Couldn’t save that. Please try again.' };
  await recordAuditAs(sb, actorOf(viewer), {
    area: 'wreaths',
    action: 'update',
    entityType: 'wreath_seller',
    entityId: b.id,
    summary: `Changed a scout’s wreath ${changes.map((c) => c.field.toLowerCase()).join(' and ')}`,
    details: changes,
    subjects: [pid]
  });
  return { ok: true };
}
