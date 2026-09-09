import { describe, it, expect } from 'vitest';
import type { Catalog, Ingredient, Plan, Recipe, RecipeLine } from '../src/lib/menu-monster/types';
import { UNITS } from '../src/lib/menu-monster/units';
import { restrictionWarnings, ruleText, servingsFor } from '../src/lib/menu-monster/engine';
import {
  compileRecipe,
  crossRestrictionWarnings,
  variationView,
  variationsFromLines,
  type BaseLine,
  type Variation
} from '../src/lib/menu-monster/variations';

/**
 * Menu Monster recipe variations (Plans/Menu-Monster-Recipe-Variations.md).
 * A recipe is a BASE line list plus zero or more per-restriction DIFFS; the
 * diff compiles to the engine's serves-rule lines. Decision 2: a base line
 * changed by two variations becomes ONE line "everyone except A or B" —
 * `servesRestrictions` is a list. Pure TS, no DB.
 */

const count = (one: string, many: string) => ({ key: 'count', one, many, kind: 'count' as const });
const ing = (id: string, name: string, unit: Ingredient['unit'], section: Ingredient['section'], avoid: Ingredient['avoid'] = []): Ingredient => ({
  id, name, unit, section, staple: false, avoid, retiredAt: null
});
const ING: Ingredient[] = [
  ing('pancake-mix', 'Pancake mix', UNITS.cup, 'dry', ['gf']),
  ing('almond-flour', 'Almond flour', UNITS.cup, 'dry', ['nut']),
  ing('eggs', 'Eggs', UNITS.egg, 'dairy'),
  ing('bananas', 'Bananas', count('banana', 'bananas'), 'produce'),
  ing('butter', 'Butter', UNITS.tbsp, 'dairy', ['dairy']),
  ing('syrup', 'Syrup', UNITS.oz, 'dry'),
  ing('bread', 'Bread', UNITS.slice, 'bakery', ['gf']),
  ing('gf-bread', 'Gluten-free bread', UNITS.slice, 'bakery'),
  ing('cheese', 'Cheese', UNITS.slice, 'dairy', ['dairy']),
  ing('hummus', 'Hummus', UNITS.tbsp, 'dairy'),
  ing('bacon', 'Bacon', UNITS.slice, 'meat', ['veg']),
  ing('chicken', 'Chicken thighs', UNITS.ozw, 'meat', ['veg'])
];
const CATALOG: Catalog = { ingredients: ING, packages: [], conversions: [], recipes: [] };

const base = (ingredientId: string, qtyPerPerson: number, unitKey: string | null = null): BaseLine => ({ ingredientId, qtyPerPerson, unitKey });
const swap = (baseIngredientId: string, ingredientId: string, qtyPerPerson: number, unitKey: string | null = null) => ({
  op: 'swap' as const, baseIngredientId, ingredientId, qtyPerPerson, unitKey
});
const leaveOut = (baseIngredientId: string) => ({ op: 'leave_out' as const, baseIngredientId, ingredientId: null, qtyPerPerson: null, unitKey: null });
const add = (ingredientId: string, qtyPerPerson: number, unitKey: string | null = null) => ({
  op: 'add' as const, baseIngredientId: null, ingredientId, qtyPerPerson, unitKey
});
const substituted = (restriction: Variation['restriction'], lines: Variation['lines']): Variation => ({ restriction, state: 'substituted', note: null, lines });

const line = (ingredientId: string, qtyPerPerson: number, servesRule: RecipeLine['servesRule'], servesRestrictions: RecipeLine['servesRestrictions'] = [], unitKey: string | null = null): RecipeLine => ({
  ingredientId, qtyPerPerson, unitKey, servesRule, servesRestrictions
});

describe('compileRecipe — diff → engine lines', () => {
  it('Variations_CompilePancakesGf_ToExceptAndOnlyLines', () => {
    const out = compileRecipe(
      [base('pancake-mix', 0.5), base('butter', 0.5), base('syrup', 1)],
      [substituted('gf', [swap('pancake-mix', 'almond-flour', 1), add('eggs', 1), add('bananas', 0.5)])]
    );
    expect(out).toEqual([
      line('pancake-mix', 0.5, 'except', ['gf']),
      line('butter', 0.5, 'everyone'),
      line('syrup', 1, 'everyone'),
      line('almond-flour', 1, 'only', ['gf']),
      line('eggs', 1, 'only', ['gf']),
      line('bananas', 0.5, 'only', ['gf'])
    ]);
  });

  it('Variations_CompileOneLineSwap_Sandwiches', () => {
    const out = compileRecipe([base('bread', 2), base('cheese', 1)], [substituted('gf', [swap('bread', 'gf-bread', 2)])]);
    expect(out).toEqual([line('bread', 2, 'except', ['gf']), line('cheese', 1, 'everyone'), line('gf-bread', 2, 'only', ['gf'])]);
  });

  it('Variations_CompileTwoRestrictionsOnOneBaseLine_AsOneExceptList', () => {
    // Decision 2: cheese left out for dairy-free AND swapped for vegetarians →
    // "everyone except dairy-free or vegetarian", in catalogue order.
    const out = compileRecipe(
      [base('bread', 2), base('cheese', 1)],
      [substituted('veg', [swap('cheese', 'hummus', 2)]), substituted('dairy', [leaveOut('cheese')])]
    );
    expect(out).toEqual([line('bread', 2, 'everyone'), line('cheese', 1, 'except', ['dairy', 'veg']), line('hummus', 2, 'only', ['veg'])]);
  });

  it('Variations_CompileSharedAdd_MergesIdenticalLines_KeepsDifferentOnes', () => {
    const same = compileRecipe([base('bread', 2)], [substituted('dairy', [add('hummus', 2)]), substituted('veg', [add('hummus', 2)])]);
    expect(same).toEqual([line('bread', 2, 'everyone'), line('hummus', 2, 'only', ['dairy', 'veg'])]);
    const different = compileRecipe([base('bread', 2)], [substituted('dairy', [add('hummus', 2)]), substituted('veg', [add('hummus', 3)])]);
    expect(different).toEqual([line('bread', 2, 'everyone'), line('hummus', 2, 'only', ['dairy']), line('hummus', 3, 'only', ['veg'])]);
  });

  it('Variations_NothingAndUnsuitable_ContributeNoLines', () => {
    const out = compileRecipe(
      [base('bacon', 3)],
      [
        { restriction: 'gf', state: 'nothing', note: null, lines: [] },
        { restriction: 'veg', state: 'unsuitable', note: 'No meat-free version', lines: [] }
      ]
    );
    expect(out).toEqual([line('bacon', 3, 'everyone')]);
  });
});

describe('variationView — the tab / chip state', () => {
  const bacon = [base('bacon', 3)];
  it('Variations_View_DerivesNotNeededOrNeedsLook_FromAvoidFlags', () => {
    expect(variationView(bacon, undefined, 'gf', CATALOG)).toBe('not_needed');
    expect(variationView(bacon, undefined, 'veg', CATALOG)).toBe('needs_look');
  });
  it('Variations_View_ReportsTheStoredState', () => {
    expect(variationView(bacon, { restriction: 'veg', state: 'unsuitable', note: null, lines: [] }, 'veg', CATALOG)).toBe('unsuitable');
    expect(variationView(bacon, { restriction: 'veg', state: 'nothing', note: null, lines: [] }, 'veg', CATALOG)).toBe('nothing');
    expect(variationView(bacon, substituted('veg', [leaveOut('bacon')]), 'veg', CATALOG)).toBe('substituted');
    // A substituted row with no changes yet is still a job to finish.
    expect(variationView(bacon, substituted('veg', []), 'veg', CATALOG)).toBe('needs_look');
  });
});

describe('variationsFromLines — the backfill and its round trip', () => {
  it('Variations_FromLines_RoundTripsSeedShapes', () => {
    const pancakes = [
      line('pancake-mix', 0.5, 'except', ['gf']),
      line('almond-flour', 1, 'only', ['gf']),
      line('eggs', 1, 'only', ['gf']),
      line('bananas', 0.5, 'only', ['gf']),
      line('butter', 0.5, 'everyone'),
      line('syrup', 1, 'everyone')
    ];
    const split = variationsFromLines(pancakes);
    expect(split.base).toEqual([base('pancake-mix', 0.5), base('butter', 0.5), base('syrup', 1)]);
    expect(split.variations).toEqual([
      substituted('gf', [leaveOut('pancake-mix'), add('almond-flour', 1), add('eggs', 1), add('bananas', 0.5)])
    ]);
    // Compiling the backfill reproduces the same lines (base first, then adds).
    expect(compileRecipe(split.base, split.variations)).toEqual([
      line('pancake-mix', 0.5, 'except', ['gf']),
      line('butter', 0.5, 'everyone'),
      line('syrup', 1, 'everyone'),
      line('almond-flour', 1, 'only', ['gf']),
      line('eggs', 1, 'only', ['gf']),
      line('bananas', 0.5, 'only', ['gf'])
    ]);
  });

  it('Variations_FromLines_KeepsAStandaloneLeaveOut_AsSubstituted', () => {
    // D001: chicken "everyone except vegetarian", no swap. The backfill keeps
    // the leave-out (today's shopping math), not "unsuitable" — a leader can
    // flip it. Compiling it back changes nothing.
    const chicken = [line('chicken', 6, 'except', ['veg']), line('bread', 1, 'everyone')];
    const split = variationsFromLines(chicken);
    expect(split.variations).toEqual([substituted('veg', [leaveOut('chicken')])]);
    expect(compileRecipe(split.base, split.variations)).toEqual(chicken);
  });
});

describe('cross-restriction warning (decision 3)', () => {
  it('Variations_WarnWhenASwapCarriesAnotherFlag', () => {
    const w = crossRestrictionWarnings([substituted('gf', [swap('pancake-mix', 'almond-flour', 1)])], CATALOG);
    expect(w).toEqual([
      "Almond flour in the gluten-free version isn't nut-free — a scout who is both gluten-free and nut-free gets nothing safe here."
    ]);
    expect(crossRestrictionWarnings([substituted('gf', [swap('bread', 'gf-bread', 2)])], CATALOG)).toEqual([]);
  });
});

describe('engine with restriction lists', () => {
  const R = { gf: 1, nut: 0, dairy: 1, veg: 2 };
  it('Engine_ServingsFor_SumsListedRestrictions', () => {
    expect(servingsFor(line('cheese', 1, 'except', ['dairy', 'veg']), 10, R)).toBe(7);
    expect(servingsFor(line('hummus', 2, 'only', ['dairy', 'veg']), 10, R)).toBe(3);
    expect(servingsFor(line('bread', 2, 'everyone'), 10, R)).toBe(10);
    expect(servingsFor(line('x', 1, 'except', ['gf', 'dairy', 'veg']), 3, R)).toBe(0);
  });
  it('Engine_RuleText_NamesEveryRestriction', () => {
    expect(ruleText(line('cheese', 1, 'except', ['dairy', 'veg']))).toBe('everyone except dairy-free or vegetarian');
    expect(ruleText(line('hummus', 2, 'only', ['veg']))).toBe('only vegetarian');
    expect(ruleText(line('bread', 2, 'everyone'))).toBe('everyone');
  });
  it('Engine_Warns_NotSuitable_ForAnyRestrictionWithACount', () => {
    const recipe: Recipe = {
      id: 'B003', name: 'Bacon', status: 'published', mealFit: ['breakfast'], foodGroups: ['protein'], camp: true, trail: false,
      method: null, stepsMd: null, sortOrder: 1, lines: [line('bacon', 3, 'everyone')],
      variations: [{ restriction: 'veg', state: 'unsuitable', note: null, lines: [] }]
    };
    const plan: Plan = {
      meal: 'breakfast', headcount: 10, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 2 }, recipeIds: ['B003'],
      packageChoice: {}, qtyOverride: {}, lineSource: {}, budgetPerPerson: 4, date: '2026-09-08', patrol: ''
    };
    const w = restrictionWarnings(plan, { ...CATALOG, recipes: [recipe] });
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('unsuitable');
    expect(w[0].count).toBe(2);
    expect(w[0].restriction.key).toBe('veg');
    // No vegetarians → no warning; the flag alone (bacon avoid veg) never warned and still doesn't.
    expect(restrictionWarnings({ ...plan, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 } }, { ...CATALOG, recipes: [recipe] })).toEqual([]);
  });
});
