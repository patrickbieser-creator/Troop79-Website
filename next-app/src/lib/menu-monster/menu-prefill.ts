/**
 * The standard meals an outing implies (guideline 5, D-336: defaults do the work). Pure; PlanTab applies it when
 * an outing is picked on a menu with no meals. Meals come back EMPTY, and a headcount is NEVER prefilled — it
 * stays null (the menu's own), because Patrick calls headcounts "highly fluid".
 */
import { outingDayCount, type Outing } from './menu-view';
import type { Menu, MenuMeal } from './menus';
import type { MealSlot } from './types';

type Newer = () => string;
const defaultId: Newer = () => (typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `m-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

/** [day, slot] pairs: a one-day outing gets lunch; else day 1 dinner, middle days all three, the last day breakfast. */
export function standardSlots(days: number): Array<{ day: number; slot: MealSlot }> {
  if (days <= 1) return [{ day: 0, slot: 'lunch' }];
  const out: Array<{ day: number; slot: MealSlot }> = [{ day: 0, slot: 'dinner' }];
  for (let d = 1; d < days - 1; d++) out.push({ day: d, slot: 'breakfast' }, { day: d, slot: 'lunch' }, { day: d, slot: 'dinner' });
  out.push({ day: days - 1, slot: 'breakfast' });
  return out;
}

export function standardMeals(outing: Outing, newId: Newer = defaultId): MenuMeal[] {
  return standardSlots(outingDayCount(outing)).map(({ day, slot }) => ({ id: newId(), day, slot, headcount: null, recipeIds: [], recipeEdits: {} }));
}

/** Adds the standard meals (and the outing's span) to a menu that has none; a menu with meals comes back untouched. */
export function prefillFromOuting(menu: Menu, outing: Outing, newId: Newer = defaultId): Menu {
  if (menu.meals.length > 0) return menu;
  return { ...menu, dayCount: outingDayCount(outing), meals: standardMeals(outing, newId) };
}
