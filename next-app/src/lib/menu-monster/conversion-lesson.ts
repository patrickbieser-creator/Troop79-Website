/**
 * Menu Monster — the Conversions tab's lesson (Patrick, 2026-10-05: "a peek
 * behind the magic curtain … formatting it as a learning tool").
 *
 * Read-only and pure. Three things a scout can see, each straight from what
 * the planner really uses, so the lesson can never drift from the math:
 *
 *   unitLadders     the measures that always convert (units.ts famFactor)
 *   foodRules       the foods that need their own number (mm_conversions)
 *   workedExamples  this menu's foods, converted step by step (units.ts conv)
 */

import type { Conversion, Ingredient, Package } from './types';
import { UNITS, conv, famFactor, qtyText, stepFactor } from './units';
import { SOLD_UNITS } from './authoring';

/** Up to two decimals, no trailing zeros: 28.3495 → "28.35", 16 → "16". */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** A unit as a scout reads it: "oz", "fl oz", "cups" — the ingredient's own noun for its count unit, and a
 *  thing sold "each" or by the pack by what it is ("stick", "box"), or "item" when nobody said. */
function unitName(key: string, n: number, ingredient?: Ingredient, noun?: string): string {
  const one = n === 1;
  if (ingredient && key === ingredient.unit.key) return one ? ingredient.unit.one : ingredient.unit.many;
  if (key === 'each' || key === 'pack') {
    const word = noun && noun !== 'each' && noun !== 'pack' ? noun : 'item';
    return one ? word : word === 'loaf' ? 'loaves' : `${word}s`;
  }
  const u = UNITS[key] ?? SOLD_UNITS.find((s) => s.key === key);
  return u ? (one ? u.one : u.many) : key;
}

export interface UnitLadder {
  key: 'volume' | 'weight' | 'count';
  label: string;
  /** "1 cup = 8 fl oz" — each step one rung up from the last. */
  steps: string[];
}

const RUNGS: readonly { key: UnitLadder['key']; label: string; units: readonly string[] }[] = [
  { key: 'volume', label: 'How much space it fills', units: ['tsp', 'tbsp', 'oz', 'cup', 'quart', 'gallon'] },
  { key: 'weight', label: 'How heavy it is', units: ['gram', 'ozw', 'lb'] }
];

export function unitLadders(): UnitLadder[] {
  const ladders: UnitLadder[] = RUNGS.map((r) => ({
    key: r.key,
    label: r.label,
    steps: r.units.slice(1).map((big, i) => {
      const f = famFactor(big, r.units[i]) as number;
      return `1 ${unitName(big, 1)} = ${num(f)} ${unitName(r.units[i], f)}`;
    })
  }));
  ladders.push({ key: 'count', label: 'How many there are', steps: ['1 dozen = 12'] });
  return ladders;
}

/** "1 cup = 5.26 oz" — whichever way round keeps the number at 1 or more. */
function ruleText(from: string, to: string, factor: number, ingredient: Ingredient, noun?: string): string {
  return factor >= 1
    ? `1 ${unitName(from, 1, ingredient, noun)} = ${num(factor)} ${unitName(to, factor, ingredient)}`
    : `1 ${unitName(to, 1, ingredient)} = ${num(1 / factor)} ${unitName(from, 1 / factor, ingredient, noun)}`;
}

export interface FoodRule {
  ingredientId: string;
  name: string;
  rule: string;
  /** Where the number comes from, as the leader recorded it. */
  source: string | null;
}

/** One line per conversion on file, A–Z by food. */
export function foodRules(catalog: { ingredients: readonly Ingredient[]; conversions: readonly Conversion[] }): FoodRule[] {
  const byId = new Map(catalog.ingredients.map((i) => [i.id, i]));
  return catalog.conversions
    .flatMap((c) => {
      const ingredient = byId.get(c.ingredientId);
      return ingredient ? [{ ingredientId: ingredient.id, name: ingredient.name, rule: ruleText(c.from, c.to, c.factor, ingredient), source: c.label }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.rule.localeCompare(b.rule));
}

export interface WorkedExample {
  ingredientId: string;
  name: string;
  /** What the menu needs, in the recipe's unit: "6 cups". */
  need: string;
  packageName: string;
  /** 'ladder' = same kind of measure; 'food' = this food's own number. */
  kind: 'ladder' | 'food';
  rule: string;
  /** "20 oz ÷ 5.26 = 3.8 cups" — what one package makes. */
  math: string;
  /** Packages that cover the need. */
  buy: number;
}

/**
 * The menu's shopping lines whose package is sold in a different unit than the
 * recipe measures, each worked from the label to the count to buy. Lines with
 * nothing to convert (sold in the recipe's unit, no label size, no path) are
 * left out — there is no lesson in them.
 */
export function workedExamples(
  lines: readonly { ing: Ingredient; need: number; pkg: Package | null }[],
  catalog: { conversions: readonly Conversion[] }
): WorkedExample[] {
  return lines.flatMap((l) => {
    const { ing, pkg } = l;
    if (!pkg || pkg.soldSize == null || !(pkg.soldSize > 0) || !pkg.soldUnit || pkg.soldUnit === 'count' || pkg.soldUnit === ing.unit.key) return [];
    const factor = conv(pkg.soldUnit, ing, catalog.conversions);
    if (factor == null || !(l.need > 0)) return [];
    const makes = pkg.soldSize * factor;
    const size = `${num(pkg.soldSize)} ${unitName(pkg.soldUnit, pkg.soldSize, ing, pkg.noun)}`;
    const out = `${num(makes)} ${unitName(ing.unit.key, makes, ing)}`;
    return [
      {
        ingredientId: ing.id,
        name: ing.name,
        need: qtyText(l.need, ing.unit),
        packageName: pkg.name,
        kind: stepFactor(pkg.soldUnit, ing.unit.key) != null ? ('ladder' as const) : ('food' as const),
        rule: ruleText(pkg.soldUnit, ing.unit.key, factor, ing, pkg.noun),
        math: factor >= 1 ? `${size} × ${num(factor)} = ${out}` : `${size} ÷ ${num(1 / factor)} = ${out}`,
        buy: Math.max(1, Math.ceil(l.need / makes - 1e-9))
      }
    ];
  });
}
