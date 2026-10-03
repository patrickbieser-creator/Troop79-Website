import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { MAX_MENU_MEALS, type Menu } from '../src/lib/menu-monster/menus';
import type { Catalog } from '../src/lib/menu-monster/types';
import { canPlanEmptyMeal, filterRecipes, recipeLibrary } from '../src/lib/menu-monster/menu-search';

/**
 * Scout Workspace: the recipe library popup a day's "Search recipes" opens —
 * narrowed by name and by meal; each recipe offers one button per meal it
 * fits, saying what picking it would do.
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

/** Orange juice also fits snack, so one recipe has two meal buttons. */
const TWO_FIT: Catalog = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'B023' ? { ...r, mealFit: ['snack', 'breakfast'] } : r)) };

const fullMenu = () =>
  menu({
    meals: Array.from({ length: MAX_MENU_MEALS }, (_, i) => ({ id: `x${i}`, day: 0, slot: 'dinner' as const, headcount: null, recipeIds: [], recipeEdits: {} }))
  });

describe('recipeLibrary', () => {
  it('Scout_SeesEveryRecipe_WhenNothingIsTypedOrFiltered', () => {
    expect(recipeLibrary(CATALOG, menu(), 0, '', null).map((e) => e.name)).toEqual(['Pancakes', 'Bacon', 'Oatmeal', 'Orange juice', 'Sandwiches']);
  });

  it('Scout_NarrowsByName_WhenTyping', () => {
    expect(recipeLibrary(CATALOG, menu(), 0, ' PANCAK ', null).map((e) => e.name)).toEqual(['Pancakes']);
  });

  it('Scout_NarrowsByMeal_WhenAFilterIsOn', () => {
    expect(recipeLibrary(CATALOG, menu(), 0, '', 'lunch').map((e) => e.name)).toEqual(['Sandwiches']);
  });

  it('Scout_SeesNothing_WhenNameAndFilterDisagree', () => {
    expect(recipeLibrary(CATALOG, menu(), 0, 'pancak', 'lunch')).toEqual([]);
  });

  it('Recipe_OffersEveryMealItFits_InMealOrder', () => {
    const oj = recipeLibrary(TWO_FIT, menu(), 1, 'orange', null)[0];
    expect(oj.targets.map((t) => t.slot)).toEqual(['breakfast', 'snack']);
  });

  it('Recipe_OffersOnlyTheFilteredMeal_WhenAFilterIsOn', () => {
    const oj = recipeLibrary(TWO_FIT, menu(), 1, '', 'snack')[0];
    expect(oj.targets).toEqual([{ slot: 'snack', state: 'new' }]);
  });

  it('Target_AddsToTheMeal_WhenTheDayHasThatSlot', () => {
    expect(recipeLibrary(CATALOG, menu(), 0, 'pancak', null)[0].targets).toEqual([{ slot: 'breakfast', state: 'adds' }]);
  });

  it('Target_IsANewMeal_WhenTheDayLacksThatSlot', () => {
    expect(recipeLibrary(CATALOG, menu(), 1, 'pancak', null)[0].targets).toEqual([{ slot: 'breakfast', state: 'new' }]);
  });

  it('Target_IsOn_WhenTheRecipeIsAlreadyOnThatMeal', () => {
    expect(recipeLibrary(CATALOG, menu(), 0, 'bacon', null)[0].targets).toEqual([{ slot: 'breakfast', state: 'on' }]);
  });

  it('Target_IsNew_ForTheSameRecipeOnAnotherDay', () => {
    expect(recipeLibrary(CATALOG, menu(), 1, 'bacon', null)[0].targets).toEqual([{ slot: 'breakfast', state: 'new' }]);
  });

  it('Target_IsFull_WhenANewMealWouldPassTheMealCap', () => {
    expect(recipeLibrary(CATALOG, fullMenu(), 1, 'pancak', null)[0].targets).toEqual([{ slot: 'breakfast', state: 'full' }]);
  });
});

describe('canPlanEmptyMeal', () => {
  it('Day_CanTakeAnEmptyMeal_WhenItLacksThatSlot', () => {
    expect(canPlanEmptyMeal(menu(), 0, 'lunch')).toBe(true);
  });

  it('Day_CannotTakeASecondMeal_OfASlotItHas', () => {
    expect(canPlanEmptyMeal(menu(), 0, 'breakfast')).toBe(false);
  });

  it('Day_CannotTakeAnEmptyMeal_AtTheMealCap', () => {
    expect(canPlanEmptyMeal(fullMenu(), 1, 'lunch')).toBe(false);
  });
});

describe('filterRecipes (Phase 4A)', () => {
  it('Library_NeverOffersARetiredRecipe', () => {
    const cat: Catalog = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'B001' ? { ...r, status: 'retired' as const } : r)) };
    expect(filterRecipes(cat, 'pancak', null)).toEqual([]);
  });
});
