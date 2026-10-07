import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { packageSizeLabel, packageSizeUnits, packageYield, sanitizeScoutPackage, scoutPackageProblem } from '../src/lib/menu-monster/scout-packages';

/**
 * Release C: a scout adds a package to a price-book ingredient. The size is
 * typed in any unit the ingredient can be bridged to (its own unit, its unit
 * family, or across one of its conversion rows) and stored in the recipe unit;
 * a unit with no path is never offered (troop79-specialist review).
 */

const ing = (id: string) => CATALOG.ingredients.find((i) => i.id === id)!;

describe('packageSizeUnits', () => {
  it('Units_StartWithTheIngredientsOwnUnit', () => {
    const bacon = ing('bacon');
    expect(packageSizeUnits(bacon, CATALOG.conversions)[0].key).toBe(bacon.unit.key);
  });

  it('Units_OfferOnlyWhatCanBeConverted', () => {
    const eggs = ing('eggs');
    const keys = packageSizeUnits(eggs, CATALOG.conversions).map((u) => u.key);
    expect(keys).toContain('dozen');
    expect(keys).not.toContain('cup');
  });
});

describe('packageYield', () => {
  it('Yield_IsTheSizeInTheRecipeUnit', () => {
    expect(packageYield(ing('eggs'), CATALOG.conversions, 2, 'dozen')).toBe(24);
  });

  it('Yield_IsNull_ForAUnitWithNoPath', () => {
    expect(packageYield(ing('eggs'), CATALOG.conversions, 2, 'cup')).toBeNull();
  });
});

describe('sanitizeScoutPackage', () => {
  const raw = { ingredientId: 'eggs', name: '  Store eggs, 18 ct ', store: 'Aldi', size: 18, sizeUnit: 'egg', price: 3.999 };

  it('Package_IsCleaned_AndPricedInWholeCents', () => {
    expect(sanitizeScoutPackage({ ...raw, sizeUnit: ing('eggs').unit.key }, CATALOG)).toEqual({
      ingredientId: 'eggs', name: 'Store eggs, 18 ct', store: 'Aldi', size: 18, price: 4
    });
  });

  it('Package_IsRefused_ForAnUnknownIngredient', () => {
    expect(sanitizeScoutPackage({ ...raw, ingredientId: 'nope' }, CATALOG)).toBeNull();
  });

  it('Package_IsRefused_ForATypedInIngredient', () => {
    const typed = { ...CATALOG, ingredients: [...CATALOG.ingredients, { ...ing('eggs'), id: 'x-0000beef', needsMatch: true }] };
    expect(sanitizeScoutPackage({ ...raw, ingredientId: 'x-0000beef', sizeUnit: ing('eggs').unit.key }, typed)).toBeNull();
  });

  it('Problem_AsksForTheLabelSize_WhenSizeIsMissing', () => {
    expect(scoutPackageProblem({ name: 'Eggs', size: 0, price: 3, yield: null })).toMatch(/label/);
  });

  it('Problem_AsksForAPriceInRange', () => {
    expect(scoutPackageProblem({ name: 'Eggs', size: 12, price: 900, yield: 12 })).toMatch(/\$0\.10 to \$500/);
  });

  it('Problem_IsNull_ForAGoodPackage', () => {
    expect(scoutPackageProblem({ name: 'Eggs', size: 12, price: 3, yield: 12 })).toBeNull();
  });
});

describe('brand packages (Menu-Monster-Brand-Detail)', () => {
  const raw = { ingredientId: 'eggs', name: 'Eggland', store: '', size: 18, sizeUnit: 'egg', price: 4, brandId: 'b-eggland' };

  it('SizeLabel_ReadsLikeTheBag', () => {
    expect([packageSizeLabel(12, 'ozw', ing('eggs')), packageSizeLabel(1.5, 'lb', ing('eggs')), packageSizeLabel(12, 'oz', ing('eggs'))]).toEqual(['12 oz', '1.5 lb', '12 fl oz']);
  });

  it('SizeLabel_UsesTheIngredientsOwnUnitWords', () => {
    const own = ing('eggs').unit;
    expect([packageSizeLabel(1, own.key, ing('eggs')), packageSizeLabel(18, own.key, ing('eggs'))]).toEqual([`1 ${own.one}`, `18 ${own.many}`]);
  });

  it('Package_CarriesItsBrandAndTheSizeAsTyped', () => {
    expect(sanitizeScoutPackage(raw, CATALOG)).toMatchObject({ brandId: 'b-eggland', sizeLabel: `18 ${ing('eggs').unit.many}`, size: 18 });
  });

  it('Package_HasNoBrandFields_WhenNoneIsGiven', () => {
    const { brandId: _b, ...rest } = raw;
    void _b;
    expect(sanitizeScoutPackage(rest, CATALOG)).not.toHaveProperty('brandId');
  });
});
