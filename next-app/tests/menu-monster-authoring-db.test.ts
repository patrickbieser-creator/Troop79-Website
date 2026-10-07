import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';

/**
 * Menu Monster leader tools against the local stack
 * (Plans/Menu-Monster-Leader-Tools.md, Test Plan — DB):
 *
 *   1. mm_save_recipe replaces a recipe's lines atomically and a bad line
 *      rolls the whole call back;
 *   2. mm_change_ingredient_unit applies a plan (unit + yields + pinned
 *      lines) in one transaction;
 *   3. neither function is callable with the anon key (D-239 posture);
 *   4. the authoring loader sees drafts and retired rows the public loader
 *      hides — with the status filter now living in the QUERY, not the mapper;
 *   5. the actions enforce the publish gate and the retire-in-use rule on the
 *      server (tech-lead, 2026-09-08).
 *
 * Same request-glue mocks as person-history.test.ts; the DB is real. Every
 * fixture id starts with `zz-mm-` and is removed in afterAll.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['library.moderate']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { loadAuthoringCatalogWith, loadCatalogWith } from '../src/lib/menu-monster/catalog';
import {
  changeIngredientUnit,
  duplicateRecipe,
  retireIngredient,
  saveRecipe,
  setRecipeStatus
} from '../src/app/admin/(workspace)/library/menu-monster/actions';
import { UNITS } from '../src/lib/menu-monster/units';

const admin = adminClient();
const FLOUR = 'zz-mm-flour';
const EGGS = 'zz-mm-eggs';
const MILK = 'zz-mm-milk';
const RECIPE = 'zz-mm-pancakes';
const PKG_BAG = 'p-zz-mm-flour-bag';
const PKG_OLD = 'p-zz-mm-flour-old';
const PKG_EGGS = 'p-zz-mm-eggs-dozen';

async function cleanup() {
  // 'zz-test-%' catches the duplicate, whose id is slugged from the NAME.
  for (const like of ['zz-mm-%', 'zz-test-%']) {
    await admin.from('mm_variation_lines').delete().like('recipe_id', like);
    await admin.from('mm_recipe_variations').delete().like('recipe_id', like);
    await admin.from('mm_recipe_lines').delete().like('recipe_id', like);
    await admin.from('mm_recipes').delete().like('id', like);
  }
  await admin.from('mm_packages').delete().like('id', 'p-zz-mm-%');
  await admin.from('mm_conversions').delete().like('ingredient_id', 'zz-mm-%');
  await admin.from('mm_ingredients').delete().like('id', 'zz-mm-%');
}

beforeAll(async () => {
  await cleanup();
  const { error: e1 } = await admin.from('mm_ingredients').insert([
    { id: FLOUR, name: 'ZZ Flour', unit_kind: 'volume', unit_key: 'cup', unit_one: 'cup', unit_many: 'cups', section: 'dry', staple: false, avoid: ['gf'] },
    { id: EGGS, name: 'ZZ Eggs', unit_kind: 'count', unit_key: 'egg', unit_one: 'egg', unit_many: 'eggs', section: 'dairy', staple: false, avoid: [] },
    { id: MILK, name: 'ZZ Milk', unit_kind: 'volume', unit_key: 'cup', unit_one: 'cup', unit_many: 'cups', section: 'dairy', staple: false, avoid: ['dairy'] }
  ]);
  if (e1) throw new Error(`fixture ingredients: ${e1.message}`);
  const { error: e2 } = await admin.from('mm_packages').insert([
    { id: PKG_BAG, ingredient_id: FLOUR, name: 'ZZ Flour 10 lb', store: 'Costco', price: 15, yield: 36, noun: 'bag', as_of: '2026-09-01' },
    { id: PKG_OLD, ingredient_id: FLOUR, name: 'ZZ Flour old bag', store: 'Kroger', price: 9, yield: 12, noun: 'bag', as_of: '2026-01-01', retired_at: '2026-08-01T00:00:00Z' },
    { id: PKG_EGGS, ingredient_id: EGGS, name: 'ZZ Eggs dozen', store: 'Kroger', price: 2.99, yield: 12, noun: 'dozen', as_of: '2026-09-01' }
  ]);
  if (e2) throw new Error(`fixture packages: ${e2.message}`);
});

afterAll(cleanup);

const line = (ingredient_id: string, qty: number | string, unit_key: string | null = null) => ({
  ingredient_id, qty_per_person: qty, unit_key, serves_rule: 'everyone', serves_restrictions: [] as string[]
});
const recipeJson = (over: Record<string, unknown> = {}) => ({
  id: RECIPE, name: 'ZZ Test Pancakes', status: 'draft', meal_fit: ['breakfast'], food_groups: ['grain'],
  camp: true, trail: false, method: 'stove', steps_md: null, sort_order: 990, ...over
});

async function linesOf(recipeId: string) {
  const { data } = await admin
    .from('mm_recipe_lines')
    .select('position, ingredient_id, qty_per_person, unit_key')
    .eq('recipe_id', recipeId)
    .order('position');
  return (data ?? []) as { position: number; ingredient_id: string; qty_per_person: number; unit_key: string | null }[];
}

describe('menu monster leader tools — RPCs', () => {
  it('Rpc_SaveRecipe_ReplacesLinesAtomically', async () => {
    const first = await admin.rpc('mm_save_recipe', {
      p_recipe: recipeJson(),
      // One base line per ingredient (the unique index); the third line is a GF-only extra.
      p_lines: [line(FLOUR, 0.5), line(EGGS, 1), { ...line(MILK, 0.25, 'tbsp'), serves_rule: 'only', serves_restrictions: ['gf'] }]
    });
    expect(first.error).toBeNull();
    expect((await linesOf(RECIPE)).map((l) => l.position)).toEqual([1, 2, 3]);
    const { data: saved } = await admin.from('mm_recipes').select('updated_at, status').eq('id', RECIPE).single();
    const t1 = (saved as { updated_at: string }).updated_at;

    await new Promise((r) => setTimeout(r, 20));
    const second = await admin.rpc('mm_save_recipe', { p_recipe: recipeJson({ name: 'ZZ Test Pancakes v2' }), p_lines: [line(FLOUR, 0.5), line(EGGS, 2)] });
    expect(second.error).toBeNull();
    const after = await linesOf(RECIPE);
    expect(after.map((l) => [l.position, l.ingredient_id, Number(l.qty_per_person)])).toEqual([[1, FLOUR, 0.5], [2, EGGS, 2]]);
    const { data: saved2 } = await admin.from('mm_recipes').select('updated_at, name').eq('id', RECIPE).single();
    expect((saved2 as { name: string }).name).toBe('ZZ Test Pancakes v2');
    expect((saved2 as { updated_at: string }).updated_at > t1).toBe(true);

    // A malformed line rolls the whole call back: the name and both lines stay.
    const bad = await admin.rpc('mm_save_recipe', { p_recipe: recipeJson({ name: 'ZZ Broken' }), p_lines: [line(FLOUR, 'abc')] });
    expect(bad.error).not.toBeNull();
    expect((await linesOf(RECIPE)).length).toBe(2);
    const { data: saved3 } = await admin.from('mm_recipes').select('name').eq('id', RECIPE).single();
    expect((saved3 as { name: string }).name).toBe('ZZ Test Pancakes v2');
  });

  it('Rpc_SaveRecipe_CarriesOnlyTheRestrictionArray', async () => {
    // Migration B dropped serves_restriction: the array is the only channel,
    // and it is the only way a line can name two restrictions at once.
    const legacy = await admin.from('mm_recipe_lines').select('serves_restriction').limit(1);
    expect(legacy.error?.message ?? '').toMatch(/serves_restriction/);

    const saved = await admin.rpc('mm_save_recipe', {
      p_recipe: recipeJson(),
      p_lines: [line(FLOUR, 0.5), { ...line(EGGS, 1), serves_rule: 'except', serves_restrictions: ['dairy', 'veg'] }]
    });
    expect(saved.error).toBeNull();
    const { data } = await admin
      .from('mm_recipe_lines')
      .select('position, serves_rule, serves_restrictions')
      .eq('recipe_id', RECIPE)
      .order('position');
    expect(data).toEqual([
      { position: 1, serves_rule: 'everyone', serves_restrictions: [] },
      { position: 2, serves_rule: 'except', serves_restrictions: ['dairy', 'veg'] }
    ]);
  });

  it('Rpc_BothFunctions_RefuseAnonExecute', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const save = await anon.rpc('mm_save_recipe', { p_recipe: recipeJson({ id: 'zz-mm-anon' }), p_lines: [] });
    expect(save.error).not.toBeNull();
    const change = await anon.rpc('mm_change_ingredient_unit', { p_ingredient_id: FLOUR, p_unit: UNITS.tbsp, p_package_yields: [], p_pin_unit: null });
    expect(change.error).not.toBeNull();
    const { count } = await admin.from('mm_recipes').select('id', { count: 'exact', head: true }).eq('id', 'zz-mm-anon');
    expect(count).toBe(0);
  });

  it('Catalog_AuthoringLoad_IncludesDraftsAndRetired', async () => {
    const authoring = await loadAuthoringCatalogWith(admin);
    const pub = await loadCatalogWith(admin);

    // The draft recipe: authoring sees it, the public planner never does.
    expect(authoring.recipes.find((r) => r.id === RECIPE)?.status).toBe('draft');
    expect(pub.recipes.find((r) => r.id === RECIPE)).toBeUndefined();
    expect(pub.recipes.every((r) => r.status === 'published')).toBe(true);

    // The retired package: authoring carries it flagged, the public load drops it.
    const old = authoring.packages.find((p) => p.id === PKG_OLD);
    expect(old?.retiredAt).toBeTruthy();
    expect(authoring.packages.find((p) => p.id === PKG_BAG)?.retiredAt).toBeNull();
    expect(pub.packages.find((p) => p.id === PKG_OLD)).toBeUndefined();
    expect(authoring.ingredients.find((i) => i.id === FLOUR)?.retiredAt).toBeNull();
  });
});

describe('menu monster leader tools — actions', () => {
  it('Action_Publish_RefusesBlockingRecipe', async () => {
    // Empty the lines through the action itself (a draft may be saved with none).
    const saved = await saveRecipe({
      id: RECIPE, name: 'ZZ Test Pancakes', status: 'draft', mealFit: ['breakfast'], foodGroups: ['grain'],
      camp: true, trail: false, method: 'stove', stepsMd: '', base: [], variations: []
    });
    expect(saved.ok).toBe(true);
    const refused = await setRecipeStatus(RECIPE, 'published');
    expect(refused).toEqual({ ok: false, error: 'Add at least one ingredient line.' });
    const { data } = await admin.from('mm_recipes').select('status').eq('id', RECIPE).single();
    expect((data as { status: string }).status).toBe('draft');

    // An unparseable amount is refused at SAVE — the table cannot hold it.
    const bad = await saveRecipe({
      id: RECIPE, name: 'ZZ Test Pancakes', status: 'draft', mealFit: ['breakfast'], foodGroups: [],
      camp: true, trail: false, method: null, stepsMd: '',
      base: [{ ingredientId: FLOUR, amount: 'two', unitKey: null }],
      variations: []
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/isn't a number/);

    // With a priced line it publishes.
    const good = await saveRecipe({
      id: RECIPE, name: 'ZZ Test Pancakes', status: 'draft', mealFit: ['breakfast'], foodGroups: ['grain'],
      camp: true, trail: false, method: 'stove', stepsMd: '',
      base: [{ ingredientId: FLOUR, amount: '½', unitKey: null }],
      variations: []
    });
    expect(good.ok).toBe(true);
    expect((await linesOf(RECIPE)).map((l) => Number(l.qty_per_person))).toEqual([0.5]);
    const published = await setRecipeStatus(RECIPE, 'published');
    expect(published).toEqual({ ok: true });
  });

  it('Action_RetireIngredient_RefusedWhileInUse', async () => {
    const refused = await retireIngredient(FLOUR);
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe('Still used by ZZ Test Pancakes — retire or edit those first.');

    expect((await setRecipeStatus(RECIPE, 'retired')).ok).toBe(true);
    const ok = await retireIngredient(FLOUR);
    expect(ok).toEqual({ ok: true });
    const { data } = await admin.from('mm_ingredients').select('retired_at').eq('id', FLOUR).single();
    expect((data as { retired_at: string | null }).retired_at).toBeTruthy();
    await admin.from('mm_ingredients').update({ retired_at: null }).eq('id', FLOUR);
  });

  it('Rpc_ChangeIngredientUnit_UpdatesYieldsAndPinsLines_InOneTransaction', async () => {
    // Put the recipe back as a draft with an implicit-unit line and an explicit one.
    await admin.rpc('mm_save_recipe', { p_recipe: recipeJson(), p_lines: [line(FLOUR, 0.5), { ...line(FLOUR, 2, 'tbsp'), serves_rule: 'only', serves_restrictions: ['gf'] }] });

    const res = await changeIngredientUnit(FLOUR, UNITS.tbsp);
    expect(res.ok).toBe(true);
    expect(res.plan?.kind).toBe('family');
    expect(res.plan?.factor).toBe(16);

    const { data: ing } = await admin.from('mm_ingredients').select('unit_kind, unit_key, unit_one, unit_many').eq('id', FLOUR).single();
    expect(ing).toEqual({ unit_kind: 'volume', unit_key: 'tbsp', unit_one: 'Tbsp', unit_many: 'Tbsp' });
    const { data: bag } = await admin.from('mm_packages').select('yield').eq('id', PKG_BAG).single();
    expect(Number((bag as { yield: number }).yield)).toBe(576);
    // The retired package is not part of the plan and keeps its old yield.
    const { data: old } = await admin.from('mm_packages').select('yield').eq('id', PKG_OLD).single();
    expect(Number((old as { yield: number }).yield)).toBe(12);
    // The implicit line is pinned to the OLD unit; the explicit one is untouched.
    expect((await linesOf(RECIPE)).map((l) => l.unit_key)).toEqual(['cup', 'tbsp']);
  });

  it('Action_SaveRecipe_CompilesVariations_IntoLinesAndRows', async () => {
    const saved = await saveRecipe({
      id: RECIPE, name: 'ZZ Test Pancakes', status: 'draft', mealFit: ['breakfast'], foodGroups: ['grain'],
      camp: true, trail: false, method: 'stove', stepsMd: '',
      base: [
        { ingredientId: FLOUR, amount: '½', unitKey: null },
        { ingredientId: EGGS, amount: '1', unitKey: null }
      ],
      variations: [
        { restriction: 'gf', state: 'substituted', note: '', lines: [{ op: 'swap', baseIngredientId: FLOUR, ingredientId: MILK, amount: '1', unitKey: null }] },
        { restriction: 'veg', state: 'unsuitable', note: 'No meat-free version', lines: [] }
      ]
    });
    expect(saved).toEqual({ ok: true, id: RECIPE });

    const { data: lines } = await admin
      .from('mm_recipe_lines')
      .select('position, ingredient_id, serves_rule, serves_restrictions')
      .eq('recipe_id', RECIPE)
      .order('position');
    expect(lines).toEqual([
      { position: 1, ingredient_id: FLOUR, serves_rule: 'except', serves_restrictions: ['gf'] },
      { position: 2, ingredient_id: EGGS, serves_rule: 'everyone', serves_restrictions: [] },
      { position: 3, ingredient_id: MILK, serves_rule: 'only', serves_restrictions: ['gf'] }
    ]);
    const { data: vars } = await admin.from('mm_recipe_variations').select('restriction, state, note').eq('recipe_id', RECIPE).order('restriction');
    expect(vars).toEqual([
      { restriction: 'gf', state: 'substituted', note: null },
      { restriction: 'veg', state: 'unsuitable', note: 'No meat-free version' }
    ]);
    const { data: vlines } = await admin.from('mm_variation_lines').select('restriction, position, op, base_ingredient_id, ingredient_id, qty_per_person').eq('recipe_id', RECIPE);
    expect(vlines).toEqual([{ restriction: 'gf', position: 1, op: 'swap', base_ingredient_id: FLOUR, ingredient_id: MILK, qty_per_person: 1 }]);

    // The authoring loader hands the diff back; a duplicate base ingredient is refused.
    const authoring = await loadAuthoringCatalogWith(admin);
    const r = authoring.recipes.find((x) => x.id === RECIPE);
    expect(r?.variations?.map((v) => [v.restriction, v.state, v.lines.length])).toEqual([['gf', 'substituted', 1], ['veg', 'unsuitable', 0]]);
    const dup = await saveRecipe({
      id: RECIPE, name: 'ZZ Test Pancakes', status: 'draft', mealFit: ['breakfast'], foodGroups: [], camp: true, trail: false, method: null, stepsMd: '',
      base: [{ ingredientId: FLOUR, amount: '1', unitKey: null }, { ingredientId: FLOUR, amount: '2', unitKey: 'tbsp' }],
      variations: []
    });
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/already has a line/);
  });

  it('Action_DuplicateRecipe_CopiesLinesAndVariations_AsADraft', async () => {
    // Same RPC payload as saveRecipe, so it is the second place the restriction
    // array had to lose its old single-value twin (qa-lead, 2026-09-09).
    const copy = await duplicateRecipe(RECIPE);
    expect(copy.ok).toBe(true);
    const newId = (copy as { ok: true; id: string }).id;
    expect(newId).not.toBe(RECIPE);

    const { data: row } = await admin.from('mm_recipes').select('name, status').eq('id', newId).single();
    expect(row).toEqual({ name: 'ZZ Test Pancakes (copy)', status: 'draft' });

    const { data: lines } = await admin
      .from('mm_recipe_lines')
      .select('position, ingredient_id, serves_rule, serves_restrictions')
      .eq('recipe_id', newId)
      .order('position');
    expect(lines).toEqual([
      { position: 1, ingredient_id: FLOUR, serves_rule: 'except', serves_restrictions: ['gf'] },
      { position: 2, ingredient_id: EGGS, serves_rule: 'everyone', serves_restrictions: [] },
      { position: 3, ingredient_id: MILK, serves_rule: 'only', serves_restrictions: ['gf'] }
    ]);
    const { data: vars } = await admin
      .from('mm_recipe_variations')
      .select('restriction, state')
      .eq('recipe_id', newId)
      .order('restriction');
    expect(vars).toEqual([{ restriction: 'gf', state: 'substituted' }, { restriction: 'veg', state: 'unsuitable' }]);
  });
});

describe('menu monster leader tools — scout recipes (Phase 4A; leaders may edit since 2026-10-05)', () => {
  const SCOUT_RECIPE = 'S-0000ae01';
  const seeded = { author_person_id: 39, attribution_label: 'Charlie W.', shared_at: '2026-10-01T12:00:00+00:00' };
  beforeAll(async () => {
    await admin.from('mm_recipe_lines').delete().eq('recipe_id', SCOUT_RECIPE);
    await admin.from('mm_recipes').delete().eq('id', SCOUT_RECIPE);
    const { error } = await admin.from('mm_recipes').insert({ id: SCOUT_RECIPE, name: 'ZZ Scout chili', status: 'published', meal_fit: ['dinner'], food_groups: [], ...seeded });
    if (error) throw new Error(`fixture scout recipe: ${error.message}`);
    await admin.from('mm_recipe_lines').insert({ recipe_id: SCOUT_RECIPE, position: 1, ...line(EGGS, 1) });
  });
  afterAll(async () => {
    await admin.from('audit_log').delete().eq('entity_id', SCOUT_RECIPE);
    await admin.from('mm_recipe_lines').delete().eq('recipe_id', SCOUT_RECIPE);
    await admin.from('mm_recipes').delete().eq('id', SCOUT_RECIPE);
  });

  it('Leader_CanEditAScoutRecipe_AndItStaysTheScouts', async () => {
    const res = await saveRecipe({
      id: SCOUT_RECIPE, name: 'ZZ Scout chili, edited by a leader', status: 'published', mealFit: ['dinner'], foodGroups: [],
      camp: true, trail: false, method: null, stepsMd: '', base: [{ ingredientId: EGGS, amount: '2', unitKey: null }], variations: []
    });
    expect(res).toMatchObject({ ok: true });
    const { data: after } = await admin.from('mm_recipes').select('author_person_id, attribution_label, shared_at, name').eq('id', SCOUT_RECIPE).single();
    expect(after).toMatchObject({ ...seeded, name: 'ZZ Scout chili, edited by a leader' });
  });

  it('Leader_CannotSetASharedScoutRecipeBackToDraft', async () => {
    expect((await setRecipeStatus(SCOUT_RECIPE, 'draft')).ok).toBe(false);
  });
});

describe('menu monster leader tools — gear (Phase 4C)', () => {
  const base = { id: RECIPE, name: 'ZZ Test Pancakes', status: 'draft' as const, mealFit: ['breakfast' as const], foodGroups: [], camp: true, trail: false, method: null, stepsMd: '', base: [], variations: [] };
  const gearOf = async () => ((await admin.from('mm_recipes').select('equipment').eq('id', RECIPE).single()).data as { equipment: string[] }).equipment;

  // Was Leader_SavesGear_FromACommaList: gear is now a list picked from the master list (2026-10-05).
  it('Leader_SavesGear_InTheMasterSpelling_AToZ_AndSaysWhatItDropped', async () => {
    const res = await saveRecipe({ ...base, gear: ['spatula', 'Skillet × 2', 'skillet', 'ZZ Ghost pan'] });
    expect(res).toMatchObject({ ok: true, dropped: ['ZZ Ghost pan'] });
    expect(await gearOf()).toEqual(['Skillet × 2', 'Spatula']);
  });

  it('SaveWithoutGear_KeepsTheStoredGear', async () => {
    await saveRecipe({ ...base, gear: ['Dutch oven (12 in)'] });
    await saveRecipe(base);
    expect(await gearOf()).toEqual(['Dutch oven (12 in)']);
  });
  it('Duplicate_KeepsBrandSuggestions', async () => {
    // Jenna's audit, 2026-10-06: a copy used to start without the suggested brand the original had.
    const suggestions = { [FLOUR]: 4242 };
    await admin.from('mm_recipes').update({ brand_suggestions: suggestions }).eq('id', RECIPE);
    const copy = await duplicateRecipe(RECIPE);
    expect(copy.ok).toBe(true);
    const { data } = await admin.from('mm_recipes').select('brand_suggestions').eq('id', (copy as { ok: true; id: string }).id).single();
    expect(data).toEqual({ brand_suggestions: suggestions });
  });

});
