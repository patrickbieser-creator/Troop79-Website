import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IngredientList } from '../src/app/(public)/library/menu-monster/_components/ingredient-list';
import type { AuthorRow } from '../src/app/(public)/library/menu-monster/_components/ingredient-list-author';

/**
 * IngredientList 'author' mode (Phase 4A recipe editor): reorder by the grip's
 * arrow keys and the ⋯ menu, remove, change amount, add from the price book,
 * and the name's "What you'd buy" line. The list only reports actions.
 */

const row = (id: string, name: string, buy: string | null = null): AuthorRow => ({
  key: `ing:${id}`,
  ingredientId: id,
  name,
  amount: '2 cups',
  note: null,
  qtyPerPerson: 0.25,
  unitLabel: 'cups',
  buy
});
const ROWS = [row('a', 'Beans', 'Bush’s Beans, 16 oz · $1.49 · Kroger'), row('b', 'Beef'), row('c', 'Onions')];
const CHOICES = [
  { id: 'a', name: 'Beans' },
  { id: 'd', name: 'Cheddar' }
];

function setup() {
  const onAction = vi.fn();
  const onAnnounce = vi.fn();
  render(<IngredientList mode="author" ariaLabel="Ingredients" rows={ROWS} choices={CHOICES} onAction={onAction} onAnnounce={onAnnounce} />);
  return { onAction, onAnnounce, user: userEvent.setup() };
}
const itemOf = (name: string) => within(screen.getByRole('list', { name: 'Ingredients' })).getByRole('button', { name }).closest('li') as HTMLElement;

describe('IngredientList author mode', () => {
  it('Grip_MovesTheRowDown_OnArrowDown', () => {
    const { onAction } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Reorder Beans/ }), { key: 'ArrowDown' });
    expect(onAction).toHaveBeenCalledWith({ type: 'move', from: 0, to: 1 });
  });

  it('Grip_DoesNothing_PastTheTop', () => {
    const { onAction } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Reorder Beans/ }), { key: 'ArrowUp' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('MoveUp_IsOffered_OnlyBelowTheTop', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Beans' }));
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull();
  });

  it('MoveDown_FromTheMenu_ReportsTheMove', async () => {
    const { user, onAction } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Beef' }));
    await user.click(screen.getByRole('button', { name: 'Move down' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'move', from: 1, to: 2 });
  });

  it('Move_IsAnnounced', () => {
    const { onAnnounce } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Reorder Beef/ }), { key: 'ArrowDown' });
    expect(onAnnounce).toHaveBeenCalledWith('Beef moved to 3 of 3.');
  });

  it('Remove_ReportsTheIngredient', async () => {
    const { user, onAction } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Onions' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'remove', ingredientId: 'c' });
  });

  it('ChangeAmount_ReportsThePerPersonAmount', async () => {
    const { user, onAction } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Beef' }));
    await user.click(screen.getByRole('button', { name: 'Change amount' }));
    const box = screen.getByRole('textbox', { name: 'Amount per person of Beef, in cups' });
    await user.clear(box);
    await user.type(box, '1/2{Enter}');
    expect(onAction).toHaveBeenCalledWith({ type: 'amount', ingredientId: 'b', qtyPerPerson: 0.5 });
  });

  it('Search_OffersOnlyIngredientsNotAlreadyInTheRecipe', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), 'e');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Cheddar']);
  });

  it('Search_ReportsTheAddedIngredient', async () => {
    const { user, onAction } = setup();
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), 'ched');
    await user.click(screen.getByRole('option', { name: 'Cheddar' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'add', ingredientId: 'd' });
  });

  it('Name_ShowsWhatYoudBuy', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Beans' }));
    expect(itemOf('Beans').textContent).toContain('Bush’s Beans, 16 oz · $1.49 · Kroger');
  });

  it('Name_SaysWhenThePriceBookHasNoPackage', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Beef' }));
    expect(itemOf('Beef').textContent).toContain('Not in the price book yet.');
  });

  it('Name_IsADisclosure', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Beans' }));
    expect(screen.getByRole('button', { name: 'Beans' }).getAttribute('aria-expanded')).toBe('true');
  });
});
