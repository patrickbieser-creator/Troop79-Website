import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import { seedPlan } from '../src/lib/menu-monster/engine';
import {
  defaultSwapQty,
  menuEditRows,
  opsWithAdded,
  opsWithAmount,
  opsWithLeaveOut,
  opsWithSwap,
  opsWithoutAdded,
  opsWithoutOp
} from '../src/lib/menu-monster/ingredient-rows';
import type { EditOp } from '../src/lib/menu-monster/menus';
import type { Plan, Recipe } from '../src/lib/menu-monster/types';
import { IngredientList, type RowAction } from '../src/app/(public)/library/menu-monster/_components/ingredient-list';

/**
 * IngredientList, menu-edit mode (Phase 2 release A, P2.2): a menu's own
 * version of a recipe. The harness keeps the ops like the meal page does and
 * feeds the rows back, so these tests drive the real round trip: ⋯ -> action ->
 * ops -> rows. The shared recipe is never touched.
 */

const bacon = CATALOG.recipes.find((r) => r.id === 'B003') as Recipe;
const plan: Plan = { ...seedPlan(CATALOG), headcount: 8, restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 } };
const CHOICES = CATALOG.ingredients.map((i) => ({ id: i.id, name: i.name }));

function Harness({ onAnnounce = () => {}, initial = [] }: { onAnnounce?: (t: string) => void; initial?: EditOp[] }) {
  const [ops, setOps] = useState<EditOp[]>(initial);
  const rows = menuEditRows(bacon, ops, CATALOG, plan, 'total');
  const act = (a: RowAction) => {
    if (a.type === 'add') return setOps((cur) => opsWithAdded(cur, a.ingredientId, 1));
    const e = rows.find((r) => r.key === a.key)?.edit;
    if (!e) return;
    setOps((cur) => {
      if (a.type === 'amount') return opsWithAmount(cur, e, a.qtyPerPerson);
      if (a.type === 'swap') return opsWithSwap(cur, e, a.to, defaultSwapQty(e, a.to, CATALOG));
      if (a.type === 'leave_out') return opsWithLeaveOut(cur, e);
      if (a.type === 'remove') return opsWithoutAdded(cur, e.ingredientId);
      return opsWithoutOp(cur, e);
    });
  };
  return <IngredientList mode="menu-edit" ariaLabel="Bacon ingredients" rows={rows} choices={CHOICES} onAction={act} onAnnounce={onAnnounce} />;
}

const user = () => userEvent.setup();
const li = (name: string) => screen.getByText(name, { selector: 'span' }).closest('li') as HTMLElement;
const more = (name: string) => screen.getByRole('button', { name: `Change ${name}` });
const pickItem = async (u: ReturnType<typeof userEvent.setup>, rowName: string, item: string) => {
  await u.click(more(rowName));
  await u.click(screen.getByRole('button', { name: item }));
};

describe('IngredientList (menu-edit)', () => {
  it('Row_HasADisclosureMenu_WithTheEditActions', async () => {
    const u = user();
    render(<Harness />);
    await u.click(more('Bacon'));
    const items = screen.getAllByRole('button').filter((b) => ['Change amount', 'Swap for…', 'Leave out'].includes(b.textContent ?? ''));
    expect(items).toHaveLength(3);
  });

  it('Menu_IsADisclosure_WithAriaExpanded', async () => {
    const u = user();
    render(<Harness />);
    expect(more('Bacon').getAttribute('aria-expanded')).toBe('false');
    await u.click(more('Bacon'));
    expect(more('Bacon').getAttribute('aria-expanded')).toBe('true');
  });

  it('Scout_CanChangeTheAmount_ShowingTheTroopsAmountStruck', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Change amount');
    const box = screen.getByRole('textbox', { name: 'Amount per person of Bacon, in slices' });
    await u.clear(box);
    await u.type(box, '2{Enter}');
    const row = li('Bacon');
    expect({ now: within(row).queryByText('16 slices') != null, was: row.querySelector('s')?.textContent }).toEqual({ now: true, was: 'was 24 slices' });
  });

  it('AmountBox_AcceptsAFraction', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Change amount');
    const box = screen.getByRole('textbox', { name: /Amount per person of Bacon/ });
    await u.clear(box);
    await u.type(box, '1 1/2{Enter}');
    expect(within(li('Bacon')).getByText('12 slices')).toBeTruthy();
  });

  it('AmountBox_AsksAgain_WhenTheAmountIsNotAboveZero', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Change amount');
    const box = screen.getByRole('textbox', { name: /Amount per person of Bacon/ });
    await u.clear(box);
    await u.type(box, '0{Enter}');
    expect(screen.getByRole('alert').textContent).toBe('Enter an amount above 0.');
  });

  it('AmountBox_Escape_CancelsAndReturnsFocusToTheMenuButton', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Change amount');
    await u.keyboard('{Escape}');
    expect({ box: screen.queryByRole('textbox', { name: /Amount per person/ }), focused: document.activeElement }).toEqual({ box: null, focused: more('Bacon') });
  });

  it('AmountBox_Enter_ReturnsFocusToTheMenuButton', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Change amount');
    await u.clear(screen.getByRole('textbox', { name: /Amount per person of Bacon/ }));
    await u.type(screen.getByRole('textbox', { name: /Amount per person of Bacon/ }), '2{Enter}');
    expect(document.activeElement).toBe(more('Bacon'));
  });

  it('Scout_CanSwapAnIngredient_ShowingTheTroopsItemStruck', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Swap for…');
    await u.type(screen.getByRole('combobox', { name: 'Swap Bacon for' }), 'bread');
    await u.click(screen.getByRole('option', { name: 'Bread' }));
    const row = li('Bread');
    expect(row.querySelector('s')?.textContent).toBe('was Bacon');
  });

  it('Swap_ThenAsksForTheNewAmount_BecauseTheUnitMayDiffer', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Swap for…');
    await u.type(screen.getByRole('combobox', { name: 'Swap Bacon for' }), 'orange');
    await u.click(screen.getByRole('option', { name: 'Orange juice' }));
    const box = screen.getByRole('textbox', { name: 'Amount per person of Orange juice, in cups' });
    expect(document.activeElement).toBe(box);
  });

  it('Swap_DoesNotOfferTheIngredientsAlreadyInTheRecipe', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Swap for…');
    await u.type(screen.getByRole('combobox', { name: 'Swap Bacon for' }), 'bacon');
    expect(screen.queryByRole('option', { name: 'Bacon' })).toBeNull();
  });

  it('Swap_Escape_ClosesTheSearchAndReturnsFocusToTheMenuButton', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Swap for…');
    await u.keyboard('{Escape}');
    expect({ search: screen.queryByRole('combobox', { name: 'Swap Bacon for' }), focused: document.activeElement }).toEqual({ search: null, focused: more('Bacon') });
  });

  it('Scout_CanLeaveAnIngredientOut_AndPutItBack', async () => {
    const u = user();
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Leave out');
    const out = li('Bacon').textContent;
    await pickItem(u, 'Bacon', 'Put back');
    expect({ out: out?.includes('Left out'), back: li('Bacon').textContent?.includes('24 slices') }).toEqual({ out: true, back: true });
  });

  it('LeftOutRow_OffersOnlyPutBack', async () => {
    const u = user();
    render(<Harness initial={[{ op: 'leave_out', ingredientId: 'bacon' }]} />);
    await u.click(more('Bacon'));
    expect(screen.queryByRole('button', { name: 'Change amount' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Put back' })).toBeTruthy();
  });

  it('Scout_CanGoBackToTheTroopAmount', async () => {
    const u = user();
    render(<Harness initial={[{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 }]} />);
    await pickItem(u, 'Bacon', 'Back to the troop amount');
    expect({ amount: within(li('Bacon')).queryByText('24 slices') != null, struck: li('Bacon').querySelector('s') }).toEqual({ amount: true, struck: null });
  });

  it('Scout_CanGoBackToTheTroopIngredient_FromASwap', async () => {
    const u = user();
    render(<Harness initial={[{ op: 'swap', ingredientId: 'bacon', to: 'bread', qtyPerPerson: 3 }]} />);
    await pickItem(u, 'Bread', 'Back to Bacon');
    expect(screen.getByText('Bacon', { selector: 'span' })).toBeTruthy();
  });

  it('Scout_CanAddAnIngredient_TaggedAddedAndAskedHowMuch', async () => {
    const u = user();
    render(<Harness />);
    await u.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await u.type(screen.getByRole('combobox', { name: 'Add an ingredient to your version' }), 'eggs');
    await u.click(screen.getByRole('option', { name: 'Eggs' }));
    expect({ tag: li('Eggs').textContent?.includes('Added'), asked: document.activeElement === screen.getByRole('textbox', { name: 'Amount per person of Eggs, in eggs' }) }).toEqual({ tag: true, asked: true });
  });

  it('AddedRow_CanBeRemoved_AndFocusReturnsToTheAddBox', async () => {
    const u = user();
    render(<Harness initial={[{ op: 'add', ingredientId: 'eggs', qtyPerPerson: 2 }]} />);
    await pickItem(u, 'Eggs', 'Remove');
    expect({ gone: screen.queryByText('Eggs', { selector: 'span' }), focused: document.activeElement }).toEqual({
      gone: null,
      focused: screen.getByRole('button', { name: '+ Ingredient' })
    });
  });

  it('Add_DoesNotOfferAnIngredientTheRecipeAlreadyHas', async () => {
    const u = user();
    render(<Harness />);
    await u.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await u.type(screen.getByRole('combobox', { name: 'Add an ingredient to your version' }), 'bacon');
    expect(screen.queryByRole('option', { name: 'Bacon' })).toBeNull();
  });

  it('Changes_AreAnnounced', async () => {
    const u = user();
    const announce = vi.fn();
    render(<Harness onAnnounce={announce} />);
    await pickItem(u, 'Bacon', 'Leave out');
    expect(announce).toHaveBeenCalledWith('Bacon left out of your version.');
  });

  it('SharedRecipe_IsNeverChangedByAnEdit', async () => {
    const u = user();
    const before = JSON.stringify(bacon);
    render(<Harness />);
    await pickItem(u, 'Bacon', 'Leave out');
    expect(JSON.stringify(bacon)).toBe(before);
  });
});
