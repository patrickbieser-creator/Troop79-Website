import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Phase 4A scout recipes (20261003150000_mm_scout_recipes.sql): mm_save_scout_recipe
 * and mm_share_scout_recipe — ownership, the lost-update guard, retired refusal,
 * text checks, the frozen credit and the id/author constraints. Every test row
 * is an S-0000aa** id, removed after each test.
 */
const SCOUT = 39;
const OTHER = 25;
const ID = 'S-0000aa01';
const ID2 = 'S-0000aa02';
const admin = adminClient();
let ING = '';

beforeAll(async () => {
  const { data } = await admin.from('mm_ingredients').select('id').is('retired_at', null).limit(1).single();
  ING = data!.id as string;
});

afterEach(async () => {
  await admin.from('mm_recipe_lines').delete().like('recipe_id', 'S-0000aa%');
  await admin.from('mm_recipes').delete().like('id', 'S-0000aa%');
});

const recipe = (over: Record<string, unknown> = {}) => ({ id: ID, name: 'Vitest chili', meal_fit: ['dinner'], food_groups: ['protein'], steps_md: 'Brown it.\nSimmer.', ...over });
const lines = () => [{ ingredient_id: ING, qty_per_person: 0.5, unit_key: null }];

async function save(person: number, r = recipe(), l: unknown[] = lines(), expected: string | null = null) {
  return admin.rpc('mm_save_scout_recipe', { p_person: person, p_recipe: r, p_lines: l, p_expected_updated_at: expected });
}
async function share(person: number, id = ID, label = 'Charlie W.') {
  return admin.rpc('mm_share_scout_recipe', { p_person: person, p_id: id, p_label: label });
}
async function row(id = ID) {
  const { data } = await admin.from('mm_recipes').select('*').eq('id', id).maybeSingle();
  return data;
}

describe('mm_save_scout_recipe', () => {
  it('Scout_CanSaveDraftRecipe_AsTheAuthor', async () => {
    const { error } = await save(SCOUT);
    expect(error).toBeNull();
    expect(await row()).toMatchObject({ status: 'draft', author_person_id: SCOUT, attribution_label: null, shared_at: null });
  });

  it('Save_WritesEveryoneLines_InOrder', async () => {
    await save(SCOUT);
    const { data } = await admin.from('mm_recipe_lines').select('ingredient_id, serves_rule, position').eq('recipe_id', ID);
    expect(data).toEqual([{ ingredient_id: ING, serves_rule: 'everyone', position: 1 }]);
  });

  it('Scout_CannotEditAnotherScoutsRecipe', async () => {
    const first = await save(SCOUT);
    const { error } = await save(OTHER, recipe({ name: 'Mine now' }), lines(), first.data as string);
    expect(error?.message).toContain('MM_NOT_YOURS');
  });

  it('Save_IsRefused_WhenTheRecipeChangedSinceItWasLoaded', async () => {
    await save(SCOUT);
    const { error } = await save(SCOUT, recipe({ name: 'Second' }), lines(), '2020-01-01T00:00:00Z');
    expect(error?.message).toContain('MM_STALE');
  });

  it('Save_Updates_WhenTheVersionMatches', async () => {
    const first = await save(SCOUT);
    const { error } = await save(SCOUT, recipe({ name: 'Second' }), lines(), first.data as string);
    expect(error).toBeNull();
    expect((await row())?.name).toBe('Second');
  });

  it('Scout_CannotEditRetiredRecipe', async () => {
    const first = await save(SCOUT);
    await admin.from('mm_recipes').update({ status: 'retired' }).eq('id', ID);
    const { error } = await save(SCOUT, recipe(), lines(), first.data as string);
    expect(error?.message).toContain('MM_RETIRED');
  });

  it('Save_RefusesALink_InTheSteps', async () => {
    const { error } = await save(SCOUT, recipe({ steps_md: 'See https://example.com' }));
    expect(error?.message).toContain('MM_BAD_TEXT');
  });

  it('Save_RefusesAControlCharacter_InTheName', async () => {
    const { error } = await save(SCOUT, recipe({ name: 'Chili\u0007' }));
    expect(error?.message).toContain('MM_BAD_TEXT');
  });

  it('Save_RefusesARetiredIngredient', async () => {
    const { error } = await save(SCOUT, recipe(), [{ ingredient_id: 'vitest-no-such-ingredient', qty_per_person: 1 }]);
    expect(error?.message).toContain('MM_BAD_INGREDIENT');
  });

  it('Save_RefusesALeaderStyleId', async () => {
    const { error } = await save(SCOUT, recipe({ id: 'B999' }));
    expect(error?.message).toContain('MM_BAD_RECIPE_ID');
  });

  it('Save_NeverChangesStatusOrCredit_OnASharedRecipe', async () => {
    const first = await save(SCOUT);
    const shared = await share(SCOUT);
    expect(shared.error).toBeNull();
    const { data: v } = await admin.from('mm_recipes').select('updated_at').eq('id', ID).single();
    await save(SCOUT, recipe({ name: 'Edited after sharing', status: 'draft' }), lines(), v!.updated_at as string);
    expect(first.error).toBeNull();
    expect(await row()).toMatchObject({ name: 'Edited after sharing', status: 'published', attribution_label: 'Charlie W.' });
  });
});

describe('mm_share_scout_recipe', () => {
  it('SharedRecipe_IsLiveImmediately_WithFrozenCredit', async () => {
    await save(SCOUT);
    await share(SCOUT);
    const r = await row();
    expect(r).toMatchObject({ status: 'published', attribution_label: 'Charlie W.' });
    expect(r?.shared_at).not.toBeNull();
  });

  it('Share_KeepsTheFirstCredit_WhenSharedAgain', async () => {
    await save(SCOUT);
    await share(SCOUT);
    await share(SCOUT, ID, 'Someone Else');
    expect((await row())?.attribution_label).toBe('Charlie W.');
  });

  it('Scout_CannotShareAnotherScoutsRecipe', async () => {
    await save(SCOUT);
    const { error } = await share(OTHER);
    expect(error?.message).toContain('MM_NOT_YOURS');
  });

  it('Share_IsRefused_WithNoIngredients', async () => {
    await save(SCOUT, recipe(), []);
    const { error } = await share(SCOUT);
    expect(error?.message).toContain('MM_NOT_READY');
  });
});

describe('mm_recipes scout constraints', () => {
  it('ScoutId_WithoutAnAuthor_IsRefused', async () => {
    const { error } = await admin.from('mm_recipes').insert({ id: ID2, name: 'x', status: 'draft' });
    expect(error).not.toBeNull();
  });

  it('LeaderPublish_OfAScoutDraft_IsRefused_WithoutACredit', async () => {
    await save(SCOUT);
    const { error } = await admin.from('mm_recipes').update({ status: 'published' }).eq('id', ID);
    expect(error).not.toBeNull();
  });
});
