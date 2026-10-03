/**
 * The per-day dashed search on the Plan tab (Plans/Menu-Monster-Scout-Workspace.md,
 * IA correction item 2): "Add to Friday — search a recipe, or type breakfast,
 * lunch…". Pure: given what the scout typed, what can be dropped onto this day.
 *
 *  - a slot name ("lun") offers an EMPTY meal for that slot, if the day lacks it;
 *  - a recipe name offers one result per slot the recipe fits, skipping a recipe
 *    already on that day's meal of that slot. "adds to breakfast" when that
 *    day's breakfast exists, "new breakfast" when picking it creates the meal.
 * Anything that would need a new meal is withheld once the menu is at its cap.
 */

import type { Catalog, MealSlot } from './types';
import { MAX_MENU_MEALS, type Menu } from './menus';
import { MEALS } from './units';

export type SearchTarget =
  | { kind: 'slot'; key: string; slot: MealSlot; label: string; sub?: undefined }
  | { kind: 'recipe'; key: string; slot: MealSlot; recipeId: string; label: string; sub: string };

const MAX_RESULTS = 12;

export function searchAddTargets(catalog: Catalog, menu: Menu, day: number, query: string): SearchTarget[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const full = menu.meals.length >= MAX_MENU_MEALS;
  const onDay = (slot: MealSlot) => menu.meals.find((m) => m.day === day && m.slot === slot);
  const out: SearchTarget[] = [];

  for (const m of MEALS) {
    if (!m.label.toLowerCase().startsWith(q) || onDay(m.key) || full) continue;
    out.push({ kind: 'slot', key: `slot:${m.key}`, slot: m.key, label: `Plan ${m.label.toLowerCase()} — pick recipes on the meal page` });
  }

  for (const r of catalog.recipes) {
    if (!r.name.toLowerCase().includes(q)) continue;
    for (const m of MEALS) {
      if (!r.mealFit.includes(m.key)) continue;
      const meal = onDay(m.key);
      if (meal?.recipeIds.includes(r.id)) continue;
      if (!meal && full) continue;
      out.push({
        kind: 'recipe',
        key: `recipe:${r.id}:${m.key}`,
        slot: m.key,
        recipeId: r.id,
        label: `${r.name} · ${m.label}`,
        sub: `${meal ? 'adds to' : 'new'} ${m.label.toLowerCase()}`
      });
    }
  }
  return out.slice(0, MAX_RESULTS);
}
