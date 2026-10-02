import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu, MenuMeal } from '../src/lib/menu-monster/menus';
import { dayLabel, mealCost, menuCost, outingDayCount } from '../src/lib/menu-monster/menu-view';

const meal = (id: string, over: Partial<MenuMeal> = {}): MenuMeal => ({
  id,
  day: 0,
  slot: 'breakfast',
  headcount: null,
  recipeIds: ['B003'],
  packageChoice: {},
  qtyOverride: {},
  lineSource: {},
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

  it('Menu_TotalsItsMeals', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })]);
    expect(menuCost(m, CATALOG).total).toBeCloseTo(29.96, 2);
  });

  it('Menu_PerPersonPerMeal_DividesByPeopleAcrossMeals', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })]);
    expect(menuCost(m, CATALOG).perPersonMeal).toBeCloseTo(1.498, 3);
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
});
