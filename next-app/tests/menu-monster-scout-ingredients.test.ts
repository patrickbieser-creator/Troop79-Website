import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import {
  SIZE_UNITS,
  isNewKey,
  newIngredientKey,
  newIngredientProblem,
  overlayNewIngredients,
  sanitizeNewIngredients,
  sizeInRecipeUnit,
  typedInPayload,
  type NewIngredient
} from '../src/lib/menu-monster/scout-ingredients';

/**
 * Phase 4B typed-in ingredients, pure rules: the new: key, the package size in
 * the recipe unit, what the form refuses, the cleaned list the RPC receives, and
 * the overlay that lets the editor price an unsaved one.
 */

const gochujang = (over: Partial<NewIngredient> = {}): NewIngredient => ({
  key: 'new:0000aaaa',
  name: 'Gochujang',
  kind: 'weight',
  one: '',
  many: '',
  avoid: ['gf'],
  section: 'dry',
  size: 17.6,
  price: 6.99,
  store: 'H Mart',
  ...over
});

describe('keys and sizes', () => {
  it('NewKey_IsRecognised', () => {
    expect(isNewKey(newIngredientKey())).toBe(true);
  });

  it('SizeUnits_FollowTheKind', () => {
    expect(SIZE_UNITS.weight.map((u) => u.key)).toEqual(['ozw', 'lb', 'gram']);
  });

  it('PoundPackage_IsSixteenOunces', () => {
    expect(sizeInRecipeUnit('weight', 2, 'lb')).toBeCloseTo(32);
  });

  it('GallonPackage_IsSixteenCups', () => {
    expect(sizeInRecipeUnit('volume', 1, 'gallon')).toBeCloseTo(16);
  });

  it('CountPackage_IsHowManyIsInIt', () => {
    expect(sizeInRecipeUnit('count', 12, 'count')).toBe(12);
  });
});

describe('newIngredientProblem', () => {
  it('GoodIngredient_HasNoProblem', () => {
    expect(newIngredientProblem(gochujang(), CATALOG)).toBeNull();
  });

  it('Ingredient_NeedsAName', () => {
    expect(newIngredientProblem(gochujang({ name: ' ' }), CATALOG)).toBe('Give the ingredient a name.');
  });

  it('Ingredient_CantCopyAPriceBookName', () => {
    expect(newIngredientProblem(gochujang({ name: 'bacon' }), CATALOG)).toBe('“bacon” is already in the price book. Pick it from the search instead.');
  });

  it('Ingredient_NeedsAPackageSize', () => {
    expect(newIngredientProblem(gochujang({ size: 0 }), CATALOG)).toBe('How big is one package?');
  });

  it('Ingredient_NeedsARealPrice', () => {
    expect(newIngredientProblem(gochujang({ price: 0.05 }), CATALOG)).toBe('Enter what one package costs, from $0.10 to $500.');
  });

  it('CountIngredient_NeedsWhatOneIsCalled', () => {
    expect(newIngredientProblem(gochujang({ kind: 'count', one: '', many: '' }), CATALOG)).toBe('Say what one is called (can, tortilla…).');
  });
});

describe('sanitizeNewIngredients', () => {
  it('CleanList_KeepsGoodOnes', () => {
    expect(sanitizeNewIngredients([gochujang()], CATALOG)).toEqual([gochujang()]);
  });

  it('BadOnes_AreDropped', () => {
    expect(sanitizeNewIngredients([gochujang({ price: 0 }), { key: 'nope' }], CATALOG)).toEqual([]);
  });

  it('CountIngredient_GetsAPluralWhenNoneGiven', () => {
    expect(sanitizeNewIngredients([gochujang({ kind: 'count', one: 'tortilla', many: '' })], CATALOG)[0].many).toBe('tortillas');
  });

  it('DietTicks_KeepOnlyRealDiets', () => {
    expect(sanitizeNewIngredients([{ ...gochujang(), avoid: ['gf', 'keto'] }], CATALOG)[0].avoid).toEqual(['gf']);
  });
});

describe('overlayNewIngredients', () => {
  const cat = overlayNewIngredients(CATALOG, [gochujang()]);

  it('Overlay_AddsTheIngredient_MarkedNew', () => {
    expect(cat.ingredients.find((i) => i.id === 'new:0000aaaa')).toMatchObject({ name: 'Gochujang', needsMatch: true, unit: { key: 'ozw' } });
  });

  it('Overlay_AddsItsPackage', () => {
    expect(cat.packages.find((p) => p.ingredientId === 'new:0000aaaa')).toMatchObject({ price: 6.99, yield: 17.6, store: 'H Mart' });
  });

  it('Overlay_LeavesTheCatalogAlone', () => {
    expect(CATALOG.ingredients.some((i) => i.id === 'new:0000aaaa')).toBe(false);
  });
});

describe('section and the optional package (food on the fly, 2026-10-06)', () => {
  it('Problem_NoPackageAtAll_IsFine_ForAFoodPricedLater', () => {
    expect(newIngredientProblem(gochujang({ size: 0, price: 0 }), CATALOG)).toBeNull();
  });

  it('Problem_NoPackageAtAll_IsRefused_WhenTheFormRequiresOne', () => {
    expect(newIngredientProblem(gochujang({ size: 0, price: 0 }), CATALOG, { requirePackage: true })).toBe('How big is one package?');
  });

  it('Problem_PriceWithoutSize_IsStillRefused', () => {
    expect(newIngredientProblem(gochujang({ size: 0, price: 4 }), CATALOG)).toBe('How big is one package?');
  });

  it('Problem_SizeWithoutPrice_IsStillRefused', () => {
    expect(newIngredientProblem(gochujang({ size: 8, price: 0 }), CATALOG)).toBe('Enter what one package costs, from $0.10 to $500.');
  });

  it('Sanitize_KeepsAValidSection', () => {
    expect(sanitizeNewIngredients([gochujang({ section: 'beverage' })], CATALOG)[0].section).toBe('beverage');
  });

  it('Sanitize_DefaultsAMissingSection_ToDry_ForTheOldCallers', () => {
    const { section, ...old } = gochujang();
    void section;
    expect(sanitizeNewIngredients([old], CATALOG)[0].section).toBe('dry');
  });

  it('Sanitize_DefaultsAnUnknownSection_ToDry', () => {
    expect(sanitizeNewIngredients([{ ...gochujang(), section: 'candy' }], CATALOG)[0].section).toBe('dry');
  });

  it('Sanitize_KeepsAFoodWithNoPackage_AsSizeAndPriceZero', () => {
    expect(sanitizeNewIngredients([{ ...gochujang(), size: undefined, price: undefined }], CATALOG)[0]).toMatchObject({ size: 0, price: 0 });
  });

  it('Payload_CarriesTheSection', () => {
    expect(typedInPayload(gochujang({ section: 'beverage' })).section).toBe('beverage');
  });

  it('Payload_HasNoPackage_WhenNoneWasGiven', () => {
    expect(typedInPayload(gochujang({ size: 0, price: 0 })).package).toBeNull();
  });

  it('Overlay_UsesTheSection_AndAddsNoPackage_WhenUnpriced', () => {
    const cat = overlayNewIngredients(CATALOG, [gochujang({ section: 'beverage', size: 0, price: 0 })]);
    expect([cat.ingredients.find((i) => i.id === 'new:0000aaaa')?.section, cat.packages.some((p) => p.ingredientId === 'new:0000aaaa')]).toEqual(['beverage', false]);
  });
});
