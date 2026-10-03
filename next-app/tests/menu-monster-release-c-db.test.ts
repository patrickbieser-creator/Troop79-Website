import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Menu Monster release C (Plans/Menu-Monster-Scout-Workspace.md, "Release C
 * design") against local Postgres: a typed-in from a MENU reuses 4B's real
 * typed-in ingredients (mm_add_menu_ingredient → mm_create_typed_in, one cap
 * with recipes), orphan cleanup keeps what a menu still mentions, and a scout's
 * package on a book ingredient is live inside the band of the cheapest live
 * package, else held (mm_add_scout_package; newPackageBand is the TS twin).
 *
 * Rows belong to the test scout (Charlie Walters, person 39) and are removed
 * after each test. Seed: pancake-mix's cheapest live package is $15 / 36
 * units ($0.4167 a unit); oj has no package at all.
 */

const SCOUT = 39;
const BOOK = 'pancake-mix';
const NO_SIBLINGS = 'oj';
const MARKER = 'vitest-mm-relc';
const admin = adminClient();

afterEach(async () => {
  await admin.from('mm_menus').delete().eq('name', MARKER);
  await admin.from('mm_packages').delete().eq('added_by_person_id', SCOUT).like('id', 'sp-%');
  const { data } = await admin.from('mm_ingredients').select('id').eq('added_by_person_id', SCOUT).like('id', 'x-%');
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length) {
    await admin.from('mm_packages').delete().in('ingredient_id', ids);
    await admin.from('mm_ingredients').delete().in('id', ids);
  }
});

const typedIn = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  kind: 'count',
  unit_one: 'jar',
  unit_many: 'jars',
  avoid: [],
  package: { size: 1, price: 3.5, store: 'Pick n Save' },
  ...over
});

const addMenuIngredient = (name: string, over: Record<string, unknown> = {}) =>
  admin.rpc('mm_add_menu_ingredient', { p_person: SCOUT, p_new: typedIn(name, over) });

const addPackage = (pkg: Record<string, unknown>, ingredient = BOOK) =>
  admin.rpc('mm_add_scout_package', { p_person: SCOUT, p_ingredient_id: ingredient, p_pkg: { name: `${MARKER} pack`, store: 'Aldi', ...pkg }, p_band: 0.5 });

const age = (id: string) => admin.from('mm_ingredients').update({ created_at: new Date(Date.now() - 2 * 3600e3).toISOString() }).eq('id', id);

describe('mm_add_menu_ingredient', () => {
  it('menuTypedIn_createsXIngredientAndPackage', async () => {
    const { data: id, error } = await addMenuIngredient('Vitest jam');
    expect(error).toBeNull();
    expect(id).toMatch(/^x-[0-9a-f]{8}$/);
    const { data: ing } = await admin.from('mm_ingredients').select('added_by_person_id, needs_match_at, shared_at').eq('id', id).single();
    expect(ing).toMatchObject({ added_by_person_id: SCOUT, shared_at: null });
    expect(ing!.needs_match_at).not.toBeNull();
    const { data: pkg } = await admin.from('mm_packages').select('price, yield').eq('ingredient_id', id).single();
    expect(pkg).toMatchObject({ price: 3.5, yield: 1 });
  });

  it('menuTypedIn_refusesBookNameDuplicate', async () => {
    const { data: book } = await admin.from('mm_ingredients').select('name').eq('id', BOOK).single();
    const { error } = await addMenuIngredient(book!.name as string);
    expect(error?.message).toContain('MM_DUPLICATE_INGREDIENT');
  });

  it('menuTypedIn_sharesCapWithRecipeTypedIns', async () => {
    for (let i = 0; i < 10; i++) expect((await addMenuIngredient(`Vitest item ${i}`)).error).toBeNull();
    expect((await addMenuIngredient('Vitest item 10')).error?.message).toContain('MM_INGREDIENT_CAP');
  });

  it('menuTypedIn_refusesAPackageWithoutSizeOrPrice', async () => {
    const { error } = await addMenuIngredient('Vitest jam', { package: { size: 0, price: 3 } });
    expect(error?.message).toContain('MM_BAD_INGREDIENT');
  });
});

describe('mm_drop_orphan_typed_ins with menus', () => {
  it('orphanDrop_keepsItemReferencedByMenu', async () => {
    const { data: id } = await addMenuIngredient('Vitest jam');
    await age(id as string);
    const meals = [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'], recipeEdits: { B001: [{ op: 'add', ingredientId: id, qtyPerPerson: 1 }] } }];
    await admin.from('mm_menus').insert({ owner_person_id: SCOUT, name: MARKER, context: 'camp', headcount: 8, meals });
    await admin.rpc('mm_drop_orphan_typed_ins', { p_person: SCOUT });
    expect((await admin.from('mm_ingredients').select('id').eq('id', id)).data).toEqual([{ id }]);
  });

  it('orphanDrop_dropsAnAgedItemNothingUses', async () => {
    const { data: id } = await addMenuIngredient('Vitest jam');
    await age(id as string);
    await admin.rpc('mm_drop_orphan_typed_ins', { p_person: SCOUT });
    expect((await admin.from('mm_ingredients').select('id').eq('id', id)).data).toEqual([]);
  });

  it('orphanDrop_keepsAFreshItem_BeforeTheMenuIsSaved', async () => {
    const { data: id } = await addMenuIngredient('Vitest jam');
    await admin.rpc('mm_drop_orphan_typed_ins', { p_person: SCOUT });
    expect((await admin.from('mm_ingredients').select('id').eq('id', id)).data).toEqual([{ id }]);
  });
});

describe('mm_add_scout_package', () => {
  it('addScoutPackage_liveWithinBand', async () => {
    const { data } = await addPackage({ size: 10, price: 5 }); // $0.50 a unit, +20% on $0.4167
    expect(data).toMatchObject({ status: 'live' });
    const { data: row } = await admin.from('mm_packages').select('held_at, anchor_price, added_by_person_id').eq('id', data.id).single();
    expect(row).toMatchObject({ held_at: null, anchor_price: 5, added_by_person_id: SCOUT });
  });

  it('addScoutPackage_heldOutsideBand', async () => {
    const { data } = await addPackage({ size: 10, price: 9 }); // $0.90 a unit, +116%
    expect(data).toMatchObject({ status: 'held' });
    const { data: row } = await admin.from('mm_packages').select('held_at').eq('id', data.id).single();
    expect(row!.held_at).not.toBeNull();
  });

  it('addScoutPackage_heldWhenNoUsableSibling', async () => {
    const { data } = await addPackage({ size: 4, price: 5 }, NO_SIBLINGS);
    expect(data).toMatchObject({ status: 'held' });
  });

  it('addScoutPackage_sameIsNoop', async () => {
    const { data } = await addPackage({ size: 36, price: 15, store: 'costco' }); // same store (any case), size and price as p-mix-10lb
    expect(data).toEqual({ status: 'same', id: 'p-mix-10lb' });
  });

  it('addScoutPackage_enforcesHeldCap', async () => {
    for (let i = 0; i < 3; i++) expect((await addPackage({ size: 10 + i, price: 9 })).data.status).toBe('held');
    for (let i = 0; i < 2; i++) expect((await addPackage({ size: 4 + i, price: 5 }, NO_SIBLINGS)).data.status).toBe('held');
    const { error } = await addPackage({ size: 9, price: 5 }, NO_SIBLINGS);
    expect(error?.message).toContain('MM_PACKAGE_CAP');
  });

  it('addScoutPackage_capsAScoutsPackagesPerIngredient', async () => {
    for (let i = 0; i < 3; i++) expect((await addPackage({ size: 10 + i, price: 5 })).error).toBeNull();
    expect((await addPackage({ size: 20, price: 9 })).error?.message).toContain('MM_PACKAGE_CAP: ingredient');
  });

  it('addScoutPackage_refusesATypedInIngredient', async () => {
    const { data: id } = await addMenuIngredient('Vitest jam');
    const { error } = await addPackage({ size: 2, price: 7 }, id as string);
    expect(error?.message).toContain('MM_BAD_INGREDIENT');
  });

  it('addScoutPackage_refusesLinkTextInTheName', async () => {
    const { error } = await addPackage({ size: 10, price: 5, name: 'Buy at https://x.example' });
    expect(error?.message).toContain('MM_BAD_TEXT');
  });
});
