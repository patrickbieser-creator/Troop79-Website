import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { composePlan, foldShopping, sanitizeMenu, type Menu, type MenuMeal } from '../src/lib/menu-monster/menus';
import { buildMenuList, menuCost } from '../src/lib/menu-monster/menu-view';
import { buildLines, totalsOf } from '../src/lib/menu-monster/engine';
import { buildSnapshot, snapshotDrift } from '../src/lib/menu-monster/menu-snapshot';

/**
 * Scout Workspace slice 5: the menu-wide shopping list. Needs from every meal
 * are merged by ingredient BEFORE packages are chosen, so two bacon meals buy
 * one pack size for the total and two lunches share a loaf. Shopping choices
 * (package, quantity, bring-from-home) live on the menu, not on a meal.
 */

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
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  meals,
  ...over
});

const line = (list: ReturnType<typeof buildMenuList>, id: string) => list.lines.find((l) => l.ing.id === id)!;

describe('buildMenuList', () => {
  it('Scout_BuysOnePackageSize_ForTwoMealsThatShareAnIngredient', () => {
    // 8 people x 3 slices = 24 per meal (two Oscar Mayer packs each, $14.98).
    // Together 48 slices: the 80-slice Kirkland pack, $18.15, beats three Oscar Mayer.
    const m = menu([meal('a'), meal('b', { day: 1 })]);
    const list = buildMenuList(m, CATALOG);
    expect(line(list, 'bacon')).toMatchObject({ need: 48, qty: 1 });
    expect(line(list, 'bacon').pkg?.id).toBe('p-bac-kirk');
    expect(list.totals.spent).toBeCloseTo(18.15, 2);
  });

  it('Scout_SeesWhatShoppingOnceSaves_AgainstShoppingEachMealAlone', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })]);
    const list = buildMenuList(m, CATALOG);
    expect(list.separately).toBeCloseTo(29.96, 2);
    expect(list.saving).toBeCloseTo(11.81, 2);
  });

  it('Scout_SeesNoSaving_WhenNothingIsShared', () => {
    const list = buildMenuList(menu([meal('a')]), CATALOG);
    expect(list.saving).toBe(0);
  });

  it('Scout_SeesNoNegativeSaving_WhenTheyPickAPricierPackage', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })], { shopping: { packageChoice: { bacon: 'p-bac-om' }, qtyOverride: {}, lineSource: {} } });
    expect(buildMenuList(m, CATALOG).saving).toBeGreaterThanOrEqual(0);
  });

  it('Menu_AgreesWithTheSingleMealEngine_ForOneMeal', () => {
    const m = menu([meal('a')]);
    const plan = composePlan(m, m.meals[0]);
    expect(buildMenuList(m, CATALOG).totals.spent).toBeCloseTo(totalsOf(buildLines(plan, CATALOG), plan).spent, 6);
  });

  it('Meal_UsesItsOwnHeadcount_WhenMerged', () => {
    // Bread, 2 slices a person: 8 people = 16, a meal of 4 = 8.
    const m = menu([meal('a', { slot: 'lunch', recipeIds: ['L001'] }), meal('b', { day: 1, slot: 'lunch', recipeIds: ['L001'], headcount: 4 })]);
    const bread = line(buildMenuList(m, CATALOG), 'bread');
    expect(bread.need).toBe(24);
    expect(bread.usedBy).toEqual([
      { mealId: 'a', amount: 16 },
      { mealId: 'b', amount: 8 }
    ]);
  });

  it('Menu_RespectsTheMenusDiets_InEveryMeal', () => {
    // Pancakes: eggs only for gluten-free scouts, one each. 2 gf people in two meals = 4 eggs.
    const m = menu([meal('a', { recipeIds: ['B001'] }), meal('b', { day: 1, recipeIds: ['B001'] })], { restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 } });
    expect(line(buildMenuList(m, CATALOG), 'eggs').need).toBe(4);
  });

  it('Menu_RoundsCountsUpOnce_NotPerMeal', () => {
    // Each meal needs 0.4 eggs' worth: three gf-style fractions would round to 1 each; merged they round once.
    const edits = { B001: [{ op: 'amount' as const, ingredientId: 'eggs', qtyPerPerson: 0.25 }] };
    const m = menu([meal('a', { recipeIds: ['B001'], recipeEdits: edits }), meal('b', { day: 1, recipeIds: ['B001'], recipeEdits: edits })], {
      restrictions: { gf: 2, nut: 0, dairy: 0, veg: 0 }
    });
    // 0.25 x 2 people = 0.5 egg per meal; together exactly 1.
    expect(line(buildMenuList(m, CATALOG), 'eggs').need).toBe(1);
  });

  it('Menu_AppliesEachMealsRecipeEdits_BeforeMerging', () => {
    const m = menu([meal('a', { recipeEdits: { B003: [{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 1 }] } }), meal('b', { day: 1 })]);
    // 8 x 1 + 8 x 3 = 32 slices.
    expect(line(buildMenuList(m, CATALOG), 'bacon').need).toBe(32);
  });

  it('Menu_ListsWhichMealsUseEachIngredient_InMenuOrder', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })]);
    expect(line(buildMenuList(m, CATALOG), 'bacon').usedBy.map((u) => u.mealId)).toEqual(['a', 'b']);
  });

  it('Menu_HonoursMenuLevelPackageQuantityAndBringFromHome', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })], {
      shopping: {
        packageChoice: { bacon: 'p-bac-om' },
        qtyOverride: { bacon: { packageId: 'p-bac-om', qty: 4 } },
        lineSource: {}
      }
    });
    const bacon = line(buildMenuList(m, CATALOG), 'bacon');
    expect(bacon).toMatchObject({ qty: 4, overridden: true });
    expect(bacon.spent).toBeCloseTo(29.96, 2);

    const home = menu([meal('a')], { shopping: { packageChoice: {}, qtyOverride: {}, lineSource: { bacon: { source: 'home', note: 'Dad' } } } });
    const l = line(buildMenuList(home, CATALOG), 'bacon');
    expect(l).toMatchObject({ status: 'bring', source: 'home', note: 'Dad' });
    expect(buildMenuList(home, CATALOG).totals.spent).toBe(0);
  });

  it('Menu_DividesPerPersonByPlatesServed', () => {
    const list = buildMenuList(menu([meal('a'), meal('b', { day: 1 }), meal('c', { day: 1, slot: 'lunch', recipeIds: [] })]), CATALOG);
    expect(list.plates).toBe(16);
    expect(list.perPersonMeal).toBeCloseTo(18.15 / 16, 4);
  });

  it('Menu_IsEmpty_WhenNoMealHasItems', () => {
    const list = buildMenuList(menu([meal('a', { recipeIds: [] })]), CATALOG);
    expect(list).toMatchObject({ lines: [], plates: 0, perPersonMeal: 0, saving: 0 });
  });
});

describe('menuCost uses the merged list', () => {
  it('MenuTotal_IsTheMergedTotal_NotTheSumOfMeals', () => {
    const m = menu([meal('a'), meal('b', { day: 1 })]);
    const c = menuCost(m, CATALOG);
    expect(c.total).toBeCloseTo(18.15, 2);
    expect(c.byMeal.a).toBeCloseTo(14.98, 2);
  });
});

describe('sanitizeMenu shopping', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    name: 'x',
    headcount: 8,
    meals: [{ id: 'a', day: 0, slot: 'breakfast', recipeIds: ['B003'] }],
    ...over
  });

  it('Shopping_KeepsValidChoices', () => {
    const shopping = {
      packageChoice: { bacon: 'p-bac-kirk' },
      qtyOverride: { bacon: { packageId: 'p-bac-kirk', qty: 2 } },
      lineSource: { bacon: { source: 'pantry', note: 'Troop pantry' } }
    };
    expect(sanitizeMenu(raw({ shopping }), CATALOG).shopping).toEqual(shopping);
  });

  it('Shopping_DropsPackagesAndQuantitiesThatNoLongerExist', () => {
    const shopping = {
      packageChoice: { bacon: 'p-gone', eggs: 'p-egg-store' },
      qtyOverride: { bacon: { packageId: 'p-gone', qty: 2 } },
      lineSource: { bacon: { source: 'moon', note: '' } }
    };
    expect(sanitizeMenu(raw({ shopping }), CATALOG).shopping).toEqual({
      packageChoice: { eggs: 'p-egg-store' },
      qtyOverride: {},
      lineSource: {}
    });
  });

  it('Shopping_DropsIngredientsTheCatalogDoesNotKnow', () => {
    const shopping = { packageChoice: { 'no-such-thing': 'p-bac-om' }, qtyOverride: {}, lineSource: { 'no-such-thing': { source: 'home', note: '' } } };
    expect(sanitizeMenu(raw({ shopping }), CATALOG).shopping).toEqual({ packageChoice: {}, qtyOverride: {}, lineSource: {} });
  });

  it('Shopping_ClampsQuantityAndTrimsNote', () => {
    const shopping = { packageChoice: {}, qtyOverride: { bacon: { packageId: 'p-bac-om', qty: 500 } }, lineSource: { bacon: { source: 'home', note: 'x'.repeat(300) } } };
    const out = sanitizeMenu(raw({ shopping }), CATALOG).shopping;
    expect(out.qtyOverride.bacon.qty).toBe(99);
    expect(out.lineSource.bacon.note).toHaveLength(120);
  });

  it('Shopping_IsEmpty_ForGarbage', () => {
    expect(sanitizeMenu(raw({ shopping: 'nope' }), CATALOG).shopping).toEqual({ packageChoice: {}, qtyOverride: {}, lineSource: {} });
  });

  it('Meals_NoLongerCarryShoppingChoices_OnceSanitized', () => {
    const m = sanitizeMenu(raw({ meals: [{ id: 'a', day: 0, slot: 'breakfast', recipeIds: ['B003'], packageChoice: { bacon: 'p-bac-om' } }] }), CATALOG);
    expect(m.meals[0]).not.toHaveProperty('packageChoice');
  });
});

describe('foldShopping (per-meal values saved before slice 5)', () => {
  it('Fold_TakesTheFirstNonEmptyMealValue_PerIngredient', () => {
    const meals = [
      { packageChoice: { bacon: 'p-bac-om' } },
      { packageChoice: { bacon: 'p-bac-kirk', eggs: 'p-egg-store' }, lineSource: { bacon: { source: 'home', note: '' } } }
    ];
    expect(foldShopping(undefined, meals)).toEqual({
      packageChoice: { bacon: 'p-bac-om', eggs: 'p-egg-store' },
      qtyOverride: {},
      lineSource: { bacon: { source: 'home', note: '' } }
    });
  });

  it('Fold_LetsTheMenusOwnChoiceWin', () => {
    const own = { packageChoice: { bacon: 'p-bac-kirk' }, qtyOverride: {}, lineSource: {} };
    expect(foldShopping(own, [{ packageChoice: { bacon: 'p-bac-om' } }]).packageChoice).toEqual({ bacon: 'p-bac-kirk' });
  });

  it('Sanitize_FoldsOldMealValuesIntoTheMenu', () => {
    const m = sanitizeMenu(
      { name: 'x', headcount: 8, meals: [{ id: 'a', day: 0, slot: 'breakfast', recipeIds: ['B003'], packageChoice: { bacon: 'p-bac-om' }, lineSource: { bacon: { source: 'home', note: 'Dad' } } }] },
      CATALOG
    );
    expect(m.shopping.packageChoice).toEqual({ bacon: 'p-bac-om' });
    expect(m.shopping.lineSource).toEqual({ bacon: { source: 'home', note: 'Dad' } });
  });

  it('Fold_IsEmpty_ForJunk', () => {
    expect(foldShopping(7, ['x', null, 3])).toEqual({ packageChoice: {}, qtyOverride: {}, lineSource: {} });
  });
});

describe('buildSnapshot', () => {
  const m = menu([meal('a'), meal('b', { day: 1 })]);

  it('Snapshot_RecordsTotalsAndPerPerson_FromTheMergedList', () => {
    const snap = buildSnapshot(m, CATALOG, '2026-10-02');
    expect(snap.v).toBe(1);
    expect(snap.totals.spent).toBeCloseTo(18.15, 2);
    expect(snap.perPerson).toBe(1.13);
  });

  it('Snapshot_RecordsEachLineWithItsPackageQuantityAndPrice', () => {
    const bacon = buildSnapshot(m, CATALOG, '2026-10-02').lines.find((l) => l.ingredientId === 'bacon');
    expect(bacon).toEqual({
      ingredientId: 'bacon',
      name: 'Bacon',
      pkgLabel: 'Kirkland Hickory Smoked Bacon, 4 x 1 lb',
      qty: 1,
      unitPrice: 18.15,
      spent: 18.15
    });
  });

  it('Snapshot_RecordsStaplesAndBringLines_WithNothingSpent', () => {
    const home = menu([meal('a')], { shopping: { packageChoice: {}, qtyOverride: {}, lineSource: { bacon: { source: 'home', note: '' } } } });
    expect(buildSnapshot(home, CATALOG, '2026-10-02').lines.find((l) => l.ingredientId === 'bacon')).toMatchObject({ spent: 0 });
  });

  it('Snapshot_AsOf_IsTheNewestPackagePriceDateUsed', () => {
    const cat = { ...CATALOG, packages: CATALOG.packages.map((p) => (p.id === 'p-bac-kirk' ? { ...p, asOf: '2026-09-30' } : p)) };
    expect(buildSnapshot(m, cat, '2026-10-02').asOf).toBe('2026-09-30');
  });

  it('Snapshot_AsOf_IsToday_WhenNothingIsPriced', () => {
    expect(buildSnapshot(menu([]), CATALOG, '2026-10-02').asOf).toBe('2026-10-02');
  });
});

describe('snapshotDrift', () => {
  const m = menu([meal('a'), meal('b', { day: 1 })]);

  it('Drift_IsNull_WhenPricesHaveNotMoved', () => {
    expect(snapshotDrift(buildSnapshot(m, CATALOG, '2026-10-02'), m, CATALOG)).toBeNull();
  });

  it('Drift_ReportsSavedAndLiveTotals_WhenAPriceMoved', () => {
    const snap = buildSnapshot(m, CATALOG, '2026-10-02');
    const moved = { ...CATALOG, packages: CATALOG.packages.map((p) => (p.id === 'p-bac-kirk' ? { ...p, price: 20 } : p)) };
    const d = snapshotDrift(snap, m, moved)!;
    expect(d.saved).toBeCloseTo(18.15, 2);
    expect(d.live).toBeCloseTo(20, 2);
  });

  it('Drift_IsNull_WhenThereIsNoSnapshotYet', () => {
    expect(snapshotDrift(null, m, CATALOG)).toBeNull();
  });

  it('Drift_IgnoresSubCentDifferences', () => {
    const snap = buildSnapshot(m, CATALOG, '2026-10-02');
    expect(snapshotDrift({ ...snap, totals: { ...snap.totals, spent: snap.totals.spent + 0.004 } }, m, CATALOG)).toBeNull();
  });
});
