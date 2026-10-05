import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * "Add what you bought" is one act (Patrick, 2026-10-05): the brand, the size, the store and the price go in
 * together, and the package lands under its brand. The session and audit trail are stubbed; the database is
 * the real local one. Everything hangs off one fixture ingredient, removed after each test.
 */
const ING_ID = 'vitest-bought-salt';
const admin = adminClient();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => ({ personId: null }) }));
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { addBought, type BoughtInput } from '../src/app/admin/(workspace)/library/menu-monster/actions';

const input = (over: Partial<BoughtInput> = {}): BoughtInput => ({
  ingredientId: ING_ID,
  name: 'vitest Morton Salt, 26 oz',
  store: null,
  price: 1.99,
  soldSize: 26,
  soldUnit: 'ozw',
  yield: 122,
  yieldUnitLabel: null,
  noun: 'pack',
  asOf: '2026-10-01',
  note: null,
  brandId: null,
  newBrand: null,
  sizeLabel: '26 oz',
  ...over
});

const brands = async () => ((await admin.from('mm_brands').select('id, name').eq('ingredient_id', ING_ID).order('name')).data ?? []) as { id: string; name: string }[];
const packages = async () =>
  ((await admin.from('mm_packages').select('name, brand_id, size_label').eq('ingredient_id', ING_ID).order('name')).data ?? []) as { name: string; brand_id: string | null; size_label: string | null }[];

beforeEach(async () => {
  const { error } = await admin
    .from('mm_ingredients')
    .insert({ id: ING_ID, name: 'Vitest salt', unit_kind: 'volume', unit_key: 'tsp', unit_one: 'tsp', unit_many: 'tsp', section: 'dry' });
  if (error) throw new Error(`fixture: ${error.message}`);
});

afterEach(async () => {
  await admin.from('mm_conversions').delete().eq('ingredient_id', ING_ID);
  await admin.from('mm_packages').delete().eq('ingredient_id', ING_ID);
  await admin.from('mm_brands').delete().eq('ingredient_id', ING_ID);
  await admin.from('mm_ingredients').delete().eq('id', ING_ID);
});

describe('addBought', () => {
  it('AddBought_MakesTheTypedBrand_AndPutsThePackageUnderIt', async () => {
    const res = await addBought(input({ newBrand: 'Vitest Morton' }));
    expect(res.ok).toBe(true);
    const [brand] = await brands();
    expect(brand.name).toBe('Vitest Morton');
    expect(await packages()).toEqual([{ name: 'vitest Morton Salt, 26 oz', brand_id: brand.id, size_label: '26 oz' }]);
  });

  it('AddBought_PutsThePackageUnderAnExistingBrand', async () => {
    await addBought(input({ newBrand: 'Vitest Morton' }));
    const [brand] = await brands();
    await addBought(input({ name: 'vitest Morton Salt, 4 lb', brandId: brand.id, sizeLabel: '4 lb' }));
    expect((await packages()).map((p) => p.brand_id)).toEqual([brand.id, brand.id]);
    expect(await brands()).toHaveLength(1);
  });

  it('AddBought_SavesAPackageWithNoBrand_WhenNoneIsChosen', async () => {
    await addBought(input({ sizeLabel: null }));
    expect(await packages()).toEqual([{ name: 'vitest Morton Salt, 26 oz', brand_id: null, size_label: null }]);
    expect(await brands()).toEqual([]);
  });

  it('AddBought_SavesNothing_WhenTheTypedBrandAlreadyExists', async () => {
    await addBought(input({ newBrand: 'Vitest Morton' }));
    const res = await addBought(input({ name: 'vitest second', newBrand: 'vitest morton' }));
    expect(res.ok).toBe(false);
    expect((await packages()).map((p) => p.name)).toEqual(['vitest Morton Salt, 26 oz']);
  });

  it('AddBought_RefusesABrandOfAnotherIngredient_ButSaysThePackageWasSaved', async () => {
    const { data: other } = await admin.from('mm_brands').select('id').neq('ingredient_id', ING_ID).is('retired_at', null).limit(1).maybeSingle();
    if (!other) return; // no brands in this database: nothing to cross
    const res = await addBought(input({ brandId: (other as { id: string }).id }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Saved vitest Morton Salt, 26 oz, but could not set its brand/);
    expect((await packages()).map((p) => p.brand_id)).toEqual([null]);
  });
});
