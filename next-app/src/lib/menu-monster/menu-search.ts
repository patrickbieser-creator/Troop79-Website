/**
 * The recipe library popup on the Plan tab (Plans/Menu-Monster-Scout-Workspace.md;
 * prototype concept-e-scout-workspace/shelf.html "Recipe library"). A day's
 * "Search recipes" opens it; the scout narrows by name and by meal (Breakfast,
 * Lunch…) and drops a recipe onto that day. Pure: given the query and the meal
 * filter, which recipes show and what each meal button would do.
 *
 * Each recipe lists the meals it fits (only the filtered one when a filter is on).
 * A meal button's state:
 *   'adds' — that day's meal of the slot exists; the recipe joins it;
 *   'new'  — picking creates that day's meal of the slot;
 *   'on'   — the recipe is already on that meal (shown greyed, never hidden);
 *   'full' — creating the meal would pass the menu's meal cap (greyed).
 */

import type { Catalog, MealSlot, Recipe } from './types';
import { MAX_MENU_MEALS, type Menu } from './menus';
import { MEALS } from './units';
import { isPickable } from './scout-recipes';

export type LibraryTargetState = 'adds' | 'new' | 'on' | 'full';

export interface LibraryTarget {
  slot: MealSlot;
  state: LibraryTargetState;
}

export interface LibraryEntry {
  recipeId: string;
  name: string;
  targets: LibraryTarget[];
}

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

/** What each meal button on one recipe would do to the day. */
export function libraryTargets(recipe: Pick<Recipe, 'id' | 'mealFit'>, menu: Menu, day: number, filter: MealSlot | null): LibraryTarget[] {
  const full = menu.meals.length >= MAX_MENU_MEALS;
  return fitSlots(recipe, filter).map((slot): LibraryTarget => {
    const meal = menu.meals.find((m) => m.day === day && m.slot === slot);
    if (meal) return { slot, state: meal.recipeIds.includes(recipe.id) ? 'on' : 'adds' };
    return { slot, state: full ? 'full' : 'new' };
  });
}

export function recipeLibrary(catalog: Catalog, menu: Menu, day: number, query: string, filter: MealSlot | null): LibraryEntry[] {
  return filterRecipes(catalog, query, filter).map((r) => ({ recipeId: r.id, name: r.name, targets: libraryTargets(r, menu, day, filter) }));
}

/** Whether the day can take an EMPTY meal of the slot (planned on the meal page): it lacks one and the menu has room. */
export function canPlanEmptyMeal(menu: Menu, day: number, slot: MealSlot): boolean {
  return menu.meals.length < MAX_MENU_MEALS && !menu.meals.some((m) => m.day === day && m.slot === slot);
}
