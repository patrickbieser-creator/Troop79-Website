/**
 * Pure helpers for adding to a menu on the Plan tab (Plans/Menu-Monster-Scout-Workspace.md;
 * prototype concept-e-scout-workspace/shelf.html "Recipe library"). One control per
 * job (Patrick + Jenna, 2026-10-03): a day's "Add a meal" adds MEALS — only the
 * slots the day lacks, greyed at the menu's meal cap — and a meal's own search adds
 * FOOD, its "Browse all recipes…" opening the Food & Recipes popup narrowed by
 * name and by meal (Breakfast, Lunch…).
 */

import type { Catalog, MealSlot, Recipe } from './types';
import { MAX_MENU_MEALS, type Menu } from './menus';
import { MEALS } from './units';
import { isPickable } from './scout-recipes';

const slotOrder = (slot: MealSlot) => MEALS.findIndex((m) => m.key === slot);

/** The recipes a name search and a meal filter leave, in library order. Shared by the popup and the Recipe Library tab. */
export function filterRecipes(catalog: Catalog, query: string, filter: MealSlot | null): Recipe[] {
  const q = query.trim().toLowerCase();
  return catalog.recipes
    .filter((r) => isPickable(r) && (!q || r.name.toLowerCase().includes(q)) && (!filter || r.mealFit.includes(filter)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** The meals a recipe fits (only the filtered one when a filter is on), in meal order. */
export function fitSlots(recipe: Pick<Recipe, 'mealFit'>, filter: MealSlot | null): MealSlot[] {
  return [...recipe.mealFit].filter((slot) => !filter || slot === filter).sort((a, b) => slotOrder(a) - slotOrder(b));
}

/** What a day's "Add a meal" offers: the slots the day lacks, in meal order, and whether the menu is at its meal cap. */
export function mealsToAdd(menu: Menu, day: number): { slots: MealSlot[]; full: boolean } {
  const has = new Set(menu.meals.filter((m) => m.day === day).map((m) => m.slot));
  return { slots: MEALS.map((m) => m.key).filter((slot) => !has.has(slot)), full: menu.meals.length >= MAX_MENU_MEALS };
}
