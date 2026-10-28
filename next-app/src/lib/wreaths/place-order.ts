/**
 * Wreath sale — the one place a customer order is validated, priced and written (Plans/Wreath-Sale.md, "The order
 * action"). The server action in (public)/wreaths/actions.ts is a thin shell that supplies the live clock, IP and
 * mailer; every rule is here so tests can drive it with fakes and a real local database.
 *
 *   - Prices come from wreath_items; anything price-shaped in the request is ignored.
 *   - Bot controls: a honeypot field, a minimum time-to-submit, and DB-counted limits (per IP per hour, per customer
 *     email per day, a global hourly cap). Over a limit — or any spam signal — the answer is one generic message:
 *     no order, no email, and nothing that says which control tripped.
 *   - Idempotent on a client-generated key: a retry returns the same order and sends no second email.
 *   - The credited scout comes only from a live seller link. The general store is the troop's, whatever the client says.
 *   - Emails never block or fail the order.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtDateFull } from '@/lib/format-date';
import { arrivalParagraphs } from './copy';
import { customerConfirmationEmail, scoutEntryConfirmationEmail, scoutNoticeEmail, type OrderEmailContext } from './emails';
import { SLUG_RE, saleFromRow, scoutDisplayName, type PublicSale } from './public';
import {
  EMAIL_RE,
  MAX_GIFT,
  EMPTY_ENTRY,
  MIN_DONATION,
  MIN_SUBMIT_MS,
  decideRound,
  inDeliveryArea,
  itemLabel,
  phoneOk,
  priceCart,
  toCents,
  zipFormatOk,
  zipPrefixText,
  type CartLine,
  type Fulfillment,
  type PricedItem
} from './rules';

/** perSellerNoticeDay caps the notes mailed to one scout's household per day, so a forged link can't use us as a mailer. */
export const RATE_LIMITS = { perIpHour: 10, perEmailDay: 5, globalHour: 200, perSellerNoticeDay: 20, perEntererHour: 60 };
export type RateLimits = typeof RATE_LIMITS;

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface PlaceOrderDeps {
  supabase: SupabaseClient;
  now: () => number;
  /** From the platform's trusted header (the action reads it); null in local dev. */
  ip: string | null;
  send: (m: EmailMessage) => Promise<unknown>;
  /** Deliverable addresses on file for a scout's household. Never a customer-supplied address. */
  householdEmails: (personId: number) => Promise<string[]>;
  siteUrl: string;
  replyTo: string;
  /** Tests name their own sale; production takes the open one. */
  saleId?: number;
  limits?: Partial<RateLimits>;
  /**
   * Scout-entry mode ("Order for someone I know"). Set ONLY by the signed-in server action, from the session, never
   * from the request body: `viewer` is who the session says is typing (with the people they may sell as: themself,
   * or their children), `emails` their own deliverable addresses. Absent = the public store, unchanged.
   */
  scoutEntry?: { viewer: ScoutEntryViewer; emails: string[] };
}

/** A signed-in person and the scouts they may enter orders for (lib/household-scope's resolveFamilyScope). */
export interface ScoutEntryViewer {
  personId: number;
  name: string;
  /** people.id of everyone this viewer acts for: themself plus children via parent_of / guardian_of. */
  scope: number[];
  /**
   * Set only for a super user (the session holds finance.manage; W-4, paper orders typed in for a scout): their own
   * family scope. Their `scope` is then widened to every active wreath seller, so this is how a page tells "my
   * scout" from "entering for someone else's scout". Absent = an ordinary family viewer, whose scope is the family.
   */
  household?: number[];
}

export type OrderField = 'cart' | 'name' | 'email' | 'phone' | 'street' | 'city' | 'zip' | 'method' | 'gift' | 'relative' | 'credit' | 'note' | 'paymentNote';

export type PlaceOrderResult =
  | { ok: true; token: string; orderNumber: string; created: boolean; confirmedTo?: string[] }
  | { ok: false; code: 'invalid' | 'closed' | 'unavailable' | 'link_inactive' | 'forbidden'; error: string; field?: OrderField };

const UNAVAILABLE = (replyTo: string): PlaceOrderResult => ({
  ok: false,
  code: 'unavailable',
  error: `We couldn’t place your order just now. Please try again in a few minutes, or email ${replyTo}.`
});
const CLOSED: PlaceOrderResult = { ok: false, code: 'closed', error: 'Sorry, the wreath sale isn’t taking new orders right now.' };
const invalid = (field: OrderField, error: string): PlaceOrderResult => ({ ok: false, code: 'invalid', error, field });

/* ── reading the untrusted request ─────────────────────────────────────────── */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return v == null ? '' : null;
  const t = v.trim();
  return t.length > max ? null : t;
};
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN);

interface ParsedRequest {
  idempotencyKey: string;
  sellerSlug: string | null;
  lines: CartLine[];
  gift: number;
  coverFee: boolean;
  /** The customer chose card at checkout and is on the way to Stripe: the confirmation names no other way to pay. */
  payByCard: boolean;
  fulfillment: 'pickup' | 'delivery' | null;
  name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  zip: string;
  outsideAreaRelative: boolean;
  /** wreath_sellers.id of a scout the customer chose to credit (general store only); undefined = not sent, null = troop. */
  creditSellerId: number | null | 'bad';
  startedAt: number | null;
  mountedAt: number | null;
  website: string;
  /** Scout-entry fields; read always, used only when the server put the order in scout-entry mode. */
  note: string;
  collected: boolean;
  paymentNote: string;
}

function parseRequest(raw: unknown): ParsedRequest | { error: PlaceOrderResult } {
  if (!isObj(raw)) return { error: invalid('cart', 'Something went wrong with your order. Please reload the page and try again.') };
  const key = typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey.trim() : '';
  if (key.length < 8 || key.length > 80) return { error: invalid('cart', 'Something went wrong with your order. Please reload the page and try again.') };
  const cust = isObj(raw.customer) ? raw.customer : {};
  const name = text(cust.name, 100);
  const email = text(cust.email, 254);
  const phone = text(cust.phone, 30);
  const street = text(cust.street, 120);
  const city = text(cust.city, 80);
  const zip = text(cust.zip, 10);
  if (name === null) return { error: invalid('name', 'That name is too long.') };
  if (email === null) return { error: invalid('email', 'That email address is too long.') };
  if (phone === null) return { error: invalid('phone', 'That phone number is too long.') };
  if (street === null) return { error: invalid('street', 'That street address is too long.') };
  if (city === null) return { error: invalid('city', 'That city name is too long.') };
  if (zip === null) return { error: invalid('zip', 'A zip is 5 digits.') };
  const note = text(cust.note, 300);
  const paymentNote = text(raw.paymentNote, 200);
  if (note === null) return { error: invalid('note', 'That note is too long. 300 characters at most.') };
  if (paymentNote === null) return { error: invalid('paymentNote', 'That payment note is too long. 200 characters at most.') };
  const lines: CartLine[] = [];
  if (Array.isArray(raw.lines)) {
    for (const l of raw.lines.slice(0, 200)) {
      if (!isObj(l)) continue;
      lines.push({ itemId: num(l.itemId), quantity: num(l.quantity), donated: l.donated === true });
    }
  }
  const slug = typeof raw.sellerSlug === 'string' && raw.sellerSlug.trim() ? raw.sellerSlug.trim().slice(0, 80) : null;
  const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    idempotencyKey: key,
    sellerSlug: slug,
    lines,
    gift: raw.gift == null || raw.gift === '' ? 0 : num(raw.gift),
    coverFee: raw.coverFee === true,
    payByCard: raw.payByCard === true,
    fulfillment: raw.fulfillment === 'pickup' || raw.fulfillment === 'delivery' ? raw.fulfillment : null,
    name,
    email: email.toLowerCase(),
    phone,
    street,
    city,
    zip,
    outsideAreaRelative: raw.outsideAreaRelative === true,
    creditSellerId: raw.creditSellerId == null ? null : Number.isInteger(raw.creditSellerId) && (raw.creditSellerId as number) > 0 ? (raw.creditSellerId as number) : 'bad',
    startedAt: ms(raw.startedAt),
    mountedAt: ms(raw.mountedAt),
    website: typeof raw.website === 'string' ? raw.website : '',
    note,
    collected: raw.collected === true,
    paymentNote
  };
}

/* ── the action ────────────────────────────────────────────────────────────── */

export async function placeOrder(raw: unknown, deps: PlaceOrderDeps): Promise<PlaceOrderResult> {
  const sb = deps.supabase;
  const now = deps.now();
  const parsed = parseRequest(raw);
  if ('error' in parsed) return parsed.error;
  const req = parsed;

  // Scout-entry mode: the caller is a signed-in family member (the action vouches for that), not an anonymous visitor.
  const entry = deps.scoutEntry ?? null;

  // Spam signals first: a filled honeypot, or a form posted before a person could have filled it. (A signed-in
  // family member entering orders has no bot to fear and no reason to wait four seconds.)
  if (!entry) {
    if (req.website.trim() !== '') return UNAVAILABLE(deps.replyTo);
    if (req.mountedAt == null || now - req.mountedAt < MIN_SUBMIT_MS) return UNAVAILABLE(deps.replyTo);
  }

  // A retry of an order already placed returns that order (no second row, no second email).
  const existing = await sb.from('wreath_orders').select('order_number, public_token').eq('idempotency_key', req.idempotencyKey).maybeSingle();
  if (existing.data) {
    const e = existing.data as { order_number: string; public_token: string };
    return { ok: true, token: e.public_token, orderNumber: e.order_number, created: false };
  }

  // The sale and the round.
  const saleQ = sb
    .from('wreath_sales')
    .select(
      'id, year, status, round1_cutoff, round2_cutoff, distribution_date, distribution_window, distribution_place, delivery_zip_prefix, delivery_fee, delivery_free_at, fee_percent, fee_fixed, scout_share, donation_scout_share, order_cc'
    );
  const { data: saleRows } = await (deps.saleId != null ? saleQ.eq('id', deps.saleId) : saleQ.eq('status', 'open').order('year', { ascending: false }).limit(1));
  const saleRow = ((saleRows ?? []) as Parameters<typeof saleFromRow>[0][])[0];
  if (!saleRow) return CLOSED;
  const sale: PublicSale = saleFromRow(saleRow);
  // Settings › Order copies: a marked copy of the order's confirmation ("Copy:" subject, a line on top), sent apart
  // from the original. Never on the scout's household notice. (sendEmail sends each address its own message.)
  const orderCc = ((saleRow as { order_cc?: string[] | null }).order_cc ?? []).filter(Boolean);
  if (sale.status !== 'open') return CLOSED;
  const round = decideRound(sale, now, deps.scoutEntry ? null : req.startedAt);
  if (round == null) return CLOSED;

  // Rate limits, counted from the orders table itself.
  const limits = { ...RATE_LIMITS, ...deps.limits };
  const since = (ms: number) => new Date(now - ms).toISOString();
  const count = async (apply: (q: ReturnType<typeof baseCount>) => ReturnType<typeof baseCount>) => {
    const { count: c } = await apply(baseCount());
    return c ?? 0;
  };
  function baseCount() {
    return sb.from('wreath_orders').select('id', { count: 'exact', head: true });
  }
  // The public store's global cap counts public orders only: signed-in scout entries (source 'paper') neither
  // count toward it nor are stopped by it, so a family entering orders can't lock out public shoppers.
  if (!entry && (await count((q) => q.neq('source', 'paper').gte('placed_at', since(3600_000)))) >= limits.globalHour) return UNAVAILABLE(deps.replyTo);
  if (entry) {
    // A family typing in a meeting's worth of orders shares one IP; the cap is per person instead.
    if ((await count((q) => q.eq('entered_by_person_id', entry.viewer.personId).gte('placed_at', since(3600_000)))) >= limits.perEntererHour) return UNAVAILABLE(deps.replyTo);
  } else {
    if (deps.ip && (await count((q) => q.eq('created_ip', deps.ip as string).gte('placed_at', since(3600_000)))) >= limits.perIpHour) return UNAVAILABLE(deps.replyTo);
    if (req.email && (await count((q) => q.eq('customer_email', req.email).gte('placed_at', since(24 * 3600_000)))) >= limits.perEmailDay) return UNAVAILABLE(deps.replyTo);
  }

  // A donation is $1 at least (qa-lead, 2026-10-19): always on the store, and on a scout-entered order with no wreath.
  // A scout-entered gift beside wreaths keeps its own bounds.
  if ((!entry || req.lines.length === 0) && req.gift > 0 && toCents(req.gift) < MIN_DONATION * 100) return invalid('gift', `A donation is at least $${MIN_DONATION}.`);

  // Customer details.
  if (entry) {
    // Only a name is required; an email or phone, if given, must be well-formed.
    if (!req.name) return invalid('name', 'Add the customer’s name, like “Grandma Sue”.');
    if (req.email && !EMAIL_RE.test(req.email)) return invalid('email', 'This email is missing something, like the @ or the .com.');
    if (req.phone && !phoneOk(req.phone)) return invalid('phone', 'A phone number is 10 digits.');
  } else {
    if (!req.name) return invalid('name', 'Enter your name.');
    if (!req.email) return invalid('email', 'Enter your email, for the receipt.');
    if (!EMAIL_RE.test(req.email)) return invalid('email', 'This email is missing something, like the @ or the .com.');
    // A donation with no wreath has nothing to deliver, so no delivery question to call about (W-3): phone optional.
    const donationOnly = req.lines.length === 0;
    if (donationOnly ? req.phone !== '' && !phoneOk(req.phone) : !phoneOk(req.phone)) {
      return invalid('phone', req.phone ? 'A phone number is 10 digits.' : 'Enter a phone number, in case of a delivery question.');
    }
  }

  // The credited scout: only a live seller link.
  let seller: { personId: number; scout: { name: string; firstName: string } } | null = null;
  if (req.sellerSlug) {
    const linkGone: PlaceOrderResult = {
      ok: false,
      code: 'link_inactive',
      error: 'That scout’s link isn’t active this year. Please start again from the main store.'
    };
    if (!SLUG_RE.test(req.sellerSlug)) return linkGone;
    const { data: s } = await sb
      .from('wreath_sellers')
      .select('person_id, people:person_id(first_name, last_name)')
      .eq('sale_id', sale.id)
      .eq('slug', req.sellerSlug)
      .eq('active', true)
      .maybeSingle();
    if (!s) return linkGone;
    const row = s as unknown as { person_id: number; people: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null };
    const p = Array.isArray(row.people) ? row.people[0] : row.people;
    seller = { personId: row.person_id, scout: scoutDisplayName(p?.first_name ?? null, p?.last_name ?? null) };
  }
  if (entry) {
    // The viewer's right to THIS scout is decided here, from the session's scope; the slug only names the target.
    if (!seller) return { ok: false, code: 'link_inactive', error: 'That scout’s link isn’t active this year, so there is no order to enter.' };
    if (!entry.viewer.scope.includes(seller.personId)) return { ok: false, code: 'forbidden', error: 'You can enter orders only for your own scout.' };
  }

  // A scout picked at checkout: credit only. The scout is not expected to deliver. Ignored on a scout-link order.
  let creditOnly: { personId: number; scout: { name: string; firstName: string } } | null = null;
  if (!entry && !seller && req.creditSellerId != null) {
    const gone: PlaceOrderResult = { ok: false, code: 'invalid', field: 'credit', error: 'That scout isn’t available to credit. Choose again, or leave it for the troop.' };
    if (req.creditSellerId === 'bad') return gone;
    const { data: c } = await sb
      .from('wreath_sellers')
      .select('person_id, people:person_id(first_name, last_name)')
      .eq('id', req.creditSellerId)
      .eq('sale_id', sale.id)
      .eq('active', true)
      .maybeSingle();
    if (!c) return gone;
    const crow = c as unknown as { person_id: number; people: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null };
    const cp = Array.isArray(crow.people) ? crow.people[0] : crow.people;
    creditOnly = { personId: crow.person_id, scout: scoutDisplayName(cp?.first_name ?? null, cp?.last_name ?? null) };
  }

  // The catalog prices the cart.
  const { data: itemRows } = await sb.from('wreath_items').select('id, catalog_number, name, size, price, unit_cost, active, donatable').eq('sale_id', sale.id);
  const items = (itemRows ?? []) as { id: number; catalog_number: number; name: string; size: string; price: number; unit_cost: number; active: boolean; donatable: boolean }[];
  const catalog: PricedItem[] = items.map((i) => ({ id: i.id, catalogNumber: i.catalog_number, price: Number(i.price), unitCost: Number(i.unit_cost), active: i.active, donatable: i.donatable }));
  const allDonated = req.lines.length > 0 && req.lines.every((l) => l.donated);
  // "Donate to Troop 79" with no wreath (W-3): nothing to deliver or pick up, no delivery fee, no address. A scout's
  // family or a super user may enter one too (Patrick, 2026-10-19): credited to the scout, nothing to deliver.
  const donationOnly = req.lines.length === 0;

  // How it reaches them. A scout-entered order with a wreath is the scout's own (they hand it over).
  let fulfillment: Fulfillment;
  if (donationOnly) fulfillment = 'none';
  else if (entry) fulfillment = 'scout';
  else if (allDonated) fulfillment = 'none';
  else if (seller) fulfillment = 'scout';
  else if (req.fulfillment) fulfillment = req.fulfillment;
  else return invalid('method', 'Choose pickup or delivery.');

  const priced = priceCart(sale, catalog, req.lines, { fulfillment, gift: req.gift, coverFee: entry ? false : req.coverFee, allowDonationOnly: true });
  if (!priced.ok) {
    if (entry && priced.problem.code === 'empty') return invalid('cart', EMPTY_ENTRY);
    return invalid(priced.problem.code === 'gift' ? 'gift' : 'cart', cartProblemText(priced.problem.code));
  }

  let outsideArea = false;
  const needsAddress = !entry && (fulfillment === 'scout' || fulfillment === 'delivery');
  if (needsAddress) {
    if (!zipFormatOk(req.zip)) return invalid('zip', 'Enter the 5-digit zip for delivery.');
    if (!inDeliveryArea(sale, req.zip)) {
      if (fulfillment === 'delivery') {
        return invalid('zip', `We can’t deliver to ${req.zip}. Troop delivery covers zips starting with ${zipPrefixText(sale.deliveryZipPrefix)}. Choose pickup instead.`);
      }
      if (!req.outsideAreaRelative) {
        return invalid('relative', `${req.zip} is outside our delivery area (zips starting with ${zipPrefixText(sale.deliveryZipPrefix)}). Tick the box if ${seller?.scout.firstName ?? 'the scout'} has agreed to deliver to you.`);
      }
      outsideArea = true;
    }
    if (!req.street) return invalid('street', 'Enter the street address for delivery.');
    if (!req.city) return invalid('city', 'Enter the city.');
  }

  const order = priced.order;
  const { data: created, error } = await sb.rpc('wreath_place_order', {
    p: {
      sale_id: sale.id,
      idempotency_key: req.idempotencyKey,
      placed_at: new Date(now).toISOString(),
      credited_person_id: seller?.personId ?? creditOnly?.personId ?? null,
      delivering_person_id: fulfillment === 'scout' ? (seller?.personId ?? null) : null,
      source: entry ? 'paper' : seller ? 'scout_link' : 'store',
      fulfillment,
      round,
      customer_name: req.name,
      customer_email: req.email,
      customer_phone: req.phone,
      customer_address: needsAddress ? req.street : null,
      customer_city: needsAddress ? req.city : null,
      customer_zip: needsAddress ? req.zip : null,
      outside_area_relative: outsideArea,
      items_subtotal: order.itemsSubtotal,
      delivery_fee: order.deliveryFee,
      fee_covered: order.feeCovered,
      gift: order.gift,
      total: order.total,
      created_ip: deps.ip ?? '',
      ...(entry
        ? { entered_by_person_id: entry.viewer.personId, collected_by_scout: req.collected, payment_note: req.paymentNote, customer_note: req.note }
        : {}),
      lines: order.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, donated: l.donated, unit_price: l.unitPrice, unit_cost: l.unitCost }))
    }
  });
  const result = ((created ?? []) as { order_number: string; public_token: string; created: boolean }[])[0];
  if (error || !result) return UNAVAILABLE(deps.replyTo);
  if (!result.created) return { ok: true, token: result.public_token, orderNumber: result.order_number, created: false };

  // Emails: best effort, after the order is safely written.
  try {
    const itemById = new Map(items.map((i) => [i.id, i]));
    const ctx: OrderEmailContext = {
      orderNumber: result.order_number,
      customerName: req.name,
      items: order.lines.map((l) => {
        const it = itemById.get(l.itemId);
        return { label: it ? itemLabel(it) : 'Item', quantity: l.quantity, donated: l.donated, amount: Math.round(l.unitPrice * l.quantity * 100) / 100 };
      }),
      itemsSubtotal: order.itemsSubtotal,
      deliveryFee: order.deliveryFee,
      feeCovered: order.feeCovered,
      gift: order.gift,
      total: order.total,
      arrival: arrivalParagraphs({
        fulfillment,
        scoutName: seller?.scout.name ?? null,
        scoutFirstName: seller?.scout.firstName ?? null,
        outsideAreaRelative: outsideArea,
        hasDonated: order.lines.some((l) => l.donated),
        distribution: { date: sale.distributionDate, window: sale.distributionWindow, place: sale.distributionPlace }
      }).join(' '),
      creditedTo: (seller ?? creditOnly)?.scout.name ?? null,
      orderUrl: `${deps.siteUrl}/wreaths/order/${result.public_token}`,
      changesBy: fmtDateFull(round === 1 ? sale.round1Cutoff : sale.round2Cutoff),
      placedAt: new Date(now).toISOString(),
      payByCard: !entry && req.payByCard
    };
    if (entry) {
      // No email to the customer, ever. The person typing gets a confirmation, and the household's parents are
      // copied when the scout typed it themself. No payment instructions: the scout collects.
      const to = new Set(entry.emails);
      if (entry.viewer.personId === seller!.personId) for (const a of await deps.householdEmails(seller!.personId)) to.add(a);
      const mail = scoutEntryConfirmationEmail({ ...ctx, collected: req.collected, paymentNote: req.paymentNote, memberUrl: `${deps.siteUrl}/member/wreaths` });
      const confirmed = [...to];
      if (to.size) await deps.send({ to: confirmed, subject: mail.subject, html: mail.html, text: mail.text, replyTo: deps.replyTo });
      const copyTo = orderCc.filter((a) => !to.has(a));
      if (copyTo.length) {
        const cc = scoutEntryConfirmationEmail({ ...ctx, collected: req.collected, paymentNote: req.paymentNote, memberUrl: `${deps.siteUrl}/member/wreaths` }, { sentTo: 'whoever entered it' });
        await deps.send({ to: copyTo, subject: cc.subject, html: cc.html, text: cc.text, replyTo: deps.replyTo });
      }
      return { ok: true, token: result.public_token, orderNumber: result.order_number, created: true, confirmedTo: confirmed };
    }
    const mail = customerConfirmationEmail(ctx);
    await deps.send({ to: [req.email], subject: mail.subject, html: mail.html, text: mail.text, replyTo: deps.replyTo });
    const copyTo = orderCc.filter((a) => a !== req.email.toLowerCase());
    if (copyTo.length) {
      const cc = customerConfirmationEmail(ctx, { sentTo: req.name });
      await deps.send({ to: copyTo, subject: cc.subject, html: cc.html, text: cc.text, replyTo: deps.replyTo });
    }
    const notify = seller && fulfillment === 'scout' ? { ...seller, creditOnly: false } : creditOnly ? { ...creditOnly, creditOnly: true } : null;
    if (notify) {
      // The order is saved either way; past the daily cap this seller's household simply isn't mailed again.
      const { count: noticed } = await sb
        .from('wreath_orders')
        .select('id', { count: 'exact', head: true })
        .eq('credited_person_id', notify.personId)
        .gte('placed_at', since(24 * 3600_000));
      const to = (noticed ?? 0) > limits.perSellerNoticeDay ? [] : await deps.householdEmails(notify.personId);
      if (to.length) {
        const note = scoutNoticeEmail({
          ...ctx,
          scoutFirstName: notify.scout.firstName,
          creditOnly: notify.creditOnly,
          // A credit-only note carries no phone or address: the troop delivers, the scout only gets the credit.
          customerPhone: notify.creditOnly ? '' : req.phone,
          customerAddress: notify.creditOnly ? '' : [req.street, req.city, req.zip].filter(Boolean).join(', ')
        });
        await deps.send({ to, subject: note.subject, html: note.html, text: note.text, replyTo: deps.replyTo });
      }
    }
  } catch (e) {
    console.error('wreath order email failed:', e);
  }
  return { ok: true, token: result.public_token, orderNumber: result.order_number, created: true };
}

function cartProblemText(code: string): string {
  switch (code) {
    case 'empty':
      return 'Your cart is empty.';
    case 'gift':
      return `A donation can be from $0 to $${MAX_GIFT}.`;
    case 'quantity':
      return 'Each item can be ordered 1 to 50 at a time.';
    case 'too_many_lines':
      return 'That is more kinds of items than one order can hold. Please split it into two orders.';
    default:
      return 'Something in your cart is no longer available. Please remove it and try again.';
  }
}
