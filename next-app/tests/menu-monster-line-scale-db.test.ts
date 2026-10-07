import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadMyRecipeWith, saveScoutRecipeWith, shareScoutRecipeWith } from '../src/lib/menu-monster/scout-recipes-store';
import { versionDraft, type ScoutRecipeDraft } from '../src/lib/menu-monster/scout-recipes';
import type { Recipe } from '../src/lib/menu-monster/types';

/**
 * A recipe line can be for the whole meal (migration 20261026100000): mm_recipe_lines.scale is 'person'
 * (default) or 'meal', written by BOTH save RPCs and kept through sharing. Local Postgres.
 */
const SCOUT = 39;
const sb = adminClient();
const actor = { personId: SCOUT, label: 'Charlie W.' };
const TROOP = 'vitest-scale-troop';
let ING = '';
let ING2 = '';
const made: string[] = [];

beforeAll(async () => {
  const { data } = await sb.from('mm_ingredients').select('id').is('retired_at', null).is('added_by_person_id', null).limit(2);
  ING = data![0].id as string;
  ING2 = data![1].id as string;
});

afterEach(async () => {
  const ids = [...made.splice(0), TROOP];
  await sb.from('audit_log').delete().eq('entity_type', 'scout_recipe').in('entity_id', ids);
  await sb.from('mm_recipe_lines').delete().in('recipe_id', ids);
  await sb.from('mm_recipes').delete().in('id', ids);
});

const draft = (lines: ScoutRecipeDraft['lines']): ScoutRecipeDraft => ({
  id: null, name: 'Vitest potato pancakes', mealFit: ['dinner'], foodGroups: ['protein'], steps: ['Fry.'], lines,
  originRecipeId: null, newIngredients: [], equipment: []
});
async function create(lines: ScoutRecipeDraft['lines']) {
  const res = await saveScoutRecipeWith(sb, actor, draft(lines), null);
  if (res.status !== 'saved') throw new Error(`fixture: ${res.status}`);
  made.push(res.id);
  return res;
}
const scaleOf = async (recipe: string) => {
  const { data } = await sb.from('mm_recipe_lines').select('ingredient_id, scale').eq('recipe_id', recipe).order('position');
  return (data ?? []).map((l) => [l.ingredient_id, l.scale]);
};

describe('line scale', () => {
  it('ScoutRecipe_SavesAndLoads_AFixedLine', async () => {
    const res = await create([
      { ingredientId: ING, qtyPerPerson: 4, unitKey: null, scale: 'meal' },
      { ingredientId: ING2, qtyPerPerson: 1, unitKey: null }
    ]);
    expect(await scaleOf(res.id)).toEqual([[ING, 'meal'], [ING2, 'person']]);
    const stored = await loadMyRecipeWith(sb, SCOUT, res.id);
    expect(stored?.recipe.lines.map((l) => l.scale ?? 'person')).toEqual(['meal', 'person']);
  });

  it('TroopRecipe_SavesAndLoads_AFixedLine', async () => {
    const line = (ingredient_id: string, qty: number, extra: Record<string, unknown> = {}) => ({
      ingredient_id, qty_per_person: qty, unit_key: null, serves_rule: 'everyone', serves_restrictions: [] as string[], ...extra
    });
    const { error } = await sb.rpc('mm_save_recipe', {
      p_recipe: { id: TROOP, name: 'Vitest troop pancakes', status: 'draft', meal_fit: ['dinner'], food_groups: [], camp: true, trail: false, method: 'stove', steps_md: null, sort_order: 9990 },
      p_lines: [line(ING, 4, { scale: 'meal' }), line(ING2, 1)],
      p_variations: []
    });
    expect(error).toBeNull();
    // An older caller that sends no scale writes per person.
    expect(await scaleOf(TROOP)).toEqual([[ING, 'meal'], [ING2, 'person']]);
  });

  it('ShareThisVersion_KeepsScale', () => {
    const troop: Recipe = {
      id: 'T1', name: 'Potato pancakes', status: 'published', mealFit: ['dinner'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: null, sortOrder: 1,
      lines: [
        { ingredientId: ING, qtyPerPerson: 4, unitKey: null, scale: 'meal', servesRule: 'everyone', servesRestrictions: [] },
        { ingredientId: ING2, qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }
      ]
    };
    expect(versionDraft(troop, []).lines.map((l) => l.scale ?? 'person')).toEqual(['meal', 'person']);
  });

  it('SharingAScoutRecipe_KeepsScale', async () => {
    const res = await create([{ ingredientId: ING, qtyPerPerson: 4, unitKey: null, scale: 'meal' }]);
    expect((await shareScoutRecipeWith(sb, actor, res.id)).status).toBe('shared');
    expect(await scaleOf(res.id)).toEqual([[ING, 'meal']]);
  });
});
