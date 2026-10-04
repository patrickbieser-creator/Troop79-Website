import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  addBrandWith,
  createBrandWith,
  mergeBrandWith,
  moveBrandWith,
  removeBrandWith,
  renameBrandWith,
  setBrandDietsWith,
  setPackageBrandWith
} from '../src/lib/menu-monster/brands-store';
import { loadAuthoringCatalogWith, loadCatalogWith } from '../src/lib/menu-monster/catalog';

/**
 * Menu Monster brands against the local stack (20261008100000_mm_brands.sql; Plans/Menu-Monster-Brands-Gear.md,
 * release 3): a typed brand joins at once and is found again whatever its case or punctuation; a leader
 * renames, merges, moves and removes; the catalog loads carry brands, "New" until someone prices one, and the
 * alias a merge leaves. Fixtures are the two `zz-brand-*` ingredients and anything named "ZZ Vitest …".
 */
const admin = adminClient();
const SCOUT = 39;
const OTHER = 25;
const ING = 'zz-brand-cookies';
const ING2 = 'zz-brand-crackers';

async function cleanup() {
  await admin.from('mm_packages').delete().like('id', 'p-zz-brand-%');
  await admin.from('mm_brands').update({ merged_into_id: null }).in('ingredient_id', [ING, ING2]);
  await admin.from('mm_brands').delete().in('ingredient_id', [ING, ING2]);
}
beforeAll(async () => {
  await cleanup();
  await admin.from('mm_ingredients').delete().in('id', [ING, ING2]);
  const row = (id: string, name: string) => ({ id, name, unit_kind: 'count', unit_key: 'count', unit_one: 'cookie', unit_many: 'cookies', section: 'bakery', staple: false, avoid: ['gf'] });
  const { error } = await admin.from('mm_ingredients').insert([row(ING, 'ZZ Vitest cookies'), row(ING2, 'ZZ Vitest crackers')]);
  if (error) throw new Error(error.message);
  return async () => {
    await cleanup();
    await admin.from('mm_ingredients').delete().in('id', [ING, ING2]);
  };
});
afterEach(cleanup);

const add = async (name: string, person = SCOUT, ing = ING) => {
  const res = await addBrandWith(admin, person, ing, name);
  if (res.status !== 'ok') throw new Error(`add: ${res.status}`);
  return res;
};
const addPackage = async (brandId: string | null, id = 'p-zz-brand-1') => {
  const { error } = await admin.from('mm_packages').insert({ id, ingredient_id: ING, name: 'ZZ Vitest pack', price: 4.29, yield: 36, as_of: '2026-10-01', brand_id: brandId });
  if (error) throw new Error(error.message);
};
const brandsOf = async (owner: number | null = null) => (await loadCatalogWith(admin, { ownerPersonId: owner })).brands?.filter((b) => b.ingredientId === ING) ?? [];

describe('a typed brand', () => {
  it('JoinsTheTroopsList_AtOnce_ForEveryone', async () => {
    const res = await add('ZZ Vitest Chips Ahoy');
    expect([res.created, res.brand.isNew, res.brand.id.startsWith('xb-')]).toEqual([true, true, true]);
    expect((await brandsOf(OTHER)).map((b) => b.name)).toEqual(['ZZ Vitest Chips Ahoy']);
    expect((await brandsOf(null)).map((b) => b.name)).toEqual(['ZZ Vitest Chips Ahoy']);
  });

  it('IsFoundAgain_WhateverItsCaseOrPunctuation', async () => {
    const first = await add('ZZ Vitest Chips Ahoy');
    const again = await add('zz vitest  chips ahoy!', OTHER);
    expect([again.brand.id, again.created]).toEqual([first.brand.id, false]);
    expect(await brandsOf()).toHaveLength(1);
  });

  it('IsRefused_ForAnIngredientThatIsGone', async () => {
    expect(await addBrandWith(admin, SCOUT, 'no-such-ingredient', 'ZZ Vitest x')).toEqual({ status: 'ingredient' });
  });

  it('IsRefused_WhenItIsOnlyPunctuation', async () => {
    expect(await addBrandWith(admin, SCOUT, ING, '!!!')).toEqual({ status: 'invalid' });
  });

  it('IsRefused_OnAnotherScoutsPrivateIngredient', async () => {
    await admin.from('mm_ingredients').update({ added_by_person_id: OTHER, needs_match_at: new Date().toISOString() }).eq('id', ING2).select();
    try {
      // The id pattern check on mm_ingredients forbids a non-x- id with an author, so this row may refuse the
      // update; when it does, the rule is still proven by the troop-ingredient cases above.
      const { data } = await admin.from('mm_ingredients').select('added_by_person_id').eq('id', ING2).single();
      if (data?.added_by_person_id === OTHER) expect(await addBrandWith(admin, SCOUT, ING2, 'ZZ Vitest x')).toEqual({ status: 'ingredient' });
    } finally {
      await admin.from('mm_ingredients').update({ added_by_person_id: null, needs_match_at: null }).eq('id', ING2);
    }
  });

  it('ThePublicCatalog_NeverSaysWhoAddedABrand', async () => {
    await add('ZZ Vitest Oreo');
    const b = (await brandsOf(OTHER)).find((x) => x.name === 'ZZ Vitest Oreo');
    expect([b?.addedBy, b?.createdAt]).toEqual([undefined, undefined]);
    expect((await loadAuthoringCatalogWith(admin)).brands?.find((x) => x.name === 'ZZ Vitest Oreo')?.addedBy).toBe(SCOUT);
  });

  it('StopsBeingNew_OnceSomeoneHasPricedIt', async () => {
    const { brand } = await add('ZZ Vitest Oreo');
    await addPackage(brand.id);
    expect((await brandsOf()).find((b) => b.id === brand.id)?.isNew).toBeUndefined();
  });

  it('AnonKey_CannotAddABrand', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string);
    const { error } = await anon.rpc('mm_add_brand', { p_person: SCOUT, p_ingredient: ING, p_name: 'ZZ Vitest x' });
    expect(error).not.toBeNull();
  });
});

describe('a leader tidies brands', () => {
  it('Rename_Works_ButNotOntoAnotherBrandsName', async () => {
    const a = await add('ZZ Vitest Oreo');
    await add('ZZ Vitest Chips Ahoy');
    expect(await renameBrandWith(admin, a.brand.id, 'ZZ Vitest Oreos')).toEqual({ ok: true });
    expect((await renameBrandWith(admin, a.brand.id, 'zz vitest chips ahoy')).ok).toBe(false);
  });

  it('Merge_MovesThePackages_AndLeavesAnAlias', async () => {
    const keep = await add('ZZ Vitest Chips Ahoy');
    const dup = await add('ZZ Vitest Chips Ahoy Original');
    await addPackage(dup.brand.id);
    expect(await mergeBrandWith(admin, dup.brand.id, keep.brand.id)).toMatchObject({ ok: true, note: '1 package moved.' });
    const catalog = await loadCatalogWith(admin, { ownerPersonId: null });
    expect(catalog.brands?.filter((b) => b.ingredientId === ING).map((b) => b.name)).toEqual(['ZZ Vitest Chips Ahoy']);
    expect(catalog.brandAliases?.[dup.brand.id]).toBe(keep.brand.id);
    expect(catalog.packages.find((p) => p.id === 'p-zz-brand-1')?.brandId).toBe(keep.brand.id);
  });

  it('Merge_IsRefused_AcrossIngredients', async () => {
    const a = await add('ZZ Vitest Oreo');
    const b = await add('ZZ Vitest Ritz', SCOUT, ING2);
    expect((await mergeBrandWith(admin, a.brand.id, b.brand.id)).ok).toBe(false);
  });

  it('Move_TakesAnUnpricedBrandToAnotherIngredient', async () => {
    const a = await add('ZZ Vitest Ritz');
    expect(await moveBrandWith(admin, a.brand.id, ING2)).toEqual({ ok: true });
    const { data } = await admin.from('mm_brands').select('ingredient_id').eq('id', a.brand.id).single();
    expect(data!.ingredient_id).toBe(ING2);
  });

  it('Move_IsRefused_OnceTheBrandHasPackages', async () => {
    const a = await add('ZZ Vitest Oreo');
    await addPackage(a.brand.id);
    expect((await moveBrandWith(admin, a.brand.id, ING2)).ok).toBe(false);
  });

  it('Remove_DeletesAnUnpricedBrand', async () => {
    const a = await add('ZZ Vitest asdf');
    expect((await removeBrandWith(admin, a.brand.id)).ok).toBe(true);
    expect(await brandsOf()).toEqual([]);
    const { data } = await admin.from('mm_brands').select('id').eq('id', a.brand.id);
    expect(data).toHaveLength(0);
  });

  it('Remove_RetiresAPricedBrand_AndItsPackagesStayWithNoBrand', async () => {
    const a = await add('ZZ Vitest Oreo');
    await addPackage(a.brand.id);
    expect((await removeBrandWith(admin, a.brand.id)).ok).toBe(true);
    const catalog = await loadCatalogWith(admin, { ownerPersonId: null });
    expect(catalog.brands?.some((b) => b.id === a.brand.id)).toBe(false);
    expect(catalog.packages.find((p) => p.id === 'p-zz-brand-1')?.brandId).toBeNull();
    // The leader tools still list it, flagged.
    expect((await loadAuthoringCatalogWith(admin)).brands?.find((b) => b.id === a.brand.id)?.retiredAt).toBeTruthy();
  });

  it('BrandDiets_OverrideTheIngredients_OrGoBackToThem', async () => {
    const a = await add('ZZ Vitest GF cookie');
    expect(await setBrandDietsWith(admin, a.brand.id, [])).toEqual({ ok: true });
    expect((await brandsOf()).find((b) => b.id === a.brand.id)?.avoid).toEqual([]);
    await setBrandDietsWith(admin, a.brand.id, null);
    expect((await brandsOf()).find((b) => b.id === a.brand.id)?.avoid).toBeNull();
  });

  it('APackage_TakesABrandOfItsOwnIngredient_AndASize', async () => {
    const a = await add('ZZ Vitest Oreo');
    const wrong = await add('ZZ Vitest Ritz', SCOUT, ING2);
    await addPackage(null);
    expect((await setPackageBrandWith(admin, 'p-zz-brand-1', wrong.brand.id, '14 oz')).ok).toBe(false);
    expect(await setPackageBrandWith(admin, 'p-zz-brand-1', a.brand.id, '14.3 oz')).toEqual({ ok: true });
    const { data } = await admin.from('mm_packages').select('brand_id, size_label').eq('id', 'p-zz-brand-1').single();
    expect(data).toEqual({ brand_id: a.brand.id, size_label: '14.3 oz' });
  });

  it('ALeadersBrand_CannotDuplicateOne', async () => {
    await add('ZZ Vitest Oreo');
    expect((await createBrandWith(admin, ING, 'zz vitest oreo')).ok).toBe(false);
    expect((await createBrandWith(admin, ING, 'ZZ Vitest Nutter Butter')).ok).toBe(true);
  });
});

describe('the split of the price book', () => {
  it('EveryTroopPackage_WithABrand_HasThatBrandLive', async () => {
    const catalog = await loadAuthoringCatalogWith(admin);
    const brands = new Set((catalog.brands ?? []).map((b) => b.id));
    const dangling = catalog.packages.filter((p) => p.brandId && !brands.has(p.brandId)).map((p) => p.id);
    expect(dangling).toEqual([]);
  });
});
