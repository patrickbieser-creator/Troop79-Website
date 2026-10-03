import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  deleteScoutDraftWith,
  listSharedScoutRecipesWith,
  setScoutRecipeCreditWith,
  listMyRecipesWith,
  loadMyRecipeWith,
  saveScoutRecipeWith,
  shareScoutRecipeWith
} from '../src/lib/menu-monster/scout-recipes-store';
import type { ScoutRecipeDraft } from '../src/lib/menu-monster/scout-recipes';

/**
 * Phase 4A scout-recipe store against local Postgres: save / share / delete-draft
 * outcomes, the frozen credit from `people`, and the audit rows. Recipe rows are
 * created through the store (random S- ids) and removed by author after each test.
 */
const SCOUT = 39;
const OTHER = 25;
const sb = adminClient();
const actor = { personId: SCOUT, label: 'Charlie W.' };
const other = { personId: OTHER, label: 'Jack P.' };
let ING = '';
const made: string[] = [];
const menus: string[] = [];

beforeAll(async () => {
  const { data } = await sb.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
  ING = data!.id as string;
});

afterEach(async () => {
  if (menus.length) await sb.from('mm_menus').delete().in('id', menus.splice(0));
  if (made.length) {
    const ids = made.splice(0);
    await sb.from('audit_log').delete().eq('entity_type', 'scout_recipe').in('entity_id', ids);
    await sb.from('mm_recipe_lines').delete().in('recipe_id', ids);
    await sb.from('mm_recipes').delete().in('id', ids);
  }
});

const draft = (over: Partial<ScoutRecipeDraft> = {}): ScoutRecipeDraft => ({
  id: null,
  name: 'Vitest foil packs',
  mealFit: ['dinner'],
  foodGroups: ['protein'],
  steps: ['Wrap.', 'Bake.'],
  lines: [{ ingredientId: ING, qtyPerPerson: 1, unitKey: null }],
  originRecipeId: null,
  newIngredients: [],
  equipment: [],
  ...over
});

async function create(over: Partial<ScoutRecipeDraft> = {}) {
  const res = await saveScoutRecipeWith(sb, actor, draft(over), null);
  if (res.status !== 'saved') throw new Error(`fixture: ${res.status}`);
  made.push(res.id);
  return res;
}

describe('scout recipe store', () => {
  it('Scout_CanSaveDraftRecipe_WhenVerifiedScoutSession', async () => {
    const res = await create();
    expect((await listMyRecipesWith(sb, SCOUT)).find((r) => r.id === res.id)?.status).toBe('draft');
  });

  it('SavedRecipe_LoadsBackForItsAuthor', async () => {
    const res = await create();
    const stored = await loadMyRecipeWith(sb, SCOUT, res.id);
    expect(stored?.recipe).toMatchObject({ name: 'Vitest foil packs', steps: ['Wrap.', 'Bake.'], lines: [{ ingredientId: ING, qtyPerPerson: 1, unitKey: null }] });
  });

  it('OtherScout_CannotLoadTheRecipe', async () => {
    const res = await create();
    expect(await loadMyRecipeWith(sb, OTHER, res.id)).toBeNull();
  });

  it('OtherScout_CannotSaveOverTheRecipe', async () => {
    const res = await create();
    const out = await saveScoutRecipeWith(sb, other, draft({ id: res.id, name: 'Taken' }), res.updatedAt);
    expect(out.status).toBe('not_found');
  });

  it('Save_IsAConflict_WhenTheVersionIsOld', async () => {
    const res = await create();
    await saveScoutRecipeWith(sb, actor, draft({ id: res.id, name: 'Second' }), res.updatedAt);
    const out = await saveScoutRecipeWith(sb, actor, draft({ id: res.id, name: 'Third' }), res.updatedAt);
    expect(out.status).toBe('conflict');
  });

  it('Share_FreezesTheCreditFromPeople', async () => {
    const res = await create();
    const out = await shareScoutRecipeWith(sb, actor, res.id);
    const { data: p } = await sb.from('people').select('first_name, last_name').eq('id', SCOUT).single();
    expect(out).toEqual({ status: 'shared', credit: `${p!.first_name} ${String(p!.last_name).charAt(0)}.` });
  });

  it('Share_IsNotReady_WithoutAMeal', async () => {
    const res = await create({ mealFit: [] });
    expect((await shareScoutRecipeWith(sb, actor, res.id)).status).toBe('not_ready');
  });

  it('Save_WritesAnAuditRowAsTheScout', async () => {
    const res = await create();
    const { data } = await sb.from('audit_log').select('area, action').eq('entity_type', 'scout_recipe').eq('entity_id', res.id);
    expect(data).toEqual([{ area: 'library', action: 'create' }]);
  });

  it('Draft_CanBeDeleted_ByItsAuthor', async () => {
    const res = await create();
    expect((await deleteScoutDraftWith(sb, actor, res.id)).status).toBe('deleted');
  });

  it('Draft_CannotBeDeleted_WhileAMenuUsesIt', async () => {
    const res = await create();
    const { data: menu } = await sb
      .from('mm_menus')
      .insert({ owner_person_id: SCOUT, name: 'vitest recipe menu', headcount: 8, meals: [{ id: 'm1', day: 0, slot: 'dinner', headcount: null, recipeIds: [res.id], recipeEdits: {} }] })
      .select('id')
      .single();
    menus.push(menu!.id as string);
    expect((await deleteScoutDraftWith(sb, actor, res.id)).status).toBe('in_use');
  });

  it('SharedRecipe_CannotBeDeleted', async () => {
    const res = await create();
    await shareScoutRecipeWith(sb, actor, res.id);
    expect((await deleteScoutDraftWith(sb, actor, res.id)).status).toBe('shared');
  });

  it('OtherScout_CannotDeleteTheDraft', async () => {
    const res = await create();
    expect((await deleteScoutDraftWith(sb, other, res.id)).status).toBe('not_found');
  });
});

describe('shared scout recipes for leaders', () => {
  it('Leader_SeesSharedRecipes_WithTheirCredit', async () => {
    const res = await create();
    await shareScoutRecipeWith(sb, actor, res.id);
    const row = (await listSharedScoutRecipesWith(sb)).find((r) => r.id === res.id);
    expect(row).toMatchObject({ name: 'Vitest foil packs', status: 'published', editedSinceShared: false });
  });

  it('Leader_DoesNotSeeUnsharedDrafts', async () => {
    const res = await create();
    expect((await listSharedScoutRecipesWith(sb)).some((r) => r.id === res.id)).toBe(false);
  });

  it('SharedRecipe_IsMarkedEdited_WhenTheAuthorChangesItAfterSharing', async () => {
    const res = await create();
    await shareScoutRecipeWith(sb, actor, res.id);
    const { data: v } = await sb.from('mm_recipes').select('updated_at').eq('id', res.id).single();
    await new Promise((r) => setTimeout(r, 1100));
    await saveScoutRecipeWith(sb, actor, draft({ id: res.id, name: 'Edited' }), v!.updated_at as string);
    expect((await listSharedScoutRecipesWith(sb)).find((r) => r.id === res.id)?.editedSinceShared).toBe(true);
  });

  it('Leader_CanChangeTheCredit', async () => {
    const res = await create();
    await shareScoutRecipeWith(sb, actor, res.id);
    await setScoutRecipeCreditWith(sb, res.id, 'Charlie W. and Jack P.');
    expect((await listSharedScoutRecipesWith(sb)).find((r) => r.id === res.id)?.credit).toBe('Charlie W. and Jack P.');
  });
});

describe('gear (Phase 4C)', () => {
  it('Gear_IsSavedAndLoadedBack', async () => {
    const res = await create({ equipment: ['Dutch oven', 'Tongs'] });
    expect((await loadMyRecipeWith(sb, SCOUT, res.id))?.recipe.equipment).toEqual(['Dutch oven', 'Tongs']);
  });
});
