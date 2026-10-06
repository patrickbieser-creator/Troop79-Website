import { describe, it, expect } from 'vitest';
import { buildFoodRows, filterFoodRows, foodListHref, parseFoodFilter, recipeHref, NO_FILTER } from '../src/lib/menu-monster/food-list';
import { UNITS } from '../src/lib/menu-monster/units';
import type { Catalog, Ingredient, Package, Recipe } from '../src/lib/menu-monster/types';

/**
 * Menu Monster leader tools — the Food & recipes list (2026-10-05): one wide table whose rows carry what a
 * leader scans for (kind, meals, what each person gets, diets, cost, status). The rows, the filters and the
 * links between the list and a recipe's own page are computed here, once, for the table and the page.
 */
const ING: Ingredient[] = [
  { id: 'eggs', name: 'Eggs', unit: UNITS.egg, section: 'dairy', staple: false, avoid: [], retiredAt: null },
  { id: 'pancake-mix', name: 'Pancake mix', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['gf'], retiredAt: null },
  { id: 'bacon', name: 'Bacon', unit: UNITS.slice, section: 'meat', staple: false, avoid: ['veg'], retiredAt: null },
  { id: 'cookies', name: 'Cookies', unit: { key: 'count', one: 'cookie', many: 'cookies', kind: 'count' }, section: 'dry', staple: false, avoid: [], retiredAt: null }
];
const pkg = (id: string, ingredientId: string, price: number, yield_: number): Package => ({
  id, ingredientId, name: id, store: 'Kroger', price, anchorPrice: price, yield: yield_, yieldUnitLabel: null, noun: 'pack',
  soldSize: null, soldUnit: null, note: null, asOf: '2026-09-01', retiredAt: null
});
const line = (ingredientId: string, qtyPerPerson: number) => ({ ingredientId, qtyPerPerson, unitKey: null, servesRule: 'everyone' as const, servesRestrictions: [] });
const recipe = (over: Partial<Recipe> & Pick<Recipe, 'id' | 'name' | 'lines'>): Recipe => ({
  status: 'published', mealFit: ['breakfast'], foodGroups: ['grain'], camp: true, trail: false, method: 'stove', stepsMd: null, sortOrder: 10, variations: [], ...over
});
const CATALOG: Catalog = {
  ingredients: ING,
  packages: [pkg('p-eggs', 'eggs', 3, 12), pkg('p-mix', 'pancake-mix', 18, 36), pkg('p-bac', 'bacon', 8, 16)],
  conversions: [],
  recipes: [
    recipe({ id: 'pancakes', name: 'Pancakes', lines: [line('pancake-mix', 0.5), line('eggs', 1)] }),
    recipe({ id: 'toast', name: 'Toast', status: 'draft', lines: [] }),
    recipe({ id: 'bacon', name: 'Bacon', mealFit: ['breakfast', 'lunch'], lines: [line('bacon', 3)] }),
    recipe({ id: 'cookies', name: 'Cookies', mealFit: ['dessert'], lines: [line('cookies', 2)] }),
    recipe({ id: 'old', name: 'Aardvark stew', status: 'retired', lines: [line('pancake-mix', 0.5), line('eggs', 1)] }),
    recipe({
      id: 'waffles', name: 'Waffles', lines: [line('pancake-mix', 0.5), line('eggs', 1)],
      variations: [{ restriction: 'gf', state: 'unsuitable', note: null, lines: [] }]
    })
  ]
};
const rows = buildFoodRows(CATALOG);
const row = (id: string) => rows.find((r) => r.recipe.id === id)!;
const names = (list: ReturnType<typeof buildFoodRows>) => list.map((r) => r.recipe.name);

describe('Food & recipes list — rows', () => {
  it('Rows_AreAToZ_WithRetiredLast', () => {
    expect(names(rows)).toEqual(['Bacon', 'Cookies', 'Pancakes', 'Toast', 'Waffles', 'Aardvark stew']);
  });

  it('ASingleFood_SaysWhatEachPersonGets', () => {
    expect(row('bacon').eachGets).toBe('3 slices');
  });

  it('ARecipe_SaysHowManyIngredients', () => {
    expect(row('pancakes').eachGets).toBe('2 ingredients');
  });

  it('ARecipeWithNoLines_SaysNoIngredients', () => {
    expect(row('toast').eachGets).toBe('No ingredients yet');
  });

  it('ASingleFood_IsMarkedAsOne', () => {
    expect([row('bacon').food, row('pancakes').food]).toEqual([true, false]);
  });

  it('Cost_IsWhatOnePersonEats', () => {
    // 0.5 cup of an $18 / 36-cup mix + 1 egg of a $3 dozen = 0.25 + 0.25.
    expect(row('pancakes').cost).toEqual({ kind: 'priced', perPerson: 0.5 });
  });

  it('Cost_IsNoPriceYet_WhenAnIngredientHasNone', () => {
    expect(row('cookies').cost).toEqual({ kind: 'unpriced' });
  });

  it('Cost_IsNothing_WithNoIngredients', () => {
    expect(row('toast').cost).toEqual({ kind: 'none' });
  });

  it('Diets_ListTheVariationsALeaderAdded', () => {
    expect(row('waffles').diets).toEqual([{ key: 'gf', view: 'unsuitable' }]);
  });

  it('Diets_CountTheFlaggedOnesNobodyAnswered', () => {
    // Pancake mix has gluten and Pancakes has no gluten-free variation.
    expect([row('pancakes').toLook, row('waffles').toLook, row('cookies').toLook]).toEqual([1, 0, 0]);
  });

  it('Status_IsNeedsFixes_WhenItCannotPublish', () => {
    expect([row('toast').pill, row('pancakes').pill, row('old').pill]).toEqual(['Needs fixes', 'Published', 'Retired']);
  });
});

describe('Food & recipes list — filters', () => {
  it('Foods_AreSingleFoodsThatAreNotRetired', () => {
    expect(names(filterFoodRows(rows, { ...NO_FILTER, kind: 'foods' }))).toEqual(['Bacon', 'Cookies']);
  });

  it('Recipes_AreTheRest_WithoutRetired', () => {
    expect(names(filterFoodRows(rows, { ...NO_FILTER, kind: 'recipes' }))).toEqual(['Pancakes', 'Toast', 'Waffles']);
  });

  it('Meal_FindsAnItemUnderEveryMealItFits', () => {
    expect(names(filterFoodRows(rows, { ...NO_FILTER, meal: 'lunch' }))).toEqual(['Bacon']);
  });

  it('Search_IsByName_AnyCase', () => {
    expect(names(filterFoodRows(rows, { ...NO_FILTER, q: ' PAN ' }))).toEqual(['Pancakes']);
  });

  it('TheOpenItem_StaysListed_WhenFilteredOut', () => {
    expect(names(filterFoodRows(rows, { ...NO_FILTER, kind: 'recipes' }, 'bacon'))).toEqual(['Bacon', 'Pancakes', 'Toast', 'Waffles']);
  });
});

describe('Food & recipes list — links', () => {
  it('AFilter_RoundTripsThroughTheUrl', () => {
    const filter = { kind: 'recipes' as const, meal: 'dinner' as const, q: 'chili mac' };
    const href = foodListHref(filter);
    const sp = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(parseFoodFilter(sp)).toEqual(filter);
  });

  it('TheList_WithNoFilter_IsThePlainTab', () => {
    expect(foodListHref(NO_FILTER)).toBe('/admin/library/menu-monster?tab=recipes');
  });

  it('TheList_CanOpenOneItem', () => {
    expect(foodListHref(NO_FILTER, 'bacon')).toBe('/admin/library/menu-monster?tab=recipes&recipe=bacon');
  });

  it('ARecipePage_CarriesTheFilterItCameFrom', () => {
    expect(recipeHref('pancakes', { ...NO_FILTER, kind: 'recipes' })).toBe('/admin/library/menu-monster/recipes/pancakes?kind=recipes');
  });

  it('AnUnknownFilterValue_IsIgnored', () => {
    expect(parseFoodFilter({ kind: 'nope', meal: 'brunch' })).toEqual(NO_FILTER);
  });
});
