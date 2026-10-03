/**
 * The recipe editor's ingredient rows (Phase 4A, IngredientList 'author' mode).
 * Pure: the draft's lines in order, each with its amount as the read list would
 * show it (ingredientRows, one line at a time, so the numbers match everywhere
 * else), the per-person amount and unit for the amount box, and "What you'd
 * buy" — the price book's cheapest usable package per recipe unit.
 */

import type { AmountView } from './ingredient-rows';
import { ingredientRows } from './ingredient-rows';
import type { ScoutRecipeLine } from './scout-recipes';
import type { Catalog, Package } from './types';
import { lineUnit, priceText } from './units';

export interface AuthorRowData {
  key: string;
  ingredientId: string;
  name: string;
  amount: string;
  note: string | null;
  qtyPerPerson: number;
  unitLabel: string;
  buy: string | null;
}

const NO_DIETS = { gf: 0, nut: 0, dairy: 0, veg: 0 };

function cheapest(packages: readonly Package[], ingredientId: string): Package | null {
  let best: Package | null = null;
  for (const p of packages) {
    if (p.ingredientId !== ingredientId || !(p.yield != null && p.yield > 0)) continue;
    if (!best || p.price / p.yield < best.price / (best.yield as number)) best = p;
  }
  return best;
}

export function authorRows(lines: readonly ScoutRecipeLine[], catalog: Catalog, people: number, view: AmountView): AuthorRowData[] {
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const out: AuthorRowData[] = [];
  for (const l of lines) {
    const ing = ING.get(l.ingredientId);
    if (!ing) continue;
    const shown = ingredientRows(
      { lines: [{ ingredientId: l.ingredientId, qtyPerPerson: l.qtyPerPerson, unitKey: l.unitKey, servesRule: 'everyone', servesRestrictions: [] }] },
      catalog,
      { headcount: people, restrictions: NO_DIETS },
      view
    )[0];
    const pkg = cheapest(catalog.packages, ing.id);
    out.push({
      key: `ing:${ing.id}`,
      ingredientId: ing.id,
      name: ing.name,
      amount: shown?.amount ?? '',
      note: null,
      qtyPerPerson: l.qtyPerPerson,
      unitLabel: lineUnit(l.unitKey, ing).many,
      buy: pkg ? [pkg.name, priceText(pkg.price), pkg.store].filter(Boolean).join(' · ') : null
    });
  }
  return out;
}
