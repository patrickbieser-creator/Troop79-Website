import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { sanitizeMenu } from '../src/lib/menu-monster/menus';
import type { Catalog } from '../src/lib/menu-monster/types';
import {
  createGearWith,
  deleteGearWith,
  listGearAdminWith,
  listGearWith,
  mergeGearWith,
  loadMenuGearWith,
  resolveGearWith,
  resolveMealGearWith,
  retireGearWith,
  setGearExtrasWith,
  setGearPackedWith,
  updateGearWith
} from '../src/lib/menu-monster/gear-store';

/**
 * Menu Monster gear against the local stack (20261007100000_mm_gear.sql; Plans/Menu-Monster-Brands-Gear.md,
 * release 2): the troop's gear list grows when someone names something new, a rename rewrites the recipes that
 * use it (onto an existing name it merges), and a menu's extras and Packed ticks are written beside the plan
 * without touching its version. Every row is named "ZZ Vitest …" and removed after each test.
 */
const admin = adminClient();
const OWNER = 39;
const OTHER = 25;
const RECIPE = 'zz-gear-recipe';

async function makeMenu(): Promise<{ id: string; updatedAt: string }> {
  const { data, error } = await admin
    .from('mm_menus')
    .insert({ owner_person_id: OWNER, name: 'ZZ Vitest gear menu', context: 'camp', headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budget_per_person_meal: 4, meals: [] })
    .select('id, updated_at')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, updatedAt: data.updated_at as string };
}
const meal = (id: string, slot: string, gear?: string[]) => ({ id, day: 0, slot, headcount: null, recipeIds: [], recipeEdits: {}, ...(gear ? { gear } : {}) });
async function makeMenuWith(meals: unknown[], extras: string[] = []): Promise<{ id: string; updatedAt: string }> {
  const m = await makeMenu();
  const { error } = await admin.from('mm_menus').update({ meals, gear_extras: extras }).eq('id', m.id);
  if (error) throw new Error(error.message);
  // The update above is a plain write; the version the row has NOW is the baseline.
  const { data } = await admin.from('mm_menus').select('updated_at').eq('id', m.id).single();
  return { id: m.id, updatedAt: data!.updated_at as string };
}
const menuRow = async (id: string) => (await admin.from('mm_menus').select('updated_at, gear_extras, meals').eq('id', id).single()).data as { updated_at: string; gear_extras: string[]; meals: { id: string; gear?: string[] }[] };
async function makeRecipe(equipment: string[]) {
  const { error } = await admin.from('mm_recipes').insert({ id: RECIPE, name: 'ZZ Vitest gear recipe', status: 'draft', equipment, sort_order: 9999 });
  if (error) throw new Error(error.message);
}
const recipeGear = async () => (await admin.from('mm_recipes').select('equipment').eq('id', RECIPE).single()).data!.equipment as string[];
const item = async (name: string) => (await listGearWith(admin, { includeRetired: true })).find((g) => g.name === name);

afterEach(async () => {
  await admin.from('mm_menus').delete().eq('name', 'ZZ Vitest gear menu');
  await admin.from('mm_recipes').delete().eq('id', RECIPE);
  await admin.from('mm_gear').delete().ilike('name', 'ZZ Vitest%');
});

describe('the troop’s gear list', () => {
  it('Seed_HasTheMessKit_OnePerPerson', async () => {
    expect(await item('Troop Mess Kit')).toMatchObject({ perPerson: true, home: 'trailer' });
  });

  // Replaces NamingSomethingNew_AddsItToTheList (2026-10-05): gear is picked from the master list, so a name
  // the list lacks is dropped, never added.
  it('ResolveGear_UsesTheMasterSpelling_KeepsTheCount_AndSortsAToZ', async () => {
    const { kept, dropped } = await resolveGearWith(admin, ['spatula', 'SKILLET × 2', 'STOVE']);
    expect(kept).toEqual(['Skillet × 2', 'Spatula', 'Stove']);
    expect(dropped).toEqual([]);
  });

  it('ResolveGear_DropsANameTheListLacks_AndNeverAddsIt', async () => {
    const res = await resolveGearWith(admin, ['ZZ Vitest wash bin × 3', 'Skillet']);
    expect(res).toEqual({ kept: ['Skillet'], dropped: ['ZZ Vitest wash bin'] });
    expect(await item('ZZ Vitest wash bin')).toBeUndefined();
  });

  it('ResolveGear_KeepsARetiredItem_OnlyWhenTheRecipeAlreadyStoresIt', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest wok', home: 'trailer', perPerson: false }, null);
    await retireGearWith(admin, (await item('ZZ Vitest wok'))!.id, true);
    expect(await resolveGearWith(admin, ['zz vitest wok × 2'], ['ZZ Vitest wok'])).toEqual({ kept: ['ZZ Vitest wok × 2'], dropped: [] });
    expect(await resolveGearWith(admin, ['ZZ Vitest wok'], [])).toEqual({ kept: [], dropped: ['ZZ Vitest wok'] });
  });

  it('Leader_CannotAddADuplicate_IgnoringCase', async () => {
    expect(await createGearWith(admin, { name: 'skillet', home: 'trailer', perPerson: false }, null)).toMatchObject({ ok: false });
  });

  it('Rename_RewritesTheRecipesThatNameIt_KeepingCounts', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest spatula', home: 'patrol_box', perPerson: false }, null);
    await makeRecipe(['ZZ Vitest spatula × 2', 'Skillet']);
    const g = await item('ZZ Vitest spatula');
    const res = await updateGearWith(admin, g!.id, { name: 'ZZ Vitest turner', home: 'patrol_box', perPerson: false });
    expect(res).toMatchObject({ ok: true, recipes: 1 });
    expect(await recipeGear()).toEqual(['ZZ Vitest turner × 2', 'Skillet']);
  });

  it('RenameOntoAnExistingName_MergesTheTwo', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest fry pan', home: 'trailer', perPerson: false }, null);
    await makeRecipe(['ZZ Vitest fry pan', 'Skillet']);
    const g = await item('ZZ Vitest fry pan');
    const res = await updateGearWith(admin, g!.id, { name: 'Skillet', home: 'trailer', perPerson: false });
    expect(res).toMatchObject({ ok: true, merged: true });
    expect(await recipeGear()).toEqual(['Skillet']);
    expect(await item('ZZ Vitest fry pan')).toBeUndefined();
  });

  // Patrick, 2026-10-05: "Charcoal and Charcoal briquettes".
  it('Merge_RepointsEveryRecipeAndMenu_AndTheItemGoesAway', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest briquettes', home: 'trailer', perPerson: false }, null);
    await makeRecipe(['ZZ Vitest briquettes × 2', 'Skillet']);
    const from = await item('ZZ Vitest briquettes');
    const into = await item('Skillet');
    const res = await mergeGearWith(admin, from!.id, into!.id);
    expect(res).toMatchObject({ ok: true, merged: true, recipes: 1 });
    expect(await recipeGear()).toEqual(['Skillet × 2']);
    expect(await item('ZZ Vitest briquettes')).toBeUndefined();
  });

  it('Merge_IntoItself_IsRefused', async () => {
    const skillet = await item('Skillet');
    expect((await mergeGearWith(admin, skillet!.id, skillet!.id)).ok).toBe(false);
  });

  it('AdminList_SaysWhichRecipesUseAnItem', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest wok', home: 'trailer', perPerson: false }, null);
    await makeRecipe(['ZZ Vitest wok']);
    expect((await listGearAdminWith(admin)).find((g) => g.name === 'ZZ Vitest wok')?.recipes).toEqual(['ZZ Vitest gear recipe']);
  });

  it('AnItemARecipeNames_CanBeRetired_ButNotDeleted', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest wok', home: 'trailer', perPerson: false }, null);
    await makeRecipe(['ZZ Vitest wok']);
    const g = await item('ZZ Vitest wok');
    expect((await deleteGearWith(admin, g!.id)).ok).toBe(false);
    expect((await retireGearWith(admin, g!.id, true)).ok).toBe(true);
    expect((await listGearWith(admin)).some((x) => x.name === 'ZZ Vitest wok')).toBe(false);
  });
});

describe('a menu’s gear state', () => {
  // Was Extras_AreTheOwners_AndJoinTheTroopList: a new name no longer joins the list, it is dropped.
  it('Extras_AreTheOwners_InTheListsSpelling_AndANameNotOnTheListIsDropped', async () => {
    const m = await makeMenu();
    expect(await setGearExtrasWith(admin, m.id, OTHER, ['Skillet'])).toBeNull();
    expect(await setGearExtrasWith(admin, m.id, OWNER, ['skillet × 2', 'SKILLET', 'ZZ Vitest water jug', 'Stove'])).toEqual({
      extras: ['Skillet × 2', 'Stove'],
      dropped: ['ZZ Vitest water jug']
    });
    expect((await loadMenuGearWith(admin, m.id)).extras).toEqual(['Skillet × 2', 'Stove']);
    expect(await item('ZZ Vitest water jug')).toBeUndefined();
  });

  it('PackedTicks_MergeOneAtATime_AndNeverTouchTheMenusVersion', async () => {
    const m = await makeMenu();
    await setGearPackedWith(admin, m.id, { key: 'Skillet', count: 2, packed: true }, { personId: OTHER, label: 'Leo B.' });
    await setGearPackedWith(admin, m.id, { key: 'Stove', count: 1, packed: true }, { personId: OWNER, label: 'Charlie W.' });
    const state = await loadMenuGearWith(admin, m.id);
    expect(Object.keys(state.packed).sort()).toEqual(['skillet', 'stove']);
    expect(state.packed.skillet).toMatchObject({ count: 2, by: 'Leo B.', personId: OTHER });
    const { data } = await admin.from('mm_menus').select('updated_at').eq('id', m.id).single();
    expect(data!.updated_at).toBe(m.updatedAt);
  });

  it('Unticking_RemovesOnlyThatTick', async () => {
    const m = await makeMenu();
    await setGearPackedWith(admin, m.id, { key: 'skillet', count: 1, packed: true }, { personId: OTHER, label: 'Leo B.' });
    await setGearPackedWith(admin, m.id, { key: 'stove', count: 1, packed: true }, { personId: OTHER, label: 'Leo B.' });
    await setGearPackedWith(admin, m.id, { key: 'skillet', count: 1, packed: false }, { personId: OWNER, label: 'Charlie W.' });
    expect(Object.keys((await loadMenuGearWith(admin, m.id)).packed)).toEqual(['stove']);
  });

  it('ATick_OnAMenuThatIsGone_IsRefused', async () => {
    expect(await setGearPackedWith(admin, '00000000-0000-4000-8000-000000000000', { key: 'skillet', count: 1, packed: true }, { personId: OTHER, label: 'Leo B.' })).toBe(false);
  });

  it('AMenu_HoldsAtMostAHundredTicks', async () => {
    const m = await makeMenu();
    const full = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, { count: 1, by: 'x', personId: OTHER, at: '2026-10-04T00:00:00Z' }]));
    await admin.from('mm_menus').update({ gear_packed: full }).eq('id', m.id);
    expect(await setGearPackedWith(admin, m.id, { key: 'one more', count: 1, packed: true }, { personId: OTHER, label: 'Leo B.' })).toBe(false);
    // Re-ticking one already there, and unticking, still work.
    expect(await setGearPackedWith(admin, m.id, { key: 'k1', count: 2, packed: true }, { personId: OTHER, label: 'Leo B.' })).toBe(true);
    expect(await setGearPackedWith(admin, m.id, { key: 'k2', count: 1, packed: false }, { personId: OTHER, label: 'Leo B.' })).toBe(true);
  });

  it('AnonKey_CannotCallThePackedFunction', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string);
    const { error } = await anon.rpc('mm_set_gear_packed', { p_menu: '00000000-0000-4000-8000-000000000000', p_key: 'x', p_packed: true, p_count: 1, p_person: 1, p_label: 'x' });
    expect(error).not.toBeNull();
  });
});

describe('gear for a meal in the Gear tab (release 2)', () => {
  it('Rename_RewritesMealGearAndExtras_KeepingCounts_WithoutBumpingTheMenusVersion', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest soap', home: 'trailer', perPerson: false }, null);
    const m = await makeMenuWith([meal('m1', 'breakfast', ['Skillet', 'ZZ Vitest soap × 2']), meal('m2', 'lunch')], ['ZZ Vitest soap']);
    const g = await item('ZZ Vitest soap');
    const res = await updateGearWith(admin, g!.id, { name: 'ZZ Vitest dish soap', home: 'trailer', perPerson: false });
    expect(res.ok).toBe(true);
    const row = await menuRow(m.id);
    // Renamed, count kept, still A to Z.
    expect(row.meals[0].gear).toEqual(['Skillet', 'ZZ Vitest dish soap × 2']);
    expect(row.meals[1]).not.toHaveProperty('gear');
    expect(row.gear_extras).toEqual(['ZZ Vitest dish soap']);
    expect(row.updated_at).toBe(m.updatedAt);
  });

  it('Merge_RewritesMealGear_AndKeepsOneWhenTheMealNamedBoth', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest bucket', home: 'trailer', perPerson: false }, null);
    await createGearWith(admin, { name: 'ZZ Vitest pail', home: 'trailer', perPerson: false }, null);
    const m = await makeMenuWith([meal('m1', 'breakfast', ['ZZ Vitest bucket × 2', 'ZZ Vitest pail']), meal('m2', 'lunch', ['ZZ Vitest bucket'])]);
    const res = await mergeGearWith(admin, (await item('ZZ Vitest bucket'))!.id, (await item('ZZ Vitest pail'))!.id);
    expect(res).toMatchObject({ ok: true, merged: true });
    const row = await menuRow(m.id);
    expect(row.meals[0].gear).toEqual(['ZZ Vitest pail × 2']);
    expect(row.meals[1].gear).toEqual(['ZZ Vitest pail']);
    expect(row.updated_at).toBe(m.updatedAt);
  });

  it('Rename_LeavesAMenuThatDoesNotNameTheItemAlone', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest mop', home: 'trailer', perPerson: false }, null);
    const m = await makeMenuWith([meal('m1', 'breakfast', ['Skillet'])]);
    await updateGearWith(admin, (await item('ZZ Vitest mop'))!.id, { name: 'ZZ Vitest mop 2', home: 'trailer', perPerson: false });
    expect((await menuRow(m.id)).meals[0].gear).toEqual(['Skillet']);
  });

  it('AdminList_CountsTheMenusThatNameAnItem_InExtrasOrInAMealsGear', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest sponge', home: 'trailer', perPerson: false }, null);
    await createGearWith(admin, { name: 'ZZ Vitest rag', home: 'trailer', perPerson: false }, null);
    await makeMenuWith([meal('m1', 'breakfast', ['ZZ Vitest sponge × 2']), meal('m2', 'lunch', ['zz vitest sponge'])], ['ZZ Vitest rag']);
    const list = await listGearAdminWith(admin);
    // Two meals on ONE menu are one menu.
    expect(list.find((g) => g.name === 'ZZ Vitest sponge')).toMatchObject({ menus: 1, recipes: [] });
    expect(list.find((g) => g.name === 'ZZ Vitest rag')?.menus).toBe(1);
  });

  it('Delete_IsRefused_WhenAMealNamesTheItem_AndAllowedOnceItIsGone', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest sponge', home: 'trailer', perPerson: false }, null);
    const m = await makeMenuWith([meal('m1', 'breakfast', ['ZZ Vitest sponge'])]);
    const g = await item('ZZ Vitest sponge');
    const refused = await deleteGearWith(admin, g!.id);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/menu/);
    await admin.from('mm_menus').delete().eq('id', m.id);
    expect((await deleteGearWith(admin, g!.id)).ok).toBe(true);
  });

  it('Delete_IsRefused_WhenAMenusExtrasNameTheItem', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest sponge', home: 'trailer', perPerson: false }, null);
    await makeMenuWith([], ['ZZ Vitest sponge']);
    expect((await deleteGearWith(admin, (await item('ZZ Vitest sponge'))!.id)).ok).toBe(false);
  });
});

describe('resolveMealGearWith (a menu save keeps meal gear to the troop’s list)', () => {
  const catalog = { ingredients: [], packages: [], conversions: [], recipes: [] } as unknown as Catalog;
  const menuOf = (gear: string[][]) => sanitizeMenu({ name: 'm', headcount: 8, meals: gear.map((g, i) => ({ id: `m${i}`, day: i, slot: 'breakfast', gear: g })) }, catalog);

  it('MealGear_TakesTheListsSpelling_AToZ_AndDropsAndReportsAnUnknownName', async () => {
    const { menu, dropped } = await resolveMealGearWith(admin, menuOf([['spatula', 'ZZ Vitest wash bin × 3', 'SKILLET × 2']]));
    expect(menu.meals[0].gear).toEqual(['Skillet × 2', 'Spatula']);
    expect(dropped).toEqual(['ZZ Vitest wash bin']);
    expect(await item('ZZ Vitest wash bin')).toBeUndefined();
  });

  it('AMealLeftWithNothing_LosesItsGearKey', async () => {
    const { menu } = await resolveMealGearWith(admin, menuOf([['ZZ Vitest wash bin']]));
    expect(menu.meals[0]).not.toHaveProperty('gear');
  });

  it('ANameDroppedOnTwoMeals_IsReportedOnce', async () => {
    const { dropped } = await resolveMealGearWith(admin, menuOf([['ZZ Vitest wash bin'], ['zz vitest WASH BIN']]));
    expect(dropped).toEqual(['ZZ Vitest wash bin']);
  });

  it('ARetiredItem_StaysOnlyOnTheMealThatAlreadyHoldsIt', async () => {
    await createGearWith(admin, { name: 'ZZ Vitest wok', home: 'trailer', perPerson: false }, null);
    await retireGearWith(admin, (await item('ZZ Vitest wok'))!.id, true);
    const stored = menuOf([['ZZ Vitest wok']]);
    const next = menuOf([['ZZ Vitest wok'], ['ZZ Vitest wok']]);
    const { menu, dropped } = await resolveMealGearWith(admin, next, stored);
    expect(menu.meals[0].gear).toEqual(['ZZ Vitest wok']);
    expect(menu.meals[1]).not.toHaveProperty('gear');
    expect(dropped).toEqual(['ZZ Vitest wok']);
  });

  it('AMenuWithNoMealGear_IsReturnedAsIs', async () => {
    const m = menuOf([[]]);
    expect(await resolveMealGearWith(admin, m)).toEqual({ menu: m, dropped: [] });
  });
});
