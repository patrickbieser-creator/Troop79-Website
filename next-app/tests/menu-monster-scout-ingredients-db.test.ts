import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { keepTypedInWith, listTypedInsWith, matchTypedInWith } from '../src/lib/menu-monster/scout-recipes-store';
import { loadCatalogWith } from '../src/lib/menu-monster/catalog';

/**
 * Phase 4B typed-in ingredients (20261003160000_mm_scout_ingredients.sql): a
 * scout's save creates them priced from the scout's entry, they stay private
 * until a recipe using them is shared, and a leader's match re-points every
 * recipe line and leaves an alias. Test recipes are S-0000af** ids; every x-
 * ingredient and xp- package is removed after each test (none exist otherwise).
 */
const SCOUT = 39;
const OTHER = 25;
const ID = 'S-0000af01';
const ID2 = 'S-0000af02';
const admin = adminClient();
let BOOK = '';
let BOOK_NAME = '';

beforeAll(async () => {
  const { data } = await admin.from('mm_ingredients').select('id, name').is('retired_at', null).eq('unit_kind', 'weight').is('added_by_person_id', null).limit(1).single();
  BOOK = data!.id as string;
  BOOK_NAME = data!.name as string;
});

afterEach(async () => {
  await admin.from('mm_recipe_lines').delete().like('recipe_id', 'S-0000af%');
  await admin.from('mm_recipes').delete().like('id', 'S-0000af%');
  await admin.from('mm_ingredients').update({ merged_into_id: null }).like('id', 'x-%');
  await admin.from('mm_packages').delete().like('id', 'xp-%');
  await admin.from('mm_ingredients').delete().like('id', 'x-%');
});

const typed = (over: Record<string, unknown> = {}) => ({
  key: 'new:0000aaaa',
  name: 'Vitest gochujang',
  kind: 'weight',
  unit_one: '',
  unit_many: '',
  avoid: ['gf'],
  package: { size: 17.6, price: 6.99, store: 'H Mart' },
  ...over
});
const recipe = (id = ID) => ({ id, name: 'Vitest bibimbap', meal_fit: ['dinner'], food_groups: [], steps_md: '' });

async function save(person: number, opts: { id?: string; lines?: unknown[]; news?: unknown[]; expected?: string | null } = {}) {
  return admin.rpc('mm_save_scout_recipe', {
    p_person: person,
    p_recipe: recipe(opts.id),
    p_lines: opts.lines ?? [{ ingredient_id: 'new:0000aaaa', qty_per_person: 0.5 }],
    p_expected_updated_at: opts.expected ?? null,
    p_new_ingredients: opts.news ?? [typed()]
  });
}
const newId = (data: unknown) => (data as { ids: Record<string, string> }).ids['new:0000aaaa'];

describe('typed-in ingredients on save', () => {
  it('Save_CreatesTheTypedInIngredient_AndReturnsItsId', async () => {
    const { data, error } = await save(SCOUT);
    expect(error).toBeNull();
    expect(newId(data)).toMatch(/^x-[0-9a-f]{8}$/);
  });

  it('TypedInIngredient_IsWaitingForAMatch_AndPrivate', async () => {
    const { data } = await save(SCOUT);
    const { data: ing } = await admin.from('mm_ingredients').select('added_by_person_id, needs_match_at, shared_at, unit_key, avoid').eq('id', newId(data)).single();
    expect({ ...ing, needs_match_at: ing!.needs_match_at != null }).toEqual({ added_by_person_id: SCOUT, needs_match_at: true, shared_at: null, unit_key: 'ozw', avoid: ['gf'] });
  });

  it('TypedInIngredient_IsPricedFromTheScoutsEntry', async () => {
    const { data } = await save(SCOUT);
    const { data: pkg } = await admin.from('mm_packages').select('price, yield, store, added_by_person_id').eq('ingredient_id', newId(data)).single();
    expect({ ...pkg, price: Number(pkg!.price), yield: Number(pkg!.yield) }).toEqual({ price: 6.99, yield: 17.6, store: 'H Mart', added_by_person_id: SCOUT });
  });

  it('RecipeLine_PointsAtTheTypedIn', async () => {
    const { data } = await save(SCOUT);
    const { data: lines } = await admin.from('mm_recipe_lines').select('ingredient_id').eq('recipe_id', ID);
    expect(lines).toEqual([{ ingredient_id: newId(data) }]);
  });

  it('TypedInIngredient_NeedsSizeAndPrice', async () => {
    const { error } = await save(SCOUT, { news: [typed({ package: { size: 0, price: 6.99 } })] });
    expect(error?.message).toContain('MM_BAD_INGREDIENT');
  });

  it('TypedInIngredient_RefusesAPennyPrice', async () => {
    const { error } = await save(SCOUT, { news: [typed({ package: { size: 10, price: 0.01 } })] });
    expect(error?.message).toContain('MM_BAD_INGREDIENT');
  });

  it('TypedInIngredient_CannotCopyABookName', async () => {
    const { error } = await save(SCOUT, { news: [typed({ name: BOOK_NAME.toUpperCase() })] });
    expect(error?.message).toContain('MM_DUPLICATE_INGREDIENT');
  });

  it('CountIngredient_NeedsItsNouns', async () => {
    const { error } = await save(SCOUT, { news: [typed({ kind: 'count', unit_one: '', unit_many: '' })] });
    expect(error?.message).toContain('MM_BAD_TEXT');
  });

  it('TypedIns_AreCappedAtTenWaitingPerScout', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `x-0000aa${String(i).padStart(2, '0')}`, name: `cap ${i}`, unit_kind: 'weight', unit_key: 'ozw', unit_one: 'oz', unit_many: 'oz', section: 'dry',
      added_by_person_id: SCOUT, needs_match_at: new Date().toISOString()
    }));
    expect((await admin.from('mm_ingredients').insert(rows)).error).toBeNull();
    const { error } = await save(SCOUT);
    expect(error?.message).toContain('MM_INGREDIENT_CAP');
  });

  it('OtherScout_CannotUseAPrivateTypedIn', async () => {
    const { data } = await save(SCOUT);
    const { error } = await save(OTHER, { id: ID2, lines: [{ ingredient_id: newId(data), qty_per_person: 1 }], news: [] });
    expect(error?.message).toContain('MM_BAD_INGREDIENT');
  });

  it('Share_RevealsTheRecipesTypedIns', async () => {
    const { data } = await save(SCOUT);
    await admin.rpc('mm_share_scout_recipe', { p_person: SCOUT, p_id: ID, p_label: 'Charlie W.' });
    const { data: ing } = await admin.from('mm_ingredients').select('shared_at').eq('id', newId(data)).single();
    expect(ing!.shared_at).not.toBeNull();
  });

  it('OtherScout_CanUseASharedTypedIn', async () => {
    const { data } = await save(SCOUT);
    await admin.rpc('mm_share_scout_recipe', { p_person: SCOUT, p_id: ID, p_label: 'Charlie W.' });
    const { error } = await save(OTHER, { id: ID2, lines: [{ ingredient_id: newId(data), qty_per_person: 1 }], news: [] });
    expect(error).toBeNull();
  });
});

describe('mm_match_ingredient', () => {
  async function sharedTypedIn() {
    const { data } = await save(SCOUT);
    await admin.rpc('mm_share_scout_recipe', { p_person: SCOUT, p_id: ID, p_label: 'Charlie W.' });
    return newId(data);
  }

  it('Leader_CanMatchTypedIn_RepointingLines', async () => {
    const x = await sharedTypedIn();
    const { data: moved, error } = await admin.rpc('mm_match_ingredient', { p_from: x, p_to: BOOK, p_factor: 2 });
    expect(error).toBeNull();
    const { data: lines } = await admin.from('mm_recipe_lines').select('ingredient_id, qty_per_person').eq('recipe_id', ID);
    expect([moved, lines!.map((l) => [l.ingredient_id, Number(l.qty_per_person)])]).toEqual([1, [[BOOK, 1]]]);
  });

  it('Match_RetiresTheTypedIn_AsAnAlias', async () => {
    const x = await sharedTypedIn();
    await admin.rpc('mm_match_ingredient', { p_from: x, p_to: BOOK, p_factor: 2 });
    const { data } = await admin.from('mm_ingredients').select('merged_into_id, merge_factor, needs_match_at').eq('id', x).single();
    expect({ ...data, merge_factor: Number(data!.merge_factor) }).toEqual({ merged_into_id: BOOK, merge_factor: 2, needs_match_at: null });
  });

  it('Match_RetiresTheTypedInsPackage', async () => {
    const x = await sharedTypedIn();
    await admin.rpc('mm_match_ingredient', { p_from: x, p_to: BOOK, p_factor: 2 });
    const { data } = await admin.from('mm_packages').select('retired_at').eq('ingredient_id', x).single();
    expect(data!.retired_at).not.toBeNull();
  });

  it('Match_AddsIntoTheTargetLine_WhenTheRecipeHasBoth', async () => {
    const { data } = await save(SCOUT, { lines: [{ ingredient_id: 'new:0000aaaa', qty_per_person: 0.5 }, { ingredient_id: BOOK, qty_per_person: 3 }] });
    const x = newId(data);
    await admin.rpc('mm_match_ingredient', { p_from: x, p_to: BOOK, p_factor: 2 });
    const { data: lines } = await admin.from('mm_recipe_lines').select('ingredient_id, qty_per_person').eq('recipe_id', ID);
    expect(lines!.map((l) => [l.ingredient_id, Number(l.qty_per_person)])).toEqual([[BOOK, 4]]);
  });

  it('Match_RefusesABookIngredientAsTheSource', async () => {
    const { error } = await admin.rpc('mm_match_ingredient', { p_from: BOOK, p_to: BOOK, p_factor: 1 });
    expect(error?.message).toContain('MM_BAD_MATCH');
  });

  it('Save_ResolvesAMatchedAwayIngredient_ToItsTarget', async () => {
    const x = await sharedTypedIn();
    await admin.rpc('mm_match_ingredient', { p_from: x, p_to: BOOK, p_factor: 2 });
    await save(OTHER, { id: ID2, lines: [{ ingredient_id: x, qty_per_person: 1 }], news: [] });
    const { data: lines } = await admin.from('mm_recipe_lines').select('ingredient_id, qty_per_person').eq('recipe_id', ID2);
    expect(lines!.map((l) => [l.ingredient_id, Number(l.qty_per_person)])).toEqual([[BOOK, 2]]);
  });
});

describe('typed-in ingredients, leader store', () => {
  async function shared() {
    const { data } = await save(SCOUT);
    await admin.rpc('mm_share_scout_recipe', { p_person: SCOUT, p_id: ID, p_label: 'Charlie W.' });
    return newId(data);
  }

  it('Leader_SeesASharedTypedIn_WithWhoAddedItAndWhereItIsUsed', async () => {
    const x = await shared();
    const row = (await listTypedInsWith(admin)).find((r) => r.id === x);
    expect(row).toMatchObject({ name: 'Vitest gochujang', usedIn: ['Vitest bibimbap'], pkg: { price: 6.99, size: 17.6, store: 'H Mart' } });
  });

  it('Leader_DoesNotSeeAPrivateTypedIn', async () => {
    const { data } = await save(SCOUT);
    expect((await listTypedInsWith(admin)).some((r) => r.id === newId(data))).toBe(false);
  });

  it('Leader_CanKeepATypedInAsNew', async () => {
    const x = await shared();
    expect(await keepTypedInWith(admin, x, 'produce', ['gf', 'nut'])).toBe('Vitest gochujang');
    const { data } = await admin.from('mm_ingredients').select('section, avoid, needs_match_at').eq('id', x).single();
    expect(data).toEqual({ section: 'produce', avoid: ['gf', 'nut'], needs_match_at: null });
  });

  it('KeptTypedIn_LeavesTheWaitingList', async () => {
    const x = await shared();
    await keepTypedInWith(admin, x, 'dry', []);
    expect((await listTypedInsWith(admin)).some((r) => r.id === x)).toBe(false);
  });

  it('MatchThroughTheStore_ReportsLinesMoved', async () => {
    const x = await shared();
    expect(await matchTypedInWith(admin, x, BOOK, 2)).toEqual({ ok: true, moved: 1 });
  });

  it('MatchThroughTheStore_ExplainsARefusal', async () => {
    const x = await shared();
    const res = await matchTypedInWith(admin, x, x, 1);
    expect(res.ok).toBe(false);
  });
});

describe('typed-in housekeeping (qa-lead fixes)', () => {
  it('UnusedPrivateTypedIn_IsDropped_OnTheNextSave', async () => {
    const { data } = await save(SCOUT);
    const x = newId(data);
    // Release C: an item younger than a day is kept (the add-to-menu → save gap), so age it.
    await admin.from('mm_ingredients').update({ created_at: new Date(Date.now() - 25 * 3600e3).toISOString() }).eq('id', x);
    const { data: v } = await admin.from('mm_recipes').select('updated_at').eq('id', ID).single();
    await save(SCOUT, { lines: [{ ingredient_id: BOOK, qty_per_person: 1 }], news: [], expected: v!.updated_at as string });
    expect((await admin.from('mm_ingredients').select('id').eq('id', x)).data).toEqual([]);
  });

  it('orphanDrop_keepsItemWithinGracePeriod', async () => {
    const { data } = await save(SCOUT);
    const x = newId(data);
    const { data: v } = await admin.from('mm_recipes').select('updated_at').eq('id', ID).single();
    await save(SCOUT, { lines: [{ ingredient_id: BOOK, qty_per_person: 1 }], news: [], expected: v!.updated_at as string });
    expect((await admin.from('mm_ingredients').select('id').eq('id', x)).data).toEqual([{ id: x }]);
  });

  it('PrivateTypedIn_CantBeKept', async () => {
    const { data } = await save(SCOUT);
    expect(await keepTypedInWith(admin, newId(data), 'dry', [])).toBeNull();
  });

  it('Match_IsRefused_WhenARecipeMeasuresTheTargetInAnotherUnit', async () => {
    const { data } = await save(SCOUT, { lines: [{ ingredient_id: 'new:0000aaaa', qty_per_person: 0.5 }, { ingredient_id: BOOK, qty_per_person: 3 }] });
    await admin.from('mm_recipe_lines').update({ unit_key: 'lb' }).eq('recipe_id', ID).eq('ingredient_id', BOOK);
    await admin.rpc('mm_share_scout_recipe', { p_person: SCOUT, p_id: ID, p_label: 'Charlie W.' });
    const { error } = await admin.rpc('mm_match_ingredient', { p_from: newId(data), p_to: BOOK, p_factor: 2 });
    expect(error?.message).toContain('another unit');
  });

  it('CatalogForAnotherScout_NeverCarriesAPrivateTypedInsPrice', async () => {
    const { data } = await save(SCOUT);
    const other = await loadCatalogWith(admin, { ownerPersonId: OTHER });
    expect(other.packages.some((p) => p.ingredientId === newId(data))).toBe(false);
  });
});
