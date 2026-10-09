import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { sanitizeMenu } from '../src/lib/menu-monster/menus';
import { buildMenuList } from '../src/lib/menu-monster/menu-view';
import { boughtRows, type Bought, type BoughtItem } from '../src/lib/menu-monster/bought';
import { cleanReceiptInput, reconcileMeals, type Receipt, type ReceiptLine } from '../src/lib/menu-monster/reconcile';

/**
 * Planned vs bought (Plans/Menu-Monster-Receipt-Reconciliation.md): a shared line's spend is split by each meal's
 * share of the amount needed, an extra lands only on the meal it joined, a line not bought is listed, and a line
 * nobody has recorded reads as planned.
 */
const meal = (id: string, day: number, slot: string, recipeIds: string[], headcount: number | null = null) => ({ id, day, slot, headcount, recipeIds, recipeEdits: {} });
const MENU = sanitizeMenu(
  {
    name: 'ZZ reconcile', context: 'camp', headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budgetPerPersonMeal: 4, startDate: '2026-10-09',
    meals: [meal('m1', 0, 'breakfast', ['B003'], 8), meal('m2', 1, 'breakfast', ['B003'], 4), meal('m3', 1, 'lunch', ['L001'], 8)]
  },
  CATALOG
);
const stamp = { by: 'Maya', personId: 5, at: '2026-10-09T15:00:00Z' };
const boughtWith = (lines: Bought['lines']): Bought => ({ lines, done: null });
const item = (qty: number, pricePaid: number): BoughtItem => ({ brandId: null, packageId: null, qty, pricePaid });
const NONE = boughtWith({});
const planned = (id: string) => boughtRows(buildMenuList(MENU, CATALOG).lines, NONE).find((r) => r.line.ing.id === id)!;
const spendOf = (id: string) => planned(id).planned.reduce((n, x) => n + x.qty * x.pricePaid, 0);
const mealOf = (r: ReturnType<typeof reconcileMeals>, id: string) => r.meals.find((m) => m.mealId === id)!;
const extra = (mealId: string | null, price: number, qty = 1): ReceiptLine => ({
  id: 1, position: 1, rawName: 'WH/BS Morsels', storeCode: '383465', unitPrice: price, qty, taxCode: 'FA', proposedIngredientId: null,
  status: 'extra', ingredientId: null, mealId, label: 'Chocolate morsels', confirmedBy: 'Maya', confirmedAt: stamp.at
});
const receipt = (lines: ReceiptLine[], total = 0): Receipt => ({ id: 'r1', menuId: 'x', store: 'Aldi', boughtAt: stamp.at, subtotal: total, tax: 0, total, itemCount: lines.length, lines });

describe('Reconcile', () => {
  it('SplitsASharedLinesSpend_ByEachMealsShare', () => {
    const r = reconcileMeals(MENU, CATALOG, NONE, null);
    const bacon = (id: string) => mealOf(r, id).planned.items.find((i) => i.ingredientId === 'bacon')!.spent;
    expect(bacon('m1') / bacon('m2')).toBeCloseTo(2, 1);
    expect(bacon('m1') + bacon('m2')).toBeCloseTo(spendOf('bacon'), 1);
  });

  it('SplitsWhatWasPaid_ByTheSameShares', () => {
    const r = reconcileMeals(MENU, CATALOG, boughtWith({ bacon: { status: 'bought', items: [item(1, 21)], ...stamp } }), null);
    const line = (id: string) => mealOf(r, id).bought.items.find((i) => i.ingredientId === 'bacon')!;
    expect(line('m1').spent).toBeCloseTo(14, 2);
    expect(line('m2').spent).toBeCloseTo(7, 2);
    expect(line('m1').kind).toBe('changed');
  });

  it('CountsAnExtra_OnlyOnItsMeal', () => {
    const base = reconcileMeals(MENU, CATALOG, NONE, null);
    const r = reconcileMeals(MENU, CATALOG, NONE, receipt([extra('m2', 3.65, 2)]));
    expect(mealOf(r, 'm2').bought.cost).toBeCloseTo(mealOf(base, 'm2').bought.cost + 7.3, 2);
    expect(mealOf(r, 'm1').bought.cost).toBe(mealOf(base, 'm1').bought.cost);
    expect(mealOf(r, 'm2').bought.items.find((i) => i.kind === 'extra')).toMatchObject({ name: 'Chocolate morsels', qty: 2, unitPrice: 3.65, spent: 7.3 });
    expect(mealOf(r, 'm2').delta).toBeCloseTo(mealOf(base, 'm2').delta + 7.3, 2);
  });

  it('IgnoresAnExtra_ThatNamesNoMealOnTheMenu', () => {
    const r = reconcileMeals(MENU, CATALOG, NONE, receipt([extra('gone', 5), extra(null, 5)]));
    expect(r.totals.bought).toBe(reconcileMeals(MENU, CATALOG, NONE, null).totals.bought);
  });

  it('ListsAPlannedLine_NotBought_UnderAsBought', () => {
    const r = reconcileMeals(MENU, CATALOG, boughtWith({ bacon: { status: 'not_bought', items: [], ...stamp } }), null);
    for (const id of ['m1', 'm2']) {
      expect(mealOf(r, id).bought.notBought).toEqual([{ ingredientId: 'bacon', name: 'Bacon' }]);
      expect(mealOf(r, id).bought.items.some((i) => i.ingredientId === 'bacon')).toBe(false);
    }
    expect(mealOf(r, 'm1').delta).toBeLessThan(0);
  });

  it('FallsBackToThePlan_ForAnUnconfirmedLine', () => {
    const r = reconcileMeals(MENU, CATALOG, NONE, null);
    expect(r.totals.bought).toBe(r.totals.planned);
    expect(r.totals.unconfirmed).toBeGreaterThan(0);
    expect(mealOf(r, 'm1').bought.items[0].kind).toBe('as_planned');
  });

  it('DividesByTheMealsOwnHeadcount', () => {
    const r = reconcileMeals(MENU, CATALOG, NONE, null);
    expect(mealOf(r, 'm2').planned.perPerson).toBeCloseTo(mealOf(r, 'm2').planned.cost / 4, 2);
    expect(mealOf(r, 'm1').planned.perPerson).toBeCloseTo(mealOf(r, 'm1').planned.cost / 8, 2);
  });

  it('MeetsTheReceiptTotal_WhenEverythingIsConfirmed', () => {
    const lines: Bought['lines'] = {};
    let paid = 0;
    for (const row of boughtRows(buildMenuList(MENU, CATALOG).lines, NONE)) {
      if (row.planned.length === 0) continue;
      const items = row.planned.map((p) => ({ ...p, pricePaid: p.pricePaid + 0.5 }));
      lines[row.line.ing.id] = { status: 'bought', items, ...stamp };
      paid += items.reduce((n, x) => n + x.qty * x.pricePaid, 0);
    }
    const extras = [extra('m3', 3.65)];
    const total = Math.round((paid + 3.65) * 100) / 100;
    const r = reconcileMeals(MENU, CATALOG, boughtWith(lines), receipt(extras, total));
    expect(r.totals.unconfirmed).toBe(0);
    expect(r.totals.bought).toBeCloseTo(total, 2);
    expect(r.totals.receiptTotal).toBe(total);
  });
});

describe('cleanReceiptInput', () => {
  const ok = { menuId: 'f5daf829-8f48-4dba-a7c6-2022d3091f77', store: 'Aldi', boughtAt: '2026-10-08T19:03:00-05:00', subtotal: 10, tax: 0, total: 10, lines: [{ code: '1', name: 'OJ  No Pulp', price: '3.499', qty: 2, tax: 'FA', proposed: null }] };

  it('RoundsMoneyToCents_AndKeepsThePrintedName', () => {
    const c = cleanReceiptInput(ok);
    expect(c.lines[0]).toMatchObject({ rawName: 'OJ No Pulp', unitPrice: 3.5, qty: 2, storeCode: '1', taxCode: 'FA' });
    expect(c.boughtAt).toBe('2026-10-09T00:03:00.000Z');
  });

  it.each([0, 100, 1.5])('RefusesAQuantityOf_%s', (qty) => {
    expect(() => cleanReceiptInput({ ...ok, lines: [{ ...ok.lines[0], qty }] })).toThrow(/quantity/);
  });

  it('RefusesMoreThanThreeHundredLines', () => {
    expect(() => cleanReceiptInput({ ...ok, lines: Array.from({ length: 301 }, () => ok.lines[0]) })).toThrow(/300/);
  });

  it('RefusesANegativePrice', () => {
    expect(() => cleanReceiptInput({ ...ok, lines: [{ ...ok.lines[0], price: -1 }] })).toThrow(/money/);
  });
});
