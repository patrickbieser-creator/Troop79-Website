/**
 * How a receipt line lands on, and comes back off, the "What we bought" record
 * (Plans/Menu-Monster-Receipt-Reconciliation.md). Pure: no DB, no session.
 *
 * A confirmed receipt line contributes one item `{brandId: null, packageId: null, qty, pricePaid: unitPrice,
 * receiptLineId}` to the ingredient's bought line. Taking it back finds that item by its receiptLineId alone — never
 * by qty + price, which a hand-entered "any brand at a price" item can share (qa-lead, 2026-10-08).
 */

import { MAX_BOUGHT_ITEMS, type BoughtItem, type BoughtLine } from './bought';

export type BoughtWrite = { status: 'bought'; items: BoughtItem[] } | null;

export const receiptItem = (l: { id: number; qty: number; unitPrice: number }): BoughtItem => ({ brandId: null, packageId: null, qty: l.qty, pricePaid: l.unitPrice, receiptLineId: l.id });

/**
 * The bought line after adding `item`. A missing or "not bought" line becomes just this item (it replaces the
 * virtual "as planned" default); a line with items gets it appended. 'full' when it already holds the most items.
 */
export function addItem(entry: BoughtLine | undefined, item: BoughtItem): BoughtWrite | 'full' {
  if (!entry || entry.status === 'not_bought' || entry.items.length === 0) return { status: 'bought', items: [item] };
  if (entry.items.length >= MAX_BOUGHT_ITEMS) return 'full';
  return { status: 'bought', items: [...entry.items, item] };
}

/**
 * The bought line after taking the item of receipt line `receiptLineId` back off: null (cleared) when nothing is
 * left, 'same' when the line holds no such item (nothing to write).
 */
export function removeItem(entry: BoughtLine | undefined, receiptLineId: number): BoughtWrite | 'same' {
  if (!entry || entry.status !== 'bought') return 'same';
  const at = entry.items.findIndex((x) => x.receiptLineId === receiptLineId);
  if (at < 0) return 'same';
  const items = entry.items.filter((_, i) => i !== at);
  return items.length === 0 ? null : { status: 'bought', items };
}
