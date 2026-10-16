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

/**
 * Release A takes no payment on the site: the customer pays the treasurer by Venmo / PayPal and the treasurer marks the
 * order paid. Release B (PayPal Checkout) flips this on, which brings back the "cover the processing fee" box.
 */
export const PAYPAL_CHECKOUT_LIVE = false;

export const PAID_METHODS = ['venmo', 'paypal', 'cash', 'check', 'other'] as const;
export type PaidMethod = (typeof PAID_METHODS)[number];

const METHOD_LABEL: Record<PaidMethod, string> = { venmo: 'Venmo', paypal: 'PayPal', cash: 'Cash', check: 'Check', other: 'Other' };

export interface PaidLedgerRow {
  occurred_on: string;
  account: 'checking';
  amount: number;
  kind: 'fundraiser';
  method: PaidMethod;
  memo: string;
  activity_label: string;
}

/**
 * The finance-ledger row Mark paid books for an order (Patrick, 2026-10-15). It follows the treasurer's fundraiser
 * convention: checking income, kind fundraiser, activity "Wreaths 'YY" (last year's rows read "Wreaths '25"). Every
 * PaidMethod is also a ledger method (lib/finance.ts TRANSACTION_METHODS; PayPal joined it 2026-10-05), so it carries
 * straight over.
 */
export function paidLedgerRow(o: {
  orderNumber: string;
  customerName: string;
  total: number;
  method: PaidMethod;
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
    activity_label: `Wreaths '${String(o.saleYear).slice(-2)}`
  };
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

/** Inside the troop's delivery area: five digits that start with the sale's prefix (532). */
export function inDeliveryArea(rules: Pick<SaleRules, 'deliveryZipPrefix'>, zip: string): boolean {
  return zipFormatOk(zip) && zip.startsWith(rules.deliveryZipPrefix);
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

/** What "cover the processing fee" adds: fee_percent of the base plus fee_fixed (0 for an empty base). */
export function coverFeeFor(rules: Pick<SaleRules, 'feePercent' | 'feeFixed'>, base: number): number {
  const b = toCents(base);
  if (b <= 0) return 0;
  return fromCents(Math.round((b * rules.feePercent) / 100) + toCents(rules.feeFixed));
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
  opts: { fulfillment: Fulfillment; gift: number; coverFee: boolean }
): { ok: true; order: PricedOrder } | { ok: false; problem: PriceProblem } {
  const byId = new Map(catalog.map((i) => [i.id, i]));
  if (rawLines.length === 0) return { ok: false, problem: { code: 'empty' } };
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
  const feeCovered = opts.coverFee ? coverFeeFor(rules, fromCents(subtotal + giftCents + toCents(deliveryFee))) : 0;
  const total = fromCents(subtotal + giftCents + toCents(deliveryFee) + toCents(feeCovered));
  return { ok: true, order: { lines: priced, itemsSubtotal, deliveryFee, feeCovered, gift: fromCents(giftCents), total } };
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
