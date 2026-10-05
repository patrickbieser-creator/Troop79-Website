import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConversionsTab } from '../src/app/(public)/library/menu-monster/menus/_components/conversions-tab';
import { unitLadders, type FoodRule, type WorkedExample } from '../src/lib/menu-monster/conversion-lesson';

/**
 * The Conversions tab (Patrick, 2026-10-05): read-only, a lesson. A scout sees
 * their own menu's foods worked out, the measures that always convert, and
 * the foods that need their own number — and nothing to edit.
 */
const EXAMPLE: WorkedExample = {
  ingredientId: 'raisins', name: 'Raisins', need: '6 cups', packageName: 'Sun-Maid Raisins', kind: 'food',
  rule: '1 cup = 5.26 oz', math: '20 oz ÷ 5.26 = 3.8 cups', buy: 2
};
const RULES: FoodRule[] = [
  { ingredientId: 'pepper', name: 'Black pepper', rule: '1 oz = 12.3 tsp', source: null },
  { ingredientId: 'raisins', name: 'Raisins', rule: '1 cup = 5.26 oz', source: 'raisins ≈ 5.25 oz per cup' }
];
const show = (examples: WorkedExample[] = [EXAMPLE]) =>
  render(<ConversionsTab menuName="High Cliff" examples={examples} ladders={unitLadders()} rules={RULES} />);

describe('Conversions tab', () => {
  it('Scout_SeesTheirOwnFoodWorkedOut_FromTheLabelToHowManyToBuy', () => {
    show();
    const row = within(screen.getByRole('list', { name: 'On this menu' })).getByRole('listitem');
    expect(within(row).getByText('Raisins')).toBeTruthy();
    expect(within(row).getByText('Needs 6 cups · Sun-Maid Raisins')).toBeTruthy();
    expect(within(row).getByText('1 cup = 5.26 oz, so 20 oz ÷ 5.26 = 3.8 cups.')).toBeTruthy();
    expect(within(row).getByText('Buy 2')).toBeTruthy();
  });

  it('Scout_SeesTheMeasuresThatAlwaysConvert', () => {
    show();
    const volume = screen.getByRole('list', { name: 'How much space it fills' });
    expect(within(volume).getByText('1 cup = 8 fl oz')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'How heavy it is' })).getByText('1 lb = 16 oz')).toBeTruthy();
  });

  it('Scout_SeesEachFoodsOwnNumber_AndWhereItComesFrom', () => {
    show();
    const table = screen.getByRole('table', { name: 'Foods with their own number' });
    const raisins = within(table).getByRole('row', { name: /^Raisins/ });
    expect(within(raisins).getByText('1 cup = 5.26 oz')).toBeTruthy();
    expect(within(raisins).getByText('raisins ≈ 5.25 oz per cup')).toBeTruthy();
  });

  it('Scout_IsToldWhy_WhenNothingOnTheMenuNeedsConverting', () => {
    show([]);
    expect(screen.getByText('Nothing to convert yet. Foods show up here as they go on the Plan tab.')).toBeTruthy();
  });

  it('Scout_CannotEditAnything', () => {
    show();
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
  });
});
