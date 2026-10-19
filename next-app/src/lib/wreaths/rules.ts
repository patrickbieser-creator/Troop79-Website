/**
 * Wreath sale rules (Plans/Wreath-Sale.md, "Release A build spec") — the pure half: pricing, the delivery
 * area, the cutoffs and the Rose order. No database and no framework, so the order action, the admin and the
 * tests all lean on the same arithmetic. The server action is the only place a price is ever decided; the
 * browser's totals are a courtesy for the customer and are ignored on arrival.
 *
 * Money is carried in whole cents inside this file and handed back as dollars with at most two decimals.
 */

export const MAX_QTY = 50;
export const MAX_LINES = 25;
export const MAX_GIFT = 500;
/** A checkout begun before a cutoff may still finish this long after it (Decisions, "After the cutoff"). */
export const CUTOFF_GRACE_MS = 2 * 60 * 60 * 1000;
/** A form posted sooner than this after its page rendered is a script, not a person. */
export const MIN_SUBMIT_MS = 4000;

export const PAID_METHODS = ['venmo', 'paypal', 'cash', 'check', 'other'] as const;
export type PaidMethod = (typeof PAID_METHODS)[number];

/** Every way an order can end up paid: the treasurer's Mark paid methods, plus `card`, which only the Stripe webhook
 *  records (Release B) — deliberately not in PAID_METHODS, so nobody can "mark paid by card" by hand. */
export type PaymentMethod = PaidMethod | 'card';

export const METHOD_LABEL: Record<PaymentMethod, string> = { venmo: 'Venmo', paypal: 'PayPal', cash: 'Cash', check: 'Check', other: 'Other', card: 'Card' };

/** How an order came in, and how it reaches the customer: the admin's words (Orders, Dashboard). */
export const SOURCE_LABEL: Record<'scout_link' | 'store' | 'paper', string> = { scout_link: 'Scout link', store: 'Store', paper: 'Scout-entered' };
export const FULFILLMENT_LABEL: Record<Fulfillment, string> = { scout: 'Scout delivers', pickup: 'Pickup', delivery: 'Troop delivery', none: 'Donated only' };

export interface PaidLedgerRow {
  occurred_on: string;
  account: 'checking';
  amount: number;
  kind: 'fundraiser';
  method: PaymentMethod;
  memo: string;
  /** The bucket's name. The card RPCs resolve it (`bucket_id_for_name`); Mark paid resolves it before its insert. */
  bucket: string;
}

/** An order's cash donation as its own ledger row (W-3): kind 'donation', same day, account and bucket as the payment. */
export type DonationLedgerRow = Omit<PaidLedgerRow, 'kind'> & { kind: 'donation' };

/** "Donate to Troop 79" (W-3, Patrick 2026-10-19): the store's preset amounts; "Other amount" takes up to MAX_GIFT. */
export const DONATION_PRESETS = [10, 25, 50] as const;

/** A scout-entered order with neither a wreath nor a donation (Patrick, 2026-10-19). */
export const EMPTY_ENTRY = 'The order is empty. Add a wreath or a donation.';

/** The least a donation can be (qa-lead, 2026-10-19; Stripe's own floor is $0.50). */
export const MIN_DONATION = 1;

/** A typed donation in dollars: MIN_DONATION to MAX_GIFT, whole cents. Null for anything else. */
export function parseDonation(text: string): number | null {
  const t = text.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= MIN_DONATION && n <= MAX_GIFT ? fromCents(toCents(n)) : null;
}

/** "Donation to Troop 79" — the one name the cart, checkout, receipts, emails and admin give an order's cash gift. */
export const DONATION_LABEL = 'Donation to Troop 79';

/**
 * How much of what came in is the donation (W-3). The rule for a short payment: the DONATION absorbs the shortfall
 * first, then the wreaths — the wreath part of an order is paid in full before any of it counts as a gift. An
 * over-payment leaves the donation as it is (the extra is owed back, or the Edit order dialog makes it the gift).
 */
export function donationPart(received: number, total: number, gift: number): number {
  const rest = toCents(total) - toCents(gift);
  return fromCents(Math.min(toCents(gift), Math.max(0, toCents(received) - rest)));
}

/**
 * The finance-ledger rows for a payment that came in by hand (Mark paid, Edit order): the wreath part and the donation
 * part, each null when it is $0. `received` is what came in; `total` and `gift` are the order's.
 */
export function paidLedgerRows(o: {
  orderNumber: string;
  customerName: string;
  received: number;
  total: number;
  gift: number;
  method: PaymentMethod;
  saleYear: number;
  today: string;
}): { payment: PaidLedgerRow | null; donation: DonationLedgerRow | null } {
  const donation = donationPart(o.received, o.total, o.gift);
  const payment = fromCents(toCents(o.received) - toCents(donation));
  return {
    payment: payment > 0 ? paidLedgerRow({ ...o, total: payment }) : null,
    donation: donation > 0 ? donationLedgerRow({ ...o, amount: donation }) : null
  };
}

export function donationLedgerRow(o: { orderNumber: string; customerName: string; amount: number; method: PaymentMethod; saleYear: number; today: string }): DonationLedgerRow {
  const base = paidLedgerRow({ ...o, total: o.amount });
  return { ...base, kind: 'donation', memo: `Donation · Wreath order ${o.orderNumber} · ${o.customerName} · ${METHOD_LABEL[o.method]}` };
}

/**
 * Stripe's fee on a card payment, split between the donation and the rest of the order in proportion to their share
 * of what was charged (W-3: the troop records the donation net of its share of the fee). A donation-only order's whole
 * fee is the donation's.
 */
export function splitCardFee(fee: number, gift: number, charged: number): { donation: number; rest: number } {
  const f = toCents(fee);
  const g = toCents(gift);
  const c = toCents(charged);
  if (f <= 0 || g <= 0 || c <= 0) return { donation: 0, rest: fromCents(Math.max(0, f)) };
  const d = Math.min(g, f, Math.round((f * g) / c));
  return { donation: fromCents(d), rest: fromCents(f - d) };
}

export interface DonationOrder {
  gift: number;
  total: number;
  paymentStatus: string;
  paidMethod: string | null;
  paidAmount: number | null;
  stripeFee: number | null;
}

/**
 * The donation the troop keeps from an order (W-3): the gift, less any shortfall it absorbed on a short payment, less
 * its share of Stripe's fee on a card payment (once the fee has settled). Unpaid orders count the gift as pledged, as
 * their wreaths' profit counts.
 */
export function donationNet(o: DonationOrder): number {
  if (!(o.gift > 0)) return 0;
  if (o.paymentStatus === 'paid' && o.paidMethod === 'card') {
    const charged = o.paidAmount ?? o.total;
    return fromCents(toCents(o.gift) - toCents(splitCardFee(o.stripeFee ?? 0, o.gift, charged).donation));
  }
  if (o.paymentStatus === 'paid' && o.paidAmount != null) return donationPart(o.paidAmount, o.total, o.gift);
  return o.gift;
}

/**
 * The finance-ledger row Mark paid books for an order (Patrick, 2026-10-15). It follows the treasurer's fundraiser
 * convention: checking income, kind fundraiser, bucket "Wreaths 'YY" (last year's rows read "Wreaths '25"). Every
 * PaymentMethod is also a ledger method (lib/finance.ts TRANSACTION_METHODS; PayPal joined it 2026-10-05), so it carries
 * straight over.
 */
export function paidLedgerRow(o: {
  orderNumber: string;
  customerName: string;
  total: number;
  method: PaymentMethod;
  saleYear: number;
  today: string;
}): PaidLedgerRow {
  if (!(o.total > 0)) throw new Error('A zero-dollar order books nothing to the ledger.');
  return {
    occurred_on: o.today,
    account: 'checking',
    amount: o.total,
    kind: 'fundraiser',
    method: o.method,
    memo: `Wreath order ${o.orderNumber} · ${o.customerName} · ${METHOD_LABEL[o.method]}`,
    bucket: `Wreaths '${String(o.saleYear).slice(-2)}`
  };
}

/**
 * What the treasurer let go on an order paid a little short by hand (Patrick, 2026-10-18, W-1022): the order keeps its
 * total, paid_amount and the ledger hold what actually came in. A card order's mismatch is not this — it means the
 * total changed after Stripe took the money, and the order panel says what is still due or owed back.
 */
export function acceptedShort(o: { paymentStatus: string; paidMethod: string | null; paidAmount: number | null; total: number }): number {
  if (o.paymentStatus !== 'paid' || o.paidMethod === 'card' || o.paidAmount == null) return 0;
  return Math.max(0, fromCents(toCents(o.total) - toCents(o.paidAmount)));
}

/**
 * The short or over on an order paid by hand, for the payment pill (Plans/Wreath-Sale.md W-2, Patrick 2026-10-19):
 * "$5 short" when less than the total came in (accepted short, D-398), "$10 over" when more did (owed back, D-401), else
 * null. Derived from paid_amount against total; nothing is stored. A card order is locked to its total, and an unpaid,
 * refunded or cancelled order shows no amount.
 *
 * An over-payment the Edit order dialog counted as a gift leaves nothing to show: "Count the extra as a gift" raises
 * the order's gift until the total equals what came in, so the stored order no longer differs from its payment.
 */
export function paymentDifferenceText(o: { status?: string; paymentStatus: string; paidMethod: string | null; paidAmount: number | null; total: number }): string | null {
  if ((o.status ?? 'placed') !== 'placed' || o.paymentStatus !== 'paid' || o.paidMethod === 'card' || o.paidAmount == null) return null;
  const diff = toCents(o.paidAmount) - toCents(o.total);
  if (diff === 0) return null;
  return `${fmtMoney(fromCents(Math.abs(diff)))} ${diff < 0 ? 'short' : 'over'}`;
}

/** The admin's paid pill after "Paid": "Venmo", "Venmo · $5 short", "Cash · $10 over". */
export function paidPillText(o: { status?: string; paymentStatus: string; paidMethod: string | null; paidAmount: number | null; total: number }): string {
  const method = o.paidMethod ? (METHOD_LABEL[o.paidMethod as PaymentMethod] ?? o.paidMethod) : null;
  return [method, paymentDifferenceText(o)].filter(Boolean).join(' · ');
}

/** How the customer pays in Release A: the treasurer directly (Decisions, "Release A payment"). Links and handles only. */
export const PAY_TREASURER = {
  venmoHandle: '@Patrick-Bieser-1',
  venmoUrl: 'https://venmo.com/u/Patrick-Bieser-1',
  paypalEmail: 'patrickbieser@gmail.com',
  note: 'The payment shows as Patrick Bieser, an assistant scoutmaster and the troop treasurer.'
} as const;

export interface SaleRules {
  deliveryZipPrefix: string;
  deliveryFee: number;
  deliveryFreeAt: number;
  feePercent: number;
  feeFixed: number;
  round1Cutoff: string;
  round2Cutoff: string;
}

export interface PricedItem {
  id: number;
  catalogNumber: number;
  price: number;
  unitCost: number;
  active: boolean;
  donatable: boolean;
}

export interface CartLine {
  itemId: number;
  quantity: number;
  donated: boolean;
}

export const toCents = (dollars: number): number => Math.round(dollars * 100);
export const fromCents = (c: number): number => c / 100;

export type Fulfillment = 'scout' | 'pickup' | 'delivery' | 'none';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Ten digits, or eleven with a leading 1. */
export function phoneOk(p: string): boolean {
  const d = p.replace(/\D/g, '');
  return d.length === 10 || (d.length === 11 && d.startsWith('1'));
}

/** A five-digit zip, nothing else. */
export function zipFormatOk(zip: string): boolean {
  return /^\d{5}$/.test(zip);
}

/** The sale's delivery zip prefixes: the setting is one prefix or a comma list ("532, 531"). */
export function zipPrefixes(setting: string): string[] {
  return setting.split(',').map((p) => p.trim()).filter(Boolean);
}

/** A valid prefix setting: one or more 1–5 digit prefixes, separated by commas. */
export function zipPrefixListOk(setting: string): boolean {
  return /^\s*\d{1,5}(\s*,\s*\d{1,5})*\s*$/.test(setting);
}

/** The prefixes for a sentence: "532", "532 or 531", "532, 531 or 530". */
export function zipPrefixText(setting: string): string {
  const p = zipPrefixes(setting);
  return p.length < 2 ? (p[0] ?? '') : `${p.slice(0, -1).join(', ')} or ${p[p.length - 1]}`;
}

/** Inside the troop's delivery area: five digits that start with one of the sale's prefixes (532, 531). */
export function inDeliveryArea(rules: Pick<SaleRules, 'deliveryZipPrefix'>, zip: string): boolean {
  return zipFormatOk(zip) && zipPrefixes(rules.deliveryZipPrefix).some((p) => zip.startsWith(p));
}

/** Troop delivery costs the fee under the free-at threshold of ITEMS (before gifts and fees); a scout delivers free. */
export function deliveryFeeFor(
  rules: Pick<SaleRules, 'deliveryFee' | 'deliveryFreeAt'>,
  fulfillment: Fulfillment,
  itemsSubtotal: number
): number {
  if (fulfillment !== 'delivery') return 0;
  return toCents(itemsSubtotal) < toCents(rules.deliveryFreeAt) ? rules.deliveryFee : 0;
}

/**
 * What "cover the card fee" adds so the troop keeps the whole base (0 for an empty base). The processor takes
 * fee_percent of the TOTAL plus fee_fixed, so the total is grossed up — ceil((base + fixed) / (1 − percent)) — rather
 * than adding the percent of the base, which left the troop a few cents short per order (E2E, 2026-10-16).
 */
export function coverFeeFor(rules: Pick<SaleRules, 'feePercent' | 'feeFixed'>, base: number): number {
  const b = toCents(base);
  if (b <= 0) return 0;
  // Integer math in basis points (1/100 of a percent) so 2.9% doesn't pick up float error.
  const keepBps = 10000 - Math.round(rules.feePercent * 100);
  let total = Math.ceil(((b + toCents(rules.feeFixed)) * 10000) / keepBps);
  // Round-half processor rounding can still leave a cent short at a boundary: step up until the troop nets the base.
  while (total - (Math.round((total * rules.feePercent) / 100) + toCents(rules.feeFixed)) < b) total += 1;
  return fromCents(total - b);
}

/** Collapses repeated (item, donated) pairs into one line each, quantities summed. */
export function mergeLines(lines: CartLine[]): CartLine[] {
  const merged = new Map<string, CartLine>();
  for (const l of lines) {
    const key = `${l.itemId}:${l.donated ? 'd' : 'p'}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += l.quantity;
    else merged.set(key, { ...l });
  }
  return [...merged.values()];
}

export interface PricedLine extends CartLine {
  unitPrice: number;
  unitCost: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  itemsSubtotal: number;
  deliveryFee: number;
  feeCovered: number;
  gift: number;
  total: number;
}

export type PriceProblem = {
  code: 'unknown_item' | 'inactive_item' | 'not_donatable' | 'quantity' | 'too_many_lines' | 'empty' | 'gift';
  itemId?: number;
};

/**
 * Prices a cart from the CATALOG, never from the client. Returns the first problem found instead of throwing so
 * the action can answer in plain words. Every bound lives here: quantity 1..50, at most 25 lines, donated lines
 * only on donatable items, an active item in this sale, a gift of 0..500.
 */
export function priceCart(
  rules: SaleRules,
  catalog: PricedItem[],
  rawLines: CartLine[],
  opts: { fulfillment: Fulfillment; gift: number; coverFee: boolean; allowDonationOnly?: boolean }
): { ok: true; order: PricedOrder } | { ok: false; problem: PriceProblem } {
  const byId = new Map(catalog.map((i) => [i.id, i]));
  // A donation with no wreath is an order of its own (W-3), where the caller allows it (the store and the admin edit).
  const donationOnly = rawLines.length === 0 && opts.allowDonationOnly === true && Number.isFinite(opts.gift) && toCents(opts.gift) > 0;
  if (rawLines.length === 0 && !donationOnly) return { ok: false, problem: { code: 'empty' } };
  if (rawLines.length > MAX_LINES) return { ok: false, problem: { code: 'too_many_lines' } };
  const lines = mergeLines(rawLines);
  const priced: PricedLine[] = [];
  let subtotal = 0;
  let deliveredCents = 0;
  for (const l of lines) {
    const item = byId.get(l.itemId);
    if (!item) return { ok: false, problem: { code: 'unknown_item', itemId: l.itemId } };
    if (!item.active) return { ok: false, problem: { code: 'inactive_item', itemId: l.itemId } };
    if (l.donated && !item.donatable) return { ok: false, problem: { code: 'not_donatable', itemId: l.itemId } };
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY) {
      return { ok: false, problem: { code: 'quantity', itemId: l.itemId } };
    }
    subtotal += toCents(item.price) * l.quantity;
    if (!l.donated) deliveredCents += toCents(item.price) * l.quantity;
    priced.push({ ...l, unitPrice: item.price, unitCost: item.unitCost });
  }
  const giftCents = toCents(opts.gift);
  if (!Number.isFinite(opts.gift) || giftCents < 0 || giftCents > MAX_GIFT * 100) return { ok: false, problem: { code: 'gift' } };
  const itemsSubtotal = fromCents(subtotal);
  // Donated wreaths are never delivered, so only the delivered items count toward the free-delivery threshold.
  const deliveryFee = deliveryFeeFor(rules, opts.fulfillment, fromCents(deliveredCents));
  // No fee is charged on the donation (W-3): "cover the card fee" covers the items and delivery only.
  const feeCovered = opts.coverFee ? coverFeeFor(rules, fromCents(subtotal + toCents(deliveryFee))) : 0;
  const total = fromCents(subtotal + giftCents + toCents(deliveryFee) + toCents(feeCovered));
  return { ok: true, order: { lines: priced, itemsSubtotal, deliveryFee, feeCovered, gift: fromCents(giftCents), total } };
}

/** A line already on an order, with the price and cost it was sold at. */
export interface SnapshotLine {
  itemId: number;
  donated: boolean;
  unitPrice: number;
  unitCost: number;
}

/**
 * Prices the treasurer's edit of an order (Patrick, 2026-10-18: a customer ordered the wrong item and paid for another).
 * Unlike priceCart, a line the order already had — same item, same donated — keeps the price and cost it was sold at,
 * a new line takes today's catalog price, and an item no longer on sale may still be used: the treasurer is correcting
 * a real order, not shopping. Every other bound is priceCart's.
 */
export function repriceEdit(
  rules: SaleRules,
  catalog: PricedItem[],
  existing: SnapshotLine[],
  rawLines: CartLine[],
  opts: { fulfillment: Fulfillment; gift: number; coverFee: boolean; allowDonationOnly?: boolean }
): { ok: true; order: PricedOrder } | { ok: false; problem: PriceProblem } {
  const kept = new Map(existing.map((l) => [`${l.itemId}:${l.donated ? 'd' : 'p'}`, l]));
  const snapshot = catalog.map((i) => ({ ...i, active: true }));
  const res = priceCart(rules, snapshot, rawLines, opts);
  if (!res.ok) return res;
  const lines = res.order.lines.map((l) => {
    const was = kept.get(`${l.itemId}:${l.donated ? 'd' : 'p'}`);
    return was ? { ...l, unitPrice: was.unitPrice, unitCost: was.unitCost } : l;
  });
  // Totals again, from the snapshots.
  const cents = (pred: (l: PricedLine) => boolean) => lines.filter(pred).reduce((n, l) => n + toCents(l.unitPrice) * l.quantity, 0);
  const subtotal = cents(() => true);
  const deliveryFee = deliveryFeeFor(rules, opts.fulfillment, fromCents(cents((l) => !l.donated)));
  const giftCents = toCents(res.order.gift);
  const feeCovered = opts.coverFee ? coverFeeFor(rules, fromCents(subtotal + toCents(deliveryFee))) : 0;
  const total = fromCents(subtotal + giftCents + toCents(deliveryFee) + toCents(feeCovered));
  return { ok: true, order: { lines, itemsSubtotal: fromCents(subtotal), deliveryFee, feeCovered, gift: res.order.gift, total } };
}

/** Which round an instant falls in: 1 up to the first cutoff, 2 up to the second, null after the sale ends. */
export function roundAt(rules: Pick<SaleRules, 'round1Cutoff' | 'round2Cutoff'>, ms: number): 1 | 2 | null {
  if (ms <= Date.parse(rules.round1Cutoff)) return 1;
  if (ms <= Date.parse(rules.round2Cutoff)) return 2;
  return null;
}

/**
 * The round a new order belongs to, or null when the store is closed to it. A checkout the customer began before a
 * cutoff may finish up to CUTOFF_GRACE_MS after it and counts in the round it began in; the cutoff stops new carts,
 * not a checkout already in progress. `startedAt` is the browser's own claim, so it only ever buys the grace window.
 */
export function decideRound(
  rules: Pick<SaleRules, 'round1Cutoff' | 'round2Cutoff'>,
  nowMs: number,
  startedAtMs: number | null
): 1 | 2 | null {
  if (startedAtMs != null && Number.isFinite(startedAtMs) && startedAtMs <= nowMs + 5 * 60 * 1000) {
    const began = roundAt(rules, startedAtMs);
    if (began) {
      const cutoff = Date.parse(began === 1 ? rules.round1Cutoff : rules.round2Cutoff);
      if (nowMs <= cutoff + CUTOFF_GRACE_MS) return began;
    }
  }
  return roundAt(rules, nowMs);
}

export interface RoseRow {
  catalogNumber: number;
  round1: number;
  round2: number;
  total: number;
}

/** The order to Rose: wreaths per catalog number. Round 1 is the initial order, round 2 the "changes". Donated wreaths count. */
export function roseOrder(rows: { catalogNumber: number; round: number; quantity: number }[]): RoseRow[] {
  const by = new Map<number, RoseRow>();
  for (const r of rows) {
    const row = by.get(r.catalogNumber) ?? { catalogNumber: r.catalogNumber, round1: 0, round2: 0, total: 0 };
    if (r.round === 1) row.round1 += r.quantity;
    else row.round2 += r.quantity;
    row.total += r.quantity;
    by.set(r.catalogNumber, row);
  }
  return [...by.values()].sort((a, b) => a.catalogNumber - b.catalogNumber);
}

/** What an order earns the troop: sell price minus unit cost, per line, donated wreaths included (they are sales). Gifts, delivery and fees are not profit. */
export function orderProfit(lines: { quantity: number; unitPrice: number; unitCost: number }[]): number {
  let cents = 0;
  for (const l of lines) cents += (toCents(l.unitPrice) - toCents(l.unitCost)) * l.quantity;
  return fromCents(cents);
}

/** A scout's share (sale.scoutShare, 0.30) of a profit, rounded to the cent. */
export function scoutEarnings(profit: number, share: number): number {
  return fromCents(Math.round(toCents(profit) * share));
}

/** The two shares a credited scout earns: of the wreaths' profit (scout_share) and of the cash donations (W-3). */
export interface ScoutShares {
  profit: number;
  donation: number;
}

/**
 * What a scout earns on the orders credited to them: their share of the wreaths' profit plus their share of the
 * donations, each donation net of any shortfall it absorbed and of its part of the card fee (W-3). One figure, so the
 * dashboard, the seller view and the scout's own page agree; no separate ledger row.
 */
export function sellerEarnings(orders: (DonationOrder & { lines: { quantity: number; unitPrice: number; unitCost: number }[] })[], shares: ScoutShares): number {
  const profit = scoutEarnings(orderProfit(orders.flatMap((o) => o.lines)), shares.profit);
  const donations = scoutEarnings(fromCents(orders.reduce((n, o) => n + toCents(donationNet(o)), 0)), shares.donation);
  return fromCents(toCents(profit) + toCents(donations));
}

/** "$26" for whole dollars, "$26.50" otherwise — the store's price style. */
export function fmtMoney(n: number): string {
  const whole = Math.round(n * 100) % 100 === 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** Always two decimals, for totals and receipts. */
export function fmtMoney2(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "20″ Wreath" — size first, the way the prototype's cart reads. */
export function itemLabel(i: { name: string; size: string }): string {
  const name = i.name.charAt(0).toUpperCase() + i.name.slice(1).toLowerCase();
  return (i.size ? i.size + ' ' : '') + name;
}
