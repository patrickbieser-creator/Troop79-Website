import { describe, it, expect, afterEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * A single food is one entry — the leader actions (Plans/Menu-Monster-Single-Food-Entry.md, release 1). The
 * one-step New food form ties its menu item to its food; retiring the food takes the item off the menu
 * instead of being refused by it; a rename typed in the editor reaches the food. Session and audit are
 * stubbed; the database is the real local one. Rows are `Vitest onefood …` and removed after each test.
 */
const admin = adminClient();
const NAME = 'Vitest onefood cookies';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => ({ personId: null, label: 'Vitest leader' }) }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => ({ kind: 'identity', label: 'Vitest leader', personId: null, capabilities: new Set(['library.moderate']) }) }));
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}), recordAuditAs: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { createFood, duplicateRecipe, putFoodOnMenu, retireIngredient, saveRecipe, takeFoodOffMenu, type FoodInput } from '../src/app/admin/(workspace)/library/menu-monster/actions';

const food = (over: Partial<FoodInput> = {}): FoodInput => ({
  ingredient: { name: NAME, unit: { kind: 'count', key: 'count', one: 'cookie', many: 'cookies' }, section: 'dry', staple: false, avoid: [] },
  package: { name: 'Vitest onefood box', store: null, price: 4, holds: 24, asOf: '2026-10-01' },
  menu: { amount: '2', mealFit: ['snack'], foodGroups: [] },
  ...over
});

async function rows() {
  const { data: ings } = await admin.from('mm_ingredients').select('id, name, retired_at').ilike('name', 'Vitest onefood%');
  const ids = ((ings ?? []) as { id: string }[]).map((i) => i.id);
  const { data: recs } = ids.length
    ? await admin.from('mm_recipes').select('id, name, status, food_ingredient_id').or(`food_ingredient_id.in.(${ids.join(',')}),name.ilike.Vitest onefood%`)
    : { data: [] };
  return { ings: (ings ?? []) as { id: string; name: string; retired_at: string | null }[], recs: (recs ?? []) as { id: string; name: string; status: string; food_ingredient_id: string | null }[] };
}

afterEach(async () => {
  const { ings, recs } = await rows();
  const recIds = recs.map((r) => r.id);
  const ingIds = ings.map((i) => i.id);
  if (recIds.length) {
    await admin.from('mm_recipe_lines').delete().in('recipe_id', recIds);
    await admin.from('mm_recipes').delete().in('id', recIds);
  }
  if (ingIds.length) {
    await admin.from('mm_recipe_lines').delete().in('ingredient_id', ingIds);
    await admin.from('mm_conversions').delete().in('ingredient_id', ingIds);
    await admin.from('mm_packages').delete().in('ingredient_id', ingIds);
    await admin.from('mm_ingredients').delete().in('id', ingIds);
  }
});

describe('one entry for a single food', () => {
  it('Leader_CreatesAFoodInOneForm_AndTheTwoRowsAreTied', async () => {
    const res = await createFood(food());
    expect(res.ok).toBe(true);
    const { ings, recs } = await rows();
    expect(recs).toEqual([{ id: res.recipeId, name: NAME, status: 'published', food_ingredient_id: ings[0].id }]);
  });

  it('Leader_AddsAFoodForRecipesOnly_AndNothingGoesOnTheMenu', async () => {
    // Salt and flour: in the Price book, not a menu choice.
    await createFood(food({ menu: null }));
    expect((await rows()).recs).toEqual([]);
  });

  it('Leader_RenamesASingleFoodInTheEditor_AndTheFoodFollows', async () => {
    const made = await createFood(food());
    const { ings } = await rows();
    const res = await saveRecipe({
      id: made.recipeId as string, name: 'Vitest onefood biscuits', status: 'published', mealFit: ['snack'], foodGroups: [], camp: true, trail: false,
      method: 'no-cook', stepsMd: '', base: [{ ingredientId: ings[0].id, amount: '2', unitKey: null }], variations: []
    });
    expect(res.ok).toBe(true);
    const after = await rows();
    expect(after.ings[0].name).toBe('Vitest onefood biscuits');
    expect(after.recs[0]).toMatchObject({ name: 'Vitest onefood biscuits', food_ingredient_id: ings[0].id });
  });

  it('Leader_CannotRenameASingleFood_ToANameAnotherFoodHas', async () => {
    const made = await createFood(food());
    const { ings } = await rows();
    const { data: other } = await admin.from('mm_ingredients').select('name').is('retired_at', null).is('added_by_person_id', null).neq('id', ings[0].id).limit(1).single();
    const taken = (other as { name: string }).name;
    const res = await saveRecipe({
      id: made.recipeId as string, name: taken.toUpperCase(), status: 'published', mealFit: ['snack'], foodGroups: [], camp: true, trail: false,
      method: 'no-cook', stepsMd: '', base: [{ ingredientId: ings[0].id, amount: '2', unitKey: null }], variations: []
    });
    expect(res).toEqual({ ok: false, error: `“${taken}” is already in the price book. Pick another name.` });
    expect((await rows()).ings[0].name).toBe(NAME);
  });

  it('CopyingASingleFood_MakesAnOrdinaryItem_NotASecondOneTiedToTheFood', async () => {
    const made = await createFood(food());
    const copy = await duplicateRecipe(made.recipeId as string);
    expect(copy.ok).toBe(true);
    const { data } = await admin.from('mm_recipes').select('food_ingredient_id').eq('id', copy.id as string).single();
    expect((data as { food_ingredient_id: string | null }).food_ingredient_id).toBeNull();
    await admin.from('mm_recipe_lines').delete().eq('recipe_id', copy.id as string);
    await admin.from('mm_recipes').delete().eq('id', copy.id as string);
  });

  it('Leader_RetiresTheFood_AndItComesOffTheMenuWithIt', async () => {
    await createFood(food());
    const { ings } = await rows();
    // Its own menu item used to block this ("Still used by …").
    expect(await retireIngredient(ings[0].id)).toEqual({ ok: true });
    const after = await rows();
    expect(after.ings[0].retired_at).not.toBeNull();
    expect(after.recs[0].status).toBe('retired');
  });

  it('Leader_PutsAFoodOnTheMenuByItself_FromThePriceBook', async () => {
    const made = await createFood(food({ menu: null }));
    const res = await putFoodOnMenu(made.id as string, { amount: '2', mealFit: ['snack'], foodGroups: [] });
    expect(res.ok).toBe(true);
    expect((await rows()).recs).toEqual([{ id: res.recipeId, name: NAME, status: 'published', food_ingredient_id: made.id }]);
  });

  it('Leader_TakesAFoodOffTheMenu_AndTheFoodStays', async () => {
    const made = await createFood(food());
    expect((await takeFoodOffMenu(made.id as string)).ok).toBe(true);
    const after = await rows();
    expect(after.recs[0].status).toBe('retired');
    expect(after.ings[0].retired_at).toBeNull();
  });

  it('PuttingItBack_RestoresTheSameMenuItem_NotASecondOne', async () => {
    const made = await createFood(food());
    await takeFoodOffMenu(made.id as string);
    const res = await putFoodOnMenu(made.id as string, { amount: '3', mealFit: ['dessert'], foodGroups: [] });
    expect(res.ok).toBe(true);
    const after = await rows();
    expect(after.recs).toHaveLength(1);
    expect(after.recs[0]).toMatchObject({ id: made.recipeId, status: 'published' });
  });

  it('AFoodWithNoPrice_GoesOnAsADraft_AndSaysWhy', async () => {
    const made = await createFood(food({ menu: null, package: null }));
    const res = await putFoodOnMenu(made.id as string, { amount: '2', mealFit: ['snack'], foodGroups: [] });
    expect(res.ok).toBe(true);
    expect(res.note).toMatch(/saved as a draft/);
    expect((await rows()).recs[0].status).toBe('draft');
  });

  it('Leader_CannotRetireAFood_StillUsedInARealRecipe', async () => {
    const made = await createFood(food({ menu: null }));
    const dish = await saveRecipe({
      id: '', name: 'Vitest onefood sundae', status: 'draft', mealFit: ['dessert'], foodGroups: [], camp: true, trail: false,
      method: 'no-cook', stepsMd: '', base: [{ ingredientId: made.id as string, amount: '1', unitKey: null }], variations: []
    });
    expect(dish.ok).toBe(true);
    const res = await retireIngredient(made.id as string);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Still used by Vitest onefood sundae/);
  });

  it('Leader_AddsASecondIngredient_AndItBecomesARecipe_WhileTheFoodStays', async () => {
    const made = await createFood(food());
    const { ings } = await rows();
    const { data: other } = await admin.from('mm_ingredients').select('id').is('retired_at', null).is('added_by_person_id', null).neq('id', ings[0].id).limit(1).single();
    const res = await saveRecipe({
      id: made.recipeId as string, name: 'Vitest onefood cookies and more', status: 'published', mealFit: ['snack'], foodGroups: [], camp: true, trail: false,
      method: 'no-cook', stepsMd: '',
      base: [
        { ingredientId: ings[0].id, amount: '2', unitKey: null },
        { ingredientId: (other as { id: string }).id, amount: '1', unitKey: null }
      ],
      variations: [], foodIngredientId: ings[0].id
    });
    expect(res.ok).toBe(true);
    const after = await rows();
    expect(after.recs[0]).toMatchObject({ name: 'Vitest onefood cookies and more', food_ingredient_id: null });
    expect(after.ings[0]).toMatchObject({ name: NAME, retired_at: null });
  });
});
