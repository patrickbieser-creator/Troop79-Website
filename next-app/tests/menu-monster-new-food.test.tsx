import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeBuilder } from '../src/app/admin/(workspace)/library/menu-monster/recipe-builder';
import { RecipeScreen } from '../src/app/admin/(workspace)/library/menu-monster/recipe-screen';
import { createFood, finishFood, saveRecipe } from '../src/app/admin/(workspace)/library/menu-monster/actions';
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
  finishFood: vi.fn(async () => ({ ok: true, id: 'cookies' })),
  saveRecipe: vi.fn(async () => ({ ok: true, id: 'trail-mix' })),
  setRecipeStatus: vi.fn(async () => ({ ok: true })),
  duplicateRecipe: vi.fn(async () => ({ ok: true, id: 'copy' }))
}));

beforeEach(() => {
  vi.mocked(finishFood).mockClear().mockResolvedValue({ ok: true, id: 'cookies' });
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
  it('Leader_SeesWhichFieldIsBad_WhenSavingAnIncompleteFood', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={CATALOG} stores={STORES} today="2026-10-03" />);
    await user.click(screen.getByRole('button', { name: '+ New single food' }));
    const form = screen.getByRole('region', { name: 'New single food' });
    await user.type(within(form).getByLabelText('Name'), 'Cookies');
    await user.type(within(form).getByLabelText('One is called'), 'cookie');
    const add = within(form).getByRole('button', { name: 'Add food' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(within(form).queryByRole('alert')).toBeNull();
    await user.click(add);
    expect(createFood).not.toHaveBeenCalled();
    expect(within(form).getByLabelText('Several are called').getAttribute('aria-invalid')).toBe('true');
    expect(within(form).getByText('Say what several are called.')).toBeTruthy();
    expect(within(form).getByRole('alert').textContent).toContain('Can’t save yet: Say what several are called');
    expect(within(form).getByRole('alert').textContent).toContain('(+2 more)');
    expect(document.activeElement).toBe(within(form).getByLabelText('Several are called'));
  });

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
    expect(add().disabled).toBe(false);
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

  it('Leader_FinishesTheSavedFood_WhenALaterStepFailed_InsteadOfCreatingItAgain', async () => {
    const user = userEvent.setup();
    vi.mocked(createFood).mockResolvedValueOnce({ ok: false, id: 'cookies', error: 'Cookies is in the price book, but its package was not saved: boom' });
    render(<RecipeScreen catalog={CATALOG} recipeId="new" stores={STORES} today="2026-10-03" />);
    const editor = screen.getByRole('region', { name: 'New recipe' });
    await user.click(within(editor).getByRole('button', { name: 'Not in the list? New ingredient…' }));
    const form = within(editor).getByRole('region', { name: 'New ingredient' });
    await user.type(within(form).getByLabelText('Name'), 'Cookies');
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
    await user.type(within(form).getByLabelText('Name'), ' and cream');
    await user.click(await within(form).findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(finishFood).toHaveBeenCalledTimes(1));
    const [id, input] = vi.mocked(finishFood).mock.calls[0];
    expect([vi.mocked(createFood).mock.calls.length, id, input.ingredient.name]).toEqual([1, 'cookies', 'Cookies and cream']);
  });
  it('Leader_SeesThatANewIngredientSavesAtOnce', async () => {
    const user = userEvent.setup();
    vi.mocked(createFood).mockResolvedValueOnce({ ok: false, id: 'cookies', error: 'Cookies is in the price book, but its package was not saved: boom' });
    render(<RecipeScreen catalog={CATALOG} recipeId="new" stores={STORES} today="2026-10-03" />);
    const editor = screen.getByRole('region', { name: 'New recipe' });
    await user.click(within(editor).getByRole('button', { name: 'Not in the list? New ingredient…' }));
    const form = within(within(editor).getByRole('region', { name: 'New ingredient' }));
    // Said up front: it does not wait for the recipe's Save.
    expect(form.getByText('Takes effect immediately')).toBeTruthy();
    await user.type(form.getByLabelText('Name'), 'Cookies');
    await user.click(form.getByRole('button', { name: 'Add ingredient' }));
    // A partial save, then Cancel: one line says the food was kept, and names it.
    await user.click(await form.findByRole('button', { name: 'Cancel' }));
    expect(within(editor).queryByRole('region', { name: 'New ingredient' })).toBeNull();
    expect(within(editor).getByText(/“Cookies” was already saved to the ingredient list/)).toBeTruthy();
  });
});
