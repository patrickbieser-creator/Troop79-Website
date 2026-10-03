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
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The client's package, cleaned; null when it isn't one a scout may add (unknown or typed-in ingredient, bad size or price). */
export function sanitizeScoutPackage(raw: unknown, catalog: Catalog): ScoutPackage | null {
  if (!isRecord(raw) || typeof raw.ingredientId !== 'string') return null;
  const ingredient = catalog.ingredients.find((i) => i.id === raw.ingredientId);
  if (!ingredient || ingredient.needsMatch) return null;
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
  return { ingredientId: ingredient.id, name: p.name, store: cleanScoutText(raw.store, 40) || null, size: yld, price: p.price };
}
