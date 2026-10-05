import { describe, it, expect } from 'vitest';
import type { Conversion, Ingredient, Package } from '../src/lib/menu-monster/types';
import { UNITS } from '../src/lib/menu-monster/units';
import { foodRules, unitLadders, workedExamples } from '../src/lib/menu-monster/conversion-lesson';

/**
 * The Conversions tab of a menu (Patrick, 2026-10-05): a read-only look at how
 * Menu Monster turns what a recipe measures into what a store sells — "a peek
 * behind the magic curtain", written as a lesson. Pure: the tab renders what
 * these return.
 */
const ing = (id: string, name: string, unit: Ingredient['unit']): Ingredient => ({ id, name, unit, section: 'dry', staple: false, avoid: [], retiredAt: null });
const RAISINS = ing('raisins', 'Raisins', UNITS.cup);
const PEPPER = ing('pepper', 'Black pepper', UNITS.tsp);
const MILK = ing('milk', 'Milk', UNITS.cup);
const EGGS = ing('eggs', 'Eggs', UNITS.egg);

const pkg = (id: string, ingredientId: string, name: string, soldSize: number | null, soldUnit: string | null, yield_: number | null = 1): Package => ({
  id, ingredientId, name, store: null, price: 4, anchorPrice: 4, yield: yield_, yieldUnitLabel: null, noun: 'pack', soldSize, soldUnit, note: null, asOf: null
});

const CONVERSIONS: Conversion[] = [
  { ingredientId: 'raisins', from: 'ozw', to: 'cup', factor: 0.19, label: 'raisins ≈ 5.25 oz per cup' },
  { ingredientId: 'pepper', from: 'ozw', to: 'tsp', factor: 12.3, label: null }
];

describe('unitLadders — the measures that always convert', () => {
  it('UnitLadders_WalkEachFamilyOneStepAtATime', () => {
    const [volume, weight, counting] = unitLadders();
    expect(volume.steps).toEqual(['1 Tbsp = 3 tsp', '1 fl oz = 2 Tbsp', '1 cup = 8 fl oz', '1 quart = 4 cups', '1 gallon = 4 quarts']);
    expect(weight.steps).toEqual(['1 oz = 28.35 g', '1 lb = 16 oz']);
    expect(counting.steps).toEqual(['1 dozen = 12']);
  });
});

describe('foodRules — the foods that need their own number', () => {
  it('FoodRules_SayTheBiggerUnitFirst_SoTheNumberIsNeverAFraction', () => {
    const rules = foodRules({ ingredients: [RAISINS, PEPPER], conversions: CONVERSIONS });
    expect(rules).toEqual([
      { ingredientId: 'pepper', name: 'Black pepper', rule: '1 oz = 12.3 tsp', source: null },
      { ingredientId: 'raisins', name: 'Raisins', rule: '1 cup = 5.26 oz', source: 'raisins ≈ 5.25 oz per cup' }
    ]);
  });

  it('FoodRules_LeaveOutAConversionWhoseIngredientIsNotInTheCatalog', () => {
    expect(foodRules({ ingredients: [PEPPER], conversions: CONVERSIONS }).map((r) => r.ingredientId)).toEqual(['pepper']);
  });
});

describe('workedExamples — the math for this menu', () => {
  const catalog = { conversions: CONVERSIONS };

  it('WorkedExample_UsesTheFoodsOwnNumber_WhenTheStoreSellsByWeight', () => {
    const [ex] = workedExamples([{ ing: RAISINS, need: 6, pkg: pkg('p1', 'raisins', 'Sun-Maid Raisins', 20, 'ozw') }], catalog);
    expect(ex).toEqual({
      ingredientId: 'raisins',
      name: 'Raisins',
      need: '6 cups',
      packageName: 'Sun-Maid Raisins',
      kind: 'food',
      rule: '1 cup = 5.26 oz',
      math: '20 oz ÷ 5.26 = 3.8 cups',
      buy: 2
    });
  });

  it('WorkedExample_UsesTheLadder_WhenTheUnitsAreTheSameKind', () => {
    const [ex] = workedExamples([{ ing: MILK, need: 20, pkg: pkg('p2', 'milk', 'Milk, gallon', 1, 'gallon') }], catalog);
    expect(ex).toMatchObject({ kind: 'ladder', rule: '1 gallon = 16 cups', math: '1 gallon × 16 = 16 cups', buy: 2 });
  });

  it('WorkedExample_MultipliesWhenTheNumberIsAboveOne', () => {
    const [ex] = workedExamples([{ ing: PEPPER, need: 2, pkg: pkg('p3', 'pepper', 'Black Pepper', 4, 'ozw') }], catalog);
    expect(ex).toMatchObject({ rule: '1 oz = 12.3 tsp', math: '4 oz × 12.3 = 49.2 tsp', buy: 1 });
  });

  it('WorkedExample_NamesAThingSoldEach_ByWhatItIs', () => {
    const butter = ing('butter', 'Butter', UNITS.tbsp);
    const stick = { ...pkg('p7', 'butter', 'Salted butter, 1 stick', 1, 'each'), noun: 'stick' };
    const [ex] = workedExamples([{ ing: butter, need: 4, pkg: stick }], {
      conversions: [{ ingredientId: 'butter', from: 'each', to: 'tbsp', factor: 8, label: '1 stick = 8 Tbsp' }]
    });
    expect(ex).toMatchObject({ rule: '1 stick = 8 Tbsp', math: '1 stick × 8 = 8 Tbsp' });
  });

  it('FoodRule_CallsAThingSoldEachAnItem_WhenTheTableDoesNotSayWhatItIs', () => {
    const butter = ing('butter', 'Butter', UNITS.tbsp);
    const rules = foodRules({ ingredients: [butter], conversions: [{ ingredientId: 'butter', from: 'each', to: 'tbsp', factor: 8, label: '1 stick = 8 Tbsp' }] });
    expect(rules[0].rule).toBe('1 item = 8 Tbsp');
  });

  it('WorkedExample_IsSkipped_WhenTheStoreSellsInTheRecipesOwnUnit', () => {
    expect(workedExamples([{ ing: MILK, need: 4, pkg: pkg('p4', 'milk', 'Milk, 4 cups', 4, 'cup') }], catalog)).toEqual([]);
  });

  it('WorkedExample_IsSkipped_WhenThereIsNoLabelSizeOrNoWayToConvert', () => {
    const lines = [
      { ing: EGGS, need: 12, pkg: pkg('p5', 'eggs', 'Eggs', null, null) },
      { ing: EGGS, need: 12, pkg: pkg('p6', 'eggs', 'Eggs, 2 lb', 2, 'lb') },
      { ing: MILK, need: 4, pkg: null }
    ];
    expect(workedExamples(lines, catalog)).toEqual([]);
  });
});
