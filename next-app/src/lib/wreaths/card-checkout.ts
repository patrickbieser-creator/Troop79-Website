import { createHash } from 'node:crypto';
import { DONATION_LABEL, coverFeeFor, donationLedgerRow, fromCents, itemLabel, paidLedgerRow, splitCardFee, toCents, type DonationLedgerRow, type PaidLedgerRow, type SaleRules } from './rules';

/**
 * Release B (Plans/Wreath-Stripe-Checkout.md, 2026-10-15) — the pure half of paying by card: the Stripe line items,
 * the idempotency key, the fee-cover recompute and the ledger rows. No Stripe client and no database here, so the
 * start-checkout action, the webhook and the tests all lean on the same arithmetic.
 *
 * What Stripe sees is built ONLY from the order row and carries nothing that identifies the customer (item names,
 * delivery, gift, fee); the customer's email goes separately as `customer_email` (qa-lead, 2026-10-15).
 */

export interface CardOrderLine {
  name: string;
  size: string;
  quantity: number;
  unitPrice: number;
  donated: boolean;
}

export interface CardOrder {
  id: number;
  orderNumber: string;
  itemsSubtotal: number;
  deliveryFee: number;
  gift: number;
  feeCovered: number;
  total: number;
  lines: CardOrderLine[];
}

export interface CheckoutLineItem {
  name: string;
  /** Cents. */
  unitAmount: number;
  quantity: number;
}

/** The order as Stripe Checkout line items. Throws when they don't add up to the order total to the cent. */
export function checkoutLineItems(o: CardOrder): CheckoutLineItem[] {
  const items: CheckoutLineItem[] = o.lines.map((l) => ({
    name: itemLabel(l) + (l.donated ? ' (donated)' : ''),
    unitAmount: toCents(l.unitPrice),
    quantity: l.quantity
  }));
  const extra = (name: string, dollars: number) => {
    if (toCents(dollars) > 0) items.push({ name, unitAmount: toCents(dollars), quantity: 1 });
  };
  extra('Delivery', o.deliveryFee);
  extra(DONATION_LABEL, o.gift);
  extra('Card processing fee', o.feeCovered);
  const sum = items.reduce((s, i) => s + i.unitAmount * i.quantity, 0);
  if (sum !== toCents(o.total)) {
    throw new Error(`Order ${o.orderNumber}: line items add up to ${sum} cents, not the total ${toCents(o.total)}.`);
  }
  return items;
}

/** Same order + same lines + same attempt = same key (a double click reuses the session). Changed lines, or a new
 *  attempt after a session was expired (`stripe_checkout_count`), = a new key — an expired session never comes back. */
export function checkoutIdempotencyKey(o: CardOrder, attempt: number): string {
  const hash = createHash('sha256').update(JSON.stringify(checkoutLineItems(o))).digest('hex').slice(0, 24);
  return `wreath-${o.id}-${attempt}-${hash}`;
}

/** The order's fee cover and total recomputed on the server for the customer's choice — the same base as checkout:
 *  items + delivery. No fee is charged on the donation (W-3); it is added after the cover. */
export function withCardFeeCover(
  o: Pick<CardOrder, 'itemsSubtotal' | 'deliveryFee' | 'gift'>,
  rules: Pick<SaleRules, 'feePercent' | 'feeFixed'>,
  cover: boolean
): { feeCovered: number; total: number } {
  const baseCents = toCents(o.itemsSubtotal) + toCents(o.deliveryFee);
  const feeCovered = cover ? coverFeeFor(rules, fromCents(baseCents)) : 0;
  return { feeCovered, total: fromCents(baseCents + toCents(o.gift) + toCents(feeCovered)) };
}

export type CardLedgerRow = PaidLedgerRow | (Omit<PaidLedgerRow, 'kind' | 'amount'> & { kind: 'expense' | 'fundraiser'; amount: number });

/** A card payment's ledger rows (Patrick, 2026-10-15): gross fundraiser income, and the Stripe fee as a separate
 *  negative expense — null while Stripe hasn't settled the fee yet (booked later from charge.updated). */
export function cardLedgerRows(o: {
  orderNumber: string;
  customerName: string;
  total: number;
  fee: number | null;
  saleYear: number;
  today: string;
}): { income: PaidLedgerRow; feeRow: CardLedgerRow | null } {
  const income = paidLedgerRow({ ...o, method: 'card' });
  const feeRow =
    o.fee != null && o.fee > 0
      ? { ...income, kind: 'expense' as const, amount: -o.fee, memo: `Stripe fee · Wreath order ${o.orderNumber}` }
      : null;
  return { income, feeRow };
}

export interface CardLedger {
  /** The wreath part (total less the donation); null on a donation-only order. */
  income: PaidLedgerRow | null;
  /** The donation net of its share of Stripe's fee (W-3), kind 'donation'; null without a donation or when the fee ate it. */
  donation: DonationLedgerRow | null;
  /** The rest of Stripe's fee as a negative expense; null while unsettled or when the donation carries the whole fee. */
  feeRow: CardLedgerRow | null;
}

/**
 * A card payment's ledger rows with the donation split out (W-3, Patrick 2026-10-19): the wreath part as fundraiser
 * income, the donation as its own row net of its share of the fee (lib/wreaths/rules splitCardFee), and the rest of the
 * fee as an expense. The rows add up to what reaches the bank: `total` − `fee`. While the fee is unknown the donation is
 * booked gross and wreath_record_card_fee nets it when the fee lands.
 */
export function cardLedger(o: { orderNumber: string; customerName: string; total: number; gift: number; fee: number | null; saleYear: number; today: string }): CardLedger {
  const gift = Math.min(toCents(o.gift), toCents(o.total));
  const split = splitCardFee(o.fee ?? 0, fromCents(gift), o.total);
  const wreaths = toCents(o.total) - gift;
  const donationNet = gift - toCents(split.donation);
  const income = wreaths > 0 ? paidLedgerRow({ ...o, total: fromCents(wreaths), method: 'card' }) : null;
  const donation = donationNet > 0 ? donationLedgerRow({ ...o, amount: fromCents(donationNet), method: 'card' }) : null;
  const base = income ?? paidLedgerRow({ ...o, method: 'card' });
  const feeRow: CardLedgerRow | null =
    o.fee != null && toCents(split.rest) > 0 ? { ...base, kind: 'expense', amount: -split.rest, memo: `Stripe fee · Wreath order ${o.orderNumber}` } : null;
  return { income, donation, feeRow };
}

/** A full card refund with the donation split out: the wreath part and the donation (gross: the customer gets it all back) reversed. */
export function cardRefundRows(o: { orderNumber: string; customerName: string; amount: number; gift: number; saleYear: number; today: string }): {
  refund: CardLedgerRow | null;
  donationRefund: (Omit<DonationLedgerRow, 'amount'> & { amount: number }) | null;
} {
  const gift = Math.min(toCents(o.gift), toCents(o.amount));
  const wreaths = toCents(o.amount) - gift;
  return {
    refund: wreaths > 0 ? cardRefundRow({ ...o, amount: fromCents(wreaths) }) : null,
    donationRefund: gift > 0 ? { ...donationLedgerRow({ ...o, amount: fromCents(gift), method: 'card' }), amount: -fromCents(gift), memo: `Refund · Donation · Wreath order ${o.orderNumber} · ${o.customerName}` } : null
  };
}

/** A full card refund's ledger row: the income reversed. Stripe keeps its fee, so the fee row stands. */
export function cardRefundRow(o: { orderNumber: string; customerName: string; amount: number; saleYear: number; today: string }): CardLedgerRow {
  const base = paidLedgerRow({ ...o, total: o.amount, method: 'card' });
  return { ...base, amount: -o.amount, memo: `Refund · Wreath order ${o.orderNumber} · ${o.customerName}` };
}
