/**
 * What the Shopping tab's "What you paid" section SHOWS (Plans/Menu-Monster-
 * Scout-Workspace.md, Phase 2 release B; prototype concept-e-scout-workspace/
 * shopping.html). Pure: no DB, no session. The server decides what a report
 * does (mm_report_price); this predicts it with the same band check so the
 * scout sees the verdict BEFORE they save, and reads a saved result after.
 */

import { bandCheck, type BandPackage } from './price-band';
import { priceText as money } from './units';
import type { Actual, Actuals, PaidStatus } from './menus';

export type PaidTag = 'updated' | 'held' | 'book' | null;

export interface PaidVerdict {
  /** The one line under the open row. */
  text: string;
  /** The quiet tag beside the row name. */
  tag: PaidTag;
  /** Held lines sort first. */
  held: boolean;
  /** True once a price is entered. */
  entered: boolean;
}

/** A line is "changed" when its price or package differs from the last saved actuals. */
export function actualChanged(draft: Actual | undefined, saved: Actual | undefined): boolean {
  if (!draft && !saved) return false;
  if (!draft || !saved) return true;
  return draft.pricePaid !== saved.pricePaid || draft.packageId !== saved.packageId;
}

/**
 * The verdict for one line. `pkg` is the package the scout says they bought
 * (live price book; the band is measured from its leader-approved anchor); `changed` says the entry differs from what is saved;
 * `result` is what the last save reported for this line, honoured only while
 * the line is unchanged since.
 */
export function paidVerdict(pkg: BandPackage | undefined, entry: Actual | undefined, changed: boolean, result?: PaidStatus): PaidVerdict {
  if (!entry) return { text: 'Not entered yet', tag: null, held: false, entered: false };
  const kept: PaidVerdict = { text: 'Kept on your menu.', tag: null, held: false, entered: true };
  if (!pkg) return kept;
  if (!changed && result === 'applied') {
    return { text: `The troop price book now says ${money(pkg.price)}, credited to you.`, tag: 'updated', held: false, entered: true };
  }
  if (!changed && result === 'held') {
    return { text: 'Held for a leader to check. Different size, or a typo?', tag: 'held', held: true, entered: true };
  }
  const verdict = bandCheck(pkg, entry.pricePaid);
  if (verdict === 'same') return { text: `Matches the price book (${money(pkg.price)}).`, tag: null, held: false, entered: true };
  if (verdict === 'apply') {
    // Saved earlier and the book has moved on since: nothing will be reported again.
    if (!changed) return kept;
    return {
      text: `When you save, the troop price book changes ${money(pkg.price)} → ${money(entry.pricePaid)}, credited to you.`,
      tag: 'book',
      held: false,
      entered: true
    };
  }
  if (verdict === 'hold') {
    return {
      text: `${money(entry.pricePaid)} is far from the usual ${money(pkg.anchorPrice ?? pkg.price)}. A leader will check it. Bought a different package? Pick it above.`,
      tag: 'held',
      held: true,
      entered: true
    };
  }
  return { text: 'Not entered yet', tag: null, held: false, entered: false };
}

/** Entries with a price, as the actuals the server stores. */
export function pricedActuals(draft: Record<string, { packageId: string; qty: number; pricePaid: number | null }>): Actuals {
  const out: Actuals = {};
  for (const [id, a] of Object.entries(draft)) {
    if (a.pricePaid != null && a.pricePaid > 0) out[id] = { packageId: a.packageId, qty: a.qty, pricePaid: a.pricePaid };
  }
  return out;
}

/** The sentence under the section after a save. */
export function paidSavedSentence(applied: number, held: number): string {
  const parts: string[] = [];
  if (applied > 0) parts.push(`${applied} ${applied === 1 ? 'price' : 'prices'} updated for every patrol, credited to you`);
  if (held > 0) parts.push(`${held} held for a leader`);
  return parts.length > 0 ? `Saved. ${parts.join('; ')}.` : 'Saved.';
}
