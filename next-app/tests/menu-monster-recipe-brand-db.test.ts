import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { addBrandWith, removeBrandWith, suggestRecipeBrandWith } from '../src/lib/menu-monster/brands-store';
import { loadAuthoringCatalogWith, loadCatalogWith } from '../src/lib/menu-monster/catalog';
import { recipeSuggestions } from '../src/lib/menu-monster/engine';

/**
 * Release 6 — a recipe's suggested brand against the local stack (20261011100000_mm_recipe_brand_suggestions.sql):
 * the author (or a leader, person null) sets one brand per ingredient of the recipe; it must be a live brand of
 * that ingredient and an ingredient the recipe uses; the catalog carries it, and marks the loader's own recipes.
 */
const admin = adminClient();
const AUTHOR = 39;
const OTHER = 25;
const ING = 'zz-sugg-cookies';
const ING2 = 'zz-sugg-crackers';
const RECIPE = 'S-5c990001';

async function clear() {
  await admin.from('mm_recipes').update({ brand_suggestions: {} }).eq('id', RECIPE);
  await admin.from('mm_brands').delete().in('ingredient_id', [ING, ING2]);
}

beforeAll(async () => {
  const wipe = async () => {
    await admin.from('mm_recipe_lines').delete().eq('recipe_id', RECIPE);
    await admin.from('mm_recipes').delete().eq('id', RECIPE);
    await admin.from('mm_brands').delete().in('ingredient_id', [ING, ING2]);
    await admin.from('mm_ingredients').delete().in('id', [ING, ING2]);
  };
  await wipe();
  const ing = (id: string, name: string) => ({ id, name, unit_kind: 'count', unit_key: 'count', unit_one: 'cookie', unit_many: 'cookies', section: 'bakery', staple: false, avoid: [] });
  const a = await admin.from('mm_ingredients').insert([ing(ING, 'ZZ Vitest sugg cookies'), ing(ING2, 'ZZ Vitest sugg crackers')]);
  if (a.error) throw new Error(a.error.message);
  const r = await admin.from('mm_recipes').insert({ id: RECIPE, name: 'ZZ Vitest sugg recipe', status: 'draft', meal_fit: ['lunch'], author_person_id: AUTHOR });
  if (r.error) throw new Error(r.error.message);
  const l = await admin.from('mm_recipe_lines').insert({ recipe_id: RECIPE, position: 1, ingredient_id: ING, qty_per_person: 2, serves_rule: 'everyone', serves_restrictions: [] });
  if (l.error) throw new Error(l.error.message);
  return wipe;
});
afterEach(clear);

const brand = async (name: string, ing = ING) => {
  const res = await addBrandWith(admin, AUTHOR, ing, name);
  if (res.status !== 'ok') throw new Error(res.status);
  return res.brand.id;
};
const stored = async () => (await admin.from('mm_recipes').select('brand_suggestions').eq('id', RECIPE).single()).data?.brand_suggestions;

describe('suggesting a brand for a recipe', () => {
  it('Author_SetsASuggestion', async () => {
    const b = await brand('ZZ Vitest Oreo');
    expect([await suggestRecipeBrandWith(admin, AUTHOR, RECIPE, ING, b), await stored()]).toEqual(['ok', { [ING]: b }]);
  });

  it('Author_ClearsIt', async () => {
    const b = await brand('ZZ Vitest Oreo');
    await suggestRecipeBrandWith(admin, AUTHOR, RECIPE, ING, b);
    expect([await suggestRecipeBrandWith(admin, AUTHOR, RECIPE, ING, null), await stored()]).toEqual(['ok', {}]);
  });

  it('SomeoneElse_IsRefused', async () => {
    const b = await brand('ZZ Vitest Oreo');
    expect([await suggestRecipeBrandWith(admin, OTHER, RECIPE, ING, b), await stored()]).toEqual(['not_yours', {}]);
  });

  it('ALeader_MaySuggestForAnyRecipe', async () => {
    const b = await brand('ZZ Vitest Oreo');
    expect(await suggestRecipeBrandWith(admin, null, RECIPE, ING, b)).toBe('ok');
  });

  it('ABrandOfAnotherIngredient_IsRefused', async () => {
    const wrong = await brand('ZZ Vitest Ritz', ING2);
    expect(await suggestRecipeBrandWith(admin, AUTHOR, RECIPE, ING, wrong)).toBe('bad_brand');
  });

  it('AnIngredientTheRecipeDoesNotUse_IsRefused', async () => {
    const b = await brand('ZZ Vitest Ritz', ING2);
    expect(await suggestRecipeBrandWith(admin, AUTHOR, RECIPE, ING2, b)).toBe('bad_brand');
  });

  it('ARemovedBrand_IsRefused', async () => {
    const b = await brand('ZZ Vitest Oreo');
    await removeBrandWith(admin, b);
    expect(await suggestRecipeBrandWith(admin, AUTHOR, RECIPE, ING, b)).toBe('bad_brand');
  });

  it('AMissingRecipe_IsNotFound', async () => {
    expect(await suggestRecipeBrandWith(admin, AUTHOR, 'S-5c99ffff', ING, null)).toBe('not_found');
  });
});

describe('the catalog carries suggestions', () => {
  it('TheAuthorsLoad_HasTheSuggestion_AndMarksTheRecipeTheirs', async () => {
    const b = await brand('ZZ Vitest Oreo');
    await suggestRecipeBrandWith(admin, AUTHOR, RECIPE, ING, b);
    const recipe = (await loadCatalogWith(admin, { ownerPersonId: AUTHOR })).recipes.find((r) => r.id === RECIPE)!;
    expect([recipe.brandSuggestions, recipe.mine]).toEqual([{ [ING]: b }, true]);
  });

  it('APublicLoad_NeverCarriesWhoWroteARecipe', async () => {
    const recipes = (await loadCatalogWith(admin)).recipes;
    expect(recipes.some((r) => 'authorPersonId' in r || r.mine)).toBe(false);
  });

  it('SomeoneElsesLoad_DoesNotMarkItTheirs', async () => {
    const recipes = (await loadCatalogWith(admin, { ownerPersonId: OTHER })).recipes;
    expect(recipes.find((r) => r.id === RECIPE)).toBeUndefined();
  });

  it('ARemovedBrand_StopsBeingASuggestion_WithoutAnyCleanup', async () => {
    const b = await brand('ZZ Vitest Oreo');
    await suggestRecipeBrandWith(admin, null, RECIPE, ING, b);
    await removeBrandWith(admin, b);
    const catalog = await loadAuthoringCatalogWith(admin);
    const recipe = catalog.recipes.find((r) => r.id === RECIPE);
    // A private draft is not in the leader tools' catalog; when it is, the dead brand is filtered at use.
    expect(recipe ? recipeSuggestions(recipe, catalog) : []).toEqual([]);
  });
});
