import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { authorRows } from '../src/lib/menu-monster/author-rows';

/**
 * Phase 4A recipe editor rows: one per line in the draft's order, the amount in
 * the chosen view, the per-person amount and its unit for the amount box, and
 * the price book's cheapest package as "What you'd buy".
 */

const lines = [
  { ingredientId: 'bacon', qtyPerPerson: 3, unitKey: null },
  { ingredientId: 'eggs', qtyPerPerson: 1, unitKey: null }
];

describe('authorRows', () => {
  it('Rows_FollowTheDraftOrder', () => {
    expect(authorRows(lines, CATALOG, 8, 'total').map((r) => r.name)).toEqual(['Bacon', 'Eggs']);
  });

  it('Row_KeyIsTheIngredient', () => {
    expect(authorRows(lines, CATALOG, 8, 'total')[0].key).toBe('ing:bacon');
  });

  it('TotalView_ScalesByPeople', () => {
    expect(authorRows(lines, CATALOG, 8, 'total')[0].amount).toBe('24 slices');
  });

  it('PersonView_ShowsEachPersonsAmount', () => {
    expect(authorRows(lines, CATALOG, 8, 'person')[0].amount).toBe('3 slices');
  });

  it('Row_CarriesThePerPersonAmountAndUnit', () => {
    expect(authorRows(lines, CATALOG, 8, 'total')[0]).toMatchObject({ qtyPerPerson: 3, unitLabel: 'slices' });
  });

  it('WhatYoudBuy_IsTheCheapestPackagePerUnit', () => {
    expect(authorRows(lines, CATALOG, 8, 'total')[0].buy).toBe('Kirkland Hickory Smoked Bacon, 4 x 1 lb · $18.15 · Costco');
  });

  it('WhatYoudBuy_IsNull_WithoutAUsablePackage', () => {
    expect(authorRows([{ ingredientId: 'oj', qtyPerPerson: 1, unitKey: null }], CATALOG, 8, 'total')[0].buy).toBeNull();
  });

  it('UnknownIngredient_IsSkipped', () => {
    expect(authorRows([{ ingredientId: 'nope', qtyPerPerson: 1, unitKey: null }], CATALOG, 8, 'total')).toEqual([]);
  });
});
