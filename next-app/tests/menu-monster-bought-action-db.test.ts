import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * "What we bought" — the save action against the local stack (Plans/Menu-Monster-Brands-Gear.md, release 4;
 * 20261009100000_mm_bought.sql). The request glue is mocked at one seam — who is recording (menuRecorder) —
 * and everything below it is real: the catalog, the menu's priced list, the price book and its ±30% band,
 * typed brands, the per-line merge.
 *
 * Fixtures: one ingredient, two brands, two packages, a recipe and a menu, all named "zz-bought-…" /
 * "ZZ Bought …"; removed afterwards.
 */
const admin = adminClient();
const OWNER = 39;
const OTHER = 25;
const ING = 'zz-bought-cookies';
const RECIPE = 'zz-bought-recipe';
const P_OREO = 'p-zz-bought-oreo';
const P_AHOY = 'p-zz-bought-ahoy';
const B_OREO = 'b-zz-bought-oreo';
const B_AHOY = 'b-zz-bought-ahoy';

const recorder = vi.hoisted(() => ({ current: null as null | { access: string; personId: number | null; name: string } }));
let MENU = '';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
// data.ts is the server-only wrapper around the real loader; the loader itself is what runs here.
vi.mock('@/lib/menu-monster/data', async () => {
  const { loadCatalogWith } = await import('../src/lib/menu-monster/catalog');
  return { loadMenuMonsterCatalog: (ownerPersonId: number | null) => loadCatalogWith(adminClient(), { ownerPersonId }) };
});
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/scout-menus', async () => {
  const { loadMenuWith } = await import('../src/lib/menu-monster/menus-store');
  return {
    menuRecorder: async (menuId: string) => {
      if (!recorder.current) return null;
      const stored = await loadMenuWith(adminClient(), menuId);
      return stored ? { ...recorder.current, stored } : null;
    }
  };
});

import { saveBoughtAction, setShoppingDoneAction } from '../src/app/(public)/library/_tools/menu-monster/bought-actions';

async function cleanup() {
  await admin.from('mm_menus').delete().eq('name', 'ZZ Bought menu');
  await admin.from('mm_recipe_lines').delete().eq('recipe_id', RECIPE);
  await admin.from('mm_recipes').delete().eq('id', RECIPE);
  const { data: pk } = await admin.from('mm_packages').select('id').eq('ingredient_id', ING);
  const ids = (pk ?? []).map((p) => p.id as string);
  if (ids.length) await admin.from('mm_price_history').delete().in('package_id', ids);
  await admin.from('mm_packages').delete().eq('ingredient_id', ING);
  await admin.from('mm_brands').delete().eq('ingredient_id', ING);
  await admin.from('mm_ingredients').delete().eq('id', ING);
  await admin.from('audit_log').delete().like('summary', '%ZZ Bought%');
}

beforeAll(async () => {
  await cleanup();
  const must = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await q;
    if (error) throw new Error(error.message);
  };
  await must(admin.from('mm_ingredients').insert({ id: ING, name: 'ZZ Bought cookies', unit_kind: 'count', unit_key: 'count', unit_one: 'cookie', unit_many: 'cookies', section: 'bakery', staple: false, avoid: [] }));
  await must(admin.from('mm_brands').insert([{ id: B_OREO, ingredient_id: ING, name: 'ZZ Bought Oreo' }, { id: B_AHOY, ingredient_id: ING, name: 'ZZ Bought Chips Ahoy' }]));
  await must(
    admin.from('mm_packages').insert([
      { id: P_OREO, ingredient_id: ING, name: 'ZZ Bought Oreo, 36 ct', price: 4, yield: 36, as_of: '2026-10-01', brand_id: B_OREO, size_label: '36 ct' },
      { id: P_AHOY, ingredient_id: ING, name: 'ZZ Bought Chips Ahoy, 40 ct', price: 5, yield: 40, as_of: '2026-10-01', brand_id: B_AHOY, size_label: '40 ct' }
    ])
  );
  await must(admin.from('mm_recipes').insert({ id: RECIPE, name: 'ZZ Bought cookies', status: 'published', meal_fit: ['snack'], sort_order: 9999 }));
  await must(admin.from('mm_recipe_lines').insert({ recipe_id: RECIPE, position: 1, ingredient_id: ING, qty_per_person: 2, serves_rule: 'everyone' }));
  const { data, error } = await admin
    .from('mm_menus')
    .insert({
      owner_person_id: OWNER, name: 'ZZ Bought menu', context: 'camp', calendar_entry_id: 35, headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budget_per_person_meal: 4,
      shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {}, brands: { [ING]: [{ brandId: B_OREO, qty: null }] } },
      meals: [{ id: 'm1', day: 0, slot: 'snack', headcount: null, recipeIds: [RECIPE], recipeEdits: {} }]
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  MENU = data.id as string;
});
afterAll(cleanup);

beforeEach(async () => {
  recorder.current = { access: 'owner', personId: OWNER, name: 'Charlie W.' };
  await admin.from('mm_menus').update({ bought: {} }).eq('id', MENU);
  await admin.from('mm_packages').update({ price: 4, anchor_price: 4 }).eq('id', P_OREO);
});

const stored = async () => (await admin.from('mm_menus').select('bought, updated_at').eq('id', MENU).single()).data as { bought: { lines?: Record<string, { status: string; items: unknown[]; by: string; personId: number }>; done?: { by: string } }; updated_at: string };
const oreoPrice = async () => Number((await admin.from('mm_packages').select('price').eq('id', P_OREO).single()).data!.price);
const bought = (items: unknown[]) => ({ [ING]: { status: 'bought', items } });

describe('saveBoughtAction', () => {
  it('RecordsALine_WithWhoAndWhen_WithoutTouchingTheMenusVersion', async () => {
    const before = (await stored()).updated_at;
    const res = await saveBoughtAction(MENU, bought([{ brandId: B_OREO, packageId: P_OREO, qty: 1, pricePaid: 4 }]));
    expect(res).toMatchObject({ ok: true, results: { [ING]: 'saved' } });
    const row = await stored();
    expect(row.bought.lines?.[ING]).toMatchObject({ status: 'bought', by: 'Charlie W.', personId: OWNER, items: [{ brandId: B_OREO, packageId: P_OREO, qty: 1, pricePaid: 4 }] });
    expect(row.updated_at).toBe(before);
  });

  it('AFoodWithNoPriceYet_CanBeRecorded_AndTheSpendIsKept', async () => {
    // Most foods start unpriced (2026-10-05): the checklist carries them and takes what was paid.
    await admin.from('mm_packages').update({ retired_at: new Date().toISOString() }).eq('ingredient_id', ING);
    try {
      const res = await saveBoughtAction(MENU, bought([{ brandId: null, packageId: null, qty: 2, pricePaid: 3.25 }]));
      expect(res).toMatchObject({ ok: true, results: { [ING]: 'saved' } });
      expect((await stored()).bought.lines?.[ING]).toMatchObject({ status: 'bought', items: [{ brandId: null, packageId: null, qty: 2, pricePaid: 3.25 }] });
    } finally {
      await admin.from('mm_packages').update({ retired_at: null }).eq('ingredient_id', ING);
    }
  });

  it('APriceInsideTheBand_UpdatesThePriceBook', async () => {
    const res = await saveBoughtAction(MENU, bought([{ packageId: P_OREO, qty: 1, pricePaid: 4.8 }]));
    expect(res).toMatchObject({ ok: true, results: { [ING]: 'applied' } });
    expect(await oreoPrice()).toBe(4.8);
  });

  it('APriceTheRecorderNeverTouched_IsNotReported_EvenIfThePageWasStale', async () => {
    // The page showed $3.50 (an old price); the book says $4.00 now. Only the count was changed.
    const res = await saveBoughtAction(MENU, bought([{ packageId: P_OREO, qty: 3, pricePaid: 3.5, seen: 3.5 }]));
    expect(res).toMatchObject({ ok: true, results: { [ING]: 'saved' } });
    expect(await oreoPrice()).toBe(4);
  });

  it('ARefusedNewBrand_LeavesNoBrandBehind', async () => {
    const res = await saveBoughtAction(MENU, bought([{ qty: 500, pricePaid: 4.5, newBrand: { name: 'ZZ Bought Orphan', size: 32, sizeUnit: 'count', sizeLabel: 'cookies' } }]));
    expect(res.ok).toBe(false);
    const noSize = await saveBoughtAction(MENU, bought([{ qty: 1, pricePaid: 4.5, newBrand: { name: 'ZZ Bought Orphan', size: 0, sizeUnit: 'count', sizeLabel: 'cookies' } }]));
    expect(noSize.ok).toBe(false);
    const { data } = await admin.from('mm_brands').select('id').eq('ingredient_id', ING).eq('name', 'ZZ Bought Orphan');
    expect(data).toHaveLength(0);
  });

  it('APriceFarFromTheTroops_IsKeptOnTheMenu_AndHeldForALeader', async () => {
    const res = await saveBoughtAction(MENU, bought([{ packageId: P_OREO, qty: 1, pricePaid: 9 }]));
    expect(res).toMatchObject({ ok: true, results: { [ING]: 'held' } });
    expect(await oreoPrice()).toBe(4);
    expect(((await stored()).bought.lines?.[ING].items[0] as { pricePaid: number }).pricePaid).toBe(9);
  });

  it('ADifferentKnownBrand_IsRecordedAgainstItsPackage', async () => {
    const res = await saveBoughtAction(MENU, bought([{ brandId: B_OREO, packageId: P_AHOY, qty: 2, pricePaid: 5 }]));
    expect(res.ok).toBe(true);
    // The brand comes from the package, never from the client.
    expect((await stored()).bought.lines?.[ING].items[0]).toMatchObject({ brandId: B_AHOY, packageId: P_AHOY, qty: 2 });
  });

  it('SomethingElse_BecomesABrandAndAPackage_AtOnce', async () => {
    const res = await saveBoughtAction(MENU, bought([{ qty: 1, pricePaid: 4.5, newBrand: { name: 'ZZ Bought Nutter Butter', size: 32, sizeUnit: 'count', sizeLabel: 'cookies' } }]));
    expect(res.ok).toBe(true);
    const { data: brand } = await admin.from('mm_brands').select('id, added_by_person_id').eq('ingredient_id', ING).eq('name', 'ZZ Bought Nutter Butter').single();
    expect(brand!.added_by_person_id).toBe(OWNER);
    const { data: pkg } = await admin.from('mm_packages').select('id, price, yield, size_label').eq('brand_id', brand!.id).single();
    expect({ price: Number(pkg!.price), yield: Number(pkg!.yield), size: pkg!.size_label }).toEqual({ price: 4.5, yield: 32, size: '32 cookies' });
    expect((await stored()).bought.lines?.[ING].items[0]).toMatchObject({ brandId: brand!.id, packageId: pkg!.id });
  });

  it('NotBought_AndThenCleared_GoBackToNotRecorded', async () => {
    expect((await saveBoughtAction(MENU, { [ING]: { status: 'not_bought' } })).ok).toBe(true);
    expect((await stored()).bought.lines?.[ING]).toMatchObject({ status: 'not_bought', items: [] });
    expect((await saveBoughtAction(MENU, { [ING]: null })).ok).toBe(true);
    expect((await stored()).bought.lines?.[ING]).toBeUndefined();
  });

  it('TheOutingsCrew_Records_WithTheirOwnName', async () => {
    recorder.current = { access: 'crew', personId: OTHER, name: 'Jack P.' };
    const res = await saveBoughtAction(MENU, bought([{ packageId: P_OREO, qty: 2, pricePaid: 4 }]));
    expect(res.ok).toBe(true);
    expect((await stored()).bought.lines?.[ING]).toMatchObject({ by: 'Jack P.', personId: OTHER });
  });

  it('AnyoneElse_IsRefused_AndNothingIsWritten', async () => {
    recorder.current = null;
    const res = await saveBoughtAction(MENU, bought([{ packageId: P_OREO, qty: 1, pricePaid: 4 }]));
    expect(res).toEqual({ ok: false, error: 'Sign in as a scout on this outing to record what was bought.' });
    expect((await stored()).bought.lines).toBeUndefined();
  });

  it('ALineTheMenuDoesNotBuy_IsRefused', async () => {
    const res = await saveBoughtAction(MENU, { 'pancake-mix': { status: 'not_bought' } });
    expect(res.ok).toBe(false);
  });

  it('APackageOfAnotherIngredient_IsRefused', async () => {
    const { data } = await admin.from('mm_packages').select('id').neq('ingredient_id', ING).limit(1).single();
    const res = await saveBoughtAction(MENU, bought([{ packageId: data!.id, qty: 1, pricePaid: 4 }]));
    expect(res.ok).toBe(false);
    expect((await stored()).bought.lines).toBeUndefined();
  });
});

describe('setShoppingDoneAction', () => {
  it('TicksAndUnticks_ByWhoeverMayRecord', async () => {
    recorder.current = { access: 'crew', personId: OTHER, name: 'Jack P.' };
    expect((await setShoppingDoneAction(MENU, true)).ok).toBe(true);
    expect((await stored()).bought.done).toMatchObject({ by: 'Jack P.' });
    expect((await setShoppingDoneAction(MENU, false)).ok).toBe(true);
    expect((await stored()).bought.done).toBeUndefined();
  });

  it('KeepsTheLines_WhenTheTickChanges', async () => {
    await saveBoughtAction(MENU, { [ING]: { status: 'not_bought' } });
    await setShoppingDoneAction(MENU, true);
    expect((await stored()).bought.lines?.[ING]).toMatchObject({ status: 'not_bought' });
  });

  it('IsRefused_ForSomeoneWhoMayNotRecord', async () => {
    recorder.current = null;
    expect((await setShoppingDoneAction(MENU, true)).ok).toBe(false);
  });
});
