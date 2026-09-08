/**
 * Menu Monster — units, fixed vocabularies, conversion and quantity text.
 *
 * Ported from the Menu Monster prototypes (concept-a / concept-c, D:\Projects\
 * Troop Menu Monster\prototypes). Pure: no React, no DB, safe on the client.
 *
 * Units, restrictions, sections, meals and food groups are code constants, not
 * tables (PATTERNS.md: don't add a lookup table for a fixed list). Per-ingredient
 * conversions (Option C density rows) DO live in the DB and are passed in.
 */

import type { FoodGroup, Ingredient, Conversion, MealSlot, Restriction, RestrictionKey, Section, Unit } from './types';

/** Named units a recipe line may use. Count nouns ('count' + banana) are per-ingredient. */
export const UNITS: Record<string, Unit> = {
  slice: { key: 'slice', one: 'slice', many: 'slices', kind: 'count' },
  cup: { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' },
  tbsp: { key: 'tbsp', one: 'Tbsp', many: 'Tbsp', kind: 'volume' },
  tsp: { key: 'tsp', one: 'tsp', many: 'tsp', kind: 'volume' },
  oz: { key: 'oz', one: 'fl oz', many: 'fl oz', kind: 'volume' },
  egg: { key: 'egg', one: 'egg', many: 'eggs', kind: 'count' },
  link: { key: 'link', one: 'link', many: 'links', kind: 'count' },
  packet: { key: 'packet', one: 'packet', many: 'packets', kind: 'count' },
  gram: { key: 'gram', one: 'g', many: 'g', kind: 'weight' },
  ozw: { key: 'ozw', one: 'oz', many: 'oz', kind: 'weight' },
  lb: { key: 'lb', one: 'lb', many: 'lb', kind: 'weight' }
};

export const RESTRICTIONS: readonly Restriction[] = [
  { key: 'gf', label: 'Gluten-free', hint: 'no wheat, barley, rye' },
  { key: 'nut', label: 'Nut-free', hint: 'peanuts and tree nuts' },
  { key: 'dairy', label: 'Dairy-free', hint: 'no milk, butter, cheese' },
  { key: 'veg', label: 'Vegetarian', hint: 'no meat' }
];

export const RESTRICTION_BY_KEY: Record<RestrictionKey, Restriction> = {
  gf: RESTRICTIONS[0],
  nut: RESTRICTIONS[1],
  dairy: RESTRICTIONS[2],
  veg: RESTRICTIONS[3]
};

/** Only gluten and nuts raise allergen warnings — vegetarian and dairy are obvious at the table. */
export const WARN_ALLERGENS: readonly RestrictionKey[] = ['gf', 'nut'];

export const SECTIONS: Record<Section, string> = {
  produce: 'Produce',
  dairy: 'Dairy & eggs',
  meat: 'Meat',
  bakery: 'Bakery',
  dry: 'Dry goods & pantry'
};

/** Shopping-list order: the walk through the store the prototype settled on. */
export const SECTION_ORDER: readonly Section[] = ['meat', 'dairy', 'produce', 'bakery', 'dry'];

export const MEALS: readonly { key: MealSlot; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snack' },
  { key: 'dessert', label: 'Dessert' }
];

export const FOOD_GROUPS: readonly { key: FoodGroup; label: string }[] = [
  { key: 'grain', label: 'Grain' },
  { key: 'protein', label: 'Protein' },
  { key: 'fruit', label: 'Fruit' },
  { key: 'veg', label: 'Vegetable' },
  { key: 'dairy', label: 'Dairy' }
];

export const SOURCE_LABELS = {
  buy: 'Buy at the store',
  pantry: 'From the troop pantry',
  home: 'Bringing from home'
} as const;

/* ---- Unit families ----------------------------------------------------------
   Value of each key in the family's base (tsp, g). Package labels may also be
   in quart/gallon (volume) even though a recipe line never is. */
const VOL: Record<string, number> = { tsp: 1, tbsp: 3, oz: 6, cup: 48, quart: 192, gallon: 768 };
const WT: Record<string, number> = { gram: 1, ozw: 28.3495, lb: 453.592 };

type Family = 'volume' | 'weight' | 'unit' | 'count';

function famOf(key: string): Family {
  if (key in VOL) return 'volume';
  if (key in WT) return 'weight';
  if (key === 'each' || key === 'pack') return 'unit';
  return 'count';
}

function famVal(key: string): number {
  if (VOL[key] != null) return VOL[key];
  if (WT[key] != null) return WT[key];
  return key === 'dozen' ? 12 : 1;
}

/** 1 a = ? b within one family; null across families. */
export function famFactor(a: string, b: string): number | null {
  if (a === b) return 1;
  const fa = famOf(a);
  const fb = famOf(b);
  if (fa !== fb || fa === 'unit') return null;
  return famVal(a) / famVal(b);
}

/** One conversion step between two unit keys: same family via the tables,
 *  dozen → a count, identical keys = 1. Count nouns never convert to each
 *  other (a slice is not an egg). */
export function stepFactor(a: string, b: string): number | null {
  if (a === b) return 1;
  const fa = famOf(a);
  const fb = famOf(b);
  if (a === 'dozen' && fb === 'count') return 12;
  if (fa === 'count' || fb === 'count' || fa === 'unit' || fb === 'unit') return null;
  return famFactor(a, b);
}

/** Factor from a line's unit to the ingredient's recipe unit; null = no path
 *  (a blocking issue — the fix is a conversion row, not a recipe change).
 *  Same family converts by table. Across families (tsp of cinnamon priced in
 *  grams, lb of bacon priced in slices) the ingredient's conversion rows
 *  bridge the gap, in either direction. */
export function conv(
  lineUnitKey: string | null | undefined,
  ingredient: Ingredient,
  conversions: readonly Conversion[]
): number | null {
  const key = lineUnitKey || ingredient.unit.key;
  const direct = stepFactor(key, ingredient.unit.key);
  if (direct != null) return direct;
  for (const d of conversions) {
    if (d.ingredientId !== ingredient.id) continue;
    const a = stepFactor(key, d.from);
    const b = stepFactor(d.to, ingredient.unit.key);
    if (a != null && b != null) return a * d.factor * b;
    const c = stepFactor(key, d.to);
    const e = stepFactor(d.from, ingredient.unit.key);
    if (c != null && e != null) return (c / d.factor) * e;
  }
  return null;
}

/** Every unit key a recipe line may use for this ingredient: whatever conv() can bridge. */
export function supportedUnits(ingredient: Ingredient, conversions: readonly Conversion[]): string[] {
  return [
    ingredient.unit.key,
    ...Object.keys(UNITS).filter((k) => k !== ingredient.unit.key && conv(k, ingredient, conversions) != null)
  ];
}

/** The Unit a line is written in (its own key, or the ingredient's). */
export function lineUnit(unitKey: string | null | undefined, ingredient: Ingredient): Unit {
  if (!unitKey || unitKey === ingredient.unit.key) return ingredient.unit;
  return UNITS[unitKey] ?? { key: unitKey, one: unitKey, many: unitKey, kind: 'count' };
}

/* ---- Quantity text -------------------------------------------------------- */

const FRACS: readonly [number, string][] = [
  [0, ''], [0.125, '⅛'], [0.25, '¼'], [0.333, '⅓'], [0.375, '⅜'], [0.5, '½'],
  [0.625, '⅝'], [0.667, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, '']
];

/** 0.5 → "½", 1.25 → "1¼", 0.3 → "0.3" (no near glyph). */
export function fracText(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const rem = n - whole;
  let best = FRACS[0];
  let bd = 1;
  for (const f of FRACS) {
    const d = Math.abs(f[0] - rem);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  if (bd > 0.03) return String(Math.round(n * 100) / 100);
  let w = whole;
  let glyph = best[1];
  if (best[0] === 1) {
    w += 1;
    glyph = '';
  }
  if (w === 0 && glyph) return glyph;
  return glyph ? `${w}${glyph}` : String(w);
}

/** "½ cup", "3 slices", "2.6 g". exact=true keeps fractions on count units
 *  (recipe cards say "2½ eggs per person"); the shopping list always rounds
 *  counts up because you can't buy half an egg. */
export function qtyText(n: number, unit: Unit, exact = false): string {
  if (unit.kind === 'count' && !exact) {
    const w = Math.ceil(n - 1e-9);
    return `${w} ${w === 1 ? unit.one : unit.many}`;
  }
  if (unit.kind === 'weight') return `${Math.round(n * 10) / 10} ${unit.many}`;
  const t = fracText(n);
  const one = n <= 1 + 1e-9;
  return `${t} ${one ? unit.one : unit.many}`;
}

/** "2½ eggs" not "2½ eggs eggs": skip the ingredient name when the unit already names it. */
export function perPersonText(qty: number, ingredient: Ingredient, unit?: Unit): string {
  const u = unit ?? ingredient.unit;
  const q = qtyText(qty, u, true);
  return ingredient.name.toLowerCase().includes(u.many) ? q : `${q} ${ingredient.name.toLowerCase()}`;
}

const FRAC_MAP: Record<string, string> = {
  '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
};

/** Accepts ½, 1/2, 1 1/2, 1½, 0.5. NaN when it isn't a quantity. */
export function parseQty(s: string | null | undefined): number {
  const text = String(s ?? '')
    .replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, (m) => ` ${FRAC_MAP[m]} `)
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return NaN;
  let total = 0;
  for (const p of text.split(' ')) {
    if (/^\d+\/\d+$/.test(p)) {
      const [a, b] = p.split('/').map(Number);
      if (!b) return NaN;
      total += a / b;
    } else if (/^\d*\.?\d+$/.test(p)) {
      total += +p;
    } else {
      return NaN;
    }
  }
  return total;
}
