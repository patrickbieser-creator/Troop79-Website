'use server';

import { revalidatePath } from 'next/cache';
import { validateLeaderRecipients } from '@/lib/signup-confirmation';
import { requireCapability } from '@/lib/require-capability';
import { recordAudit, type AuditDetail } from '@/lib/audit';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToInstant, centralToday, instantToCentral } from '@/lib/dates';
import { uploadToBunny } from '@/lib/bunny-storage';
import { EMAIL_RE, PAID_METHODS, paidLedgerRow, fmtMoney2, fromCents, inDeliveryArea, itemLabel, phoneOk, repriceEdit, toCents, zipFormatOk, zipPrefixListOk, zipPrefixes, zipPrefixText, type CartLine, type Fulfillment, type PaidMethod } from '@/lib/wreaths/rules';
import { canonicalSlug, scoutDisplayName, SLUG_RE } from '@/lib/wreaths/public';
import { arrivalParagraphs } from '@/lib/wreaths/copy';
import { orderUpdatedEmail } from '@/lib/wreaths/emails';
import { sendEmail, troopEmail } from '@/lib/email';
import { siteUrl } from '@/lib/site-url';
import { fmtDateFull } from '@/lib/format-date';
import { parseDeliveryMessage, parseGoal } from '@/lib/wreaths/scout-entry';
import { cardCheckoutLive, cardDeps, expireOrderCheckout } from '@/lib/wreaths/stripe-client';
import { refundCardOrderCore } from '@/lib/wreaths/card-payments';

/**
 * Wreath sale admin (Plans/Wreath-Sale.md, Release A: Settings, Items, Sellers, Orders). Gate: `finance.manage` on
 * EVERY action, checked before anything is read or written — the page hiding a control is not enforcement. Writes
 * are service-role (the tables have RLS on and no policies). Mark paid, Edit order, cancel and every settings, item
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
  /** Order copies: up to five addresses (blanks dropped), the signup builder's leader-list rule. */
  orderCc: string[];
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
  if (!zipPrefixListOk(v.deliveryZipPrefix)) return fail('Zip prefixes are 1 to 5 digits, separated by commas, like 532, 531.', 'deliveryZipPrefix');
  const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
  if (!inRange(v.deliveryFee, 0, 100)) return fail('The delivery fee is $0 to $100.', 'deliveryFee');
  if (!inRange(v.deliveryFreeAt, 0, 10000)) return fail('Free delivery starts at $0 to $10,000.', 'deliveryFreeAt');
  if (!inRange(v.feePercent, 0, 10)) return fail('The processing fee percent is 0 to 10.', 'feePercent');
  if (!inRange(v.feeFixed, 0, 5)) return fail('The fixed processing fee is $0 to $5.', 'feeFixed');
  if (!inRange(v.scoutSharePercent, 0, 100)) return fail('The scout share is 0 to 100 percent.', 'scoutSharePercent');
  const cc = validateLeaderRecipients(Array.isArray(v.orderCc) ? v.orderCc.map(String) : []);
  if (!cc.ok) return fail(cc.errors[0], 'orderCc');

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
    delivery_zip_prefix: zipPrefixes(v.deliveryZipPrefix).join(', '),
    delivery_fee: v.deliveryFee,
    delivery_free_at: v.deliveryFreeAt,
    fee_percent: v.feePercent,
    fee_fixed: v.feeFixed,
    scout_share: Math.round(v.scoutSharePercent * 10) / 1000,
    order_cc: cc.recipients
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
  diff('Order copies', ((before.order_cc as string[] | null) ?? []).join(', '), next.order_cc.join(', '));
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

/** Sets or clears a seller's goal (whole number 0..999, empty = none). The scout's family can set it too, from Members. */
export async function setSellerGoal(sellerId: number, rawGoal: unknown): Promise<WreathResult> {
  await requireCapability('finance.manage');
  const parsed = parseGoal(rawGoal);
  if (!parsed.ok) return fail(parsed.error, 'goal');
  const supabase = createAdminClient();
  const { data: seller } = await supabase.from('wreath_sellers').select('id, person_id, goal').eq('id', sellerId).maybeSingle();
  if (!seller) return fail('That seller no longer exists.');
  if (seller.goal === parsed.goal) return { ok: true };
  const { error } = await supabase.from('wreath_sellers').update({ goal: parsed.goal }).eq('id', sellerId);
  if (error) return fail('Couldn’t save the goal. Please try again.', 'goal');
  const name = await personName(supabase, seller.person_id);
  await recordAudit({
    area: 'wreaths',
    action: 'update',
    entityType: 'wreath_seller',
    entityId: sellerId,
    summary: `Changed ${name}’s wreath goal`,
    details: [{ field: 'Goal', from: seller.goal == null ? '—' : String(seller.goal), to: parsed.goal == null ? '—' : String(parsed.goal) }],
    subjects: [seller.person_id]
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/** Sets or clears a seller's delivery message (plain text, 200 characters; live when saved). Audited. */
export async function setSellerDeliveryMessage(sellerId: number, raw: unknown): Promise<WreathResult> {
  await requireCapability('finance.manage');
  const parsed = parseDeliveryMessage(raw);
  if (!parsed.ok) return fail(parsed.error, 'deliveryMessage');
  const supabase = createAdminClient();
  const { data: seller } = await supabase.from('wreath_sellers').select('id, person_id, delivery_message').eq('id', sellerId).maybeSingle();
  if (!seller) return fail('That seller no longer exists.');
  if ((seller.delivery_message ?? null) === parsed.message) return { ok: true };
  const { error } = await supabase.from('wreath_sellers').update({ delivery_message: parsed.message }).eq('id', sellerId);
  if (error) return fail('Couldn’t save the message. Please try again.', 'deliveryMessage');
  const name = await personName(supabase, seller.person_id);
  await recordAudit({
    area: 'wreaths',
    action: 'update',
    entityType: 'wreath_seller',
    entityId: sellerId,
    summary: `Changed ${name}’s wreath delivery message`,
    details: [{ field: 'Delivery message', from: seller.delivery_message ?? '—', to: parsed.message ?? '—' }],
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
 *
 * `received` is what actually came in, when it isn't the whole total (Patrick, 2026-10-18: W-1022 came in a little
 * short and was let through). The order keeps its total; paid_amount and the ledger row hold what arrived, and the
 * shortfall is the troop's to absorb (see acceptedShort). More than the total is refused.
 */
export async function markPaid(orderId: number, method: PaidMethod, received?: number): Promise<WreathResult> {
  const actor = await requireCapability('finance.manage');
  if (!PAID_METHODS.includes(method)) return fail('Choose how it was paid.', 'method');
  // Paid another way: its card session must not stay payable (Release B).
  await expireOrderCheckout(orderId);
  const supabase = createAdminClient();
  const { data: pre } = await supabase.from('wreath_orders').select('total, fee_covered, collected_by_scout').eq('id', orderId).maybeSingle();
  // The cover-the-card-fee amount belongs to card payment only (Release B): paid another way, the order owes without it.
  const claimedTotal = fromCents(toCents(Number(pre?.total ?? 0)) - toCents(Number(pre?.fee_covered ?? 0)));
  const paidAmount = received === undefined ? claimedTotal : fromCents(toCents(received));
  if (received !== undefined && !(Number.isFinite(received) && paidAmount > 0)) return fail('Enter the amount that came in.', 'amount');
  if (paidAmount > claimedTotal) return fail(`That’s more than the ${money(claimedTotal)} total.`, 'amount');
  const { data: claimed } = await supabase
    .from('wreath_orders')
    .update({ payment_status: 'paid', paid_method: method, paid_at: new Date().toISOString(), paid_by_person_id: actor.personId, paid_amount: paidAmount, fee_covered: 0, total: claimedTotal, collected_by_scout: true })
    .eq('id', orderId)
    .eq('payment_status', 'unpaid')
    .eq('status', 'placed')
    // qa-lead: a Reassign landing between the read and the claim changes the total — don't pay against the stale one.
    .eq('total', Number(pre?.total ?? 0))
    .eq('fee_covered', Number(pre?.fee_covered ?? 0))
    .select('order_number, total, customer_name, wreath_sales(year)')
    .maybeSingle();
  if (!claimed) {
    const { data: row } = await supabase.from('wreath_orders').select('payment_status, status').eq('id', orderId).maybeSingle();
    if (!row) return fail('That order no longer exists.');
    if (row.status === 'cancelled') return fail('That order is cancelled, so it can’t be marked paid.');
    if (row.payment_status === 'paid') return { ok: true, already: true };
    return fail('That order changed while you were marking it paid. Check its total and try again.');
  }
  // Book the money into the finance ledger (Patrick, 2026-10-15). Only the claiming call gets here, and the live-row
  // unique index on wreath_order_id backs that up. If the ledger refuses the row, the payment is put back so an order
  // is never paid without its ledger line.
  // The amount the claim recorded as paid_amount — the ledger books the same figure.
  const total = paidAmount;
  const short = fromCents(toCents(claimedTotal) - toCents(paidAmount));
  let ledger: AuditDetail | null = null;
  if (total > 0) {
    const sale = claimed.wreath_sales as unknown as { year: number } | null;
    const row = paidLedgerRow({
      orderNumber: claimed.order_number,
      customerName: claimed.customer_name,
      total,
      method,
      saleYear: sale?.year ?? Number(centralToday().slice(0, 4)),
      today: centralToday()
    });
    const { bucket, ...fields } = row;
    const { data: bucketId, error: bucketError } = await supabase.rpc('bucket_id_for_name', { p_name: bucket });
    const { error: ledgerError } = bucketError
      ? { error: bucketError }
      : await supabase
          .from('financial_transactions')
          .insert({ ...fields, bucket_id: bucketId as number, wreath_order_id: orderId, source: 'app', entered_by_person_id: actor.personId });
    if (ledgerError) {
      const { error: revertError } = await supabase
        .from('wreath_orders')
        .update({ payment_status: 'unpaid', paid_method: null, paid_at: null, paid_by_person_id: null, paid_amount: null, collected_by_scout: pre?.collected_by_scout ?? false })
        .eq('id', orderId)
        .eq('payment_status', 'paid');
      if (revertError) {
        console.error('[wreaths] markPaid: ledger insert and revert both failed', orderId, ledgerError.message, revertError.message);
        return fail(`${claimed.order_number} is marked paid but its finance ledger line was not recorded. Add it in Finance by hand.`);
      }
      return fail('The finance ledger couldn’t record this payment, so the order is still unpaid. Try again.');
    }
    ledger = { field: 'Finance ledger', from: '—', to: `${money(total)} to checking (${row.bucket})` };
  }
  await recordAudit({
    area: 'wreaths',
    action: 'mark_paid',
    entityType: 'wreath_order',
    entityId: orderId,
    summary: `Marked order ${claimed.order_number} paid`,
    details: [
      { field: 'Payment', from: 'Unpaid', to: `Paid (${method})` },
      { field: 'Amount', from: '—', to: short > 0 ? `${money(total)} of ${money(claimedTotal)} (${money(short)} short, accepted)` : money(total) },
      ...(ledger ? [ledger] : [])
    ]
  });
  revalidatePath('/admin/finance');
  revalidatePath(PAGE);
  return { ok: true };
}

/**
 * The treasurer's edit of an order's payment note ("Venmo'd Patrick 10/20"), on any order, paid or not. 200 characters.
 * Audited with the old and the new text; empty clears it.
 */
export async function setPaymentNote(orderId: number, noteIn: string): Promise<WreathResult> {
  await requireCapability('finance.manage');
  const note = typeof noteIn === 'string' ? noteIn.trim() : '';
  if (note.length > 200) return fail('A payment note is 200 characters at most.', 'paymentNote');
  const supabase = createAdminClient();
  const { data: before } = await supabase.from('wreath_orders').select('order_number, payment_note').eq('id', orderId).maybeSingle();
  if (!before) return fail('That order no longer exists.');
  if ((before.payment_note ?? '') === note) return { ok: true };
  const { error } = await supabase.from('wreath_orders').update({ payment_note: note || null }).eq('id', orderId);
  if (error) return fail('Couldn’t save the note. Please try again.', 'paymentNote');
  await recordAudit({
    area: 'wreaths',
    action: 'update',
    entityType: 'wreath_order',
    entityId: orderId,
    summary: `Edited the payment note on order ${before.order_number}`,
    details: [{ field: 'Payment note', from: before.payment_note || '—', to: note || '—' }]
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/**
 * Refunds a card-paid order in full through Stripe, then cancels it (Release B; tech-lead: Stripe first, then cancel).
 * Also returns a flagged card payment — one that landed on a cancelled order, an order paid another way, or with the
 * wrong amount — without touching the order's own payment. The amount and PaymentIntent come from the database; the
 * charge.refunded webhook marks the order refunded and books the ledger reversal.
 */
export async function refundCardOrder(orderId: number): Promise<WreathResult> {
  await requireCapability('finance.manage');
  if (!cardCheckoutLive()) return fail('Card payments aren’t configured, so there is nothing to refund here.');
  const supabase = createAdminClient();
  const { data: before } = await supabase.from('wreath_orders').select('order_number, paid_method, payment_status, needs_refund, total, paid_amount').eq('id', orderId).maybeSingle();
  if (!before) return fail('That order no longer exists.');
  const res = await refundCardOrderCore(orderId, cardDeps());
  if (!res.ok) return fail(res.error);
  const fullRefund = !res.stray && before.paid_method === 'card' && before.payment_status === 'paid';
  if (fullRefund) {
    await supabase.from('wreath_orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', orderId).eq('status', 'placed');
  }
  await recordAudit({
    area: 'wreaths',
    action: 'refund_card',
    entityType: 'wreath_order',
    entityId: orderId,
    summary: `Refunded the card payment for order ${before.order_number}`,
    details: [
      { field: 'Refund', from: '—', to: fullRefund ? `${money(Number(before.paid_amount ?? before.total))} to the card; order cancelled` : `Stray card payment returned (${before.needs_refund ?? 'duplicate'}); the order's own payment stands` },
      { field: 'Stripe refund', from: '—', to: res.refundId }
    ]
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/** Cancels an order (Release A has no refunds: if it was paid, the treasurer returns the money by hand). */
export async function cancelOrder(orderId: number): Promise<WreathResult> {
  await requireCapability('finance.manage');
  await expireOrderCheckout(orderId);
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

export interface EditOrderInput {
  /** What the dialog was opened on: an order that has changed since (paid, repriced) is refused, not overwritten. */
  seen: { total: number; paymentStatus: string };
  lines: CartLine[];
  gift: number;
  customer: { name: string; email: string; phone: string; street: string; city: string; zip: string };
  /** people.id of the scout who gets the credit (and their share); null = the troop store. */
  creditedPersonId: number | null;
  /** Ignored when every line is donated: the order then has nothing to deliver. */
  fulfillment: 'scout' | 'pickup' | 'delivery';
  /** Who delivers when fulfillment is 'scout'; defaults to the credited scout. */
  deliveringPersonId?: number | null;
  /** Paid by hand only (never card, never unpaid): what came in and how. A change rebooks the ledger. */
  payment?: { method: PaidMethod; received: number; acceptShort: boolean };
  /** Email the customer the updated order (never on a scout-entered order). */
  notifyCustomer?: boolean;
}

const FULFILLMENT_WORDS: Record<string, string> = { scout: 'Scout delivers', pickup: 'Pickup', delivery: 'Troop delivery', none: 'Donated only' };

const PRICE_PROBLEM: Record<string, string> = {
  empty: 'An order needs at least one item. To drop them all, cancel the order instead.',
  too_many_lines: 'That is too many different items for one order.',
  unknown_item: 'One of the items isn’t in this sale.',
  not_donatable: 'One of the items can’t be donated.',
  quantity: 'Each quantity is 1 to 50.',
  gift: 'A gift is $0 to $500.',
  inactive_item: 'One of the items isn’t on sale.'
};

/**
 * The treasurer's full edit of an order (Patrick, 2026-10-18: a customer ordered the wrong item, then paid by Venmo for
 * a different one): items, gift, contact, credit and delivery (Reassign's rules, which this replaced), and on an order
 * paid by hand the payment itself. Prices come from repriceEdit — a kept line keeps what it sold at. One RPC applies it
 * all atomically, guarded by what the dialog saw (tech-lead, 2026-10-18).
 *
 * Payment rules: an unpaid order takes no payment fields (Mark paid does that). A card-paid order's total can't change
 * (Stripe holds the money: refund first). On an order paid by hand, a total above what came in needs the shortfall
 * accepted (it then reads as accepted short, as on Mark paid); a total below it is owed back unless the dialog turned
 * the extra into a gift. A changed amount or method voids the ledger row and books the corrected one on the same day.
 */
export async function editOrder(orderId: number, v: EditOrderInput): Promise<WreathResult> {
  const actor = await requireCapability('finance.manage');
  if (!['scout', 'pickup', 'delivery'].includes(v.fulfillment)) return fail('Choose how the order is delivered.', 'fulfillment');
  const name = v.customer.name.trim();
  const email = v.customer.email.trim().toLowerCase();
  const phone = v.customer.phone.trim();
  if (!name) return fail('Enter the customer’s name.', 'name');
  if (name.length > 120) return fail('Keep the name under 120 characters.', 'name');
  if (email && (!EMAIL_RE.test(email) || email.length > 200)) return fail('That email address doesn’t look right.', 'email');
  if (phone && !phoneOk(phone)) return fail('Enter a 10-digit phone number.', 'phone');
  const supabase = createAdminClient();
  const { data: order } = await supabase.from('wreath_orders').select('*, wreath_order_lines(item_id, quantity, donated, unit_price, unit_cost)').eq('id', orderId).maybeSingle();
  if (!order) return fail('That order no longer exists.');
  if (order.status !== 'placed') return fail('A cancelled order can’t be edited.');
  if (toCents(Number(order.total)) !== toCents(v.seen.total) || order.payment_status !== v.seen.paymentStatus) return fail('That order changed while you were editing it. Close this and open it again.');
  const byCard = order.paid_method === 'card';
  const byHand = order.payment_status === 'paid' && !byCard;
  if (v.payment && !byHand) return fail(byCard ? 'A card payment can’t be changed here.' : 'Mark the order paid first; then its payment can be corrected here.');
  if (byHand && !v.payment) return fail('Enter the amount that came in.', 'received');

  const { data: sale } = await supabase.from('wreath_sales').select('*').eq('id', order.sale_id).single();
  const { data: itemRows } = await supabase.from('wreath_items').select('id, catalog_number, name, size, price, unit_cost, active, donatable').eq('sale_id', order.sale_id);
  const items = (itemRows ?? []) as { id: number; catalog_number: number; name: string; size: string; price: number; unit_cost: number; active: boolean; donatable: boolean }[];
  const oldLines = (order.wreath_order_lines ?? []) as { item_id: number; quantity: number; donated: boolean; unit_price: number; unit_cost: number }[];
  const allDonated = v.lines.length > 0 && v.lines.every((l) => l.donated);
  const fulfillment: Fulfillment = allDonated ? 'none' : v.fulfillment;
  const rules = {
    deliveryZipPrefix: sale?.delivery_zip_prefix ?? '532',
    deliveryFee: Number(sale?.delivery_fee ?? 0),
    deliveryFreeAt: Number(sale?.delivery_free_at ?? 0),
    feePercent: Number(sale?.fee_percent ?? 0),
    feeFixed: Number(sale?.fee_fixed ?? 0),
    round1Cutoff: sale?.round1_cutoff ?? '',
    round2Cutoff: sale?.round2_cutoff ?? ''
  };
  const priced = repriceEdit(
    rules,
    items.map((i) => ({ id: i.id, catalogNumber: i.catalog_number, price: Number(i.price), unitCost: Number(i.unit_cost), active: i.active, donatable: i.donatable })),
    oldLines.map((l) => ({ itemId: l.item_id, donated: l.donated, unitPrice: Number(l.unit_price), unitCost: Number(l.unit_cost) })),
    v.lines,
    // An unpaid order whose customer chose to cover the card fee keeps covering it, on the new amount.
    { fulfillment, gift: v.gift, coverFee: order.payment_status === 'unpaid' && Number(order.fee_covered) > 0 }
  );
  if (!priced.ok) return fail(PRICE_PROBLEM[priced.problem.code] ?? 'Check the items.', priced.problem.code === 'gift' ? 'gift' : 'lines');
  // A card payment already covered its fee: that amount is part of what Stripe took, so it stays as it is (qa-lead).
  const coveredByCard = byCard ? Number(order.fee_covered) : 0;
  const next = coveredByCard > 0 ? { ...priced.order, feeCovered: coveredByCard, total: fromCents(toCents(priced.order.total) + toCents(coveredByCard)) } : priced.order;
  if (byCard && toCents(next.total) !== toCents(Number(order.total))) return fail('This order was paid by card, so its total can’t change here. Refund it first, or keep the total the same.', 'lines');

  // Credit and delivery: Reassign's rules.
  const liveSeller = async (personId: number) => {
    const { data } = await supabase.from('wreath_sellers').select('id').eq('sale_id', order.sale_id).eq('person_id', personId).eq('active', true).limit(1);
    return (data ?? []).length > 0;
  };
  if (v.creditedPersonId != null && v.creditedPersonId !== order.credited_person_id && !(await liveSeller(v.creditedPersonId))) return fail('Only an active seller can take the credit.', 'creditedPersonId');
  const address = { customer_address: v.customer.street.trim(), customer_city: v.customer.city.trim(), customer_zip: v.customer.zip.trim() };
  if (fulfillment === 'scout' || fulfillment === 'delivery') {
    if (!address.customer_address) return fail('Enter the street address for delivery.', 'street');
    if (!address.customer_city) return fail('Enter the city.', 'city');
    if (!zipFormatOk(address.customer_zip)) return fail('Enter the 5-digit zip for delivery.', 'zip');
    const inside = inDeliveryArea(rules, address.customer_zip);
    if (fulfillment === 'delivery' && !inside) return fail(`Troop delivery covers zips starting with ${zipPrefixText(rules.deliveryZipPrefix)}. Choose pickup or a scout who has agreed to deliver.`, 'zip');
    if (fulfillment === 'scout' && !inside && !order.outside_area_relative) return fail('That address is outside the delivery area, and the customer didn’t say a relative arranged it.', 'zip');
  } else if (address.customer_zip && !zipFormatOk(address.customer_zip)) return fail('Enter a 5-digit zip, or leave it empty.', 'zip');
  let delivering: number | null = null;
  if (fulfillment === 'scout') {
    delivering = v.deliveringPersonId ?? v.creditedPersonId;
    if (delivering == null) return fail('Choose which scout delivers.', 'deliveringPersonId');
    if (delivering !== order.delivering_person_id && !(await liveSeller(delivering))) return fail('Only an active seller can deliver.', 'deliveringPersonId');
  }

  // The payment, on an order paid by hand.
  const oldPaid = order.paid_amount == null ? null : Number(order.paid_amount);
  let paid: { method: PaidMethod; amount: number } | null = null;
  if (byHand && v.payment) {
    if (!PAID_METHODS.includes(v.payment.method)) return fail('Choose how it was paid.', 'method');
    const amount = fromCents(toCents(v.payment.received));
    if (!(Number.isFinite(v.payment.received) && amount > 0)) return fail('Enter the amount that came in.', 'received');
    if (amount > 10000) return fail('That amount is too large.', 'received');
    if (toCents(amount) < toCents(next.total) && !v.payment.acceptShort) {
      return fail(`${money(amount)} came in, ${money(fromCents(toCents(next.total) - toCents(amount)))} short of the ${money(next.total)} total. Accept the shortfall, or change the items.`, 'received');
    }
    paid = { method: v.payment.method, amount };
  }
  const rebook = paid != null && (toCents(paid.amount) !== toCents(oldPaid ?? 0) || paid.method !== order.paid_method);
  const { data: liveLedger } = await supabase
    .from('financial_transactions')
    .select('id, amount')
    .eq('wreath_order_id', orderId)
    .eq('ledger_role', 'payment')
    .is('voided_at', null)
    .maybeSingle();
  const saleYear = Number(sale?.year ?? centralToday().slice(0, 4));
  const ledgerRow =
    rebook && liveLedger && paid
      ? paidLedgerRow({ orderNumber: order.order_number, customerName: name, total: paid.amount, method: paid.method, saleYear, today: centralToday() })
      : null;

  // A change to what the order owes or how it was paid: the open card session would charge the old amount. Only then,
  // and only once the edit is valid, so a refused or contact-only edit leaves the customer's checkout alone (qa-lead).
  if (toCents(next.total) !== toCents(Number(order.total)) || rebook) await expireOrderCheckout(orderId);
  const { data: outcome, error } = await supabase.rpc('wreath_edit_order', {
    p: {
      order_id: orderId,
      expect: {
        payment_status: order.payment_status,
        total: Number(order.total),
        paid_amount: order.paid_amount == null ? '' : Number(order.paid_amount),
        paid_method: order.paid_method ?? '',
        ledger_id: liveLedger?.id ?? '',
        ledger_amount: liveLedger ? Number(liveLedger.amount) : 0
      },
      order: {
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        ...address,
        credited_person_id: v.creditedPersonId ?? '',
        delivering_person_id: delivering ?? '',
        fulfillment,
        items_subtotal: next.itemsSubtotal,
        delivery_fee: next.deliveryFee,
        fee_covered: next.feeCovered,
        gift: next.gift,
        total: next.total,
        ...(paid ? { paid_method: paid.method, paid_amount: paid.amount } : {})
      },
      lines: next.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, donated: l.donated, unit_price: l.unitPrice, unit_cost: l.unitCost })),
      ledger: ledgerRow ? { amount: ledgerRow.amount, method: ledgerRow.method, memo: ledgerRow.memo, actor_person_id: actor.personId ?? '' } : null
    }
  });
  if (error) {
    console.error('[wreaths] editOrder', orderId, error.message);
    return fail('Couldn’t save the order. Please try again.');
  }
  if (outcome !== 'ok') return fail(outcome === 'cancelled' ? 'That order was cancelled, so it can’t be edited.' : outcome === 'missing' ? 'That order no longer exists.' : 'That order changed while you were editing it. Close this and open it again.');

  // The audit: old and new as readable text. Never the address, phone or email values (read by more people than Orders).
  const itemById = new Map(items.map((i) => [i.id, i]));
  const lineText = (ls: { itemId: number; quantity: number; donated: boolean }[]) =>
    ls
      .map((l) => {
        const it = itemById.get(l.itemId);
        return `${l.quantity} × ${it ? itemLabel(it) : 'Item'}${l.donated ? ' (donated)' : ''}`;
      })
      .sort()
      .join(', ');
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
  const changed = (field: string, from: string | null, to: string) => {
    if ((from ?? '') !== to) changes.push({ field, from: from ? 'On file' : '—', to: to ? 'Changed' : 'Removed' });
  };
  diff('Items', lineText(oldLines.map((l) => ({ itemId: l.item_id, quantity: l.quantity, donated: l.donated }))), lineText(next.lines));
  diff('Gift', money(Number(order.gift)), money(next.gift));
  diff('Delivery fee', money(Number(order.delivery_fee)), money(next.deliveryFee));
  diff('Processing fee', money(Number(order.fee_covered)), money(next.feeCovered));
  diff('Total', money(Number(order.total)), money(next.total));
  diff('Customer name', order.customer_name, name);
  changed('Email', order.customer_email, email);
  changed('Phone', order.customer_phone, phone);
  if ((order.customer_address ?? '') !== address.customer_address || (order.customer_city ?? '') !== address.customer_city || (order.customer_zip ?? '') !== address.customer_zip) {
    changes.push({ field: 'Address', from: order.customer_address ? 'On file' : '—', to: address.customer_address ? 'Changed' : 'Removed' });
  }
  diff('Credited to', who(order.credited_person_id), who(v.creditedPersonId));
  diff('Delivery', how(order.fulfillment, order.delivering_person_id), how(fulfillment, delivering));
  if (paid) {
    const shortBy = fromCents(toCents(next.total) - toCents(paid.amount));
    diff('Payment', `${money(oldPaid ?? 0)} (${order.paid_method})`, `${money(paid.amount)} (${paid.method})${shortBy > 0 ? `, ${money(shortBy)} short, accepted` : shortBy < 0 ? `, ${money(-shortBy)} owed back` : ''}`);
    if (rebook) diff('Finance ledger', liveLedger ? `${money(Number(liveLedger.amount))} (voided)` : '—', ledgerRow ? `${money(ledgerRow.amount)} to checking` : 'No linked ledger line: correct it in Finance by hand');
  }
  if (changes.length) {
    await recordAudit({
      area: 'wreaths',
      action: 'edit',
      entityType: 'wreath_order',
      entityId: orderId,
      summary: `Edited order ${order.order_number}: ${changes.map((c) => c.field).join(', ')}`,
      details: changes,
      subjects: [order.credited_person_id, v.creditedPersonId].filter((x): x is number => x != null)
    });
  }

  // Best effort, after the edit is safely written; never on a scout-entered order (its customer is never emailed).
  if (v.notifyCustomer && email && order.source !== 'paper') {
    try {
      const credited = v.creditedPersonId == null ? null : await scoutLabel(supabase, v.creditedPersonId);
      const deliverer = delivering == null ? null : delivering === v.creditedPersonId ? credited : await scoutLabel(supabase, delivering);
      const ctx = {
        orderNumber: order.order_number,
        customerName: name,
        items: next.lines.map((l) => {
          const it = itemById.get(l.itemId);
          return { label: it ? itemLabel(it) : 'Item', quantity: l.quantity, donated: l.donated, amount: fromCents(toCents(l.unitPrice) * l.quantity) };
        }),
        itemsSubtotal: next.itemsSubtotal,
        deliveryFee: next.deliveryFee,
        feeCovered: next.feeCovered,
        gift: next.gift,
        total: next.total,
        arrival: arrivalParagraphs({
          fulfillment,
          scoutName: deliverer?.name ?? null,
          scoutFirstName: deliverer?.firstName ?? null,
          outsideAreaRelative: order.outside_area_relative,
          hasDonated: next.lines.some((l) => l.donated),
          distribution: { date: sale?.distribution_date ?? null, window: sale?.distribution_window ?? '', place: sale?.distribution_place ?? '' }
        }).join(' '),
        creditedTo: credited?.name ?? null,
        orderUrl: `${siteUrl()}/wreaths/order/${order.public_token}`,
        changesBy: fmtDateFull(order.round === 1 ? rules.round1Cutoff : rules.round2Cutoff),
        paid: order.payment_status === 'paid' ? (paid?.amount ?? oldPaid ?? next.total) : null
      };
      const mail = orderUpdatedEmail(ctx);
      await sendEmail({ to: [email], subject: mail.subject, html: mail.html, text: mail.text, replyTo: troopEmail(), confirm: true });
      const copyTo = (((sale?.order_cc as string[] | null) ?? []) as string[]).filter((a) => a && a !== email);
      if (copyTo.length) {
        const cc = orderUpdatedEmail(ctx, { sentTo: name });
        await sendEmail({ to: copyTo, subject: cc.subject, html: cc.html, text: cc.text, replyTo: troopEmail(), confirm: true });
      }
    } catch (e) {
      console.error('[wreaths] editOrder email', orderId, e instanceof Error ? e.message : e);
    }
  }
  revalidatePath('/admin/finance');
  revalidatePath(PAGE);
  return { ok: true };
}

/** "Ben B." and "Ben": how the customer's email names a scout. */
async function scoutLabel(supabase: ReturnType<typeof createAdminClient>, personId: number): Promise<{ name: string; firstName: string }> {
  const { data } = await supabase.from('people').select('first_name, last_name').eq('id', personId).maybeSingle();
  return scoutDisplayName(data?.first_name ?? null, data?.last_name ?? null);
}
