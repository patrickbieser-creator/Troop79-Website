import { describe, it, expect } from 'vitest';
import type { Catalog, Recipe } from '../src/lib/menu-monster/types';
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from '../src/lib/menu-monster/engine';
import { MAX_FREE_ITEMS, MAX_MENU_DAYS, MAX_MENU_MEALS, composePlan, isMenuId, menuNameError, sanitizeMenu, type Menu } from '../src/lib/menu-monster/menus';

/**
 * Scout Workspace menus (Plans/Menu-Monster-Scout-Workspace.md, Phase 1).
 * Pure TS: a menu is one row of scout input folded through the planner's own
 * rules — restorePlan() per meal, diets clamped to the headcount — so a
 * stored menu can never hold what the anonymous planner couldn't.
 */

const recipe = (id: string, mealFit: Recipe['mealFit']): Recipe => ({
  id, name: id, status: 'published', mealFit, foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 0,
  lines: [{ ingredientId: 'eggs', qtyPerPerson: 2, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }]
});

const CATALOG: Catalog = {
  ingredients: [{ id: 'eggs', name: 'Eggs', unit: { key: 'egg', one: 'egg', many: 'eggs', kind: 'count' }, section: 'dairy', staple: false, avoid: [] }],
  packages: [],
  conversions: [],
  recipes: [recipe('B001', ['breakfast']), recipe('D001', ['dinner'])]
} as unknown as Catalog;

const raw = (overrides: Record<string, unknown> = {}) => ({
  name: 'Fall Camporee',
  context: 'camp',
  headcount: 8,
  restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4.5,
  dayCount: 3,
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'] }],
  ...overrides
});

describe('sanitizeMenu dayCount', () => {
  it('DayCount_KeepsAValidNumber', () => {
    expect(sanitizeMenu(raw({ dayCount: 5 }), CATALOG).dayCount).toBe(5);
  });

  it('DayCount_ClampsToOneThroughMax', () => {
    expect([sanitizeMenu(raw({ dayCount: 0, meals: [] }), CATALOG).dayCount, sanitizeMenu(raw({ dayCount: 99 }), CATALOG).dayCount]).toEqual([1, MAX_MENU_DAYS]);
  });

  it('DayCount_CoversTheLastMealsDay_WhenSmaller', () => {
    const meals = [{ id: 'm1', day: 4, slot: 'breakfast', headcount: null, recipeIds: ['B001'] }];
    expect(sanitizeMenu(raw({ dayCount: 2, meals }), CATALOG).dayCount).toBe(5);
  });

  it('DayCount_DefaultsToTwo_WhenMissingOrJunk', () => {
    expect([sanitizeMenu(raw({ dayCount: undefined, meals: [] }), CATALOG).dayCount, sanitizeMenu(raw({ dayCount: 'x', meals: [] }), CATALOG).dayCount]).toEqual([2, 2]);
  });
});

describe('sanitizeMenu', () => {
  it('Menu_KeepsValidInput_Unchanged', () => {
    const m = sanitizeMenu(raw(), CATALOG);
    expect(m).toMatchObject({ name: 'Fall Camporee', context: 'camp', headcount: 8, budgetPerPersonMeal: 4.5 });
    expect(m.meals).toHaveLength(1);
    expect(m.meals[0]).toMatchObject({ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'] });
  });

  it('Menu_ClampsHeadcount_ToThePlannersRange', () => {
    expect(sanitizeMenu(raw({ headcount: 50 }), CATALOG).headcount).toBe(50);
    expect(sanitizeMenu(raw({ headcount: 80 }), CATALOG).headcount).toBe(MAX_HEADCOUNT);
    expect(sanitizeMenu(raw({ headcount: 0 }), CATALOG).headcount).toBe(MIN_HEADCOUNT);
  });

  it('Menu_ClampsDietCounts_ToHeadcount', () => {
    const m = sanitizeMenu(raw({ headcount: 4, restrictions: { gf: 9, nut: 2, dairy: -3, veg: 'x' } }), CATALOG);
    expect(m.restrictions).toEqual({ gf: 4, nut: 2, dairy: 0, veg: 0 });
  });

  it('Menu_DefaultsUnknownContext_ToCamp', () => {
    expect(sanitizeMenu(raw({ context: 'boat' }), CATALOG).context).toBe('camp');
  });

  it('Menu_RejectsNegativeBudget_ForTheDefault', () => {
    expect(sanitizeMenu(raw({ budgetPerPersonMeal: -2 }), CATALOG).budgetPerPersonMeal).toBe(4);
  });

  it('Menu_DropsMeals_WithUnknownSlotOrRepeatedDaySlot', () => {
    const m = sanitizeMenu(raw({ meals: [
      { id: 'a', day: 0, slot: 'breakfast', recipeIds: [] },
      { id: 'b', day: 0, slot: 'breakfast', recipeIds: [] },
      { id: 'c', day: 0, slot: 'brunch', recipeIds: [] },
      { id: 'd', day: 1, slot: 'dinner', recipeIds: [] }
    ] }), CATALOG);
    expect(m.meals.map((x) => x.id)).toEqual(['a', 'd']);
  });

  it('Menu_DropsRecipes_ThatDoNotFitTheMeal', () => {
    const m = sanitizeMenu(raw({ meals: [{ id: 'a', day: 0, slot: 'breakfast', recipeIds: ['B001', 'D001', 'ZZZ'] }] }), CATALOG);
    expect(m.meals[0].recipeIds).toEqual(['B001']);
  });

  it('Menu_CapsMealCount', () => {
    const slots = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];
    const meals = Array.from({ length: MAX_MENU_MEALS + 5 }, (_, i) => ({ id: `m${i}`, day: Math.floor(i / 5), slot: slots[i % 5], recipeIds: [] }));
    expect(sanitizeMenu(raw({ meals }), CATALOG).meals).toHaveLength(MAX_MENU_MEALS);
  });

  it('Menu_ClampsMealHeadcountOverride', () => {
    const m = sanitizeMenu(raw({ meals: [{ id: 'a', day: 0, slot: 'breakfast', headcount: 99, recipeIds: [] }] }), CATALOG);
    expect(MAX_HEADCOUNT).toBe(50); // Patrick, 2026-10-02: whole-troop meals run up to 50
    expect(m.meals[0].headcount).toBe(MAX_HEADCOUNT);
  });

  it('Menu_GivesEveryMealAnId', () => {
    const m = sanitizeMenu(raw({ meals: [{ day: 0, slot: 'breakfast', recipeIds: [] }] }), CATALOG);
    expect(m.meals[0].id).toMatch(/\S/);
  });

  it('Menu_ReturnsADefaultMenu_ForGarbageInput', () => {
    const m = sanitizeMenu('nope', CATALOG);
    expect(m).toMatchObject({ name: '', context: 'camp', meals: [] });
  });
});

describe('menuNameError', () => {
  it('MenuName_IsRequired', () => {
    expect(menuNameError('   ')).toMatch(/name/i);
  });

  it('MenuName_IsCapped', () => {
    expect(menuNameError('x'.repeat(121))).toMatch(/120/);
  });

  it('MenuName_AcceptsANormalName', () => {
    expect(menuNameError('Fall Camporee')).toBeNull();
  });
});

describe('composePlan', () => {
  const menu: Menu = sanitizeMenu(raw({ meals: [
    { id: 'a', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'] },
    { id: 'b', day: 1, slot: 'dinner', headcount: 12, recipeIds: ['D001'] }
  ] }), CATALOG);

  it('ComposePlan_UsesTheMenusPeopleDietsAndBudget', () => {
    const p = composePlan(menu, menu.meals[0]);
    expect(p).toMatchObject({ meal: 'breakfast', headcount: 8, restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 }, budgetPerPerson: 4.5, recipeIds: ['B001'], patrol: '' });
  });

  it('ComposePlan_UsesTheMealsHeadcount_WhenOverridden', () => {
    expect(composePlan(menu, menu.meals[1]).headcount).toBe(12);
  });
});

describe('sanitizeMenu meal ids', () => {
  const meal = (id: unknown, day: number, slot = 'breakfast') => ({ id, day, slot, recipeIds: [] });
  const ids = (meals: unknown[]) => sanitizeMenu(raw({ meals }), CATALOG).meals.map((m) => m.id);

  it('Scout_KeepsAMealId_WhenItIsSafeAndUnique', () => {
    expect(ids([meal('m-1', 0)])).toEqual(['m-1']);
  });

  it('SanitizeMenu_GeneratesAFreshId_WhenTheClientIdHasUnsafeCharacters', () => {
    const [id] = ids([meal('<img src=x onerror=1>', 0)]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('SanitizeMenu_GeneratesAFreshId_WhenTheClientIdIsTooLong', () => {
    expect(ids([meal('a'.repeat(65), 0)])[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('SanitizeMenu_GeneratesAFreshId_WhenTheClientIdIsNotAString', () => {
    expect(ids([meal(42, 0)])[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('SanitizeMenu_GivesTheSecondMealAFreshId_WhenTwoMealsShareAnId', () => {
    const [a, b] = ids([meal('dup', 0), meal('dup', 1)]);
    expect(a).toBe('dup');
    expect(b).not.toBe('dup');
  });
});

describe('sanitizeMenu server-owned fields', () => {
  const m = sanitizeMenu(
    raw({ id: 'x', ownerPersonId: 7, snapshot: { total: 1 }, updatedAt: '2020-01-01T00:00:00Z', createdAt: 'y' }),
    CATALOG
  ) as unknown as Record<string, unknown>;

  it('SanitizeMenu_IgnoresClientSnapshot', () => expect(m).not.toHaveProperty('snapshot'));
  it('SanitizeMenu_IgnoresClientOwner', () => expect(m).not.toHaveProperty('ownerPersonId'));
  it('SanitizeMenu_IgnoresClientId', () => expect(m).not.toHaveProperty('id'));
  it('SanitizeMenu_IgnoresClientUpdatedAt', () => expect(m).not.toHaveProperty('updatedAt'));
});

describe('isMenuId', () => {
  it('IsMenuId_AcceptsAUuid', () => expect(isMenuId('0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f')).toBe(true));
  it('IsMenuId_RejectsAMalformedId', () => expect(isMenuId('not-a-uuid')).toBe(false));
  it('IsMenuId_RejectsANonString', () => expect(isMenuId(5)).toBe(false));
  it('IsMenuId_RejectsAnInjectionAttempt', () => expect(isMenuId("x' or 1=1 --")).toBe(false));
});

const ACT_CATALOG = {
  ...CATALOG,
  ingredients: [...CATALOG.ingredients, { ...CATALOG.ingredients[0], id: 'bacon', name: 'Bacon' }, { ...CATALOG.ingredients[0], id: 'oj', name: 'OJ' }],
  packages: [
    { id: 'p-egg-store', ingredientId: 'eggs' },
    { id: 'p-bac-om', ingredientId: 'bacon' }
  ]
} as unknown as Catalog;

describe('sanitizeMenu actuals + freeItems (Phase 2 release A: validated pass-through)', () => {
  it('Menu_HasNoActualsOrFreeItems_WhenTheClientSendsNone', () => {
    const m = sanitizeMenu(raw(), ACT_CATALOG);
    expect({ actuals: m.actuals, freeItems: m.freeItems }).toEqual({ actuals: {}, freeItems: [] });
  });

  it('Actuals_KeepsAWellFormedEntry_AndDropsMalformedOnes', () => {
    const m = sanitizeMenu(
      raw({
        actuals: {
          eggs: { packageId: 'p-egg-store', qty: 2, pricePaid: 3.49 },
          bacon: { packageId: 'p-bac-om', qty: 1, pricePaid: -1 },
          oj: 'cheap',
          'bad id!': { packageId: 'p', qty: 1, pricePaid: 1 }
        }
      }),
      ACT_CATALOG
    );
    expect(m.actuals).toEqual({ eggs: { packageId: 'p-egg-store', qty: 2, pricePaid: 3.49 } });
  });

  it('Actuals_DropsAnIngredientOrPackage_ThatIsNotInTheCatalog', () => {
    const m = sanitizeMenu(raw({ actuals: { 'no-such': { packageId: 'p-egg-store', qty: 1, pricePaid: 3 }, eggs: { packageId: 'p-nope', qty: 1, pricePaid: 3 } } }), ACT_CATALOG);
    expect(m.actuals).toEqual({});
  });

  it('Actuals_DropsAPackage_ThatBelongsToAnotherIngredient', () => {
    expect(sanitizeMenu(raw({ actuals: { eggs: { packageId: 'p-bac-om', qty: 1, pricePaid: 3 } } }), ACT_CATALOG).actuals).toEqual({});
  });

  it('Actuals_AcceptsQuantityZeroTo99_AndRefusesOthers', () => {
    const at = (qty: number) => sanitizeMenu(raw({ actuals: { eggs: { packageId: 'p-egg-store', qty, pricePaid: 3 } } }), ACT_CATALOG).actuals;
    expect([at(0), at(99)].map((a) => a.eggs?.qty)).toEqual([0, 99]);
    expect([at(100), at(-1), at(1.5)]).toEqual([{}, {}, {}]);
  });

  it('Actuals_AcceptsPrice1CentTo9999_99_AndRefusesOthers', () => {
    const at = (pricePaid: number) => sanitizeMenu(raw({ actuals: { eggs: { packageId: 'p-egg-store', qty: 1, pricePaid } } }), ACT_CATALOG).actuals;
    expect([at(0.01), at(9999.99)].map((a) => a.eggs?.pricePaid)).toEqual([0.01, 9999.99]);
    expect([at(0), at(10000)]).toEqual([{}, {}]);
  });

  it('Actuals_RoundsThePriceToWholeCents', () => {
    expect(sanitizeMenu(raw({ actuals: { eggs: { packageId: 'p-egg-store', qty: 1, pricePaid: 3.494 } } }), ACT_CATALOG).actuals.eggs.pricePaid).toBe(3.49);
  });

  it('Actuals_IsEmpty_WhenNotAnObject', () => {
    expect(sanitizeMenu(raw({ actuals: [1, 2] }), CATALOG).actuals).toEqual({});
  });

  it('FreeItems_KeepsObjectsWithAnId_UpToTheCap', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `new:${String(i).padStart(8, '0')}`, name: `Thing ${i}` }));
    const m = sanitizeMenu(raw({ freeItems: [...items, 'junk', { name: 'no id' }] }), CATALOG);
    expect(m.freeItems).toHaveLength(MAX_FREE_ITEMS);
  });

  it('FreeItems_IsEmpty_WhenNotAnArray', () => {
    expect(sanitizeMenu(raw({ freeItems: { a: 1 } }), CATALOG).freeItems).toEqual([]);
  });
});
