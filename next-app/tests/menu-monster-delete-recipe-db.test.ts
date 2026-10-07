import { describe, it, expect, afterEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Deleting a troop recipe (2026-10-06): mm_delete_recipe removes the row and its dependents in one step, and
 * refuses a recipe a saved menu still uses, a single food tied to its ingredient, and a scout's recipe. Session
 * is stubbed and the audit call is captured; the database is the real local one. Rows are `Vitest delrec …`.
 */
const admin = adminClient();
const audit = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => ({ personId: null, label: 'Vitest leader' }) }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => ({ kind: 'identity', label: 'Vitest leader', personId: null, capabilities: new Set(['library.moderate']) }) }));
vi.mock('@/lib/audit', () => ({ recordAudit: audit, recordAuditAs: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { deleteRecipe } from '../src/app/admin/(workspace)/library/menu-monster/actions';
import { menusUsingRecipeWith } from '../src/lib/menu-monster/recipe-delete-store';

const REC = 'vitest-delrec-a';
const TIED = 'vitest-delrec-tied';
const ING = 'vitest-delrec-ing';
const MENU_NAME = 'Vitest delrec menu';
let ownerId: number | null = null;

async function seed(id: string, over: Record<string, unknown> = {}) {
  const { error } = await admin.from('mm_recipes').insert({ id, name: `Vitest delrec ${id}`, status: 'draft', meal_fit: ['breakfast'], food_groups: ['grain'], ...over });
  if (error) throw new Error(error.message);
  const line = await admin.from('mm_recipe_lines').insert({ recipe_id: id, position: 0, ingredient_id: ING, qty_per_person: 1 });
  if (line.error) throw new Error(line.error.message);
}

async function seedIngredient() {
  const { error } = await admin.from('mm_ingredients').insert({ id: ING, name: 'Vitest delrec ingredient', unit_kind: 'count', unit_key: 'count', unit_one: 'thing', unit_many: 'things', section: 'dry' });
  if (error) throw new Error(`ingredient: ${error.message}`);
}

const count = async (table: string, col: string, id: string) => (await admin.from(table).select('*', { count: 'exact', head: true }).eq(col, id)).count ?? 0;

afterEach(async () => {
  audit.mockClear();
  await admin.from('mm_menus').delete().eq('name', MENU_NAME);
  for (const id of [REC, TIED]) {
    await admin.from('mm_recipe_variations').delete().eq('recipe_id', id);
    await admin.from('mm_recipe_lines').delete().eq('recipe_id', id);
    await admin.from('mm_recipes').delete().eq('id', id);
  }
  await admin.from('mm_ingredients').delete().eq('id', ING);
});

describe('deleting a recipe', () => {
  it('Leader_DeletesARecipe_AndItsLinesAndVariationsGoWithIt', async () => {
    await seedIngredient();
    await seed(REC);
    await admin.from('mm_recipe_variations').insert({ recipe_id: REC, restriction: 'gf', state: 'nothing' });
    const res = await deleteRecipe(REC);
    expect(res).toEqual({ ok: true });
    expect([await count('mm_recipes', 'id', REC), await count('mm_recipe_lines', 'recipe_id', REC), await count('mm_recipe_variations', 'recipe_id', REC)]).toEqual([0, 0, 0]);
  });

  it('Leader_DeletingARecipe_WritesOneAuditRow', async () => {
    await seedIngredient();
    await seed(REC);
    await deleteRecipe(REC);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', entityType: 'mm_recipe', entityId: REC }));
  });

  it('Leader_CannotDelete_ARecipeASavedMenuStillUses', async () => {
    await seedIngredient();
    await seed(REC);
    const people = await admin.from('people').select('id').limit(1).single();
    ownerId = (people.data as { id: number }).id;
    const made = await admin.from('mm_menus').insert({ owner_person_id: ownerId, name: MENU_NAME, headcount: 8, meals: [{ id: 'm1', recipeIds: [REC] }] });
    expect(made.error).toBeNull();
    const res = await deleteRecipe(REC);
    expect(res.ok).toBe(false);
    expect(await count('mm_recipes', 'id', REC)).toBe(1);
    expect(audit).not.toHaveBeenCalled();
    expect(await menusUsingRecipeWith(admin, REC)).toEqual({ count: 1, names: [MENU_NAME] });
  });

  it('Leader_CannotDelete_ASingleFoodTiedToItsIngredient', async () => {
    await seedIngredient();
    // The tie is kept by deferred triggers, so it is made the way the app makes it: one save of the item and its line.
    const saved = await admin.rpc('mm_save_recipe', {
      p_recipe: { id: TIED, name: `Vitest delrec ${TIED}`, status: 'draft', meal_fit: ['breakfast'], food_groups: ['grain'], camp: true, trail: false, method: 'none', sort_order: 999, food_ingredient_id: ING },
      p_lines: [{ ingredient_id: ING, qty_per_person: 1, unit_key: null, serves_rule: 'everyone', serves_restrictions: [] }],
      p_variations: []
    });
    expect(saved.error).toBeNull();
    expect((await admin.from('mm_recipes').select('food_ingredient_id').eq('id', TIED).single()).data).toEqual({ food_ingredient_id: ING });
    const res = await deleteRecipe(TIED);
    expect(res.ok).toBe(false);
    expect(await count('mm_recipes', 'id', TIED)).toBe(1);
  });

  it('Leader_DeletingAGoneRecipe_SaysSo', async () => {
    expect(await deleteRecipe('vitest-delrec-nothing')).toEqual({ ok: false, error: 'That menu item is gone.' });
  });
});
