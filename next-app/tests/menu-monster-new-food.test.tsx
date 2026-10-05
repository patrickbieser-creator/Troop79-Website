import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeBuilder } from '../src/app/admin/(workspace)/library/menu-monster/recipe-builder';
import { RecipeScreen } from '../src/app/admin/(workspace)/library/menu-monster/recipe-screen';
import { createFood, saveRecipe } from '../src/app/admin/(workspace)/library/menu-monster/actions';
import { UNITS } from '../src/lib/menu-monster/units';
import type { Catalog } from '../src/lib/menu-monster/types';

/**
 * Menu Monster leader tools — adding a single food (Cookies) from the Food &
 * recipes tab: one form for the ingredient, its price and its one-line menu
 * item; a new ingredient from inside a recipe; and a new recipe saved without
 * the editor's `__new__` placeholder. The mock boundary is the actions module.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })
}));
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  createFood: vi.fn(async () => ({ ok: true, id: 'cookies', recipeId: 'cookies' })),
  saveRecipe: vi.fn(async () => ({ ok: true, id: 'trail-mix' })),
  setRecipeStatus: vi.fn(async () => ({ ok: true })),
  duplicateRecipe: vi.fn(async () => ({ ok: true, id: 'copy' }))
}));

beforeEach(() => {
  vi.mocked(createFood).mockClear().mockResolvedValue({ ok: true, id: 'cookies', recipeId: 'cookies' });
  vi.mocked(saveRecipe).mockClear().mockResolvedValue({ ok: true, id: 'trail-mix' });
});

const CATALOG: Catalog = {
  ingredients: [{ id: 'eggs', name: 'Eggs', unit: UNITS.egg, section: 'dairy', staple: false, avoid: [], retiredAt: null }],
  packages: [],
  conversions: [],
  recipes: []
};
const STORES = ['Costco', 'Kroger'];

describe('Food & recipes — a single food', () => {
  // A dozen typed fields: slow under the full suite's load, so it gets room (BACKLOG: load-timeout flakes).
  it('Leader_AddsCookies_InOneForm', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={CATALOG} stores={STORES} today="2026-10-03" />);
    await user.click(screen.getByRole('button', { name: '+ New single food' }));
    const form = screen.getByRole('region', { name: 'New single food' });

    const add = () => within(form).getByRole('button', { name: 'Add food' }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    await user.type(within(form).getByLabelText('Name'), 'Cookies');
    await user.type(within(form).getByLabelText('One is called'), 'cookie');
    await user.type(within(form).getByLabelText('Several are called'), 'cookies');
    await user.selectOptions(within(form).getByLabelText('Store section'), 'bakery');
    await user.type(within(form).getByLabelText('Product on the label'), 'Chips Ahoy, 13 oz');
    await user.selectOptions(within(form).getByLabelText('Store'), 'Kroger');
    await user.type(within(form).getByLabelText('One package costs'), '$4.29');
    await user.type(within(form).getByLabelText('One package holds (cookies)'), '36');
    await user.type(within(form).getByLabelText('Each person gets (cookies)'), '2');
    expect(add().getAttribute('title')).toBe('Pick at least one meal it fits');
    await user.click(within(form).getByLabelText('Dessert'));

    await user.click(add());
    await waitFor(() => expect(createFood).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createFood).mock.calls[0][0]).toEqual({
      ingredient: { name: 'Cookies', unit: { kind: 'count', key: 'count', one: 'cookie', many: 'cookies' }, section: 'bakery', staple: false, avoid: [] },
      package: { name: 'Chips Ahoy, 13 oz', store: 'Kroger', price: 4.29, holds: 36, asOf: '2026-10-03' },
      menu: { amount: '2', mealFit: ['dessert'], foodGroups: [] }
    });
  });

  it('Leader_AddsAnIngredient_FromInsideARecipe', async () => {
    const user = userEvent.setup();
    vi.mocked(createFood).mockResolvedValue({ ok: true, id: 'sprinkles' });
    render(<RecipeScreen catalog={CATALOG} recipeId="new" stores={STORES} today="2026-10-03" />);
    const editor = screen.getByRole('region', { name: 'New recipe' });
    await user.click(within(editor).getByRole('button', { name: 'Not in the list? New ingredient…' }));
    const form = within(editor).getByRole('region', { name: 'New ingredient' });
    await user.type(within(form).getByLabelText('Name'), 'Sprinkles');
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
    await waitFor(() => expect(createFood).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createFood).mock.calls[0][0]).toMatchObject({ ingredient: { name: 'Sprinkles' }, package: null, menu: null });
    // Its line is waiting for an amount.
    await waitFor(() => expect(within(editor).getByLabelText('Line 1 amount')).toBeTruthy());
  });

  it('Leader_SavesANewRecipe_WithoutThePlaceholderId', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="new" stores={STORES} today="2026-10-03" />);
    const editor = screen.getByRole('region', { name: 'New recipe' });
    await user.type(within(editor).getByLabelText('Name'), 'Trail mix');
    await user.click(within(editor).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({ id: '', name: 'Trail mix' });
  });
});
