import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { settleNewBrands } from '../src/lib/menu-monster/brand-detail';
import type { Catalog, Package } from '../src/lib/menu-monster/types';

const brand = (id: string, isNew: boolean) => ({ id, ingredientId: 'eggs', name: id, avoid: null, ...(isNew ? { isNew: true as const } : {}) });
const pkg = (id: string, brandId: string, over: Partial<Package> = {}): Package => ({
  id, ingredientId: 'eggs', name: id, store: null, price: 3, anchorPrice: 3, yield: 12, yieldUnitLabel: null, noun: 'pack', soldSize: null, soldUnit: null, note: null, asOf: null, brandId, ...over
});
const withBits = (brands: Catalog['brands'], packages: Package[]): Catalog => ({ ...CATALOG, brands, packages });

describe('settleNewBrands', () => {
  it('Brand_StopsBeingNew_OnceItHasASizeOfItsOwn', () => {
    const out = settleNewBrands(withBits([brand('b-a', true), brand('b-b', true)], [pkg('p1', 'b-a')]));
    expect(out.brands?.map((b) => [b.id, b.isNew === true])).toEqual([['b-a', false], ['b-b', true]]);
  });

  it('Brand_StaysNew_WhenItsPackageHasNoUsableSize', () => {
    const out = settleNewBrands(withBits([brand('b-a', true)], [pkg('p1', 'b-a', { yield: null })]));
    expect(out.brands?.[0].isNew).toBe(true);
  });

  it('Catalog_IsReturnedAsIs_WhenNothingChanges', () => {
    const c = withBits([brand('b-a', false)], [pkg('p1', 'b-a')]);
    expect(settleNewBrands(c)).toBe(c);
  });
});
