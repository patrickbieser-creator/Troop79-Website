import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { browseIngredients } from '../src/lib/menu-monster/ingredient-browse';

/**
 * Menu Monster hub, Ingredients tab: the price book a scout browses — narrowed
 * by name and by store section, each ingredient with its packages cheapest first.
 */

describe('browseIngredients', () => {
  it('Scout_SeesIngredientsByName_WhenNothingIsTypedOrFiltered', () => {
    const names = browseIngredients(CATALOG, '', null).map((e) => e.ingredient.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('Scout_NarrowsByName_WhenTyping', () => {
    expect(browseIngredients(CATALOG, ' BACON ', null).map((e) => e.ingredient.id)).toEqual(['bacon']);
  });

  it('Scout_NarrowsBySection_WhenAFilterIsOn', () => {
    expect(browseIngredients(CATALOG, '', 'bakery').every((e) => e.ingredient.section === 'bakery')).toBe(true);
  });

  it('Ingredient_ListsItsPackages_CheapestFirst', () => {
    const bacon = browseIngredients(CATALOG, 'bacon', null)[0];
    expect(bacon.packages.map((p) => p.id)).toEqual(['p-bac-om', 'p-bac-kirk']);
  });

  it('Ingredient_ShowsItsLowestPrice', () => {
    expect(browseIngredients(CATALOG, 'bacon', null)[0].from).toBe(7.49);
  });

  it('Ingredient_HasNoLowestPrice_WhenNoPackageIsSold', () => {
    const bare = { ...CATALOG, packages: [] };
    expect(browseIngredients(bare, 'bacon', null)[0].from).toBeNull();
  });
});
