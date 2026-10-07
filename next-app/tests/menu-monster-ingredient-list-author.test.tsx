import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IngredientList } from '../src/app/(public)/library/menu-monster/_components/ingredient-list';
import { UNITS, lineUnit, parseAmountWithUnit, supportedUnits } from '../src/lib/menu-monster/units';
import type { Ingredient } from '../src/lib/menu-monster/types';
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
    expect(onAction).toHaveBeenCalledWith({ type: 'amount', ingredientId: 'b', qtyPerPerson: 0.5, scale: 'person' });
  });

  it('ChangeAmount_CanMarkTheLine_ForTheWholeMeal', async () => {
    const { user, onAction } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Beef' }));
    await user.click(screen.getByRole('button', { name: 'Change amount' }));
    const group = screen.getByRole('radiogroup', { name: 'What the Beef amount is for' });
    expect((within(group).getByRole('radio', { name: 'per person' }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(group).getByRole('radio', { name: 'whole meal' }));
    // Moving from the box to the choice is still editing: nothing is committed yet.
    expect(onAction).not.toHaveBeenCalled();
    const box = screen.getByRole('textbox', { name: 'Amount of Beef for the whole meal, in cups' });
    await user.clear(box);
    await user.type(box, '4{Enter}');
    expect(onAction).toHaveBeenCalledWith({ type: 'amount', ingredientId: 'b', qtyPerPerson: 4, scale: 'meal' });
  });

  it('ChangeAmount_ReportsAScaleChange_WithTheSameNumber', async () => {
    const { user, onAction } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Beef' }));
    await user.click(screen.getByRole('button', { name: 'Change amount' }));
    await user.click(screen.getByRole('radio', { name: 'whole meal' }));
    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledWith({ type: 'amount', ingredientId: 'b', qtyPerPerson: 0.25, scale: 'meal' });
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

/* A row that can be written in more than one unit (cooking oil is measured in Tbsp, the recipe needs cups). */
const unitRow = (ing: Ingredient, conversions: { ingredientId: string; from: string; to: string; factor: number; label: string | null }[] = []): AuthorRow => ({
  key: `ing:${ing.id}`,
  ingredientId: ing.id,
  name: ing.name,
  amount: `2 ${ing.unit.many}`,
  note: null,
  qtyPerPerson: 2,
  unitLabel: ing.unit.many,
  buy: null,
  unitKey: null,
  units: supportedUnits(ing, conversions).map((k) => ({ key: k, label: lineUnit(k, ing).many })),
  parseAmount: (t) => parseAmountWithUnit(t, ing, conversions)
});
const mk = (id: string, name: string, unit: Ingredient['unit']): Ingredient => ({ id, name, unit, section: 'dry', staple: false, avoid: [], retiredAt: null });
const OIL = mk('oil', 'Cooking oil', UNITS.tbsp);
const EGGS = mk('eggs', 'Eggs', UNITS.egg);

function setupUnits(r: AuthorRow) {
  const onAction = vi.fn();
  render(<IngredientList mode="author" ariaLabel="Ingredients" rows={[r]} choices={[]} onAction={onAction} onAnnounce={vi.fn()} />);
  return { onAction, user: userEvent.setup() };
}
async function openAmount(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Change ${name}` }));
  await user.click(screen.getByRole('button', { name: 'Change amount' }));
}

describe('IngredientList author mode: the unit of a line', () => {
  it('Scout_WritesALine_InCups_ForATablespoonIngredient', async () => {
    const { user, onAction } = setupUnits(unitRow(OIL));
    await openAmount(user, 'Cooking oil');
    const select = screen.getByRole('combobox', { name: 'Unit for Cooking oil' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Tbsp', 'cups', 'tsp', 'quarts', 'gallons', 'fl oz']);
    await user.selectOptions(select, 'cup');
    const box = screen.getByRole('textbox', { name: 'Amount per person of Cooking oil, in cups' });
    await user.clear(box);
    await user.click(screen.getByRole('radio', { name: 'whole meal' }));
    await user.type(box, '4{Enter}');
    expect(onAction).toHaveBeenCalledWith({ type: 'amount', ingredientId: 'oil', qtyPerPerson: 4, scale: 'meal', unitKey: 'cup' });
  });

  it('Scout_SeesNoUnitChoice_WhenOnlyOneUnitExists', async () => {
    const { user } = setupUnits(unitRow(EGGS));
    await openAmount(user, 'Eggs');
    expect(screen.queryByRole('combobox', { name: 'Unit for Eggs' })).toBeNull();
    expect(screen.getByText('eggs')).toBeTruthy();
  });

  it('Scout_TypesFourCups_AndTheLineIsInCups', async () => {
    const { user, onAction } = setupUnits(unitRow(OIL));
    await openAmount(user, 'Cooking oil');
    const box = screen.getByRole('textbox', { name: /Amount per person of Cooking oil/ });
    await user.clear(box);
    await user.type(box, '4 cups{Enter}');
    expect(onAction).toHaveBeenCalledWith({ type: 'amount', ingredientId: 'oil', qtyPerPerson: 4, scale: 'person', unitKey: 'cup' });
  });

  it('Scout_IsToldInPlace_WhenTheTypedUnitCannotBeConverted', async () => {
    const { user, onAction } = setupUnits(unitRow(EGGS));
    await openAmount(user, 'Eggs');
    const box = screen.getByRole('textbox', { name: /Amount per person of Eggs/ });
    await user.clear(box);
    await user.type(box, '4 cups{Enter}');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('cups is not a unit the Price book can convert for Eggs. Ask a leader to add a conversion.');
    expect(onAction).not.toHaveBeenCalled();
  });
});
