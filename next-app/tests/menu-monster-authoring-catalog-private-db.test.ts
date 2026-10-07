import { describe, it, expect, afterEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * A scout's private draft (an unshared single food with a typed-in ingredient) must open in the leader recipe
 * editor — leaders have full rights on any scout recipe (D-327/D-330) — without every other recipe's picker
 * starting to offer the scout's private typed-ins. The authoring catalog adds that one recipe and the typed-ins
 * its lines use only when asked for it by id. Scout recipes are S-0000b1** ids; x- ingredients are removed after.
 */
const SCOUT = 39;
const ID = 'S-0000b101';
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

import { loadAuthoringCatalogWith } from '../src/lib/menu-monster/catalog';
import { saveRecipe, setRecipeStatus, duplicateRecipe } from '../src/app/admin/(workspace)/library/menu-monster/actions';

afterEach(async () => {
  await admin.from('mm_recipe_lines').delete().like('recipe_id', 'S-0000b1%');
  await admin.from('mm_recipes').delete().like('id', 'S-0000b1%');
  const { data: made } = await admin.from('mm_ingredients').select('id').ilike('name', 'Vitest privdraft%');
  const ids = ((made ?? []) as { id: string }[]).map((i) => i.id);
  if (ids.length) {
    await admin.from('mm_recipe_lines').delete().in('ingredient_id', ids);
    await admin.from('mm_ingredients').delete().in('id', ids);
  }
});

async function saveDraft(): Promise<string> {
  const { data, error } = await admin.rpc('mm_save_scout_recipe', {
    p_person: SCOUT,
    p_recipe: { id: ID, name: 'Vitest privdraft cocoa', meal_fit: ['snack'], food_groups: [], steps_md: '' },
    p_lines: [{ ingredient_id: 'new:0000b1b1', qty_per_person: 2 }],
    p_expected_updated_at: null,
    p_new_ingredients: [{ key: 'new:0000b1b1', name: 'Vitest privdraft cocoa', kind: 'count', unit_one: 'packet', unit_many: 'packets', avoid: [], section: 'dry', package: null }]
  });
  expect(error).toBeNull();
  return (data as { ids: Record<string, string> }).ids['new:0000b1b1'];
}

describe('authoring catalog and a scout private draft', () => {
  it('Catalog_IncludesAScoutsPrivateDraft_AndItsTypedIns_WhenAskedForThatRecipe', async () => {
    const x = await saveDraft();
    const cat = await loadAuthoringCatalogWith(admin, { forRecipe: ID });
    const recipe = cat.recipes.find((r) => r.id === ID);
    expect({ recipe: recipe?.lines.map((l) => l.ingredientId), ingredient: cat.ingredients.find((i) => i.id === x)?.name, needsMatch: cat.ingredients.find((i) => i.id === x)?.needsMatch }).toEqual({
      recipe: [x],
      ingredient: 'Vitest privdraft cocoa',
      needsMatch: true
    });
  });

  it('Catalog_StillHidesPrivateDrafts_ByDefault', async () => {
    const x = await saveDraft();
    const cat = await loadAuthoringCatalogWith(admin);
    expect({ recipe: cat.recipes.some((r) => r.id === ID), ingredient: cat.ingredients.some((i) => i.id === x) }).toEqual({ recipe: false, ingredient: false });
  });

  it('Catalog_AskedForOneDraft_DoesNotOfferItsTypedInsToOtherwiseUnrelatedAsks', async () => {
    const x = await saveDraft();
    const cat = await loadAuthoringCatalogWith(admin, { forRecipe: 'no-such-recipe' });
    expect(cat.ingredients.some((i) => i.id === x)).toBe(false);
  });

  it('Leader_SavesAScoutsPrivateDraft_AndTheScoutKeepsIt', async () => {
    const x = await saveDraft();
    const res = await saveRecipe({
      id: ID,
      name: 'Vitest privdraft cocoa',
      mealFit: ['snack'],
      foodGroups: [],
      camp: true,
      trail: false,
      method: null,
      stepsMd: 'Stir.',
      base: [{ ingredientId: x, amount: '3', unitKey: null }],
      variations: []
    } as unknown as Parameters<typeof saveRecipe>[0]);
    const { data } = await admin.from('mm_recipes').select('author_person_id, shared_at, steps_md').eq('id', ID).single();
    expect({ ok: res.ok, author: data?.author_person_id, shared: data?.shared_at, steps: data?.steps_md }).toEqual({ ok: true, author: SCOUT, shared: null, steps: 'Stir.' });
  });

  it('Leader_RetiresAndDuplicates_AScoutsPrivateDraft', async () => {
    await saveDraft();
    const retired = await setRecipeStatus(ID, 'retired');
    const restored = await setRecipeStatus(ID, 'draft');
    const copy = await duplicateRecipe(ID);
    const { data: orig } = await admin.from('mm_recipes').select('author_person_id, shared_at, status').eq('id', ID).single();
    const { data: dup } = await admin.from('mm_recipes').select('author_person_id, status').eq('id', copy.id ?? '').single();
    if (copy.id) {
      await admin.from('mm_recipe_lines').delete().eq('recipe_id', copy.id);
      await admin.from('mm_recipes').delete().eq('id', copy.id);
    }
    expect({ retired: retired.ok, restored: restored.ok, copy: copy.ok, orig, dup }).toEqual({
      retired: true,
      restored: true,
      copy: true,
      orig: { author_person_id: SCOUT, shared_at: null, status: 'draft' },
      dup: { author_person_id: null, status: 'draft' }
    });
  });
});
