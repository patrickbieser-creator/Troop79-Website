/**
 * Wreath sale — the loaders behind Admin › Finance › Wreath Sale. Service-role client passed in; every caller has
 * already passed requireCapability('finance.manage'). Unlike lib/wreaths/public.ts these DO carry customer details
 * and unit costs: this is the treasurer's view.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { roseOrder, type RoseRow } from './rules';

export interface AdminSale {
  id: number;
  year: number;
  status: 'draft' | 'open' | 'closed';
  round1Cutoff: string;
  round2Cutoff: string;
  distributionDate: string | null;
  distributionWindow: string;
  distributionPlace: string;
  deliveryZipPrefix: string;
  deliveryFee: number;
  deliveryFreeAt: number;
  feePercent: number;
  feeFixed: number;
  scoutShare: number;
}

export interface AdminItem {
  id: number;
  catalogNumber: number;
  name: string;
  size: string;
  description: string;
  price: number;
  unitCost: number;
  imageUrl: string | null;
  donatable: boolean;
  active: boolean;
}

export interface AdminSeller {
  id: number;
  personId: number;
  name: string;
  slug: string | null;
  active: boolean;
  orders: number;
}

export interface AdminOrderLine {
  label: string;
  catalogNumber: number;
  quantity: number;
  donated: boolean;
  amount: number;
  /** Snapshots at order time; with quantity they give the order's profit (lib/wreaths/my-orders). */
  unitPrice: number;
  unitCost: number;
}

export interface AdminOrder {
  id: number;
  orderNumber: string;
  placedAt: string;
  round: 1 | 2;
  source: 'scout_link' | 'store' | 'paper';
  fulfillment: 'scout' | 'pickup' | 'delivery' | 'none';
  creditedPersonId: number | null;
  creditedName: string;
  deliveringPersonId: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  customerCity: string;
  customerZip: string;
  outsideAreaRelative: boolean;
  itemsSubtotal: number;
  deliveryFee: number;
  feeCovered: number;
  gift: number;
  total: number;
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  paidMethod: string | null;
  paidAt: string | null;
  /** What the order totalled when it was marked paid (a later reassign can change the total). */
  paidAmount: number | null;
  status: 'placed' | 'cancelled';
  lines: AdminOrderLine[];
}

export interface AuditEntry {
  id: number;
  occurredAt: string;
  actor: string;
  action: string;
  summary: string;
  changes: { field: string; from: string; to: string }[];
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** The sale the admin works on: the most recent year. */
export async function loadAdminSale(sb: SupabaseClient): Promise<AdminSale | null> {
  const { data } = await sb.from('wreath_sales').select('*').order('year', { ascending: false }).limit(1);
  const r = ((data ?? []) as Record<string, unknown>[])[0];
  if (!r) return null;
  return {
    id: r.id as number,
    year: r.year as number,
    status: r.status as AdminSale['status'],
    round1Cutoff: r.round1_cutoff as string,
    round2Cutoff: r.round2_cutoff as string,
    distributionDate: (r.distribution_date as string | null) ?? null,
    distributionWindow: r.distribution_window as string,
    distributionPlace: r.distribution_place as string,
    deliveryZipPrefix: r.delivery_zip_prefix as string,
    deliveryFee: Number(r.delivery_fee),
    deliveryFreeAt: Number(r.delivery_free_at),
    feePercent: Number(r.fee_percent),
    feeFixed: Number(r.fee_fixed),
    scoutShare: Number(r.scout_share)
  };
}

/**
 * Is the current sale open? One narrow select (status only) for Home's card grid, which orders the Wreath Sale card
 * by season. Same "current sale" rule as loadAdminSale (latest year); no sale at all reads as not open.
 */
export async function loadWreathSaleOpen(sb: SupabaseClient): Promise<boolean> {
  const { data } = await sb.from('wreath_sales').select('status').order('year', { ascending: false }).limit(1);
  return ((data ?? []) as { status: string }[])[0]?.status === 'open';
}

export async function loadAdminItems(sb: SupabaseClient, saleId: number): Promise<AdminItem[]> {
  const { data } = await sb.from('wreath_items').select('*').eq('sale_id', saleId).order('sort_order').order('catalog_number');
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    catalogNumber: r.catalog_number as number,
    name: r.name as string,
    size: r.size as string,
    description: r.description as string,
    price: Number(r.price),
    unitCost: Number(r.unit_cost),
    imageUrl: (r.image_url as string | null) ?? null,
    donatable: r.donatable as boolean,
    active: r.active as boolean
  }));
}

export async function loadAdminSellers(sb: SupabaseClient, saleId: number): Promise<AdminSeller[]> {
  const [{ data: sellers }, { data: counts }] = await Promise.all([
    sb.from('wreath_sellers').select('id, person_id, slug, active, people:person_id(display_name)').eq('sale_id', saleId),
    sb.from('wreath_orders').select('credited_person_id').eq('sale_id', saleId).eq('status', 'placed').not('credited_person_id', 'is', null)
  ]);
  const perPerson = new Map<number, number>();
  for (const c of (counts ?? []) as { credited_person_id: number }[]) perPerson.set(c.credited_person_id, (perPerson.get(c.credited_person_id) ?? 0) + 1);
  return ((sellers ?? []) as unknown as { id: number; person_id: number; slug: string | null; active: boolean; people: { display_name: string } | { display_name: string }[] | null }[])
    .map((s) => ({
      id: s.id,
      personId: s.person_id,
      name: one(s.people)?.display_name ?? `Person ${s.person_id}`,
      slug: s.slug,
      active: s.active,
      orders: perPerson.get(s.person_id) ?? 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Active scouts on the roster who are not yet sellers in this sale — the "Add a seller" picker. */
export async function loadSellerCandidates(sb: SupabaseClient, saleId: number): Promise<{ personId: number; name: string; firstName: string; lastName: string }[]> {
  const [{ data: scouts }, { data: taken }] = await Promise.all([
    sb.from('scouts').select('person_id, first_name, last_name, display_name').eq('active', true).not('person_id', 'is', null),
    sb.from('wreath_sellers').select('person_id').eq('sale_id', saleId)
  ]);
  const have = new Set(((taken ?? []) as { person_id: number }[]).map((t) => t.person_id));
  return ((scouts ?? []) as { person_id: number; first_name: string; last_name: string; display_name: string }[])
    .filter((s) => !have.has(s.person_id))
    .map((s) => ({ personId: s.person_id, name: s.display_name, firstName: s.first_name, lastName: s.last_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every order in a sale, or — with `involving` — only those credited to or delivered by one of those people (the
 * Members "My wreath orders" page, which then strips the customer details it may not show).
 */
export async function loadAdminOrders(sb: SupabaseClient, saleId: number, opts: { involving?: number[] } = {}): Promise<AdminOrder[]> {
  let q = sb
    .from('wreath_orders')
    .select('*, credited:credited_person_id(display_name), wreath_order_lines(quantity, donated, unit_price, unit_cost, wreath_items(catalog_number, name, size))')
    .eq('sale_id', saleId);
  if (opts.involving) {
    if (opts.involving.length === 0) return [];
    const ids = opts.involving.join(',');
    q = q.or(`credited_person_id.in.(${ids}),delivering_person_id.in.(${ids})`);
  }
  const { data } = await q.order('placed_at', { ascending: false }).order('id', { ascending: false });
  return ((data ?? []) as Record<string, any>[]).map((r) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: r.id,
    orderNumber: r.order_number,
    placedAt: r.placed_at,
    round: r.round,
    source: r.source,
    fulfillment: r.fulfillment,
    creditedPersonId: r.credited_person_id,
    creditedName: one(r.credited)?.display_name ?? 'Troop store',
    deliveringPersonId: r.delivering_person_id,
    customerName: r.customer_name,
    customerEmail: r.customer_email ?? '',
    customerPhone: r.customer_phone ?? '',
    customerAddress: r.customer_address ?? '',
    customerCity: r.customer_city ?? '',
    customerZip: r.customer_zip ?? '',
    outsideAreaRelative: r.outside_area_relative,
    itemsSubtotal: Number(r.items_subtotal),
    deliveryFee: Number(r.delivery_fee),
    feeCovered: Number(r.fee_covered),
    gift: Number(r.gift),
    total: Number(r.total),
    paymentStatus: r.payment_status,
    paidMethod: r.paid_method,
    paidAt: r.paid_at,
    paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
    status: r.status,
    lines: (r.wreath_order_lines as Record<string, any>[]).map((l) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const it = one(l.wreath_items) as { catalog_number: number; name: string; size: string } | null;
      return {
        label: it ? `${it.size ? it.size + ' ' : ''}${it.name}` : 'Item',
        catalogNumber: it?.catalog_number ?? 0,
        quantity: l.quantity,
        donated: l.donated,
        amount: Math.round(Number(l.unit_price) * l.quantity * 100) / 100,
        unitPrice: Number(l.unit_price),
        unitCost: Number(l.unit_cost)
      };
    })
  }));
}

/** The audit trail of every order in a sale (Mark paid, Reassign, cancel), newest first, keyed by order id. */
export async function loadOrderHistory(sb: SupabaseClient, orderIds: number[]): Promise<Map<number, AuditEntry[]>> {
  const out = new Map<number, AuditEntry[]>();
  if (orderIds.length === 0) return out;
  const { data } = await sb
    .from('audit_log')
    .select('id, occurred_at, actor_label, action, summary, details, entity_id')
    .eq('area', 'wreaths')
    .eq('entity_type', 'wreath_order')
    .in('entity_id', orderIds.map(String))
    .order('id', { ascending: false });
  for (const r of (data ?? []) as { id: number; occurred_at: string; actor_label: string; action: string; summary: string; details: unknown; entity_id: string }[]) {
    const list = Array.isArray(r.details) ? (r.details as { field: string; from: string; to: string }[]) : [];
    const entry: AuditEntry = { id: r.id, occurredAt: r.occurred_at, actor: r.actor_label, action: r.action, summary: r.summary, changes: list };
    const key = Number(r.entity_id);
    out.set(key, [...(out.get(key) ?? []), entry]);
  }
  return out;
}

export interface AdminRoseRow extends RoseRow {
  name: string;
  size: string;
}

/** Wreaths to order from Rose, per catalog number: round 1 is the initial order, round 2 the changes. Cancelled orders do not count. */
export async function loadRoseOrder(sb: SupabaseClient, saleId: number): Promise<AdminRoseRow[]> {
  const { data } = await sb
    .from('wreath_order_lines')
    .select('quantity, wreath_items!inner(catalog_number, name, size), wreath_orders!inner(round, status, sale_id)')
    .eq('wreath_orders.sale_id', saleId)
    .eq('wreath_orders.status', 'placed');
  const rows = (data ?? []) as unknown as {
    quantity: number;
    wreath_items: { catalog_number: number; name: string; size: string } | { catalog_number: number; name: string; size: string }[];
    wreath_orders: { round: number } | { round: number }[];
  }[];
  const names = new Map<number, { name: string; size: string }>();
  const flat = rows.map((r) => {
    const it = one(r.wreath_items)!;
    names.set(it.catalog_number, { name: it.name, size: it.size });
    return { catalogNumber: it.catalog_number, round: one(r.wreath_orders)!.round, quantity: r.quantity };
  });
  return roseOrder(flat).map((r) => ({ ...r, ...names.get(r.catalogNumber)! }));
}
