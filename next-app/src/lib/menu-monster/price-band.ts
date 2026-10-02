/**
 * The price band for scout-reported prices (Plans/Menu-Monster-Scout-Workspace.md,
 * "Phase 2 design"): a reported price whose UNIT price (price ÷ yield per
 * recipe unit) is within ±50% of the package's current unit price applies
 * straight away; anything further out, or against an unusable package, is
 * held for a leader. Authoring's 25% `BIG_CHANGE` is a different, softer flag.
 *
 * Pure. `mm_report_price` (20261003120000_mm_report_price.sql) implements the
 * same rule in SQL; keep the two in step (db tests run the same cases).
 *
 * Both prices belong to the same package, so the yield cancels out of the
 * ratio: |new/y − cur/y| ≤ band · cur/y  ⇔  |new − cur| ≤ band · cur. The
 * comparison is done in whole cents (exact in SQL numeric too) rather than
 * on divided floats, so an edge value like 4 → 6 is never on the wrong side.
 */

export const PRICE_BAND = 0.5;

export type BandResult = 'same' | 'apply' | 'hold' | 'invalid';

export interface BandPackage {
  price: number;
  /** Per recipe unit; null = unusable until someone types it. */
  yield: number | null;
}

/** Price per recipe unit, or null when the package has no usable yield. */
export function unitPrice(pkg: BandPackage): number | null {
  if (pkg.yield == null || !(pkg.yield > 0)) return null;
  return pkg.price / pkg.yield;
}

const cents = (n: number) => Math.round(n * 100);

export function bandCheck(pkg: BandPackage, reportedPrice: number, band: number = PRICE_BAND): BandResult {
  if (!Number.isFinite(reportedPrice) || reportedPrice <= 0) return 'invalid';
  const cur = cents(pkg.price);
  const next = cents(reportedPrice);
  if (cur === next) return 'same';
  if (unitPrice(pkg) == null || cur <= 0) return 'hold';
  return Math.abs(next - cur) <= band * cur ? 'apply' : 'hold';
}
