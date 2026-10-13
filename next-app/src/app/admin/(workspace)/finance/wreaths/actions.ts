'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { recordAudit, type AuditDetail } from '@/lib/audit';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToInstant, instantToCentral } from '@/lib/dates';
import { uploadToBunny } from '@/lib/bunny-storage';
import { PAID_METHODS, deliveryFeeFor, fmtMoney2, fromCents, inDeliveryArea, toCents, zipFormatOk, type PaidMethod } from '@/lib/wreaths/rules';
import { canonicalSlug, SLUG_RE } from '@/lib/wreaths/public';

/**
 * Wreath sale admin (Plans/Wreath-Sale.md, Release A: Settings, Items, Sellers, Orders). Gate: `finance.manage` on
 * EVERY action, checked before anything is read or written — the page hiding a control is not enforcement. Writes
 * are service-role (the tables have RLS on and no policies). Mark paid, Reassign, cancel and every settings, item
 * and seller edit write an audit row (area 'wreaths') with the actor, and the old and new values as readable text;
 * the one-line summary names the thing changed, never the values (D-257).
 */

export interface WreathResult {
  ok: boolean;
  error?: string;
  field?: string;
  id?: number;
  /** Mark paid: the order was already paid, so nothing changed. */
  already?: boolean;
}

const PAGE = '/admin/finance/wreaths';
const fail = (error: string, field?: string): WreathResult => ({ ok: false, error, field });
const money = (n: number) => fmtMoney2(n);

/** Words a seller's link may never be: they are the checkout and confirmation routes. */
const RESERVED_SLUGS = new Set(['checkout', 'order']);

function slugProblem(slug: string): string | null {
  if (slug.length > 40) return 'A link can be at most 40 characters.';
  if (!SLUG_RE.test(slug)) return 'Use lowercase letters, numbers and single hyphens, like oliver-k.';
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is a page on the store, so a scout can’t have it as a link.`;
  return null;
}

/* ── settings ──────────────────────────────────────────────────────────────── */

export interface SettingsInput {
  status: 'draft' | 'open' | 'closed';
  /** 'YYYY-MM-DD'; the cutoff is the end of that day, Central. */
  round1Date: string;
  round2Date: string;
  distributionDate: string;
  distributionWindow: string;
  distributionPlace: string;
  deliveryZipPrefix: string;
  deliveryFee: number;
  deliveryFreeAt: number;
  feePercent: number;
  feeFixed: number;
  scoutSharePercent: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveSettings(saleId: number, v: SettingsInput): Promise<WreathResult> {
  const actor = await requireCapability('finance.manage');
  if (!['draft', 'open', 'closed'].includes(v.status)) return fail('Choose draft, open or closed.', 'status');
  if (!DATE_RE.test(v.round1Date)) return fail('Enter the Round 1 cutoff date.', 'round1Date');
  if (!DATE_RE.test(v.round2Date)) return fail('Enter the Round 2 cutoff date.', 'round2Date');
  const r1 = centralToInstant(v.round1Date, '23:59');
  const r2 = centralToInstant(v.round2Date, '23:59');
  if (!r1) return fail('That Round 1 date isn’t a real date.', 'round1Date');
  if (!r2) return fail('That Round 2 date isn’t a real date.', 'round2Date');
  if (Date.parse(r2) <= Date.parse(r1)) return fail('Round 2 must close after Round 1.', 'round2Date');
  if (v.distributionDate && !DATE_RE.test(v.distributionDate)) return fail('Enter the distribution date.', 'distributionDate');
  if (v.distributionWindow.length > 60) return fail('Keep the time window under 60 characters.', 'distributionWindow');
  if (v.distributionPlace.length > 160) return fail('Keep the place under 160 characters.', 'distributionPlace');
  if (!/^\d{1,5}$/.test(v.deliveryZipPrefix)) return fail('Zip codes start with 1 to 5 digits, like 532.', 'deliveryZipPrefix');
  const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
  if (!inRange(v.deliveryFee, 0, 100)) return fail('The delivery fee is $0 to $100.', 'deliveryFee');
  if (!inRange(v.deliveryFreeAt, 0, 10000)) return fail('Free delivery starts at $0 to $10,000.', 'deliveryFreeAt');
  if (!inRange(v.feePercent, 0, 10)) return fail('The processing fee percent is 0 to 10.', 'feePercent');
  if (!inRange(v.feeFixed, 0, 5)) return fail('The fixed processing fee is $0 to $5.', 'feeFixed');
  if (!inRange(v.scoutSharePercent, 0, 100)) return fail('The scout share is 0 to 100 percent.', 'scoutSharePercent');

  const supabase = createAdminClient();
  const { data: before } = await supabase.from('wreath_sales').select('*').eq('id', saleId).maybeSingle();
  if (!before) return fail('That sale no longer exists.');
  const next = {
    status: v.status,
    round1_cutoff: r1,
    round2_cutoff: r2,
    distribution_date: v.distributionDate || null,
    distribution_window: v.distributionWindow.trim(),
    distribution_place: v.distributionPlace.trim(),
    delivery_zip_prefix: v.deliveryZipPrefix,
    delivery_fee: v.deliveryFee,
    delivery_free_at: v.deliveryFreeAt,
    fee_percent: v.feePercent,
    fee_fixed: v.feeFixed,
    scout_share: Math.round(v.scoutSharePercent * 10) / 1000
  };
  const { error } = await supabase
    .from('wreath_sales')
    .update({ ...next, updated_at: new Date().toISOString(), updated_by: actor.label })
    .eq('id', saleId);
  if (error) return fail('Couldn’t save the settings. Please try again.');

  const day = (iso: string) => instantToCentral(iso).date;
  const changes: AuditDetail[] = [];
  const diff = (field: string, from: string, to: string) => {
    if (from !== to) changes.push({ field, from: from || '—', to: to || '—' });
  };
  diff('Status', before.status, next.status);
  diff('Round 1 cutoff', day(before.round1_cutoff), day(r1));
  diff('Round 2 cutoff', day(before.round2_cutoff), day(r2));
  diff('Distribution date', before.distribution_date ?? '', next.distribution_date ?? '');
  diff('Distribution window', before.distribution_window, next.distribution_window);
  diff('Distribution place', before.distribution_place, next.distribution_place);
  diff('Delivery zip prefix', before.delivery_zip_prefix, next.delivery_zip_prefix);
  diff('Delivery fee', money(Number(before.delivery_fee)), money(next.delivery_fee));
  diff('Free delivery at', money(Number(before.delivery_free_at)), money(next.delivery_free_at));
  diff('Processing fee percent', String(Number(before.fee_percent)), String(next.fee_percent));
  diff('Processing fee fixed', money(Number(before.fee_fixed)), money(next.fee_fixed));
  diff('Scout share', `${Math.round(Number(before.scout_share) * 1000) / 10}%`, `${Math.round(next.scout_share * 1000) / 10}%`);
  if (changes.length) {
    await recordAudit({
      area: 'wreaths',
      action: 'update',
      entityType: 'wreath_sale',
      entityId: saleId,
      summary: `Changed wreath sale ${before.year} settings: ${changes.map((c) => c.field).join(', ')}`,
      details: changes
    });
  }
  revalidatePath(PAGE);
  return { ok: true };
}

/* ── items ─────────────────────────────────────────────────────────────────── */

export interface ItemInput {
  name: string;
  size: string;
  description: string;
  price: number;
  unitCost: number;
  imageUrl: string | null;
  donatable: boolean;
  active: boolean;
}

export async function saveItem(itemId: number, v: ItemInput): Promise<WreathResult> {
  await requireCapability('finance.manage');
  const name = v.name.trim();
  if (!name) return fail('Give the item a name.', 'name');
  if (name.length > 80) return fail('Keep the name under 80 characters.', 'name');
  if (v.size.length > 20) return fail('Keep the size under 20 characters.', 'size');
  if (v.description.length > 400) return fail('Keep the description under 400 characters.', 'description');
  if (!Number.isFinite(v.price) || v.price < 0 || v.price > 1000) return fail('The price is $0 to $1,000.', 'price');
  if (!Number.isFinite(v.unitCost) || v.unitCost < 0 || v.unitCost > 1000) return fail('The unit cost is $0 to $1,000.', 'unitCost');
  const imageUrl = v.imageUrl?.trim() || null;
  if (imageUrl && (!/^https:\/\/[^\s]+$/.test(imageUrl) || imageUrl.length > 500)) return fail('The photo must be an https:// address.', 'imageUrl');

  const supabase = createAdminClient();
  const { data: before } = await supabase.from('wreath_items').select('*').eq('id', itemId).maybeSingle();
  if (!before) return fail('That item no longer exists.');
  const next = {
    name,
    size: v.size.trim(),
    description: v.description.trim(),
    price: Math.round(v.price * 100) / 100,
    unit_cost: Math.round(v.unitCost * 100) / 100,
    image_url: imageUrl,
    donatable: v.donatable,
    active: v.active
  };
  const { error } = await supabase.from('wreath_items').update(next).eq('id', itemId);
  if (error) return fail('Couldn’t save the item. Please try again.');

  const changes: AuditDetail[] = [];
  const diff = (field: string, from: string, to: string) => {
    if (from !== to) changes.push({ field, from: from || '—', to: to || '—' });
  };
  diff('Name', before.name, next.name);
  diff('Size', before.size, next.size);
  diff('Description', before.description, next.description);
  diff('Price', money(Number(before.price)), money(next.price));
  diff('Unit cost', money(Number(before.unit_cost)), money(next.unit_cost));
  diff('Photo', before.image_url ?? '', next.image_url ?? '');
  diff('Can be donated', before.donatable ? 'Yes' : 'No', next.donatable ? 'Yes' : 'No');
  diff('On sale', before.active ? 'Yes' : 'No', next.active ? 'Yes' : 'No');
  if (changes.length) {
    await recordAudit({
      area: 'wreaths',
      action: 'update',
      entityType: 'wreath_item',
      entityId: itemId,
      summary: `Edited wreath item ${before.catalog_number}: ${changes.map((c) => c.field).join(', ')}`,
      details: changes
    });
  }
  revalidatePath(PAGE);
  return { ok: true };
}

/** Uploads an item photo to the troop CDN under wreaths/ and returns its address; the caller puts it in the form. */
export async function uploadItemImage(formData: FormData): Promise<{ ok: boolean; url?: string; error?: string }> {
  await requireCapability('finance.manage');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a photo first.' };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { ok: false, error: 'Use a JPG, PNG or WebP photo.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'That photo is over 5 MB. Please use a smaller one.' };
  const year = new Date().getFullYear();
  const uploaded = await uploadToBunny(file, `wreaths/${year}/`);
  if (!uploaded.ok || !uploaded.cdnUrl) return { ok: false, error: uploaded.error ?? 'The upload failed. Please try again.' };
  return { ok: true, url: uploaded.cdnUrl };
}

/* ── sellers ───────────────────────────────────────────────────────────────── */

async function personName(supabase: ReturnType<typeof createAdminClient>, personId: number): Promise<string> {
  const { data } = await supabase.from('people').select('display_name').eq('id', personId).maybeSingle();
  return data?.display_name ?? `Person ${personId}`;
}

async function slugTaken(supabase: ReturnType<typeof createAdminClient>, saleId: number, slug: string, exceptSellerId?: number): Promise<boolean> {
  let q = supabase.from('wreath_sellers').select('id').eq('sale_id', saleId).eq('slug', slug);
  if (exceptSellerId != null) q = q.neq('id', exceptSellerId);
  const { data } = await q.limit(1);
  return (data ?? []).length > 0;
}

/** Adds a roster scout as a seller. Only an ACTIVE scout; a colliding link is refused (no auto-suffix). */
export async function addSeller(saleId: number, v: { personId: number; slug: string }): Promise<WreathResult> {
  await requireCapability('finance.manage');
  const slug = canonicalSlug(v.slug);
  const problem = slug ? slugProblem(slug) : 'Give the seller a link, like oliver-k.';
  if (problem) return fail(problem, 'slug');
  const supabase = createAdminClient();
  const { data: scout } = await supabase.from('scouts').select('id').eq('person_id', v.personId).eq('active', true).limit(1);
  if (!scout?.length) return fail('Only an active scout on the roster can be a seller. Add them to the roster first.', 'personId');
  const { data: dupe } = await supabase.from('wreath_sellers').select('id').eq('sale_id', saleId).eq('person_id', v.personId).limit(1);
  if (dupe?.length) return fail('That scout is already a seller.', 'personId');
  if (await slugTaken(supabase, saleId, slug)) return fail(`The link "${slug}" is already taken. Pick another.`, 'slug');

  const { data, error } = await supabase.from('wreath_sellers').insert({ sale_id: saleId, person_id: v.personId, slug }).select('id').single();
  if (error || !data) return fail(error?.code === '23505' ? `The link "${slug}" is already taken. Pick another.` : 'Couldn’t add the seller. Please try again.', 'slug');
  const name = await personName(supabase, v.personId);
  await recordAudit({
    area: 'wreaths',
    action: 'add',
    entityType: 'wreath_seller',
    entityId: data.id,
    summary: `Added ${name} as a wreath seller`,
    details: [{ field: 'Link', from: '—', to: slug }],
    subjects: [v.personId]
  });
  revalidatePath(PAGE);
  return { ok: true, id: data.id };
}

/** Sets or clears (null) a seller's link. A cleared link means the seller has no page; their credit still works from Orders. */
export async function setSellerSlug(sellerId: number, slugIn: string | null): Promise<WreathResult> {
  await requireCapability('finance.manage');
  const slug = (slugIn && canonicalSlug(slugIn)) || null;
  if (slug) {
    const problem = slugProblem(slug);
    if (problem) return fail(problem, 'slug');
  }
  const supabase = createAdminClient();
  const { data: seller } = await supabase.from('wreath_sellers').select('id, sale_id, person_id, slug').eq('id', sellerId).maybeSingle();
  if (!seller) return fail('That seller no longer exists.');
  if (slug && (await slugTaken(supabase, seller.sale_id, slug, sellerId))) return fail(`The link "${slug}" is already taken. Pick another.`, 'slug');
  if (slug === seller.slug) return { ok: true };
  const { error } = await supabase.from('wreath_sellers').update({ slug }).eq('id', sellerId);
  if (error) return fail(error.code === '23505' ? `The link "${slug}" is already taken. Pick another.` : 'Couldn’t save the link. Please try again.', 'slug');
  const name = await personName(supabase, seller.person_id);
  await recordAudit({
    area: 'wreaths',
    action: 'update',
    entityType: 'wreath_seller',
    entityId: sellerId,
    summary: `Changed ${name}’s wreath link`,
    details: [{ field: 'Link', from: seller.slug ?? '—', to: slug ?? '—' }],
    subjects: [seller.person_id]
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/** Retires or restores a seller. A retired seller keeps their link, but it opens the general store. */
export async function setSellerActive(sellerId: number, active: boolean): Promise<WreathResult> {
  await requireCapability('finance.manage');
  const supabase = createAdminClient();
  const { data: seller } = await supabase.from('wreath_sellers').select('id, person_id, active').eq('id', sellerId).maybeSingle();
  if (!seller) return fail('That seller no longer exists.');
  if (seller.active === active) return { ok: true };
  const { error } = await supabase.from('wreath_sellers').update({ active }).eq('id', sellerId);
  if (error) return fail('Couldn’t save that. Please try again.');
  const name = await personName(supabase, seller.person_id);
  await recordAudit({
    area: 'wreaths',
    action: active ? 'restore' : 'retire',
    entityType: 'wreath_seller',
    entityId: sellerId,
    summary: `${active ? 'Restored' : 'Retired'} ${name} as a wreath seller`,
    details: [{ field: 'Selling', from: active ? 'Retired' : 'Selling', to: active ? 'Selling' : 'Retired' }],
    subjects: [seller.person_id]
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/* ── orders ────────────────────────────────────────────────────────────────── */

/**
 * Marks an order paid by hand (Release A: the treasurer checks Venmo / PayPal). Idempotent — a second call on a paid
 * order changes nothing and writes no second audit row. A conditional update does the claiming, so two clicks racing
 * each other still pay it once.
 */
export async function markPaid(orderId: number, method: PaidMethod): Promise<WreathResult> {
  const actor = await requireCapability('finance.manage');
  if (!PAID_METHODS.includes(method)) return fail('Choose how it was paid.', 'method');
  const supabase = createAdminClient();
  const { data: pre } = await supabase.from('wreath_orders').select('total').eq('id', orderId).maybeSingle();
  const claimedTotal = Number(pre?.total ?? 0);
  const { data: claimed } = await supabase
    .from('wreath_orders')
    .update({ payment_status: 'paid', paid_method: method, paid_at: new Date().toISOString(), paid_by_person_id: actor.personId, paid_amount: claimedTotal })
    .eq('id', orderId)
    .eq('payment_status', 'unpaid')
    .eq('status', 'placed')
    .select('order_number, total')
    .maybeSingle();
  if (!claimed) {
    const { data: row } = await supabase.from('wreath_orders').select('payment_status, status').eq('id', orderId).maybeSingle();
    if (!row) return fail('That order no longer exists.');
    if (row.status === 'cancelled') return fail('That order is cancelled, so it can’t be marked paid.');
    if (row.payment_status === 'paid') return { ok: true, already: true };
    return fail('That order can’t be marked paid.');
  }
  await recordAudit({
    area: 'wreaths',
    action: 'mark_paid',
    entityType: 'wreath_order',
    entityId: orderId,
    summary: `Marked order ${claimed.order_number} paid`,
    details: [
      { field: 'Payment', from: 'Unpaid', to: `Paid (${method})` },
      { field: 'Amount', from: '—', to: money(Number(claimed.total)) }
    ]
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/** Cancels an order (Release A has no refunds: if it was paid, the treasurer returns the money by hand). */
export async function cancelOrder(orderId: number): Promise<WreathResult> {
  await requireCapability('finance.manage');
  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from('wreath_orders')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('status', 'placed')
    .select('order_number, payment_status, total')
    .maybeSingle();
  if (!row) return fail('That order is already cancelled, or no longer exists.');
  await recordAudit({
    area: 'wreaths',
    action: 'cancel',
    entityType: 'wreath_order',
    entityId: orderId,
    summary: `Cancelled order ${row.order_number}`,
    details: [
      { field: 'Status', from: 'Placed', to: 'Cancelled' },
      { field: 'Payment at cancel', from: '—', to: row.payment_status === 'paid' ? `Paid ${money(Number(row.total))}: refund by hand` : 'Unpaid' }
    ]
  });
  revalidatePath(PAGE);
  return { ok: true };
}

export interface ReassignInput {
  /** people.id of the scout who gets the credit (and their share); null = the troop store. */
  creditedPersonId: number | null;
  fulfillment: 'scout' | 'pickup' | 'delivery';
  /** Who delivers when fulfillment is 'scout'; defaults to the credited scout. */
  deliveringPersonId?: number | null;
  street?: string;
  city?: string;
  zip?: string;
}

const FULFILLMENT_WORDS: Record<string, string> = { scout: 'Scout delivers', pickup: 'Pickup', delivery: 'Troop delivery', none: 'Donated only' };

/**
 * Moves an order's credit and delivery between scouts, or between a scout and the troop (Decisions, "Credit and
 * reassignment"). Money already collected stays with the troop. Only a live seller can take credit or deliver; troop
 * delivery needs an address inside the delivery area; every change is audited with the old and the new.
 */
export async function reassignOrder(orderId: number, v: ReassignInput): Promise<WreathResult> {
  await requireCapability('finance.manage');
  if (!['scout', 'pickup', 'delivery'].includes(v.fulfillment)) return fail('Choose how the order is delivered.', 'fulfillment');
  const supabase = createAdminClient();
  const { data: order } = await supabase.from('wreath_orders').select('*').eq('id', orderId).maybeSingle();
  if (!order) return fail('That order no longer exists.');
  if (order.status !== 'placed') return fail('A cancelled order can’t be reassigned.');
  const { data: sale } = await supabase.from('wreath_sales').select('delivery_zip_prefix').eq('id', order.sale_id).single();

  const liveSeller = async (personId: number) => {
    const { data } = await supabase.from('wreath_sellers').select('id').eq('sale_id', order.sale_id).eq('person_id', personId).eq('active', true).limit(1);
    return (data ?? []).length > 0;
  };
  if (v.creditedPersonId != null && !(await liveSeller(v.creditedPersonId))) return fail('Only an active seller can take the credit.', 'creditedPersonId');

  // An order of only donated wreaths has nothing to deliver; only its credit can move.
  const fulfillment = order.fulfillment === 'none' ? 'none' : v.fulfillment;
  let delivering: number | null = null;
  const address = {
    customer_address: v.street?.trim() ? v.street.trim() : order.customer_address,
    customer_city: v.city?.trim() ? v.city.trim() : order.customer_city,
    customer_zip: v.zip?.trim() ? v.zip.trim() : order.customer_zip
  };
  if (fulfillment === 'scout' || fulfillment === 'delivery') {
    if (!address.customer_address) return fail('Enter the street address for delivery.', 'street');
    if (!address.customer_city) return fail('Enter the city.', 'city');
    if (!zipFormatOk(address.customer_zip ?? '')) return fail('Enter the 5-digit zip for delivery.', 'zip');
    const inside = inDeliveryArea({ deliveryZipPrefix: sale?.delivery_zip_prefix ?? '532' }, address.customer_zip as string);
    if (fulfillment === 'delivery' && !inside) return fail(`Troop delivery covers zips starting with ${sale?.delivery_zip_prefix}. Choose pickup or a scout who has agreed to deliver.`, 'zip');
    if (fulfillment === 'scout' && !inside && !order.outside_area_relative) return fail('That address is outside the delivery area, and the customer didn’t say a relative arranged it.', 'zip');
  }
  if (fulfillment === 'scout') {
    delivering = v.deliveringPersonId ?? v.creditedPersonId;
    if (delivering == null) return fail('Choose which scout delivers.', 'deliveringPersonId');
    if (!(await liveSeller(delivering))) return fail('Only an active seller can deliver.', 'deliveringPersonId');
  }

  // A change of delivery reprices the delivery fee from the order's own lines (donated lines are never delivered).
  const { data: lineRows } = await supabase.from('wreath_order_lines').select('quantity, donated, unit_price').eq('order_id', orderId);
  const deliveredCents = ((lineRows ?? []) as { quantity: number; donated: boolean; unit_price: number }[])
    .filter((l) => !l.donated)
    .reduce((n, l) => n + toCents(Number(l.unit_price)) * l.quantity, 0);
  const { data: fees } = await supabase.from('wreath_sales').select('delivery_fee, delivery_free_at').eq('id', order.sale_id).single();
  const newFee = deliveryFeeFor({ deliveryFee: Number(fees?.delivery_fee ?? 0), deliveryFreeAt: Number(fees?.delivery_free_at ?? 0) }, fulfillment, fromCents(deliveredCents));
  const newTotal = fromCents(toCents(Number(order.items_subtotal)) + toCents(newFee) + toCents(Number(order.fee_covered)) + toCents(Number(order.gift)));

  const { error } = await supabase
    .from('wreath_orders')
    .update({ credited_person_id: v.creditedPersonId, delivering_person_id: delivering, fulfillment, ...address, delivery_fee: newFee, total: newTotal })
    .eq('id', orderId);
  if (error) return fail('Couldn’t reassign the order. Please try again.');

  const names = new Map<number, string>();
  for (const id of [order.credited_person_id, order.delivering_person_id, v.creditedPersonId, delivering]) {
    if (id != null && !names.has(id)) names.set(id, await personName(supabase, id));
  }
  const who = (id: number | null) => (id == null ? 'Troop store' : (names.get(id) ?? `Person ${id}`));
  const how = (f: string, d: number | null) => (f === 'scout' ? `${FULFILLMENT_WORDS.scout} (${who(d)})` : (FULFILLMENT_WORDS[f] ?? f));
  const changes: AuditDetail[] = [];
  const diff = (field: string, from: string, to: string) => {
    if (from !== to) changes.push({ field, from: from || '—', to: to || '—' });
  };
  diff('Credited to', who(order.credited_person_id), who(v.creditedPersonId));
  diff('Delivery', how(order.fulfillment, order.delivering_person_id), how(fulfillment, delivering));
  // Deliberately no address or phone here: the audit trail is read by more people than the order screen is.
  diff('Delivery fee', money(Number(order.delivery_fee)), money(newFee));
  diff('Total', money(Number(order.total)), money(newTotal));
  await recordAudit({
    area: 'wreaths',
    action: 'reassign',
    entityType: 'wreath_order',
    entityId: orderId,
    summary: `Reassigned order ${order.order_number}: ${changes.length ? changes.map((c) => c.field).join(', ') : 'no change'}`,
    details: changes,
    subjects: [order.credited_person_id, v.creditedPersonId].filter((x): x is number => x != null)
  });
  revalidatePath(PAGE);
  return { ok: true };
}
