/**
 * Menu Monster — the rows an ingredient list shows (Plans/Menu-Monster-Scout-
 * Workspace.md, slice 4b). Pure: no React, no DB. The engine's own serves rules
 * (servingsFor) and the units helpers (conv, lineUnit, qtyText, fracText) do
 * all the arithmetic; this module only picks the words, so what a scout reads
 * here can never disagree with what the shopping list buys.
 *
 * Feed it a recipe whose lines already carry the meal's edits
 * (menus.ts mealCatalog / applyRecipeEdits) and the list shows the scout's
 * version with no extra work.
 */

import type { Catalog, Plan, Recipe } from './types';
import { effectiveRestrictions, ruleText, servingsFor } from './engine';
import { conv, fracText, lineUnit, qtyText } from './units';

/** 'total' = what to buy for the meal's headcount; 'person' = one person's share. */
export type AmountView = 'total' | 'person';

/** What happened to a row in a menu's version of the recipe (Phase 2). */
export type RowMarker = { kind: 'changed' | 'added' | 'swapped' | 'out'; was?: string };

export interface IngredientRow {
  /** Stable within the recipe: the line's index and ingredient. */
  key: string;
  /** 'Almond flour'. */
  name: string;
  /** The amount for the view, already worded: '3½ cups', '30 slices', '2'. */
  amount: string;
  /** Who a diet line is for: 'gluten-free only' / 'everyone else'; null for a plain line. */
  note: string | null;
  /** Phase 2 (menu-edit mode): Changed / Added / Swapped / Left out, with the struck old value. Phase 1 never sets it. */
  marker?: RowMarker;
}

export function ingredientRows(
  recipe: Pick<Recipe, 'lines'>,
  catalog: Catalog,
  plan: Pick<Plan, 'headcount' | 'restrictions'>,
  view: AmountView
): IngredientRow[] {
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const people = plan.headcount;
  const R = effectiveRestrictions(plan as Plan);
  const rows: IngredientRow[] = [];

  recipe.lines.forEach((line, i) => {
    const ing = ING.get(line.ingredientId);
    // The same lines buildLines() skips: unknown ingredient, no conversion path, no amount.
    if (!ing || !(line.qtyPerPerson > 0) || conv(line.unitKey, ing, catalog.conversions) == null) return;
    const fed = servingsFor(line, people, R);
    if (fed <= 0) return; // a diet swap nobody needs

    const unit = lineUnit(line.unitKey, ing);
    const qty = view === 'total' ? line.qtyPerPerson * fed : line.qtyPerPerson;
    const exact = view === 'person';
    // "Eggs · 2", not "Eggs · 2 eggs": the unit already names the ingredient.
    const amount = ing.name.toLowerCase().includes(unit.many)
      ? unit.kind === 'count' && !exact
        ? String(Math.ceil(qty - 1e-9))
        : fracText(qty)
      : qtyText(qty, unit, exact);

    let note: string | null = null;
    if (line.servesRule === 'only' && line.servesRestrictions.length > 0) note = `${ruleText(line).replace(/^only /, '')} only`;
    else if (line.servesRule === 'except' && fed < people) note = 'everyone else';

    rows.push({ key: `${i}:${line.ingredientId}`, name: ing.name, amount, note });
  });
  return rows;
}
