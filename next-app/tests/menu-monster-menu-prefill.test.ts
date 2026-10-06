import { describe, it, expect } from 'vitest';
import { prefillFromOuting, standardMeals } from '../src/lib/menu-monster/menu-prefill';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Outing } from '../src/lib/menu-monster/menu-view';

const outing = (startDate: string, endDate: string): Outing => ({ id: 1, title: 'Camp', startDate, endDate, category: 'Campout / Overnight' });
let n = 0;
const id = () => `id-${++n}`;
const shape = (o: Outing) => standardMeals(o, id).map((m) => `${m.day}:${m.slot}`);
const menu = (over: Partial<Menu> = {}): Menu => ({
  name: '', context: 'camp', calendarEntryId: null, startDate: null, headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4, dayCount: 1, shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} }, actuals: {}, meals: [], ...over
});

describe('standardMeals', () => {
  it('OneDayOuting_GetsLunch', () => {
    expect(shape(outing('2026-10-10', '2026-10-10'))).toEqual(['0:lunch']);
  });
  it('TwoDayOuting_GetsFirstDinnerAndLastBreakfast', () => {
    expect(shape(outing('2026-10-10', '2026-10-11'))).toEqual(['0:dinner', '1:breakfast']);
  });
  it('ThreeDayOuting_GetsAllThreeOnTheMiddleDay', () => {
    expect(shape(outing('2026-10-09', '2026-10-11'))).toEqual(['0:dinner', '1:breakfast', '1:lunch', '1:dinner', '2:breakfast']);
  });
  it('EveryMeal_IsEmpty_WithNoHeadcount', () => {
    const meals = standardMeals(outing('2026-10-09', '2026-10-11'), id);
    expect(meals.every((m) => m.headcount === null && m.recipeIds.length === 0 && Object.keys(m.recipeEdits).length === 0)).toBe(true);
  });
});

describe('prefillFromOuting', () => {
  it('EmptyMenu_TakesTheSpanAndTheMeals', () => {
    const r = prefillFromOuting(menu(), outing('2026-10-09', '2026-10-11'), id);
    expect([r.dayCount, r.meals.length]).toEqual([3, 5]);
  });
  it('MenuWithMeals_IsUntouched', () => {
    const m = menu({ dayCount: 2, meals: [{ id: 'x', day: 0, slot: 'breakfast', headcount: null, recipeIds: [], recipeEdits: {} }] });
    expect(prefillFromOuting(m, outing('2026-10-09', '2026-10-11'), id)).toBe(m);
  });
});
