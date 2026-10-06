import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { SECTIONS, SECTION_ORDER } from '../src/lib/menu-monster/units';
import { foodProblems, overlayNewRecipes, sanitizeSingleFood, singleFoodDraft, singleFoodRecipe } from '../src/lib/menu-monster/single-food';

/**
 * Food on the fly (Patrick, 2026-10-06), pure rules: the Beverages section, what is required to save, the
 * cleaned payload the action receives, and the one-line recipe the food becomes.
 */

describe('sections', () => {
  it('SectionOrder_IncludesBeverage_AfterDairy', () => {
    expect(SECTION_ORDER.slice(0, 3)).toEqual(['meat', 'dairy', 'beverage']);
  });

  it('EverySection_HasALabel_AndAPlaceInTheStoreWalk', () => {
    expect(Object.keys(SECTIONS).sort()).toEqual([...SECTION_ORDER].sort());
  });

  it('Beverage_IsLabelledBeverages', () => {
    expect(SECTIONS.beverage).toBe('Beverages');
  });
});

describe('foodProblems', () => {
  it('NameAndKind_AreTheOnlyRequirements', () => {
    expect(foodProblems({ name: 'Kool-Aid', section: 'beverage' })).toEqual([]);
  });

  it('MissingKind_SaysWhatToPick', () => {
    expect(foodProblems({ name: 'Kool-Aid', section: '' })).toEqual([{ field: 'section', reason: 'pick what kind of food it is' }]);
  });

  it('MissingName_IsListedFirst', () => {
    expect(foodProblems({ name: '  ', section: '' }).map((p) => p.field)).toEqual(['name', 'section']);
  });
});

const raw = (over: Record<string, unknown> = {}, ing: Record<string, unknown> = {}) => ({
  ingredient: { key: 'new:0000beef', name: 'Kool-Aid', section: 'beverage', kind: 'count', one: 'packet', many: 'packets', avoid: [], ...ing },
  eachPerson: 1,
  mealSlot: 'snack',
  ...over
});

describe('sanitizeSingleFood', () => {
  it('Basics_AreEnough_AndThePackageIsEmpty', () => {
    const res = sanitizeSingleFood(raw(), CATALOG);
    expect(res).toMatchObject({ ok: true, food: { ingredient: { name: 'Kool-Aid', section: 'beverage', size: 0, price: 0 }, eachPerson: 1, mealSlot: 'snack', existingIngredientId: null } });
  });

  it('EachPerson_DefaultsToOne', () => {
    expect(sanitizeSingleFood({ ...raw(), eachPerson: undefined }, CATALOG)).toMatchObject({ ok: true, food: { eachPerson: 1 } });
  });

  it('EachPerson_ZeroOrHuge_IsRefused', () => {
    expect([sanitizeSingleFood(raw({ eachPerson: 0 }), CATALOG).ok, sanitizeSingleFood(raw({ eachPerson: 5000 }), CATALOG).ok]).toEqual([false, false]);
  });

  it('MissingSection_IsRefused_InWords', () => {
    expect(sanitizeSingleFood(raw({}, { section: undefined }), CATALOG)).toEqual({ ok: false, error: 'Can’t save yet: pick what kind of food it is.' });
  });

  it('UnknownSection_IsRefused', () => {
    expect(sanitizeSingleFood(raw({}, { section: 'candy' }), CATALOG).ok).toBe(false);
  });

  it('UnknownMealSlot_IsRefused', () => {
    expect(sanitizeSingleFood(raw({ mealSlot: 'brunch' }), CATALOG).ok).toBe(false);
  });

  it('APriceBookName_IsRefused_WithTheExistingFoodToOffer', () => {
    expect(sanitizeSingleFood(raw({}, { name: 'orange JUICE' }), CATALOG)).toMatchObject({ ok: false, existingIngredientId: 'oj' });
  });

  it('AnExistingFood_NeedsNoNewIngredient', () => {
    expect(sanitizeSingleFood({ existingIngredientId: 'oj', mealSlot: 'breakfast' }, CATALOG)).toMatchObject({ ok: true, food: { ingredient: null, existingIngredientId: 'oj', eachPerson: 1 } });
  });

  it('AnExistingFoodThatIsGone_IsRefused', () => {
    expect(sanitizeSingleFood({ existingIngredientId: 'nope', mealSlot: 'breakfast' }, CATALOG).ok).toBe(false);
  });

  it('APackage_WithAPrice_IsKept', () => {
    expect(sanitizeSingleFood(raw({}, { size: 8, price: 3.5, store: 'Aldi' }), CATALOG)).toMatchObject({ ok: true, food: { ingredient: { size: 8, price: 3.5, store: 'Aldi' } } });
  });

  it('ALineUnit_ThatBridges_IsKept_AnythingElseIsTheFoodsOwn', () => {
    const volume = raw({ unit: 'oz' }, { kind: 'volume', one: '', many: '' });
    const odd = raw({ unit: 'lb' }, { kind: 'volume', one: '', many: '' });
    expect([sanitizeSingleFood(volume, CATALOG), sanitizeSingleFood(odd, CATALOG)]).toMatchObject([{ food: { unit: 'oz' } }, { food: { unit: null } }]);
  });
});

describe('the one-line recipe', () => {
  it('Draft_IsNamedForTheFood_FitsTheSlot_HasOneLine', () => {
    expect(singleFoodDraft('Kool-Aid', 'snack', 'x-0000beef', 2, null)).toMatchObject({
      id: null,
      name: 'Kool-Aid',
      mealFit: ['snack'],
      foodGroups: [],
      steps: [],
      lines: [{ ingredientId: 'x-0000beef', qtyPerPerson: 2, unitKey: null }],
      newIngredients: []
    });
  });

  it('Recipe_IsTheOwnersDraft_WithAnEveryoneLine', () => {
    expect(singleFoodRecipe('S-0000beef', 'Kool-Aid', 'snack', 'x-0000beef', 1, null)).toMatchObject({ id: 'S-0000beef', status: 'draft', mine: true, lines: [{ ingredientId: 'x-0000beef', servesRule: 'everyone' }] });
  });

  it('Overlay_AddsTheRecipe_AndSkipsOneTheCatalogHas', () => {
    const r = singleFoodRecipe('S-0000beef', 'Kool-Aid', 'snack', 'x-0000beef', 1, null);
    const once = overlayNewRecipes(CATALOG, [r]);
    expect([once.recipes.length, overlayNewRecipes(once, [r]).recipes.length, CATALOG.recipes.some((x) => x.id === r.id)]).toEqual([CATALOG.recipes.length + 1, CATALOG.recipes.length + 1, false]);
  });
});
