/**
 * Wreath sale — the loaders behind the PUBLIC pages (store, scout link, confirmation). Each takes the service-role
 * client as an argument (RLS is on with zero policies, so the browser's own client can read nothing) and selects only
 * what the page may show: never a customer's phone, address or email, never an item's unit cost, and a scout only as
 * first name + last initial. tests/wreath-public.test.ts holds both the returned shapes and this file's column list.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { itemLabel, type SaleRules } from './rules';

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoreSection = 'wreaths' | 'boxed' | 'shapes' | 'trees' | 'extras';
export const STORE_SECTIONS: { id: StoreSection; title: string }[] = [
  { id: 'wreaths', title: 'Wreaths' },
  { id: 'boxed', title: 'Decorated and boxed' },
  { id: 'shapes', title: 'Shapes and greens' },
  { id: 'trees', title: 'Trees and table' },
  { id: 'extras', title: 'Hangers and stands' }
];

export interface PublicSale extends SaleRules {
  id: number;
  year: number;
  status: 'draft' | 'open' | 'closed';
  distributionDate: string | null;
  distributionWindow: string;
  distributionPlace: string;
  scoutShare: number;
}

export interface StoreItem {
  id: number;
  catalogNumber: number;
  name: string;
  size: string;
  description: string;
  price: number;
  imageUrl: string | null;
  section: StoreSection;
  donatable: boolean;
}

export interface ScoutLink {
  slug: string;
  /** "Ben B." */
  name: string;
  firstName: string;
  /** Shown only once a leader has approved it. */
  message: string | null;
}

export interface Confirmation {
  orderNumber: string;
  firstName: string;
  status: 'placed' | 'cancelled';
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  fulfillment: 'scout' | 'pickup' | 'delivery' | 'none';
  scoutName: string | null;
  scoutFirstName: string | null;
  outsideAreaRelative: boolean;
  round: 1 | 2;
  items: { label: string; quantity: number; donated: boolean; amount: number }[];
  itemsSubtotal: number;
  deliveryFee: number;
  feeCovered: number;
  gift: number;
  total: number;
  distribution: { date: string | null; window: string; place: string };
  /** The cutoff of the order's round (an instant): changes are possible until the end of that day. */
  changesBy: string;
}

const SALE_COLS =
  'id, year, status, round1_cutoff, round2_cutoff, distribution_date, distribution_window, distribution_place, delivery_zip_prefix, delivery_fee, delivery_free_at, fee_percent, fee_fixed, scout_share';

type SaleRow = {
  id: number;
  year: number;
  status: 'draft' | 'open' | 'closed';
  round1_cutoff: string;
  round2_cutoff: string;
  distribution_date: string | null;
  distribution_window: string;
  distribution_place: string;
  delivery_zip_prefix: string;
  delivery_fee: number;
  delivery_free_at: number;
  fee_percent: number;
  fee_fixed: number;
  scout_share: number;
};

export function saleFromRow(r: SaleRow): PublicSale {
  return {
    id: r.id,
    year: r.year,
    status: r.status,
    round1Cutoff: r.round1_cutoff,
    round2Cutoff: r.round2_cutoff,
    distributionDate: r.distribution_date,
    distributionWindow: r.distribution_window,
    distributionPlace: r.distribution_place,
    deliveryZipPrefix: r.delivery_zip_prefix,
    deliveryFee: Number(r.delivery_fee),
    deliveryFreeAt: Number(r.delivery_free_at),
    feePercent: Number(r.fee_percent),
    feeFixed: Number(r.fee_fixed),
    scoutShare: Number(r.scout_share)
  };
}

/** The sale the public pages show: the one asked for, else the most recent year. Null before any sale exists. */
export async function loadCurrentSale(sb: SupabaseClient, saleId?: number): Promise<PublicSale | null> {
  let q = sb.from('wreath_sales').select(SALE_COLS);
  q = saleId != null ? q.eq('id', saleId) : q.order('year', { ascending: false }).limit(1);
  const { data } = await q;
  const row = ((data ?? []) as SaleRow[])[0];
  return row ? saleFromRow(row) : null;
}

/** Active items only, in the sale's order. No unit cost, ever. */
export async function loadStoreItems(sb: SupabaseClient, saleId: number): Promise<StoreItem[]> {
  const { data } = await sb
    .from('wreath_items')
    .select('id, catalog_number, name, size, description, price, image_url, store_section, donatable, sort_order')
    .eq('sale_id', saleId)
    .eq('active', true)
    .order('sort_order')
    .order('catalog_number');
  return ((data ?? []) as {
    id: number;
    catalog_number: number;
    name: string;
    size: string;
    description: string;
    price: number;
    image_url: string | null;
    store_section: StoreSection;
    donatable: boolean;
  }[]).map((r) => ({
    id: r.id,
    catalogNumber: r.catalog_number,
    name: r.name,
    size: r.size,
    description: r.description,
    price: Number(r.price),
    imageUrl: r.image_url,
    section: r.store_section,
    donatable: r.donatable
  }));
}

/** "Ben B." from a people row — the only way a scout is ever named on a public page. */
export function scoutDisplayName(first: string | null, last: string | null): { name: string; firstName: string } {
  const firstName = (first ?? '').trim() || 'Scout';
  const initial = (last ?? '').trim().charAt(0).toUpperCase();
  return { firstName, name: initial ? `${firstName} ${initial}.` : firstName };
}

type PersonJoin = { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * The seller behind a link, or null. An unknown slug, a malformed one and a RETIRED seller all return null — the
 * caller shows the general store and never says which, so a retired link cannot be told from one that never existed.
 */
/** A typed or pasted link in its stored form: case and surrounding space don't matter ("Anjali-S" is "anjali-s"). */
export function canonicalSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function resolveScoutLink(sb: SupabaseClient, saleId: number, rawSlug: string): Promise<ScoutLink | null> {
  const slug = canonicalSlug(rawSlug);
  if (!SLUG_RE.test(slug)) return null;
  const { data } = await sb
    .from('wreath_sellers')
    .select('slug, message, message_approved_at, people:person_id(first_name, last_name)')
    .eq('sale_id', saleId)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as { slug: string; message: string | null; message_approved_at: string | null; people: PersonJoin };
  const p = one(row.people);
  const { name, firstName } = scoutDisplayName(p?.first_name ?? null, p?.last_name ?? null);
  return { slug: row.slug, name, firstName, message: row.message_approved_at && row.message?.trim() ? row.message.trim() : null };
}

/** The confirmation page's data, keyed by the unguessable token. No address, phone or email; the customer's first name only. */
export async function loadConfirmation(sb: SupabaseClient, token: string): Promise<Confirmation | null> {
  if (!UUID_RE.test(token)) return null;
  const { data } = await sb
    .from('wreath_orders')
    .select(
      'order_number, customer_name, status, payment_status, fulfillment, outside_area_relative, round, sale_id, items_subtotal, delivery_fee, fee_covered, gift, total, ' +
        'scout:credited_person_id(first_name, last_name), wreath_order_lines(quantity, donated, unit_price, wreath_items(name, size))'
    )
    .eq('public_token', token)
    .order('id', { referencedTable: 'wreath_order_lines' })
    .maybeSingle();
  if (!data) return null;
  const o = data as unknown as {
    order_number: string;
    customer_name: string;
    status: 'placed' | 'cancelled';
    payment_status: 'unpaid' | 'paid' | 'refunded';
    fulfillment: Confirmation['fulfillment'];
    outside_area_relative: boolean;
    round: 1 | 2;
    sale_id: number;
    items_subtotal: number;
    delivery_fee: number;
    fee_covered: number;
    gift: number;
    total: number;
    scout: PersonJoin;
    wreath_order_lines: {
      quantity: number;
      donated: boolean;
      unit_price: number;
      wreath_items: { name: string; size: string } | { name: string; size: string }[] | null;
    }[];
  };
  const sale = await loadCurrentSale(sb, o.sale_id);
  const scout = one(o.scout);
  const named = scout ? scoutDisplayName(scout.first_name, scout.last_name) : null;
  return {
    orderNumber: o.order_number,
    firstName: o.customer_name.trim().split(/\s+/)[0] ?? '',
    status: o.status,
    paymentStatus: o.payment_status,
    fulfillment: o.fulfillment,
    scoutName: named?.name ?? null,
    scoutFirstName: named?.firstName ?? null,
    outsideAreaRelative: o.outside_area_relative,
    round: o.round,
    items: o.wreath_order_lines.map((l) => {
      const item = one(l.wreath_items);
      return {
        label: item ? itemLabel(item) : 'Item',
        quantity: l.quantity,
        donated: l.donated,
        amount: Math.round(Number(l.unit_price) * l.quantity * 100) / 100
      };
    }),
    itemsSubtotal: Number(o.items_subtotal),
    deliveryFee: Number(o.delivery_fee),
    feeCovered: Number(o.fee_covered),
    gift: Number(o.gift),
    total: Number(o.total),
    distribution: { date: sale?.distributionDate ?? null, window: sale?.distributionWindow ?? '', place: sale?.distributionPlace ?? '' },
    changesBy: (o.round === 1 ? sale?.round1Cutoff : sale?.round2Cutoff) ?? ''
  };
}
