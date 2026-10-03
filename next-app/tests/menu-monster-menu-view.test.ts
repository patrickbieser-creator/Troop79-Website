import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu, MenuMeal } from '../src/lib/menu-monster/menus';
import { dayLabel, mealCost, mealTitle, menuCost, outingDayCount, recipeShares } from '../src/lib/menu-monster/menu-view';

const meal = (id: string, over: Partial<MenuMeal> = {}): MenuMeal => ({
  id,
  day: 0,
  slot: 'breakfast',
  headcount: null,
  recipeIds: ['B003'],
  recipeEdits: {},
  ...over
});

const menu = (meals: MenuMeal[], over: Partial<Menu> = {}): Menu => ({
  name: 'Fall Camporee',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 10,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals,
  ...over
});

describe('menu-view', () => {
  it('Meal_CostsWhatTheRegisterCharges_ForTheMenusPeople', () => {
    // 10 people x 3 slices = 30 slices: two Oscar Mayer packs, $14.98.
    const m = menu([meal('a')]);
    expect(mealCost(m, m.meals[0], CATALOG)).toBeCloseTo(14.98, 2);
  });

  it('Meal_UsesItsOwnHeadcount_WhenOverridden', () => {
    // 4 people x 3 = 12 slices: one Oscar Mayer pack, $7.49.
    const m = menu([meal('a', { headcount: 4 })]);
    expect(mealCost(m, m.meals[0], CATALOG)).toBeCloseTo(7.49, 2);
  });

  it('Menu_TotalsTheMergedList_NotTheSumOfItsMeals', () => {
    // 60 slices together: one 80-slice Kirkland pack ($18.15), not two meals at $14.98 each.
    const m = menu([meal('a'), meal('b', { day: 1 })]);
    expect(menuCost(m, CATALOG).total).toBeCloseTo(18.15, 2);
  });

  it('Menu_PerPersonPerMeal_DividesByPeopleAcrossMeals', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })]);
    expect(menuCost(m, CATALOG).perPersonMeal).toBeCloseTo(18.15 / 20, 3);
  });

  it('Menu_PerPersonPerMeal_IgnoresMealsWithNothingPicked', () => {
    const m = menu([meal('a'), meal('b', { day: 1, recipeIds: [] })]);
    expect(menuCost(m, CATALOG).perPersonMeal).toBeCloseTo(1.498, 3);
  });

  it('Menu_CostsZero_WhenNoMealHasItems', () => {
    expect(menuCost(menu([]), CATALOG)).toMatchObject({ total: 0, perPersonMeal: 0 });
  });

  it('DayLabel_IsDayNumber_WhenNoStartDate', () => {
    expect(dayLabel(null, 0)).toBe('Day 1');
  });

  it('DayLabel_AddsTheWeekdayDate_WhenStartDateKnown', () => {
    expect(dayLabel('2026-10-10', 1)).toBe('Day 2 · Sun, Oct 11');
  });

  it('Outing_SpansItsInclusiveDays', () => {
    expect(outingDayCount({ id: 1, title: 'Camporee', startDate: '2026-10-09', endDate: '2026-10-11', category: 'Campout / Overnight' })).toBe(3);
  });
  it('Meal_CostUsesTheMealsRecipeEdits', () => {
    // 10 people x 1 slice = 10 slices: one Oscar Mayer pack, $7.49 (not 30 slices, $14.98).
    const m = menu([meal('a', { recipeEdits: { B003: [{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 1 }] } })]);
    expect(mealCost(m, m.meals[0], CATALOG)).toBeCloseTo(7.49, 2);
  });

  it('Meal_CostsNothing_WhenItsOnlyIngredientIsLeftOut', () => {
    const m = menu([meal('a', { recipeEdits: { B003: [{ op: 'leave_out', ingredientId: 'bacon' }] } })]);
    expect(mealCost(m, m.meals[0], CATALOG)).toBe(0);
  });

  it('MealTitle_IsTheWeekdayAndSlot_WhenStartDateKnown', () => {
    expect(mealTitle('2026-10-10', 0, 'breakfast')).toBe('Saturday breakfast');
  });

  it('MealTitle_FollowsTheDayOffset', () => {
    expect(mealTitle('2026-10-10', 1, 'dinner')).toBe('Sunday dinner');
  });

  it('MealTitle_IsDayNumberAndSlot_WhenNoStartDate', () => {
    expect(mealTitle(null, 1, 'lunch')).toBe('Day 2 lunch');
  });
});

describe('recipeShares', () => {
  // Scrambled eggs (2 a person) + gluten-free pancakes (1 egg each for the GF
  // scouts) share one egg purchase: each recipe's share is its part of the
  // eggs it uses, so the rows always add up to the meal's total.
  const eggs = { ingredientId: 'eggs', qtyPerPerson: 2, unitKey: null, servesRule: 'everyone' as const, servesRestrictions: [] };
  const cat = { ...CATALOG, recipes: [...CATALOG.recipes, { ...CATALOG.recipes.find((r) => r.id === 'B003')!, id: 'B099', name: 'Scrambled eggs', lines: [eggs] }] };
  const m = menu([meal('a', { recipeIds: ['B001', 'B099'] })], { headcount: 5, restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 } });

  it('RecipeShares_AddUpToTheMealsCost_WhenRecipesSharePackages', () => {
    const shares = recipeShares(m, m.meals[0], cat);
    expect(shares.B001 + shares.B099).toBeCloseTo(mealCost(m, m.meals[0], cat), 2);
  });

  it('RecipeShares_SplitASharedPackage_ByWhatEachRecipeUses', () => {
    // 10 scrambled + 2 GF-pancake eggs = 12: one dozen at $2.99, split 10:2.
    const shares = recipeShares(m, m.meals[0], cat);
    expect(shares.B099).toBeCloseTo((2.99 * 10) / 12, 2);
  });
});
