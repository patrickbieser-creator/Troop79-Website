import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { findReceiptWith, hasReceiptWith, insertReceiptWith, loadReceiptWith, setReceiptLineWith } from '../src/lib/menu-monster/receipt-store';

/**
 * Receipts against the local stack (20261030100000_mm_receipts.sql; Plans/Menu-Monster-Receipt-Reconciliation.md).
 * Needs the migration applied: until then every test here fails on a missing table. Rows are named
 * "ZZ Vitest …" (menu) / test-owned ids (ingredient) and removed after each test.
 */
const admin = adminClient();
const OWNER = 39;
const ING = 'zz-receipt-ing';

async function makeMenu(): Promise<string> {
  const { data, error } = await admin
    .from('mm_menus')
    .insert({ owner_person_id: OWNER, name: 'ZZ Vitest receipt menu', context: 'camp', headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budget_per_person_meal: 4, meals: [] })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
async function makeIngredient() {
  const { error } = await admin.from('mm_ingredients').insert({ id: ING, name: 'ZZ Vitest receipt food', unit_kind: 'count', unit_key: 'count', unit_one: 'each', unit_many: 'each', section: 'dry', staple: false, avoid: [] });
  if (error) throw new Error(error.message);
}
const input = (menuId: string, over: Record<string, unknown> = {}) => ({
  menuId, store: 'ZZ Vitest Aldi', boughtAt: '2026-10-08T19:03:00-05:00', subtotal: 9.46, tax: 0, total: 9.46, itemCount: 3, source: 'photo', note: 'test',
  lines: [
    { code: '1', name: 'FC OJ No Pulp', price: 3.49, qty: 2, tax: 'FA', proposedIngredientId: ING },
    { code: '2', name: 'WH/BS Morsels', price: 2.48, qty: 1, tax: 'FA', proposedIngredientId: null }
  ],
  ...over
});
const who = { personId: OWNER, name: 'Maya S.' };

afterEach(async () => {
  await admin.from('mm_menus').delete().eq('name', 'ZZ Vitest receipt menu');
  await admin.from('mm_ingredients').delete().eq('id', ING);
});

describe('receipts', () => {
  it('Insert_StoresTheReceiptAndItsLinesInPrintedOrder', async () => {
    await makeIngredient();
    const menu = await makeMenu();
    const id = await insertReceiptWith(admin, input(menu), OWNER);
    const r = await loadReceiptWith(admin, menu);
    expect(r).toMatchObject({ id, menuId: menu, store: 'ZZ Vitest Aldi', subtotal: 9.46, total: 9.46, itemCount: 3 });
    expect(r!.lines.map((l) => [l.position, l.rawName, l.unitPrice, l.qty, l.status, l.proposedIngredientId])).toEqual([
      [1, 'FC OJ No Pulp', 3.49, 2, 'pending', ING],
      [2, 'WH/BS Morsels', 2.48, 1, 'pending', null]
    ]);
  });

  it('HasReceipt_IsFalseUntilOneIsStored', async () => {
    await makeIngredient();
    const menu = await makeMenu();
    expect(await hasReceiptWith(admin, menu)).toBe(false);
    await insertReceiptWith(admin, input(menu), null);
    expect(await hasReceiptWith(admin, menu)).toBe(true);
  });

  it('Load_ReturnsNull_ForAMenuWithNoReceipt', async () => {
    expect(await loadReceiptWith(admin, await makeMenu())).toBeNull();
  });

  it('Find_RecognisesTheSameInstant_InAnotherOffset', async () => {
    await makeIngredient();
    const menu = await makeMenu();
    const id = await insertReceiptWith(admin, input(menu), null);
    expect(await findReceiptWith(admin, menu, '2026-10-09T00:03:00Z')).toBe(id);
    expect(await findReceiptWith(admin, menu, '2026-10-09T00:04:00Z')).toBeNull();
  });

  it('Insert_RefusesAQuantityOutsideOneToNinetyNine_AndStoresNothing', async () => {
    const menu = await makeMenu();
    await expect(insertReceiptWith(admin, input(menu, { lines: [{ name: 'X', price: 1, qty: 100 }] }), null)).rejects.toThrow(/quantity/);
    expect(await hasReceiptWith(admin, menu)).toBe(false);
  });

  it('Insert_StoresNothing_WhenAProposedIngredientDoesNotExist', async () => {
    const menu = await makeMenu();
    await expect(insertReceiptWith(admin, input(menu), null)).rejects.toThrow();
    expect(await hasReceiptWith(admin, menu)).toBe(false);
  });

  it('Delete_OfTheMenu_TakesTheReceiptAndLinesWithIt', async () => {
    const menu = await makeMenu();
    const id = await insertReceiptWith(admin, input(menu, { lines: [{ name: 'Milk', price: 2.82, qty: 1 }] }), null);
    await admin.from('mm_menus').delete().eq('id', menu);
    expect((await admin.from('mm_receipts').select('id').eq('id', id)).data).toEqual([]);
    expect((await admin.from('mm_receipt_lines').select('id').eq('receipt_id', id)).data).toEqual([]);
  });
});

describe('settling a line', () => {
  async function stored() {
    await makeIngredient();
    const menu = await makeMenu();
    await insertReceiptWith(admin, input(menu), null);
    return (await loadReceiptWith(admin, menu))!.lines;
  }

  it('Confirm_StampsWhoAndWhen_AndKeepsTheIngredient', async () => {
    const [line] = await stored();
    expect(await setReceiptLineWith(admin, line.id, { status: 'confirmed', ingredientId: ING }, who)).toBe(true);
    const { data } = await admin.from('mm_receipt_lines').select('status, ingredient_id, confirmed_by, confirmed_by_person_id, confirmed_at').eq('id', line.id).single();
    expect(data).toMatchObject({ status: 'confirmed', ingredient_id: ING, confirmed_by: 'Maya S.', confirmed_by_person_id: OWNER });
    expect(data!.confirmed_at).not.toBeNull();
  });

  it('Extra_RecordsTheMealAndTheName', async () => {
    const [, line] = await stored();
    await setReceiptLineWith(admin, line.id, { status: 'extra', mealId: 'm-1', label: '  Chocolate   morsels ' }, who);
    const { data } = await admin.from('mm_receipt_lines').select('status, meal_id, label').eq('id', line.id).single();
    expect(data).toEqual({ status: 'extra', meal_id: 'm-1', label: 'Chocolate morsels' });
  });

  it('Reopen_ClearsTheStampAndTheChoice', async () => {
    const [, line] = await stored();
    await setReceiptLineWith(admin, line.id, { status: 'extra', mealId: 'm-1', label: 'Morsels' }, who);
    await setReceiptLineWith(admin, line.id, { status: 'pending' }, who);
    const { data } = await admin.from('mm_receipt_lines').select('status, meal_id, label, ingredient_id, confirmed_by, confirmed_by_person_id, confirmed_at').eq('id', line.id).single();
    expect(data).toEqual({ status: 'pending', meal_id: null, label: null, ingredient_id: null, confirmed_by: null, confirmed_by_person_id: null, confirmed_at: null });
  });

  it('Settle_ReturnsFalse_ForALineThatIsGone', async () => {
    expect(await setReceiptLineWith(admin, 2147483000, { status: 'skipped' }, who)).toBe(false);
  });
});
