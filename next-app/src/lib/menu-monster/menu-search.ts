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

import type { Catalog, MealSlot } from './types';
import { MAX_MENU_MEALS, type Menu } from './menus';
import { MEALS } from './units';

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

export function recipeLibrary(catalog: Catalog, menu: Menu, day: number, query: string, filter: MealSlot | null): LibraryEntry[] {
  const q = query.trim().toLowerCase();
  const full = menu.meals.length >= MAX_MENU_MEALS;
  const onDay = (slot: MealSlot) => menu.meals.find((m) => m.day === day && m.slot === slot);

  return catalog.recipes
    .filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!filter || r.mealFit.includes(filter)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((r) => ({
      recipeId: r.id,
      name: r.name,
      targets: [...r.mealFit]
        .filter((slot) => !filter || slot === filter)
        .sort((a, b) => slotOrder(a) - slotOrder(b))
        .map((slot): LibraryTarget => {
          const meal = onDay(slot);
          if (meal) return { slot, state: meal.recipeIds.includes(r.id) ? 'on' : 'adds' };
          return { slot, state: full ? 'full' : 'new' };
        })
    }));
}

/** Whether the day can take an EMPTY meal of the slot (planned on the meal page): it lacks one and the menu has room. */
export function canPlanEmptyMeal(menu: Menu, day: number, slot: MealSlot): boolean {
  return menu.meals.length < MAX_MENU_MEALS && !menu.meals.some((m) => m.day === day && m.slot === slot);
}
