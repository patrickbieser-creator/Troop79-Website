import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  createGearWith,
  deleteGearWith,
  listGearAdminWith,
  listGearWith,
  loadMenuGearWith,
  resolveGearWith,
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
    expect(await item('Troop mess kit')).toMatchObject({ perPerson: true, home: 'trailer' });
  });

  // Replaces NamingSomethingNew_AddsItToTheList (2026-10-05): gear is picked from the master list, so a name
  // the list lacks is dropped, never added.
  it('ResolveGear_UsesTheMasterSpelling_KeepsTheCount_AndSortsAToZ', async () => {
    const { kept, dropped } = await resolveGearWith(admin, ['spatula', 'SKILLET × 2', 'camp  stove']);
    expect(kept).toEqual(['Camp stove', 'Skillet × 2', 'Spatula']);
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
    expect(await setGearExtrasWith(admin, m.id, OWNER, ['skillet × 2', 'SKILLET', 'ZZ Vitest water jug', 'Camp stove'])).toEqual({
      extras: ['Camp stove', 'Skillet × 2'],
      dropped: ['ZZ Vitest water jug']
    });
    expect((await loadMenuGearWith(admin, m.id)).extras).toEqual(['Camp stove', 'Skillet × 2']);
    expect(await item('ZZ Vitest water jug')).toBeUndefined();
  });

  it('PackedTicks_MergeOneAtATime_AndNeverTouchTheMenusVersion', async () => {
    const m = await makeMenu();
    await setGearPackedWith(admin, m.id, { key: 'Skillet', count: 2, packed: true }, { personId: OTHER, label: 'Leo B.' });
    await setGearPackedWith(admin, m.id, { key: 'Camp stove', count: 1, packed: true }, { personId: OWNER, label: 'Charlie W.' });
    const state = await loadMenuGearWith(admin, m.id);
    expect(Object.keys(state.packed).sort()).toEqual(['camp stove', 'skillet']);
    expect(state.packed.skillet).toMatchObject({ count: 2, by: 'Leo B.', personId: OTHER });
    const { data } = await admin.from('mm_menus').select('updated_at').eq('id', m.id).single();
    expect(data!.updated_at).toBe(m.updatedAt);
  });

  it('Unticking_RemovesOnlyThatTick', async () => {
    const m = await makeMenu();
    await setGearPackedWith(admin, m.id, { key: 'skillet', count: 1, packed: true }, { personId: OTHER, label: 'Leo B.' });
    await setGearPackedWith(admin, m.id, { key: 'camp stove', count: 1, packed: true }, { personId: OTHER, label: 'Leo B.' });
    await setGearPackedWith(admin, m.id, { key: 'skillet', count: 1, packed: false }, { personId: OWNER, label: 'Charlie W.' });
    expect(Object.keys((await loadMenuGearWith(admin, m.id)).packed)).toEqual(['camp stove']);
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
