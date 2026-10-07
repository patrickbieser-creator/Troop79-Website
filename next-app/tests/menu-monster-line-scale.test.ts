import { describe, it, expect } from 'vitest';
import type { Catalog, Ingredient, Plan, Recipe, RecipeLine } from '../src/lib/menu-monster/types';
import { UNITS } from '../src/lib/menu-monster/units';
import { gatherNeeds, lineFeeds, seedPlan, servingsFor } from '../src/lib/menu-monster/engine';
import { ingredientRows } from '../src/lib/menu-monster/ingredient-rows';
import { compileRecipe, type BaseLine } from '../src/lib/menu-monster/variations';

/**
 * A line can be for the whole meal (Patrick, 2026-10-06: "4 cups of oil no matter how many people").
 * `scale: 'meal'` = the amount is once per meal row; absent / 'person' = per person fed. One rule,
 * lineFeeds(), is read by the shopping math (gatherNeeds) and the list's display math (ingredientRows).
 */

const ing = (id: string, name: string, unit: Ingredient['unit'], section: Ingredient['section'], avoid: Ingredient['avoid'] = []): Ingredient => ({
  id, name, unit, section, staple: false, avoid, retiredAt: null
});
const CATALOG_BASE: Catalog = {
  ingredients: [ing('oil', 'Cooking oil', UNITS.cup, 'dry'), ing('potatoes', 'Potatoes', UNITS.cup, 'produce', []), ing('canola', 'Canola oil', UNITS.cup, 'dry'), ing('mix', 'Pancake mix', UNITS.cup, 'dry', ['gf'])],
  packages: [],
  conversions: [],
  recipes: []
};
const line = (over: Partial<RecipeLine> & Pick<RecipeLine, 'ingredientId' | 'qtyPerPerson'>): RecipeLine => ({ unitKey: null, servesRule: 'everyone', servesRestrictions: [], ...over });
const recipe = (lines: RecipeLine[]): Recipe => ({
  id: 'R1', name: 'Potato pancakes', status: 'published', mealFit: ['dinner'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 1, lines
});
const planOf = (headcount: number, gf = 0): Plan => ({ ...seedPlan(CATALOG_BASE), headcount, recipeIds: ['R1'], restrictions: { gf, nut: 0, dairy: 0, veg: 0 } });
const R0 = { gf: 0, nut: 0, dairy: 0, veg: 0 };

describe('lineFeeds', () => {
  it('FixedLine_IgnoresHeadcount', () => {
    const fixed = line({ ingredientId: 'oil', qtyPerPerson: 4, scale: 'meal' });
    expect(lineFeeds(fixed, 6, R0)).toBe(1);
    expect(lineFeeds(fixed, 30, R0)).toBe(1);
  });

  it('PersonLine_StillFeedsTheHeadcount', () => {
    expect(lineFeeds(line({ ingredientId: 'oil', qtyPerPerson: 1 }), 12, R0)).toBe(12);
    expect(lineFeeds(line({ ingredientId: 'oil', qtyPerPerson: 1, scale: 'person' }), 12, R0)).toBe(servingsFor(line({ ingredientId: 'oil', qtyPerPerson: 1 }), 12, R0));
  });

  it('FixedLine_FeedsNobody_WhenAnExceptRuleLeavesNoOne', () => {
    const fixed = line({ ingredientId: 'oil', qtyPerPerson: 4, scale: 'meal', servesRule: 'except', servesRestrictions: ['gf'] });
    expect(lineFeeds(fixed, 3, { ...R0, gf: 3 })).toBe(0);
    expect(lineFeeds(fixed, 3, { ...R0, gf: 1 })).toBe(1);
  });
});

describe('the shopping math', () => {
  it('FixedLine_NeedsTheSameAmount_AtAnyHeadcount', () => {
    const cat: Catalog = { ...CATALOG_BASE, recipes: [recipe([line({ ingredientId: 'oil', qtyPerPerson: 4, scale: 'meal' }), line({ ingredientId: 'potatoes', qtyPerPerson: 1 })])] };
    expect(gatherNeeds(planOf(6), cat).get('oil')?.need).toBe(4);
    expect(gatherNeeds(planOf(24), cat).get('oil')?.need).toBe(4);
    expect(gatherNeeds(planOf(24), cat).get('potatoes')?.need).toBe(24);
  });
});

describe('ingredientRows', () => {
  const r = recipe([line({ ingredientId: 'oil', qtyPerPerson: 4, scale: 'meal' }), line({ ingredientId: 'potatoes', qtyPerPerson: 1 })]);
  const rowsOf = (headcount: number, view: 'total' | 'person', gf = 0) => ingredientRows(r, CATALOG_BASE, planOf(headcount, gf), view);

  it('IngredientRows_UseTheSameRule_AsTheEngine', () => {
    const cat: Catalog = { ...CATALOG_BASE, recipes: [r] };
    const need = gatherNeeds(planOf(10), cat).get('oil')?.need;
    expect(need).toBe(4);
    expect(rowsOf(10, 'total').find((x) => x.name === 'Cooking oil')?.amount).toBe('4 cups (whole meal)');
  });

  it('FixedLine_ReadsTheSame_InThePerPersonView', () => {
    expect(rowsOf(10, 'person').find((x) => x.name === 'Cooking oil')?.amount).toBe('4 cups (whole meal)');
    expect(rowsOf(10, 'person').find((x) => x.name === 'Potatoes')?.amount).toBe('1 cup');
  });

  it('PersonLine_IsUnchanged', () => {
    expect(rowsOf(10, 'total').find((x) => x.name === 'Potatoes')?.amount).toBe('10 cups');
  });
});

describe('compileRecipe and scale', () => {
  const base = (ingredientId: string, qtyPerPerson: number, scale?: 'person' | 'meal'): BaseLine => ({ ingredientId, qtyPerPerson, unitKey: null, ...(scale ? { scale } : {}) });

  it('compileRecipe_RoundTripsScale', () => {
    const out = compileRecipe([base('oil', 4, 'meal'), base('potatoes', 1)], []);
    expect(out.map((l) => [l.ingredientId, l.scale ?? 'person'])).toEqual([['oil', 'meal'], ['potatoes', 'person']]);
  });

  it('Swap_InheritsTheBaseLinesScale', () => {
    const out = compileRecipe(
      [base('oil', 4, 'meal')],
      [{ restriction: 'veg', state: 'substituted', note: null, lines: [{ op: 'swap', baseIngredientId: 'oil', ingredientId: 'canola', qtyPerPerson: 4, unitKey: null }] }]
    );
    const swapped = out.find((l) => l.ingredientId === 'canola');
    expect(swapped).toMatchObject({ servesRule: 'only', scale: 'meal' });
  });

  it('Add_IsAlwaysPerPerson', () => {
    const out = compileRecipe(
      [base('oil', 4, 'meal')],
      [{ restriction: 'veg', state: 'substituted', note: null, lines: [{ op: 'add', baseIngredientId: null, ingredientId: 'canola', qtyPerPerson: 1, unitKey: null }] }]
    );
    expect(out.find((l) => l.ingredientId === 'canola')?.scale ?? 'person').toBe('person');
  });
});
