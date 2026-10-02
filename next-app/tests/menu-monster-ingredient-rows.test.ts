import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Plan, Recipe, RestrictionKey } from '../src/lib/menu-monster/types';
import { seedPlan } from '../src/lib/menu-monster/engine';
import { ingredientRows } from '../src/lib/menu-monster/ingredient-rows';

/**
 * The rows the ingredient list shows for one recipe on one meal: the engine's
 * own serves rules (servingsFor) and the units helpers do all the math; this
 * module only chooses words. Pancakes (fixture): pancake mix for everyone
 * except gluten-free, almond flour and eggs only for gluten-free.
 */

const plan = (headcount: number, gf = 0): Plan => ({
  ...seedPlan(CATALOG),
  headcount,
  restrictions: { gf, nut: 0, dairy: 0, veg: 0 } as Record<RestrictionKey, number>
});
const recipe = (id: string) => CATALOG.recipes.find((r) => r.id === id) as Recipe;
const rows = (id: string, p: Plan, view: 'total' | 'person') => ingredientRows(recipe(id), CATALOG, p, view);
const byName = (id: string, p: Plan, view: 'total' | 'person', name: string) => rows(id, p, view).find((r) => r.name === name);

describe('ingredientRows', () => {
  it('Total_ScalesTheAmountByEveryoneTheLineFeeds', () => {
    expect(byName('B003', plan(10), 'total', 'Bacon')?.amount).toBe('30 slices');
  });

  it('PerPerson_ShowsTheRecipesOwnAmount', () => {
    expect(byName('B003', plan(10), 'person', 'Bacon')?.amount).toBe('3 slices');
  });

  it('Total_UsesFriendlyFractions_ForVolume', () => {
    // 0.5 cup x 7 people (8 minus the gluten-free one) = 3.5 cups.
    expect(byName('B001', plan(8, 1), 'total', 'Pancake mix')?.amount).toBe('3½ cups');
  });

  it('DietSwap_IsLabelledWhoItIsFor', () => {
    expect(byName('B001', plan(8, 1), 'total', 'Almond flour')).toMatchObject({ amount: '1 cup', note: 'gluten-free only' });
  });

  it('BaseLine_IsLabelledEveryoneElse_WhenADietExcludesPeople', () => {
    expect(byName('B001', plan(8, 1), 'total', 'Pancake mix')?.note).toBe('everyone else');
  });

  it('BaseLine_HasNoLabel_WhenNobodyIsExcluded', () => {
    expect(byName('B001', plan(8, 0), 'total', 'Pancake mix')?.note).toBeNull();
  });

  it('DietSwap_IsHidden_WhenNobodyNeedsIt', () => {
    expect(byName('B001', plan(8, 0), 'total', 'Almond flour')).toBeUndefined();
  });

  it('PlainLine_HasNoLabel', () => {
    expect(byName('B003', plan(8), 'total', 'Bacon')?.note).toBeNull();
  });

  it('Amount_DropsTheUnitWord_WhenTheNameAlreadySaysIt', () => {
    // "Eggs · 2", not "Eggs · 2 eggs".
    expect(byName('B001', plan(8, 2), 'total', 'Eggs')?.amount).toBe('2');
  });

  it('Rows_KeepTheRecipesLineOrder', () => {
    expect(rows('B001', plan(8, 1), 'total').map((r) => r.name)).toEqual(['Pancake mix', 'Almond flour', 'Eggs']);
  });

  it('Rows_HaveStableDistinctKeys', () => {
    const keys = rows('B001', plan(8, 1), 'total').map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('Rows_AreEmpty_WhenTheRecipeHasNoLines', () => {
    expect(ingredientRows({ lines: [] }, CATALOG, plan(8), 'total')).toEqual([]);
  });
});
