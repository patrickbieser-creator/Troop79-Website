import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * A single food is one entry (Plans/Menu-Monster-Single-Food-Entry.md, release 1): the stored link
 * `mm_recipes.food_ingredient_id` says "this menu item is that food, served by itself", and the DATABASE keeps
 * it true — one line on that food and no diet-swap line, one such item per food, the food's name, and the
 * food's retirement. These run against the real local Postgres; every row is a `vitest-link-*` fixture.
 */
const admin = adminClient();
const FOOD = 'vitest-link-cookies';
const OTHER = 'vitest-link-milk';
const ITEM = 'vitest-link-item';
const ITEM2 = 'vitest-link-item-2';

const line = (ingredient_id: string, qty = 2) => ({ ingredient_id, qty_per_person: qty, unit_key: null, serves_rule: 'everyone', serves_restrictions: [] as string[] });

async function save(id: string, name: string, lines: unknown[], foodId: string | null | undefined, variations: unknown[] = []) {
  return admin.rpc('mm_save_recipe', {
    p_recipe: {
      id, name, status: 'draft', meal_fit: ['snack'], food_groups: [], camp: true, trail: false, method: 'no-cook', steps_md: null, sort_order: 9990,
      ...(foodId === undefined ? {} : { food_ingredient_id: foodId })
    },
    p_lines: lines,
    p_variations: variations
  });
}
async function item(id: string = ITEM) {
  const { data } = await admin.from('mm_recipes').select('name, status, food_ingredient_id').eq('id', id).maybeSingle();
  return data as { name: string; status: string; food_ingredient_id: string | null } | null;
}

beforeEach(async () => {
  const { error } = await admin.from('mm_ingredients').insert([
    { id: FOOD, name: 'Vitest link cookies', unit_kind: 'count', unit_key: 'count', unit_one: 'cookie', unit_many: 'cookies', section: 'dry' },
    { id: OTHER, name: 'Vitest link milk', unit_kind: 'volume', unit_key: 'cup', unit_one: 'cup', unit_many: 'cups', section: 'dairy' }
  ]);
  if (error) throw new Error(`fixture: ${error.message}`);
});

afterEach(async () => {
  await admin.from('mm_recipes').delete().in('id', [ITEM, ITEM2]); // lines and variations cascade or are deleted below
  await admin.from('mm_recipe_lines').delete().in('recipe_id', [ITEM, ITEM2]);
  await admin.from('mm_recipes').delete().in('id', [ITEM, ITEM2]);
  await admin.from('mm_ingredients').delete().in('id', [FOOD, OTHER]);
});

describe('the food link holds only for one line on that food', () => {
  it('FoodLink_IsKept_WhenTheMenuItemIsOneLineOfThatFood', async () => {
    expect((await save(ITEM, 'anything', [line(FOOD)], FOOD)).error).toBeNull();
    expect((await item())?.food_ingredient_id).toBe(FOOD);
  });

  it('FoodLink_IsDropped_WhenTheMenuItemHasTwoIngredientLines', async () => {
    await save(ITEM, 'x', [line(FOOD), line(OTHER, 1)], FOOD);
    expect((await item())?.food_ingredient_id).toBeNull();
  });

  it('FoodLink_IsDropped_WhenTheLineIsADifferentFood', async () => {
    await save(ITEM, 'x', [line(OTHER, 1)], FOOD);
    expect((await item())?.food_ingredient_id).toBeNull();
  });

  it('FoodLink_IsDropped_WhenThereIsNoLineAtAll', async () => {
    await save(ITEM, 'x', [], FOOD);
    expect((await item())?.food_ingredient_id).toBeNull();
  });

  it('FoodLink_IsDropped_WhenADietSwapChangesALine', async () => {
    const swap = [{ restriction: 'gf', state: 'substituted', note: null, lines: [{ op: 'swap', base_ingredient_id: FOOD, ingredient_id: OTHER, qty_per_person: 1, unit_key: null }] }];
    await save(ITEM, 'x', [line(FOOD)], FOOD, swap);
    expect((await item())?.food_ingredient_id).toBeNull();
  });

  it('FoodLink_IsDropped_WhenASecondIngredientIsAddedLater_AndTheFoodStays', async () => {
    await save(ITEM, 'x', [line(FOOD)], FOOD);
    await save(ITEM, 'Cookies and milk', [line(FOOD), line(OTHER, 1)], undefined);
    expect(await item()).toMatchObject({ food_ingredient_id: null, name: 'Cookies and milk' });
    const { data } = await admin.from('mm_ingredients').select('id, retired_at').eq('id', FOOD).single();
    expect(data).toEqual({ id: FOOD, retired_at: null });
  });

  it('FoodLink_IsKept_WhenAnOlderCallerSavesWithoutNamingIt', async () => {
    await save(ITEM, 'x', [line(FOOD)], FOOD);
    await save(ITEM, 'x', [line(FOOD, 3)], undefined);
    expect((await item())?.food_ingredient_id).toBe(FOOD);
  });

  it('FoodLink_IsRefused_ForASecondMenuItemOfTheSameFood', async () => {
    await save(ITEM, 'x', [line(FOOD)], FOOD);
    const second = await save(ITEM2, 'y', [line(FOOD)], FOOD);
    expect(second.error).not.toBeNull();
    expect(await item(ITEM2)).toBeNull();
  });
});

describe('a linked menu item carries the food’s name', () => {
  it('SavingALinkedMenuItemUnderANewName_RenamesTheFoodToo', async () => {
    // Today's editor renames only the menu item; one save must still move both names.
    await save(ITEM, 'Vitest link cookies', [line(FOOD)], FOOD);
    await save(ITEM, 'Vitest link biscuits', [line(FOOD)], undefined);
    expect((await item())?.name).toBe('Vitest link biscuits');
    const { data } = await admin.from('mm_ingredients').select('name').eq('id', FOOD).single();
    expect((data as { name: string }).name).toBe('Vitest link biscuits');
  });

  it('LinkedMenuItem_CannotDriftFromTheFoodsName_ByADirectWrite', async () => {
    await save(ITEM, 'Vitest link cookies', [line(FOOD)], FOOD);
    await admin.from('mm_recipes').update({ name: 'Something else' }).eq('id', ITEM);
    expect((await item())?.name).toBe('Vitest link cookies');
  });

  it('RenamingAndAddingAnIngredientInOneSave_KeepsTheTypedName_AndTheFoodsOwnName', async () => {
    await save(ITEM, 'Vitest link cookies', [line(FOOD)], FOOD);
    await save(ITEM, 'Cookies and milk', [line(FOOD), line(OTHER, 1)], undefined);
    expect(await item()).toMatchObject({ name: 'Cookies and milk', food_ingredient_id: null });
    const { data } = await admin.from('mm_ingredients').select('name').eq('id', FOOD).single();
    expect((data as { name: string }).name).toBe('Vitest link cookies');
  });

  it('RenamingTheFood_RenamesItsLinkedMenuItem', async () => {
    await save(ITEM, 'x', [line(FOOD)], FOOD);
    await admin.from('mm_ingredients').update({ name: 'Vitest link biscuits' }).eq('id', FOOD);
    expect((await item())?.name).toBe('Vitest link biscuits');
  });

  it('RenamingAnUnlinkedDish_LeavesTheFoodAlone', async () => {
    // "Eggs - Hard-boiled" is a dish made of one food: its own name, not the food's.
    await save(ITEM, 'Vitest link cookies - warmed', [line(FOOD)], null);
    await admin.from('mm_ingredients').update({ name: 'Vitest link biscuits' }).eq('id', FOOD);
    expect((await item())?.name).toBe('Vitest link cookies - warmed');
  });
});

describe('retiring', () => {
  it('RetiringTheFood_TakesItsLinkedMenuItemOffTheMenu', async () => {
    await save(ITEM, 'x', [line(FOOD)], FOOD);
    await admin.from('mm_ingredients').update({ retired_at: new Date().toISOString() }).eq('id', FOOD);
    expect((await item())?.status).toBe('retired');
  });

  it('RetiringTheMenuItem_LeavesTheFoodInThePriceBook', async () => {
    await save(ITEM, 'x', [line(FOOD)], FOOD);
    await admin.from('mm_recipes').update({ status: 'retired' }).eq('id', ITEM);
    const { data } = await admin.from('mm_ingredients').select('retired_at').eq('id', FOOD).single();
    expect((data as { retired_at: string | null }).retired_at).toBeNull();
  });

  it('MatchingAFoodAway_IsNotRetiringIt_SoTheMenuItemIsLeftAlone', async () => {
    // mm_match_ingredient sets retired_at and merged_into_id together; that is a merge, not "we stopped buying it".
    await save(ITEM, 'x', [line(FOOD)], FOOD);
    await admin.from('mm_ingredients').update({ retired_at: new Date().toISOString(), merged_into_id: OTHER, merge_factor: 1 }).eq('id', FOOD);
    expect((await item())?.status).toBe('draft');
  });

  it('RestoringTheFood_DoesNotPutItBackOnTheMenuByItself', async () => {
    await save(ITEM, 'x', [line(FOOD)], FOOD);
    await admin.from('mm_ingredients').update({ retired_at: new Date().toISOString() }).eq('id', FOOD);
    await admin.from('mm_ingredients').update({ retired_at: null }).eq('id', FOOD);
    expect((await item())?.status).toBe('retired');
  });
});
