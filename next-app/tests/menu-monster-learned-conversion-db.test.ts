import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * A package's typed yield is remembered as the ingredient's conversion
 * (Patrick, 2026-10-05: "I have to add one conversion at a time at the bottom
 * of the price book"). The session and audit trail are stubbed; the database
 * is the real local one. Everything hangs off one fixture ingredient, removed
 * after each test (its packages and conversions cascade or are deleted first).
 */
const ING_ID = 'vitest-learn-raisins';
const admin = adminClient();

const mocks = vi.hoisted(() => ({ audit: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => ({ personId: null }) }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});

import { createPackage, updatePackage, type PackageInput } from '../src/app/admin/(workspace)/library/menu-monster/actions';

const input = (over: Partial<PackageInput> = {}): PackageInput => ({
  ingredientId: ING_ID,
  name: 'vitest raisins 20 oz',
  store: null,
  price: 5,
  soldSize: 20,
  soldUnit: 'ozw',
  yield: 4,
  yieldUnitLabel: null,
  noun: 'pack',
  asOf: '2026-10-01',
  note: null,
  ...over
});

async function conversions() {
  const { data } = await admin.from('mm_conversions').select('from_unit, to_unit, factor, label').eq('ingredient_id', ING_ID).order('id');
  return (data ?? []).map((c) => ({ ...c, factor: Number(c.factor) }));
}

beforeEach(async () => {
  mocks.audit.mockClear();
  const { error } = await admin
    .from('mm_ingredients')
    .insert({ id: ING_ID, name: 'Vitest raisins', unit_kind: 'volume', unit_key: 'cup', unit_one: 'cup', unit_many: 'cups', section: 'dry' });
  if (error) throw new Error(`fixture: ${error.message}`);
});

afterEach(async () => {
  await admin.from('mm_conversions').delete().eq('ingredient_id', ING_ID);
  await admin.from('mm_packages').delete().eq('ingredient_id', ING_ID);
  await admin.from('mm_ingredients').delete().eq('id', ING_ID);
});

describe('createPackage remembers the conversion', () => {
  it('CreatePackage_SavesTheTypedYieldAsAConversion_WhenNoneIsOnFile', async () => {
    const res = await createPackage(input());
    expect(res.ok).toBe(true);
    expect(await conversions()).toEqual([
      { from_unit: 'ozw', to_unit: 'cup', factor: 0.2, label: '20 oz made 4 cups — vitest raisins 20 oz' }
    ]);
  });

  it('CreatePackage_TellsTheFormWhatItRemembered', async () => {
    const res = await createPackage(input());
    expect(res.learned).toBe('1 oz = 0.2 cups');
  });

  it('CreatePackage_LeavesTheConversionAlone_WhenASecondPackageDisagrees', async () => {
    await createPackage(input());
    await createPackage(input({ name: 'vitest raisins 12 oz', soldSize: 12, yield: 3 }));
    expect((await conversions()).map((c) => c.factor)).toEqual([0.2]);
  });

  it('CreatePackage_SavesNoConversion_WhenTheYieldIsLeftBlank', async () => {
    await createPackage(input({ yield: null }));
    expect(await conversions()).toEqual([]);
  });
});

describe('updatePackage remembers the conversion', () => {
  it('UpdatePackage_SavesTheConversion_WhenAnUnusablePackageGetsItsYield', async () => {
    const made = await createPackage(input({ yield: null }));
    const edit = input();
    const res = await updatePackage(made.id as string, edit);
    expect(res.ok).toBe(true);
    expect((await conversions()).map((c) => c.factor)).toEqual([0.2]);
  });
});
