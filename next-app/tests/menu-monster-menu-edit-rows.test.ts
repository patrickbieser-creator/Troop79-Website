import { describe, it, expect } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import { seedPlan } from '../src/lib/menu-monster/engine';
import {
  defaultSwapQty,
  ingredientRows,
  menuEditRows,
  opsWithAdded,
  opsWithAmount,
  opsWithLeaveOut,
  opsWithSwap,
  opsWithoutAdded,
  opsWithoutOp,
  type RowEdit
} from '../src/lib/menu-monster/ingredient-rows';
import type { EditOp } from '../src/lib/menu-monster/menus';
import type { Plan, Recipe } from '../src/lib/menu-monster/types';

/**
 * Menu-edit mode (Phase 2 release A, P2.2): the rows of a recipe's list WITH a
 * menu's ops visible, and the pure op builders the list's actions use. The
 * numbers are ingredientRows' own — one line at a time — so they match the
 * shopping list; the shared recipe is never touched.
 */

const pancakes = CATALOG.recipes.find((r) => r.id === 'B001') as Recipe;
const bacon = CATALOG.recipes.find((r) => r.id === 'B003') as Recipe;
const plan: Plan = { ...seedPlan(CATALOG), headcount: 8, restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 } };
const rows = (r: Recipe, ops: EditOp[] = [], view: 'total' | 'person' = 'total') => menuEditRows(r, ops, CATALOG, plan, view);
const byName = (list: ReturnType<typeof rows>, name: string) => list.find((x) => x.name === name)!;
const editOf = (r: Recipe, name: string): RowEdit => byName(rows(r), name).edit!;

describe('menuEditRows', () => {
  it('Rows_MatchTheReadRows_WhenThereAreNoEdits', () => {
    const read = ingredientRows(pancakes, CATALOG, plan, 'total').map((r) => [r.name, r.amount, r.note]);
    expect(rows(pancakes).map((r) => [r.name, r.amount, r.note])).toEqual(read);
  });

  it('Rows_HaveNoMarker_WhenThereAreNoEdits', () => {
    expect(rows(pancakes).every((r) => r.marker === undefined)).toBe(true);
  });

  it('ChangedAmount_ShowsTheNewAmount_AndKeepsTheTroopsAsWas', () => {
    const r = byName(rows(pancakes, [{ op: 'amount', ingredientId: 'pancake-mix', qtyPerPerson: 1 }]), 'Pancake mix');
    expect({ amount: r.amount, marker: r.marker }).toEqual({ amount: '7 cups', marker: { kind: 'changed', was: '3½ cups' } });
  });

  it('SwappedRow_ShowsTheNewIngredient_AndNamesTheOldAsWas', () => {
    const r = rows(pancakes, [{ op: 'swap', ingredientId: 'pancake-mix', to: 'oj', qtyPerPerson: 1 }]).find((x) => x.name === 'Orange juice')!;
    expect({ marker: r.marker, current: r.edit?.currentIngredientId, target: r.edit?.ingredientId }).toEqual({
      marker: { kind: 'swapped', was: 'Pancake mix' },
      current: 'oj',
      target: 'pancake-mix'
    });
  });

  it('LeftOutRow_StaysInTheList_WithNoAmount', () => {
    const r = byName(rows(bacon, [{ op: 'leave_out', ingredientId: 'bacon' }]), 'Bacon');
    expect({ amount: r.amount, marker: r.marker, op: r.edit?.op }).toEqual({ amount: '', marker: { kind: 'out' }, op: 'leave_out' });
  });

  it('AddedIngredient_IsTheLastRow_TaggedAdded', () => {
    const list = rows(bacon, [{ op: 'add', ingredientId: 'eggs', qtyPerPerson: 2 }]);
    const last = list[list.length - 1];
    expect({ name: last.name, amount: last.amount, marker: last.marker, kind: last.edit?.kind }).toEqual({
      name: 'Eggs',
      amount: '16',
      marker: { kind: 'added' },
      kind: 'added'
    });
  });

  it('Rows_CarryThePerPersonAmountAndUnit_ForTheAmountEditor', () => {
    expect(editOf(pancakes, 'Pancake mix')).toMatchObject({ kind: 'base', qtyPerPerson: 0.5, unitLabel: 'cups', baseQty: 0.5 });
  });

  it('EditsToOneRecipe_DoNotChangeTheSharedRecipe', () => {
    const before = JSON.stringify(pancakes);
    rows(pancakes, [{ op: 'leave_out', ingredientId: 'pancake-mix' }]);
    expect(JSON.stringify(pancakes)).toBe(before);
  });
});

describe('op builders', () => {
  const base = editOf(bacon, 'Bacon');

  it('Amount_AddsAnAmountOp_WhenItDiffersFromTheTroops', () => {
    expect(opsWithAmount([], base, 2)).toEqual([{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 }]);
  });

  it('Amount_ReplacesThePreviousAmountOp', () => {
    const ops = opsWithAmount([{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 }], { ...base, op: 'amount' }, 4);
    expect(ops).toEqual([{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 4 }]);
  });

  it('Amount_DropsTheOp_WhenItEqualsTheTroopsAmount', () => {
    expect(opsWithAmount([{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 }], { ...base, op: 'amount' }, 3)).toEqual([]);
  });

  it('Amount_KeepsTheSwap_WhenTheRowIsSwapped', () => {
    const swapped = { ...base, op: 'swap' as const };
    const ops = opsWithAmount([{ op: 'swap', ingredientId: 'bacon', to: 'eggs', qtyPerPerson: 1 }], swapped, 2);
    expect(ops).toEqual([{ op: 'swap', ingredientId: 'bacon', to: 'eggs', qtyPerPerson: 2 }]);
  });

  it('Amount_ChangesAnAddedRowsOwnAmount', () => {
    const added: RowEdit = { kind: 'added', ingredientId: 'eggs', currentIngredientId: 'eggs', qtyPerPerson: 1, unitLabel: 'eggs' };
    expect(opsWithAmount([{ op: 'add', ingredientId: 'eggs', qtyPerPerson: 1 }], added, 3)).toEqual([{ op: 'add', ingredientId: 'eggs', qtyPerPerson: 3 }]);
  });

  it('Swap_ReplacesAnAmountOpOnTheSameRow', () => {
    const ops = opsWithSwap([{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 }], base, 'eggs', 1);
    expect(ops).toEqual([{ op: 'swap', ingredientId: 'bacon', to: 'eggs', qtyPerPerson: 1 }]);
  });

  it('LeaveOut_ReplacesAnyOpOnTheRow', () => {
    expect(opsWithLeaveOut([{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 }], base)).toEqual([{ op: 'leave_out', ingredientId: 'bacon' }]);
  });

  it('WithoutOp_PutsARowBack_AndLeavesOtherRowsAlone', () => {
    const ops: EditOp[] = [
      { op: 'leave_out', ingredientId: 'bacon' },
      { op: 'add', ingredientId: 'bacon', qtyPerPerson: 1 },
      { op: 'amount', ingredientId: 'eggs', qtyPerPerson: 2 }
    ];
    expect(opsWithoutOp(ops, base)).toEqual([ops[1], ops[2]]);
  });

  it('Added_IsReplacedNotDuplicated_WhenTheSameIngredientIsAddedAgain', () => {
    const ops = opsWithAdded([{ op: 'add', ingredientId: 'eggs', qtyPerPerson: 1 }], 'eggs', 2);
    expect(ops).toEqual([{ op: 'add', ingredientId: 'eggs', qtyPerPerson: 2 }]);
  });

  it('RemovedAdded_LeavesATroopOpOnTheSameIngredient', () => {
    const ops: EditOp[] = [
      { op: 'amount', ingredientId: 'eggs', qtyPerPerson: 2 },
      { op: 'add', ingredientId: 'eggs', qtyPerPerson: 1 }
    ];
    expect(opsWithoutAdded(ops, 'eggs')).toEqual([ops[0]]);
  });

  it('SwapStartsAtTheTroopsAmount_WhenTheNewIngredientIsCountedTheSameWay', () => {
    expect(defaultSwapQty(base, 'bread', CATALOG)).toBe(3); // slice -> slice
  });

  it('SwapStartsAtOne_WhenTheNewIngredientIsCountedInAnotherUnit', () => {
    expect(defaultSwapQty(base, 'oj', CATALOG)).toBe(1); // slice -> cup
  });
});
