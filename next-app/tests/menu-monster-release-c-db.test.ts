import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { CATALOG } from './helpers/menu-monster-fixture';
import { loadCatalogWith } from '../src/lib/menu-monster/catalog';
import { addScoutPackageWith, approveHeldPackageWith, listHeldPackagesWith, rejectHeldPackageWith } from '../src/lib/menu-monster/scout-packages-store';
import type { Menu } from '../src/lib/menu-monster/menus';
import { addMenuIngredientWith, createMenuWith, deleteMenuWith, loadMenuWith, saveMenuWith, setMenuSharedWith } from '../src/lib/menu-monster/menus-store';

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
const OTHER_SCOUT = 25;
const BOOK = 'pancake-mix';
const NO_SIBLINGS = 'oj';
const MARKER = 'vitest-mm-relc';
const admin = adminClient();

afterEach(async () => {
  await admin.from('mm_packages').delete().eq('added_by_person_id', OTHER_SCOUT).like('id', 'sp-%');
  await admin.from('audit_log').delete().eq('area', 'library').like('summary', `%${MARKER}%`);
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

const age = (id: string) => admin.from('mm_ingredients').update({ created_at: new Date(Date.now() - 25 * 3600e3).toISOString() }).eq('id', id);

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

  // Patrick, 2026-10-05: most foods start with no price, so a food's FIRST price goes live at once
  // (migration 20261016100000) instead of waiting for a leader with nothing to compare it against.
  it('addScoutPackage_liveWhenItIsTheFoodsFirstPrice', async () => {
    const { data } = await addPackage({ size: 4, price: 5 }, NO_SIBLINGS);
    expect(data).toMatchObject({ status: 'live' });
    const { data: row } = await admin.from('mm_packages').select('held_at').eq('id', data.id).single();
    expect(row!.held_at).toBeNull();
  });

  it('addScoutPackage_measuresLaterOnes_AgainstThatFirstPrice', async () => {
    expect((await addPackage({ size: 4, price: 5 }, NO_SIBLINGS)).data.status).toBe('live'); // $1.25 a unit: the anchor
    expect((await addPackage({ size: 4, price: 6 }, NO_SIBLINGS)).data.status).toBe('live'); // $1.50, +20%
    expect((await addPackage({ size: 4, price: 12 }, NO_SIBLINGS)).data.status).toBe('held'); // $3.00, +140%
  });

  it('addScoutPackage_theFirstPriceStaysTheAnchor_SoLaterAddsCannotWalkItDown', async () => {
    expect((await addPackage({ size: 4, price: 5 }, NO_SIBLINGS)).data.status).toBe('live'); // $1.25, the anchor
    expect((await addPackage({ size: 4, price: 3 }, NO_SIBLINGS)).data.status).toBe('live'); // $0.75, −40% on the anchor
    // $0.45 a unit: −40% on the scout's own $0.75, but −64% on the anchor — held.
    expect((await addPackage({ size: 4, price: 1.8 }, NO_SIBLINGS)).data.status).toBe('held');
  });

  it('addScoutPackage_sameIsNoop', async () => {
    const { data } = await addPackage({ size: 36, price: 15, store: 'costco' }); // same store (any case), size and price as p-mix-10lb
    expect(data).toEqual({ status: 'same', id: 'p-mix-10lb' });
  });

  it('addScoutPackage_enforcesHeldCap', async () => {
    for (let i = 0; i < 3; i++) expect((await addPackage({ size: 10 + i, price: 9 })).data.status).toBe('held');
    // A food with no price: the first goes live and is the anchor; two far from it are held (five held in all).
    expect((await addPackage({ size: 4, price: 5 }, NO_SIBLINGS)).data.status).toBe('live');
    for (let i = 0; i < 2; i++) expect((await addPackage({ size: 4, price: 20 + i }, NO_SIBLINGS)).data.status).toBe('held');
    // The sixth held would be over the cap — but this scout also has three packages on this food already.
    const { error } = await addPackage({ size: 4, price: 30 }, NO_SIBLINGS);
    expect(error?.message).toContain('MM_PACKAGE_CAP');
  });

  it('addScoutPackage_capsAScoutsPackagesPerIngredient', async () => {
    for (let i = 0; i < 3; i++) expect((await addPackage({ size: 10 + i, price: 5 })).error).toBeNull();
    expect((await addPackage({ size: 20, price: 9 })).error?.message).toContain('MM_PACKAGE_CAP: ingredient');
  });

  // v1.196.0 (migration 20261025100000): the person who typed a food in may price it; anyone else is still refused.
  it('addScoutPackage_refusesAnotherPersonsTypedInIngredient', async () => {
    const { data: id } = await addMenuIngredient('Vitest jam');
    const { error } = await admin.rpc('mm_add_scout_package', { p_person: OTHER_SCOUT, p_ingredient_id: id as string, p_pkg: { name: `${MARKER} pack`, store: 'Aldi', size: 2, price: 7 }, p_band: 0.5 });
    expect(error?.message).toContain('MM_BAD_INGREDIENT');
  });

  it('addScoutPackage_acceptsTheOwnersOwnTypedInIngredient', async () => {
    const { data: id } = await addMenuIngredient('Vitest jam');
    const { error } = await addPackage({ size: 2, price: 7 }, id as string);
    expect(error).toBeNull();
  });

  it('addScoutPackage_refusesLinkTextInTheName', async () => {
    const { error } = await addPackage({ size: 10, price: 5, name: 'Buy at https://x.example' });
    expect(error?.message).toContain('MM_BAD_TEXT');
  });
});

const ACTOR = { personId: SCOUT, label: 'Charlie W.' };
const JAM = { key: 'new:0000beef', name: 'Vitest jam', kind: 'count' as const, one: 'jar', many: 'jars', avoid: [], section: 'dry' as const, size: 1, price: 3.5, store: null };
const menuWith = (ingredientId: string | null): Menu => ({
  name: MARKER,
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B001'], recipeEdits: ingredientId ? { B001: [{ op: 'add', ingredientId, qtyPerPerson: 1 }] } : {} }]
});

describe('menu store, typed-ins (release C)', () => {
  it('Store_AddsAMenuTypedIn_AsTheSessionScouts', async () => {
    const res = await addMenuIngredientWith(admin, ACTOR, JAM);
    if (res.status !== 'added') throw new Error(res.status);
    const { data } = await admin.from('mm_ingredients').select('added_by_person_id').eq('id', res.id).single();
    expect(data!.added_by_person_id).toBe(SCOUT);
  });

  it('Store_ReportsTheCap_AsAStatus', async () => {
    for (let i = 0; i < 10; i++) await addMenuIngredientWith(admin, ACTOR, { ...JAM, name: `Vitest item ${i}` });
    expect((await addMenuIngredientWith(admin, ACTOR, { ...JAM, name: 'Vitest item 10' })).status).toBe('ingredient_cap');
  });

  it('shareMenu_revealsItsTypedIns', async () => {
    const res = await addMenuIngredientWith(admin, ACTOR, JAM);
    if (res.status !== 'added') throw new Error(res.status);
    const id = await createMenuWith(admin, ACTOR, menuWith(res.id), CATALOG);
    await setMenuSharedWith(admin, ACTOR, id, true);
    const { data } = await admin.from('mm_ingredients').select('shared_at').eq('id', res.id).single();
    expect(data!.shared_at).not.toBeNull();
  });

  it('Save_DropsATypedIn_TheMenuNoLongerUses', async () => {
    const res = await addMenuIngredientWith(admin, ACTOR, JAM);
    if (res.status !== 'added') throw new Error(res.status);
    const id = await createMenuWith(admin, ACTOR, menuWith(res.id), CATALOG);
    await age(res.id);
    const stored = (await loadMenuWith(admin, id))!;
    await saveMenuWith(admin, ACTOR, id, menuWith(null), stored.updatedAt, CATALOG);
    expect((await admin.from('mm_ingredients').select('id').eq('id', res.id)).data).toEqual([]);
  });

  it('Delete_DropsTheDeletedMenusTypedIns', async () => {
    const res = await addMenuIngredientWith(admin, ACTOR, JAM);
    if (res.status !== 'added') throw new Error(res.status);
    const id = await createMenuWith(admin, ACTOR, menuWith(res.id), CATALOG);
    await age(res.id);
    await deleteMenuWith(admin, ACTOR, id);
    expect((await admin.from('mm_ingredients').select('id').eq('id', res.id)).data).toEqual([]);
  });
});

describe('catalog and held scout packages (release C)', () => {
  it('catalog_ownerSeesOwnHeldOthersDont', async () => {
    const { data } = await addPackage({ size: 10, price: 9 });
    expect(data.status).toBe('held');
    const mine = await loadCatalogWith(admin, { ownerPersonId: SCOUT });
    const theirs = await loadCatalogWith(admin, { ownerPersonId: 25 });
    const everyone = await loadCatalogWith(admin);
    expect(mine.packages.find((p) => p.id === data.id)).toMatchObject({ held: true });
    expect(theirs.packages.some((p) => p.id === data.id)).toBe(false);
    expect(everyone.packages.some((p) => p.id === data.id)).toBe(false);
  });

  it('catalog_marksNoBookPackageAsHeld', async () => {
    const everyone = await loadCatalogWith(admin);
    expect(everyone.packages.every((p) => !p.held)).toBe(true);
  });
});

describe('scout package store (release C)', () => {
  const PKG = { ingredientId: BOOK, name: `${MARKER} pack`, store: 'Aldi', size: 10, price: 5 };

  it('Store_AddsALivePackage_AndAuditsItUnderLibrary', async () => {
    const res = await addScoutPackageWith(admin, ACTOR, PKG);
    expect(res).toMatchObject({ status: 'live' });
    const { data } = await admin.from('audit_log').select('summary').eq('area', 'library').like('summary', `%${MARKER}%`);
    expect(data!.map((r) => r.summary)).toEqual([`Charlie W. added package "${MARKER} pack" to Pancake mix`]);
  });

  it('Store_SaysHeld_WhenOutsideTheBand', async () => {
    expect(await addScoutPackageWith(admin, ACTOR, { ...PKG, price: 9 })).toMatchObject({ status: 'held' });
  });

  it('Store_ReportsTheCap_AsAStatus', async () => {
    for (let i = 0; i < 3; i++) await addScoutPackageWith(admin, ACTOR, { ...PKG, size: 10 + i });
    expect(await addScoutPackageWith(admin, ACTOR, { ...PKG, size: 20 })).toEqual({ status: 'cap' });
  });
});

describe('leader: packages waiting (release C)', () => {
  const held = async () => {
    const { data } = await addPackage({ size: 10, price: 9 });
    expect(data.status).toBe('held');
    return data.id as string;
  };

  it('Leader_SeesAHeldPackage_WithTheComparisonBasis', async () => {
    const id = await held();
    const row = (await listHeldPackagesWith(admin)).find((r) => r.id === id);
    expect(row).toMatchObject({ ingredientName: 'Pancake mix', price: 9, size: 10 });
    expect(row!.unitPrice).toBeCloseTo(0.9);
    expect(row!.cheapestUnitPrice).toBeCloseTo(15 / 36);
    expect(row!.addedBy).toMatch(/^Charlie/);
  });

  it('leaderApproveHeldPackage_makesItPublic', async () => {
    const id = await held();
    expect(await approveHeldPackageWith(admin, id)).toBe(true);
    expect((await loadCatalogWith(admin)).packages.some((p) => p.id === id)).toBe(true);
  });

  it('Leader_RejectDeletesAnUnreferencedHeldPackage', async () => {
    const id = await held();
    expect(await rejectHeldPackageWith(admin, id)).toBe('deleted');
    expect((await admin.from('mm_packages').select('id').eq('id', id)).data).toEqual([]);
  });

  it('Leader_RejectRetiresAHeldPackage_AMenuStillNames', async () => {
    const id = await held();
    await admin.from('mm_menus').insert({ owner_person_id: SCOUT, name: MARKER, context: 'camp', headcount: 8, shopping: { packageChoice: { [BOOK]: id }, qtyOverride: {}, lineSource: {} } });
    expect(await rejectHeldPackageWith(admin, id)).toBe('retired');
    const { data } = await admin.from('mm_packages').select('retired_at').eq('id', id).single();
    expect(data!.retired_at).not.toBeNull();
  });

  it('Approve_IsFalse_ForAPackageThatIsNotHeld', async () => {
    expect(await approveHeldPackageWith(admin, 'p-mix-10lb')).toBe(false);
  });
});

describe('qa-lead fixes (release C)', () => {
  it('addScoutPackage_sameIgnoresAnotherScoutsHeldPackage', async () => {
    const { data: theirs } = await admin.rpc('mm_add_scout_package', { p_person: OTHER_SCOUT, p_ingredient_id: BOOK, p_pkg: { name: `${MARKER} pack`, store: 'Aldi', size: 10, price: 9 }, p_band: 0.5 });
    expect(theirs.status).toBe('held');
    const { data: mine } = await addPackage({ size: 10, price: 9 });
    expect(mine.status).toBe('held');
    expect(mine.id).not.toBe(theirs.id);
  });

  it('addScoutPackage_measuresAgainstBookPackagesOnly', async () => {
    // $0.25 a unit: −40% on the book's cheapest $0.4167 — live.
    expect((await addPackage({ size: 10, price: 2.5 })).data.status).toBe('live');
    // $0.13 a unit: −69% on the book (held), though only −48% on the scout's own $0.25.
    expect((await addPackage({ size: 100, price: 13 })).data.status).toBe('held');
  });

  it('orphanDrop_keepsAnItemYoungerThanADay', async () => {
    const { data: id } = await addMenuIngredient('Vitest jam');
    await admin.from('mm_ingredients').update({ created_at: new Date(Date.now() - 2 * 3600e3).toISOString() }).eq('id', id);
    await admin.rpc('mm_drop_orphan_typed_ins', { p_person: SCOUT });
    expect((await admin.from('mm_ingredients').select('id').eq('id', id)).data).toEqual([{ id }]);
  });
});

describe('posture (release C)', () => {
  it.each([
    ['mm_create_typed_in', { p_person: SCOUT, p_new: {} }],
    ['mm_add_menu_ingredient', { p_person: SCOUT, p_new: {} }],
    ['mm_add_scout_package', { p_person: SCOUT, p_ingredient_id: BOOK, p_pkg: {}, p_band: 0.5 }],
    ['mm_package_in_use', { p_id: 'p-mix-10lb' }],
    ['mm_drop_orphan_typed_ins', { p_person: SCOUT }]
  ])('Anon_CannotExecute_%s', async (fn, args) => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.rpc(fn, args);
    expect(error?.code).toBe('42501');
  });

  it('shareMenu_leavesAnotherScoutsTypedInPrivate', async () => {
    const { data: theirs } = await admin.rpc('mm_add_menu_ingredient', { p_person: OTHER_SCOUT, p_new: typedIn('Vitest their jam') });
    const id = await createMenuWith(admin, ACTOR, menuWith(theirs as string), CATALOG);
    await setMenuSharedWith(admin, ACTOR, id, true);
    const { data } = await admin.from('mm_ingredients').select('shared_at').eq('id', theirs).single();
    expect(data!.shared_at).toBeNull();
    await admin.from('mm_packages').delete().eq('ingredient_id', theirs);
    await admin.from('mm_ingredients').delete().eq('id', theirs);
  });
});

describe('a typed-in with no package, and its section (food on the fly, 2026-10-06)', () => {
  it('TypedIn_WithNoPackage_WritesNoPackageRow_AndStoresTheSection', async () => {
    const res = await addMenuIngredientWith(admin, ACTOR, { ...JAM, name: 'Vitest Kool-Aid', section: 'beverage', size: 0, price: 0 });
    if (res.status !== 'added') throw new Error(res.status);
    const { data: ing } = await admin.from('mm_ingredients').select('section, needs_match_at').eq('id', res.id).single();
    const { data: pkgs } = await admin.from('mm_packages').select('id').eq('ingredient_id', res.id);
    expect([ing!.section, ing!.needs_match_at !== null, pkgs]).toEqual(['beverage', true, []]);
  });

  it('TypedIn_WithAPackage_StillWritesIt', async () => {
    const res = await addMenuIngredientWith(admin, ACTOR, { ...JAM, name: 'Vitest Kool-Aid', section: 'beverage', size: 8, price: 3.5 });
    if (res.status !== 'added') throw new Error(res.status);
    const { data: pkgs } = await admin.from('mm_packages').select('price, yield').eq('ingredient_id', res.id);
    expect(pkgs).toEqual([{ price: 3.5, yield: 8 }]);
  });

  it('TypedIn_WithNoSection_IsDry_ForTheOldCallers', async () => {
    const res = await addMenuIngredient('Vitest jam');
    const { data: ing } = await admin.from('mm_ingredients').select('section').eq('id', res.data as string).single();
    expect(ing!.section).toBe('dry');
  });

  it('TypedIn_RefusesAnUnknownSection', async () => {
    const { error } = await addMenuIngredient('Vitest jam', { section: 'candy' });
    expect(error?.message).toContain('MM_BAD_INGREDIENT');
  });

  it('IngredientsTable_AcceptsBeverage_AsASection', async () => {
    const res = await addMenuIngredientWith(admin, ACTOR, { ...JAM, name: 'Vitest lemonade', section: 'beverage', size: 0, price: 0 });
    expect(res.status).toBe('added');
  });
});
