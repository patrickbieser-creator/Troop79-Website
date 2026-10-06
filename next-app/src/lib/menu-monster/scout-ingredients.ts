/**
 * Typed-in ingredients on scout recipes (Plans/Menu-Monster-Scout-Workspace.md,
 * Phase 4B). Pure: a scout adds an ingredient the price book doesn't have —
 * its name, how it's measured, one package (size + price, store optional) and
 * what it contains (diet ticks, unverified until a leader matches it). Until
 * the save the editor works on a `new:<8 hex>` key; mm_save_scout_recipe turns
 * it into a real x-<hex> ingredient and returns the id.
 *
 * The recipe unit is fixed per kind (volume → cup, weight → oz, count → the
 * scout's own noun), so a package size typed in gallons or pounds is converted
 * once, here, into the recipe unit the database stores.
 */

import type { Catalog, Ingredient, Package, RestrictionKey, Section, Unit } from './types';
import { SECTION_ORDER, UNITS, famFactor } from './units';
import { cleanScoutText } from './scout-recipes';

export type NewIngredientKind = 'count' | 'volume' | 'weight';

export interface NewIngredient {
  /** new:<8 hex> until saved. */
  key: string;
  name: string;
  kind: NewIngredientKind;
  /** Count only: what one / several are called ("tortilla" / "tortillas"). */
  one: string;
  many: string;
  /** Diets it doesn't suit (contains gluten → 'gf'). Unverified. */
  avoid: RestrictionKey[];
  /** The store section (Kind of food). The old callers that never send one get 'dry'. */
  section: Section;
  /** One package, in the recipe unit (cups / oz / count). 0 with a 0 price = no package: the food is unpriced until someone prices it. */
  size: number;
  price: number;
  store: string | null;
}

export const MAX_NEW_INGREDIENTS = 10;
export const MIN_PRICE = 0.1;
export const MAX_PRICE = 500;
const MAX_SIZE = 100000;
const NEW_KEY = /^new:[0-9a-f]{8}$/;
const DIETS: readonly RestrictionKey[] = ['gf', 'nut', 'dairy', 'veg'];

/** Whether the typed-in carries a package (a size and a price); without one it is saved unpriced. */
export const hasPackage = (n: Pick<NewIngredient, 'size' | 'price'>) => n.size > 0 && n.price > 0;

export const isNewKey = (v: unknown): v is string => typeof v === 'string' && NEW_KEY.test(v);

export function newIngredientKey(rand: () => number = Math.random): string {
  let hex = '';
  for (let i = 0; i < 8; i++) hex += Math.floor(rand() * 16).toString(16);
  return `new:${hex}`;
}

/** The unit a typed-in ingredient's recipe lines and package yield are in. */
export function recipeUnitFor(kind: NewIngredientKind, one = '', many = ''): Unit {
  if (kind === 'volume') return UNITS.cup;
  if (kind === 'weight') return UNITS.ozw;
  return { key: 'count', one, many, kind: 'count' };
}

/** The package-size units a scout may type, per kind (the first is the recipe unit). */
export const SIZE_UNITS: Record<NewIngredientKind, { key: string; label: string }[]> = {
  weight: [
    { key: 'ozw', label: 'oz' },
    { key: 'lb', label: 'lb' },
    { key: 'gram', label: 'g' }
  ],
  volume: [
    { key: 'cup', label: 'cups' },
    { key: 'oz', label: 'fl oz' },
    { key: 'quart', label: 'quarts' },
    { key: 'gallon', label: 'gallons' }
  ],
  count: [{ key: 'count', label: 'in a package' }]
};

/** A package size typed in any of SIZE_UNITS[kind], in the recipe unit; null when the unit doesn't belong to the kind. */
export function sizeInRecipeUnit(kind: NewIngredientKind, size: number, sizeUnit: string): number | null {
  if (!SIZE_UNITS[kind].some((u) => u.key === sizeUnit)) return null;
  if (kind === 'count') return size;
  const f = famFactor(sizeUnit, recipeUnitFor(kind).key);
  return f == null ? null : size * f;
}

const plural = (one: string) => (/(s|x|ch|sh)$/i.test(one) ? `${one}es` : /[^aeiou]y$/i.test(one) ? `${one.slice(0, -1)}ies` : `${one}s`);

/** What the add form says is wrong, or null. */
export function newIngredientProblem(
  n: Pick<NewIngredient, 'name' | 'kind' | 'one' | 'size' | 'price'>,
  catalog: Catalog,
  /** The recipe editor's form wants the package; the on-the-fly food does not (it can be priced later). */
  opts: { requirePackage?: boolean } = {}
): string | null {
  const name = cleanScoutText(n.name, 60);
  if (!name) return 'Give the ingredient a name.';
  if (catalog.ingredients.some((i) => i.name.toLowerCase() === name.toLowerCase() && !i.needsMatch)) {
    return `“${name}” is already in the price book. Pick it from the search instead.`;
  }
  if (n.kind === 'count' && !cleanScoutText(n.one, 20)) return 'Say what one is called (can, tortilla…).';
  // No package at all (size and price both empty) is a food nobody has priced yet — fine unless the form needs one.
  const none = !(n.size > 0) && !(n.price > 0);
  if (none && !opts.requirePackage) return null;
  if (!(Number.isFinite(n.size) && n.size > 0 && n.size <= MAX_SIZE)) return 'How big is one package?';
  if (!(Number.isFinite(n.price) && n.price >= MIN_PRICE && n.price <= MAX_PRICE)) return `Enter what one package costs, from $${MIN_PRICE.toFixed(2)} to $${MAX_PRICE}.`;
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Any payload → the typed-ins the RPC will accept (bad ones dropped, at most 10, keys unique). */
/** A typed-in as the RPCs take it (mm_create_typed_in via the recipe save or mm_add_menu_ingredient). */
export function typedInPayload(n: NewIngredient) {
  return { key: n.key, name: n.name, kind: n.kind, unit_one: n.one, unit_many: n.many, avoid: n.avoid, section: n.section, package: hasPackage(n) ? { size: n.size, price: n.price, store: n.store } : null };
}

/** Every typed-in id (x-<8 hex>) a menu's meals, shopping choices or actuals name. */
export function typedInIdsIn(value: unknown): string[] {
  return [...new Set(JSON.stringify(value ?? null).match(/x-[0-9a-f]{8}/g) ?? [])];
}

export function sanitizeNewIngredients(raw: unknown, catalog: Catalog): NewIngredient[] {
  const out: NewIngredient[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_NEW_INGREDIENTS) break;
    if (!isRecord(r) || !isNewKey(r.key) || out.some((x) => x.key === r.key)) continue;
    const kind = r.kind === 'count' || r.kind === 'volume' || r.kind === 'weight' ? r.kind : null;
    if (!kind) continue;
    const one = kind === 'count' ? cleanScoutText(r.one, 20) : '';
    const many = kind === 'count' ? cleanScoutText(r.many, 20) || plural(one) : '';
    const n: NewIngredient = {
      key: r.key,
      name: cleanScoutText(r.name, 60),
      kind,
      one,
      many,
      avoid: DIETS.filter((d) => Array.isArray(r.avoid) && r.avoid.includes(d)),
      section: SECTION_ORDER.find((k) => k === r.section) ?? 'dry',
      size: Math.round((Number(r.size) || 0) * 1000) / 1000,
      price: Math.round((Number(r.price) || 0) * 100) / 100,
      store: cleanScoutText(r.store, 40) || null
    };
    if (newIngredientProblem(n, catalog) == null) out.push(n);
  }
  return out;
}

/** The catalog plus the editor's typed-ins (unsaved, or saved but not in this page's catalog yet), so their rows price
 *  like any other. One the catalog already has is skipped. Pure; the catalog is not changed. */
export function overlayNewIngredients(catalog: Catalog, list: readonly NewIngredient[]): Catalog {
  const have = new Set(catalog.ingredients.map((i) => i.id));
  list = list.filter((n) => !have.has(n.key));
  if (list.length === 0) return catalog;
  const ingredients: Ingredient[] = list.map((n) => ({
    id: n.key,
    name: n.name,
    unit: recipeUnitFor(n.kind, n.one, n.many),
    section: n.section,
    staple: false,
    avoid: n.avoid,
    needsMatch: true
  }));
  const packages: Package[] = list.filter(hasPackage).map((n) => ({
    id: `pkg:${n.key}`,
    ingredientId: n.key,
    name: n.name,
    store: n.store,
    price: n.price,
    anchorPrice: n.price,
    yield: n.size,
    yieldUnitLabel: null,
    noun: 'pack',
    soldSize: null,
    soldUnit: null,
    note: null,
    asOf: null
  }));
  return { ...catalog, ingredients: [...catalog.ingredients, ...ingredients], packages: [...catalog.packages, ...packages] };
}
