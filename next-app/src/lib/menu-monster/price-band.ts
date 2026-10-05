/**
 * The price band for scout-reported prices (Plans/Menu-Monster-Scout-Workspace.md,
 * "Phase 2 design"): a reported price whose UNIT price (price ÷ yield per
 * recipe unit) is within ±30% of the package's current unit price applies
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

// ±30% since 2026-10-04 (Patrick + Brad): at 50% a scout typing the total for two packages of a $3 item as
// $5.80 quietly raised every menu's cost. Each change stays in the package's price history with Revert.
export const PRICE_BAND = 0.3;

export type BandResult = 'same' | 'apply' | 'hold' | 'invalid';

export interface BandPackage {
  price: number;
  /** The last leader-set or leader-approved price; the band is measured from it. Absent = `price`. */
  anchorPrice?: number;
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
  const next = cents(reportedPrice);
  if (cents(pkg.price) === next) return 'same';
  const anchor = cents(pkg.anchorPrice ?? pkg.price);
  if (unitPrice(pkg) == null || anchor <= 0) return 'hold';
  return Math.abs(next - anchor) <= band * anchor ? 'apply' : 'hold';
}

/**
 * A scout-ADDED package (release C) has no price history of its own, so its
 * unit price (price ÷ size in recipe units) is measured against the CHEAPEST
 * live sibling package with a usable yield (Decision 13) — the caller passes
 * the troop's own packages, or — when the troop has priced none — the first scout package that went live
 * (a fixed anchor: no downward ratchet). No usable sibling → it is the food's first price and applies
 * (2026-10-05; it used to wait for a leader). Exact: |P/Y − Pc/Yc| ≤ band·Pc/Yc is compared
 * cross-multiplied in whole cents (mm_add_scout_package does the same in SQL).
 */
export function newPackageBand(
  siblings: readonly Pick<BandPackage, 'price' | 'yield'>[],
  price: number,
  size: number,
  band: number = PRICE_BAND
): Exclude<BandResult, 'same'> {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) return 'invalid';
  const usable = siblings.filter((s) => s.yield != null && s.yield > 0 && s.price > 0);
  if (usable.length === 0) return 'apply';
  const cheapest = usable.reduce((a, b) => (b.price / (b.yield as number) < a.price / (a.yield as number) ? b : a));
  const p = cents(price);
  const pc = cents(cheapest.price);
  const yc = cheapest.yield as number;
  return Math.abs(p * yc - pc * size) <= band * pc * size ? 'apply' : 'hold';
}
