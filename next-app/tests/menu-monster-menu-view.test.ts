import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu, MenuMeal } from '../src/lib/menu-monster/menus';
import { buildMenuList, buildOutingList, dayLabel, mealCost, mealTitle, mealUnpriced, menuCost, outingDayCount, recipeShares } from '../src/lib/menu-monster/menu-view';

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
