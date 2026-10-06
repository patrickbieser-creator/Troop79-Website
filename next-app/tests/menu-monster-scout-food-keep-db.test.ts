import { describe, it, expect, afterEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * A scout's single food ("Hot chocolate", typed in on the public meal planner) is private to its author, so the
 * leaders' Food & recipes search could never find it. These tests cover the leader side: listing the scout's
 * single foods that still wait on a typed-in ingredient, and "Keep for the troop" — the ingredient becomes a
 * troop ingredient, the troop gets its own tied single-food item, and the scout's item stays the scout's.
 * Scout recipes are S-0000b0** ids; every x- ingredient is removed after each test.
 */
const SCOUT = 39;
const ID = 'S-0000b001';
const admin = adminClient();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => ({ personId: null, label: 'Vitest leader' }) }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => ({ kind: 'identity', label: 'Vitest leader', personId: null, capabilities: new Set(['library.moderate']) }) }));
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}), recordAuditAs: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { listScoutFoodsWith } from '../src/lib/menu-monster/scout-recipes-store';
import { keepScoutFood } from '../src/app/admin/(workspace)/library/menu-monster/actions';

afterEach(async () => {
  const { data: tied } = await admin.from('mm_recipes').select('id').like('name', 'Vitest scoutfood%');
  const ids = ((tied ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length) {
    await admin.from('mm_recipe_lines').delete().in('recipe_id', ids);
    await admin.from('mm_recipes').delete().in('id', ids);
  }
  await admin.from('mm_recipe_lines').delete().like('recipe_id', 'S-0000b0%');
  await admin.from('mm_recipes').delete().like('id', 'S-0000b0%');
  await admin.from('mm_packages').delete().like('id', 'xp-%');
  await admin.from('mm_ingredients').update({ merged_into_id: null }).like('id', 'x-%');
  const { data: made } = await admin.from('mm_ingredients').select('id').ilike('name', 'Vitest scoutfood%');
  const madeIds = ((made ?? []) as { id: string }[]).map((i) => i.id);
  if (madeIds.length) {
    await admin.from('mm_recipe_lines').delete().in('ingredient_id', madeIds);
    await admin.from('mm_packages').delete().in('ingredient_id', madeIds);
    await admin.from('mm_ingredients').delete().in('id', madeIds);
  }
});

const typed = { key: 'new:0000bbbb', name: 'Vitest scoutfood cocoa', kind: 'count', unit_one: 'packet', unit_many: 'packets', avoid: ['dairy'], section: 'dry', package: null };
async function save(over: { meal?: string[]; lines?: unknown[] } = {}) {
  const { data, error } = await admin.rpc('mm_save_scout_recipe', {
    p_person: SCOUT,
    p_recipe: { id: ID, name: 'Vitest scoutfood cocoa', meal_fit: over.meal ?? ['snack'], food_groups: [], steps_md: '' },
    p_lines: over.lines ?? [{ ingredient_id: 'new:0000bbbb', qty_per_person: 2 }],
    p_expected_updated_at: null,
    p_new_ingredients: [typed]
  });
  expect(error).toBeNull();
  return (data as { ids: Record<string, string> }).ids['new:0000bbbb'];
}
const owners = async (ids: number[]) => new Map(ids.map((i) => [i, 'Sam K.']));

describe('scout single foods for the leaders', () => {
  it('ScoutsSingleFood_WithATypedInIngredient_IsListedEvenWhilePrivate', async () => {
    const x = await save();
    const mine = (await listScoutFoodsWith(admin, owners)).find((f) => f.id === ID);
    expect(mine).toMatchObject({ name: 'Vitest scoutfood cocoa', status: 'draft', owner: 'Sam K.', ingredientId: x, ingredientName: 'Vitest scoutfood cocoa', amount: 2, mealFit: ['snack'] });
  });

  it('AScoutRecipeWithTwoIngredients_IsNotASingleFood', async () => {
    await save({ lines: [{ ingredient_id: 'new:0000bbbb', qty_per_person: 2 }, { ingredient_id: 'eggs', qty_per_person: 1 }] });
    expect((await listScoutFoodsWith(admin, owners)).some((f) => f.id === ID)).toBe(false);
  });
});

describe('Keep for the troop', () => {
  it('Keep_MakesATroopIngredient_WithTheTypedInsSectionAndDiets', async () => {
    await save();
    const res = await keepScoutFood(ID);
    const { data } = await admin.from('mm_ingredients').select('name, section, avoid, added_by_person_id, retired_at').eq('id', res.id!).single();
    expect(data).toEqual({ name: 'Vitest scoutfood cocoa', section: 'dry', avoid: ['dairy'], added_by_person_id: null, retired_at: null });
  });

  it('Keep_CreatesTheTroopsTiedItem_WithTheScoutsMealFitAndAmount', async () => {
    await save({ meal: ['snack', 'dessert'] });
    const x = (await keepScoutFood(ID)).id!;
    const { data: item } = await admin.from('mm_recipes').select('id, name, author_person_id, meal_fit').eq('food_ingredient_id', x).single();
    const { data: lines } = await admin.from('mm_recipe_lines').select('ingredient_id, qty_per_person').eq('recipe_id', item!.id);
    expect({ author: item!.author_person_id, meal: [...(item!.meal_fit as string[])].sort(), line: lines!.map((l) => [l.ingredient_id, Number(l.qty_per_person)]) }).toEqual({ author: null, meal: ['dessert', 'snack'], line: [[x, 2]] });
  });

  it('Keep_LeavesTheScoutsItemWithTheScout', async () => {
    await save();
    const x = (await keepScoutFood(ID)).id!;
    const { data } = await admin.from('mm_recipes').select('author_person_id, food_ingredient_id').eq('id', ID).single();
    const { data: lines } = await admin.from('mm_recipe_lines').select('ingredient_id').eq('recipe_id', ID);
    expect({ author: data!.author_person_id, tied: data!.food_ingredient_id, line: lines!.map((l) => l.ingredient_id) }).toEqual({ author: SCOUT, tied: null, line: [x] });
  });

  it('Keep_SaysWhatHappened_InWords', async () => {
    await save();
    const res = await keepScoutFood(ID);
    expect(res.note).toMatch(/Kept .*Vitest scoutfood cocoa.* for the troop and put it on the menu/);
  });

  it('Keep_LeavesTheScoutFoodList', async () => {
    await save();
    await keepScoutFood(ID);
    expect((await listScoutFoodsWith(admin, owners)).some((f) => f.id === ID)).toBe(false);
  });

  it('Keep_WithNoMealOnTheScoutsItem_KeepsTheIngredientAndSaysWhatIsLeft', async () => {
    await save({ meal: [] });
    const res = await keepScoutFood(ID);
    const x = res.id!;
    const { data: item } = await admin.from('mm_recipes').select('id').eq('food_ingredient_id', x);
    expect({ ok: res.ok, items: item!.length, note: res.note }).toMatchObject({ ok: true, items: 0, note: expect.stringMatching(/not on the menu yet.*Put it on the menu by itself/) });
  });

  it('Keep_OfAnItemThatIsNotWaiting_IsRefused', async () => {
    expect((await keepScoutFood('S-0000b0ff')).ok).toBe(false);
  });
});
