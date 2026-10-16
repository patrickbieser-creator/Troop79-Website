import { createHash } from 'node:crypto';
import { coverFeeFor, fromCents, itemLabel, paidLedgerRow, toCents, type PaidLedgerRow, type SaleRules } from './rules';

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
  extra('Gift to Troop 79', o.gift);
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
 *  items + gift + delivery. */
export function withCardFeeCover(
  o: Pick<CardOrder, 'itemsSubtotal' | 'deliveryFee' | 'gift'>,
  rules: Pick<SaleRules, 'feePercent' | 'feeFixed'>,
  cover: boolean
): { feeCovered: number; total: number } {
  const baseCents = toCents(o.itemsSubtotal) + toCents(o.gift) + toCents(o.deliveryFee);
  const feeCovered = cover ? coverFeeFor(rules, fromCents(baseCents)) : 0;
  return { feeCovered, total: fromCents(baseCents + toCents(feeCovered)) };
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

/** A full card refund's ledger row: the income reversed. Stripe keeps its fee, so the fee row stands. */
export function cardRefundRow(o: { orderNumber: string; customerName: string; amount: number; saleYear: number; today: string }): CardLedgerRow {
  const base = paidLedgerRow({ ...o, total: o.amount, method: 'card' });
  return { ...base, amount: -o.amount, memo: `Refund · Wreath order ${o.orderNumber} · ${o.customerName}` };
}
