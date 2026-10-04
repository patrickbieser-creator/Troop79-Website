import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Phase 4B admin › Scout recipes › New ingredients: Match (factor prefilled within a unit family) and Keep as new. */

const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const matchScoutIngredient = vi.fn();
const keepScoutIngredient = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  matchScoutIngredient: (...a: unknown[]) => matchScoutIngredient(...a),
  keepScoutIngredient: (...a: unknown[]) => keepScoutIngredient(...a)
}));

import { ScoutIngredients } from '../src/app/admin/(workspace)/library/menu-monster/scout-ingredients';

const ITEM = {
  id: 'x-0000aaaa',
  name: 'Gochujang',
  unit: { key: 'ozw', one: 'oz', many: 'oz', kind: 'weight' as const },
  avoid: ['gf' as const],
  pkg: { price: 6.99, size: 17.6, store: 'H Mart' },
  addedBy: 'Charlie W.',
  requested: false, usedIn: ['Bibimbap']
};
const BOOK = [
  { id: 'chili-paste', name: 'Chili paste', unitKey: 'lb', unitMany: 'lb' },
  { id: 'eggs', name: 'Eggs', unitKey: 'egg', unitMany: 'eggs' }
];

beforeEach(() => {
  vi.clearAllMocks();
  matchScoutIngredient.mockResolvedValue({ ok: true });
  keepScoutIngredient.mockResolvedValue({ ok: true });
});

const menu = (v: string) => userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'More for Gochujang' }), v);

describe('ScoutIngredients', () => {
  it('Row_ShowsTheScoutsPackageAndWhereItIsUsed', () => {
    render(<ScoutIngredients items={[ITEM]} book={BOOK} />);
    expect(screen.getByText('17.6 oz · $6.99 · H Mart')).toBeTruthy();
    expect(screen.getByText('Bibimbap')).toBeTruthy();
  });

  it('Match_PrefillsTheFactor_WithinAUnitFamily', async () => {
    const user = userEvent.setup();
    render(<ScoutIngredients items={[ITEM]} book={BOOK} />);
    await menu('match');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Price-book ingredient for Gochujang' }), 'chili-paste');
    expect((screen.getByRole('textbox', { name: 'How many lb one oz is' }) as HTMLInputElement).value).toBe('0.0625');
  });

  it('Leader_CanMatchTypedIn', async () => {
    const user = userEvent.setup();
    render(<ScoutIngredients items={[ITEM]} book={BOOK} />);
    await menu('match');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Price-book ingredient for Gochujang' }), 'chili-paste');
    await user.click(screen.getByRole('button', { name: 'Match' }));
    expect(matchScoutIngredient).toHaveBeenCalledWith('x-0000aaaa', 'chili-paste', 0.0625);
  });

  it('Match_AcrossFamilies_WaitsForAFactor', async () => {
    const user = userEvent.setup();
    render(<ScoutIngredients items={[ITEM]} book={BOOK} />);
    await menu('match');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Price-book ingredient for Gochujang' }), 'eggs');
    expect((screen.getByRole('button', { name: 'Match' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Leader_CanKeepItAsNew_WithItsDiets', async () => {
    const user = userEvent.setup();
    render(<ScoutIngredients items={[ITEM]} book={BOOK} />);
    await menu('keep');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Store section for Gochujang' }), 'produce');
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(keepScoutIngredient).toHaveBeenCalledWith('x-0000aaaa', 'produce', ['gf']);
  });

  it('EmptyList_SaysSo', () => {
    render(<ScoutIngredients items={[]} book={BOOK} />);
    expect(screen.getByText('Nothing to match.')).toBeTruthy();
  });
});
