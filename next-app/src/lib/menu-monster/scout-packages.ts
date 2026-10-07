/**
 * A scout's package on a price-book ingredient (release C, P2.3a — Plans/
 * Menu-Monster-Scout-Workspace.md, "Release C design"): what they bought that
 * the book doesn't list (name, store, size, price). Pure: the Shopping tab's
 * form and the server action share the same rules, and mm_add_scout_package
 * re-checks the bounds and the band.
 *
 * The size is typed in any unit the ingredient can be bridged to — its own
 * unit, its unit family, or across one of its conversion rows (units.ts conv)
 * — and stored in the recipe unit. A unit with no path is never offered, so a
 * scout can't invent a conversion (troop79-specialist review).
 */

import { cleanScoutText } from './scout-text';
import { MAX_PRICE, MIN_PRICE } from './scout-ingredients';
import { conv } from './units';
import type { Catalog, Conversion, Ingredient } from './types';

export const MAX_PACKAGE_SIZE = 100000;

/** Units a scout may read off the label, beyond the ingredient's own. */
const LABEL_UNITS: { key: string; label: string }[] = [
  { key: 'ozw', label: 'oz (weight)' },
  { key: 'lb', label: 'lb' },
  { key: 'gram', label: 'g' },
  { key: 'cup', label: 'cups' },
  { key: 'oz', label: 'fl oz' },
  { key: 'quart', label: 'quarts' },
  { key: 'gallon', label: 'gallons' },
  { key: 'dozen', label: 'dozen' }
];

/** The size units this ingredient's package can be typed in, its own unit first. */
export function packageSizeUnits(ingredient: Ingredient, conversions: readonly Conversion[]): { key: string; label: string }[] {
  const own = { key: ingredient.unit.key, label: ingredient.unit.many };
  return [own, ...LABEL_UNITS.filter((u) => u.key !== own.key && conv(u.key, ingredient, conversions) != null)];
}

/** The short words a size is read in on a label ("12 oz", "1 lb"); the ingredient's own unit uses its own words. */
const SHORT_UNITS: Record<string, string> = { ozw: 'oz', oz: 'fl oz', lb: 'lb', gram: 'g', cup: 'cups', quart: 'qt', gallon: 'gal', dozen: 'dozen' };

/** "12 oz", "1.5 lb", "18 eggs": the size as the scout typed it, for the quantity row ("4 × 12 oz"). */
export function packageSizeLabel(size: number, unitKey: string, ingredient: Ingredient): string {
  const n = String(Math.round(size * 1000) / 1000);
  if (unitKey === ingredient.unit.key) return `${n} ${size === 1 ? ingredient.unit.one : ingredient.unit.many}`;
  return `${n} ${SHORT_UNITS[unitKey] ?? unitKey}`;
}

/** The package size in the ingredient's recipe unit; null when the unit has no path or the size isn't positive. */
export function packageYield(ingredient: Ingredient, conversions: readonly Conversion[], size: number, unitKey: string): number | null {
  if (!Number.isFinite(size) || size <= 0) return null;
  const f = conv(unitKey, ingredient, conversions);
  return f == null ? null : Math.round(size * f * 1000) / 1000;
}

/** What the form says is wrong, or null. `yield` is the size in recipe units (packageYield). */
export function scoutPackageProblem(p: { name: string; size: number; price: number; yield: number | null }): string | null {
  if (!p.name.trim()) return 'Give the package a name, like the label says.';
  if (!(p.size > 0) || p.yield == null || !(p.yield > 0)) return 'Enter how much one package holds — check the label.';
  if (p.yield > MAX_PACKAGE_SIZE) return 'That package is too big. Check the size.';
  if (!(p.price >= MIN_PRICE && p.price <= MAX_PRICE)) return `Enter what one package costs, from $${MIN_PRICE.toFixed(2)} to $${MAX_PRICE}.`;
  return null;
}

export interface ScoutPackage {
  ingredientId: string;
  name: string;
  store: string | null;
  /** In the ingredient's recipe unit. */
  size: number;
  price: number;
  /** A size of this brand ("12 oz" on the bag): the package is filed under the brand (brand detail dialog). */
  brandId?: string;
  sizeLabel?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The client's package, cleaned; null when it isn't one a scout may add (unknown or typed-in ingredient, bad size
 * or price). A typed-in is refused unless `ownTypedIn` — the caller has checked on the server that the acting
 * person typed that food in (the action reads added_by_person_id; mm_add_scout_package re-checks it).
 */
export function sanitizeScoutPackage(raw: unknown, catalog: Catalog, ownTypedIn = false): ScoutPackage | null {
  if (!isRecord(raw) || typeof raw.ingredientId !== 'string') return null;
  const ingredient = catalog.ingredients.find((i) => i.id === raw.ingredientId);
  if (!ingredient || (ingredient.needsMatch && !ownTypedIn)) return null;
  const size = Number(raw.size);
  const unitKey = typeof raw.sizeUnit === 'string' ? raw.sizeUnit : ingredient.unit.key;
  const yld = packageYield(ingredient, catalog.conversions, size, unitKey);
  const p = {
    name: cleanScoutText(raw.name, 60),
    size,
    price: Math.round(Number(raw.price) * 100) / 100,
    yield: yld
  };
  if (scoutPackageProblem(p) != null || yld == null) return null;
  const brandId = typeof raw.brandId === 'string' && raw.brandId.length > 0 && raw.brandId.length <= 100 ? raw.brandId : null;
  return {
    ingredientId: ingredient.id,
    name: p.name,
    store: cleanScoutText(raw.store, 40) || null,
    size: yld,
    price: p.price,
    ...(brandId ? { brandId, sizeLabel: packageSizeLabel(size, unitKey, ingredient) } : {})
  };
}
