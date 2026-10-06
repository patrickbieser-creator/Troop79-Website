import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Admin › Menu Monster › a food's "On the menu by itself" editor: an incomplete form marks its fields, it does not grey Save. */

const putFoodOnMenu = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  putFoodOnMenu: (...a: unknown[]) => putFoodOnMenu(...a),
  takeFoodOffMenu: vi.fn(async () => ({ ok: true }))
}));

import { FoodOnMenu } from '../src/app/admin/(workspace)/library/menu-monster/food-on-menu';
import type { Catalog, Ingredient } from '../src/lib/menu-monster/types';

const ING: Ingredient = { id: 'cookies', name: 'Cookies', unit: { key: 'count', one: 'cookie', many: 'cookies', kind: 'count' }, section: 'bakery', staple: false, avoid: [], retiredAt: null };
const CATALOG: Catalog = { ingredients: [ING], packages: [], conversions: [], recipes: [] };

beforeEach(() => {
  putFoodOnMenu.mockReset().mockResolvedValue({ ok: true });
});

describe('FoodOnMenu — saving an incomplete form', () => {
  it('Leader_SeesWhichFieldIsBad_WhenPuttingAFoodOnTheMenuWithoutAMeal', async () => {
    const user = userEvent.setup();
    render(<FoodOnMenu ing={ING} catalog={CATALOG} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Put it on the menu' }));
    const put = screen.getAllByRole('button', { name: 'Put it on the menu' }).at(-1) as HTMLButtonElement;
    expect(put.disabled).toBe(false);
    expect(put.getAttribute('title')).toBeNull();
    await user.click(put);
    expect(putFoodOnMenu).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Breakfast').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Pick at least one meal.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Can’t save yet: Pick at least one meal');
  });

  it('Leader_SeesTheAmountMarked_WhenItIsEmptied', async () => {
    const user = userEvent.setup();
    render(<FoodOnMenu ing={ING} catalog={CATALOG} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Put it on the menu' }));
    await user.clear(screen.getByLabelText('Each person gets'));
    await user.click(screen.getByLabelText('Dessert'));
    await user.click(screen.getAllByRole('button', { name: 'Put it on the menu' }).at(-1) as HTMLElement);
    expect(putFoodOnMenu).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Each person gets').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Type how many each person gets.')).toBeTruthy();
  });
});
