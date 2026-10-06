import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu, MenuMeal } from '../src/lib/menu-monster/menus';
import { buildMenuList, buildOutingList, dayLabel, outingOver, planProgress, mealCost, mealTitle, mealUnpriced, mealUnpricedItems, menuCost, outingDayCount, recipeShares } from '../src/lib/menu-monster/menu-view';

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

  // Foods go in long before anyone has shopped (Patrick, 2026-10-05), so a menu says which of its items have
  // no price yet instead of letting them read as free. B023 in the fixture is orange juice, which has none.
  it('Meal_NamesItsUnpricedFoods_ByTheItemThatNeedsThem', () => {
    const m = menu([meal('a', { recipeIds: ['B001', 'B023'] })]);
    expect(mealUnpriced(m, m.meals[0], CATALOG)).toEqual({ B023: ['Orange juice'] });
  });

  it('UnpricedItems_CarryTheIngredientIdForTheShoppingLink', () => {
    const m = menu([meal('m1', { recipeIds: ['B003', 'B023'] })]);
    expect(mealUnpricedItems(m, m.meals[0], CATALOG)).toEqual({ B023: [{ id: 'oj', name: 'Orange juice' }] });
  });

  it('Meal_HasNoUnpricedFoods_WhenEverythingHasAPrice', () => {
    const m = menu([meal('a', { recipeIds: ['B001'] })]);
    expect(mealUnpriced(m, m.meals[0], CATALOG)).toEqual({});
  });

  it('Menu_SaysWhichMealsAndFoodsItsTotalLeavesOut', () => {
    const m = menu([meal('a', { recipeIds: ['B001'] }), meal('b', { day: 1, recipeIds: ['B023'] })]);
    const c = menuCost(m, CATALOG);
    expect(c.unpricedByMeal).toEqual({ b: ['Orange juice'] });
    expect(c.unpriced).toEqual(['Orange juice']);
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

describe('buildOutingList (release 5: the troop shops together)', () => {
  const eagles = { id: 'a', label: 'Screaming Eagles', menu: menu([meal('m1')], { patrol: 'Screaming Eagles' }) };
  const quackers = { id: 'b', label: 'FireQuacker', menu: menu([meal('m1')], { patrol: 'FireQuacker', headcount: 6 }) };
  const bacon = (list: ReturnType<typeof buildOutingList>) => list.lines.find((l) => l.ing.id === 'bacon')!;

  it('Needs_AreAdded_AcrossMenus', () => {
    expect(bacon(buildOutingList([eagles, quackers], CATALOG)).need).toBe(48);
  });

  it('EachMenusShare_IsListed_UnderTheLine', () => {
    expect(bacon(buildOutingList([eagles, quackers], CATALOG)).byMenu).toEqual([
      { menuId: 'a', label: 'Screaming Eagles', amount: 30 },
      { menuId: 'b', label: 'FireQuacker', amount: 18 }
    ]);
  });

  it('Plates_CountEveryMealOfEveryMenu', () => {
    expect(buildOutingList([eagles, quackers], CATALOG).plates).toBe(16);
  });

  it('ACountChangedOnOneMenu_IsNotCarried_AndDoesNotSkewTheSaving', () => {
    const more = { ...eagles, menu: { ...eagles.menu, shopping: { ...eagles.menu.shopping, qtyOverride: { bacon: { packageId: 'p-bac-om', qty: 9 } } } } };
    const [plain, changed] = [buildOutingList([eagles, quackers], CATALOG), buildOutingList([more, quackers], CATALOG)];
    expect([changed.totals.spent, changed.separately]).toEqual([plain.totals.spent, plain.separately]);
  });

  it('Separately_IsEachMenusOwnTotal_AddedUp', () => {
    const own = buildMenuList(eagles.menu, CATALOG).totals.spent + buildMenuList(quackers.menu, CATALOG).totals.spent;
    expect(buildOutingList([eagles, quackers], CATALOG).separately).toBeCloseTo(own, 2);
  });

  it('Saving_IsTheGap_AndNeverNegative', () => {
    const list = buildOutingList([eagles, quackers], CATALOG);
    expect(list.saving).toBeCloseTo(Math.max(0, list.separately - list.totals.spent), 2);
  });

  it('OneMenu_ShopsForExactlyItsOwnList', () => {
    expect(buildOutingList([eagles], CATALOG).totals.spent).toBeCloseTo(buildMenuList(eagles.menu, CATALOG).totals.spent, 2);
  });

  it('Line_IsBrought_OnlyWhenEveryMenuBringsIt', () => {
    const home = { packageChoice: {}, qtyOverride: {}, lineSource: { bacon: { source: 'home' as const, note: '' } } };
    const both = buildOutingList([{ ...eagles, menu: { ...eagles.menu, shopping: home } }, { ...quackers, menu: { ...quackers.menu, shopping: home } }], CATALOG);
    const one = buildOutingList([{ ...eagles, menu: { ...eagles.menu, shopping: home } }, quackers], CATALOG);
    expect([bacon(both).status, bacon(one).status]).toEqual(['bring', 'ok']);
  });

  it('NoMenus_GiveAnEmptyList', () => {
    const list = buildOutingList([], CATALOG);
    expect([list.lines.length, list.plates, list.saving]).toEqual([0, 0, 0]);
  });
});

describe('planProgress', () => {
  const ID = 'B023'; // orange juice: unpriced in the fixture
  const mealWithJuice = (id: string, over: Partial<MenuMeal> = {}) => meal(id, { recipeIds: ['B003', ID], ...over });

  it('planProgress_CountsEmptyMealsAndUnpriced', () => {
    const m = menu([meal('a'), meal('b', { day: 0, slot: 'lunch', recipeIds: [] }), meal('c', { day: 1, slot: 'dinner', recipeIds: [] }), mealWithJuice('d', { day: 1, slot: 'breakfast' })]);
    const p = planProgress(m, CATALOG);
    expect(p.steps.meals.fixes.map((f) => [f.text, f.target])).toEqual([['2 meals empty', { step: 'meals', mealId: 'b' }]]);
    const unpriced = mealUnpricedItems(m, m.meals[3], CATALOG)[ID][0].id;
    expect(p.steps.shopping.fixes.map((f) => [f.text, f.target])).toEqual([['1 not priced', { step: 'shopping', ingredientId: unpriced }]]);
    expect(p.toFix).toBe(3);
  });

  it('Meals_EmptyMealsAreFoundInDayAndSlotOrder_NotArrayOrder', () => {
    const m = menu([meal('late', { day: 1, slot: 'dinner', recipeIds: [] }), meal('early', { day: 0, slot: 'dinner', recipeIds: [] })]);
    expect(planProgress(m, CATALOG).steps.meals.fixes[0].target.mealId).toBe('early');
  });

  it('Meals_AMenuWithNoMealsIsNotDone_AndSaysToAddOne', () => {
    const p = planProgress(menu([]), CATALOG);
    expect([p.steps.meals.done, p.steps.meals.fixes[0].text]).toEqual([false, 'Add a meal']);
  });

  it('Eating_IsDone_WhenNamedAndPeopleAreSet', () => {
    expect(planProgress(menu([meal('a')]), CATALOG).steps.eating.done).toBe(true);
    const p = planProgress(menu([meal('a')], { name: '  ' }), CATALOG);
    expect([p.steps.eating.done, p.steps.eating.fixes.map((f) => f.text)]).toEqual([false, ['Name the menu']]);
  });

  it('Eating_NeverInfersHeadcount_ZeroPeopleIsNotDone', () => {
    const p = planProgress(menu([meal('a')], { headcount: 0 }), CATALOG);
    expect([p.steps.eating.done, p.headcount, p.steps.eating.fixes.map((f) => f.text)]).toEqual([false, 0, ['Set how many are eating']]);
  });

  it('Gear_IsAlwaysDone', () => {
    expect(planProgress(menu([]), CATALOG).steps.gear).toEqual({ done: true, fixes: [] });
  });

  it('Shopping_IsDone_WhenNothingIsUnpriced', () => {
    const p = planProgress(menu([meal('a')]), CATALOG);
    expect([p.steps.shopping.done, p.toFix]).toEqual([true, 0]);
  });

  it('Progress_CarriesHeadcountDietsCostAndBudget', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })], { restrictions: { gf: 3, nut: 0, dairy: 0, veg: 1 } });
    const p = planProgress(m, CATALOG);
    expect(p.headcount).toBe(10);
    expect(p.diets).toEqual([{ key: 'gf', label: 'Gluten-free', count: 3 }, { key: 'veg', label: 'Vegetarian', count: 1 }]);
    expect(p.perPersonMeal).toBeCloseTo(menuCost(m, CATALOG).perPersonMeal, 4);
    expect([p.total, p.budget]).toEqual([menuCost(m, CATALOG).total, 4]);
  });

  it('Progress_HasNoCost_UntilAMealHasFood', () => {
    expect(planProgress(menu([meal('a', { recipeIds: [] })]), CATALOG).hasCost).toBe(false);
    expect(planProgress(menu([meal('a')]), CATALOG).hasCost).toBe(true);
  });

  it('Progress_ListsEveryFixInStepOrder', () => {
    const m = menu([meal('a', { recipeIds: [] })], { name: '' });
    expect(planProgress(m, CATALOG).fixes.map((f) => f.target.step)).toEqual(['eating', 'meals']);
  });

  it('OutingOver_IsTrueOnlyAfterTheLastDay', () => {
    const m = menu([], { startDate: '2026-10-09', dayCount: 3 });
    expect([outingOver(m, '2026-10-11'), outingOver(m, '2026-10-12')]).toEqual([false, true]);
    expect(outingOver(menu([]), '2026-10-12')).toBe(false);
  });
});
