import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { MAX_MENU_MEALS, type Menu } from '../src/lib/menu-monster/menus';
import type { Catalog } from '../src/lib/menu-monster/types';
import { filterRecipes, fitSlots, mealsToAdd } from '../src/lib/menu-monster/menu-search';

/**
 * Scout Workspace: the Food & Recipes popup a meal's "Browse all recipes…"
 * opens (narrowed by name and by meal), and the day's "Add a meal" (only the
 * meals the day doesn't have yet, greyed at the menu's meal cap).
 */

const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }],
  ...over
});

const fullMenu = () =>
  menu({
    meals: Array.from({ length: MAX_MENU_MEALS }, (_, i) => ({ id: `x${i}`, day: 0, slot: 'dinner' as const, headcount: null, recipeIds: [], recipeEdits: {} }))
  });

const names = (cat: Catalog, q: string, f: Parameters<typeof filterRecipes>[2]) => filterRecipes(cat, q, f).map((r) => r.name);

describe('filterRecipes', () => {
  it('Scout_SeesEveryRecipe_WhenNothingIsTypedOrFiltered', () => {
    expect(names(CATALOG, '', null)).toEqual(['Pancakes', 'Bacon', 'Oatmeal', 'Orange juice', 'Sandwiches']);
  });

  it('Scout_NarrowsByName_WhenTyping', () => {
    expect(names(CATALOG, ' PANCAK ', null)).toEqual(['Pancakes']);
  });

  it('Scout_NarrowsByMeal_WhenAFilterIsOn', () => {
    expect(names(CATALOG, '', 'lunch')).toEqual(['Sandwiches']);
  });

  it('Scout_SeesNothing_WhenNameAndFilterDisagree', () => {
    expect(names(CATALOG, 'pancak', 'lunch')).toEqual([]);
  });

  it('Library_NeverOffersARetiredRecipe', () => {
    const cat: Catalog = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'B001' ? { ...r, status: 'retired' as const } : r)) };
    expect(filterRecipes(cat, 'pancak', null)).toEqual([]);
  });
});

describe('fitSlots', () => {
  it('Recipe_ListsEveryMealItFits_InMealOrder', () => {
    expect(fitSlots({ mealFit: ['snack', 'breakfast'] }, null)).toEqual(['breakfast', 'snack']);
  });
});

describe('mealsToAdd', () => {
  it('Day_OffersOnlyTheMealsItLacks_InMealOrder', () => {
    expect(mealsToAdd(menu(), 0).slots).toEqual(['lunch', 'dinner', 'snack', 'dessert']);
  });

  it('EmptyDay_OffersEveryMeal', () => {
    expect(mealsToAdd(menu(), 1).slots).toEqual(['breakfast', 'lunch', 'dinner', 'snack', 'dessert']);
  });

  it('Day_IsNotFull_UnderTheMealCap', () => {
    expect(mealsToAdd(menu(), 1).full).toBe(false);
  });

  it('Day_IsFull_AtTheMenusMealCap', () => {
    expect(mealsToAdd(fullMenu(), 1).full).toBe(true);
  });

  it('Day_OffersNothing_WhenItHasEveryMeal', () => {
    const all = menu({ meals: (['breakfast', 'lunch', 'dinner', 'snack', 'dessert'] as const).map((slot) => ({ id: slot, day: 0, slot, headcount: null, recipeIds: [], recipeEdits: {} })) });
    expect(mealsToAdd(all, 0).slots).toEqual([]);
  });
});
