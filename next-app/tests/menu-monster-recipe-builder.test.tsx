import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeBuilder } from '../src/app/admin/(workspace)/library/menu-monster/recipe-builder';
import { saveRecipe, setRecipeStatus } from '../src/app/admin/(workspace)/library/menu-monster/actions';
import { UNITS } from '../src/lib/menu-monster/units';
import type { Catalog, Ingredient, Package } from '../src/lib/menu-monster/types';

/**
 * Menu Monster leader tools — Recipe builder (Plans/Menu-Monster-Leader-Tools.md,
 * Test Plan — DOM). The publish gate the editor shows is recipeIssues();
 * the mock boundary is the actions module.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  saveRecipe: vi.fn(async () => ({ ok: true, id: 'toast' })),
  setRecipeStatus: vi.fn(async () => ({ ok: true })),
  duplicateRecipe: vi.fn(async () => ({ ok: true, id: 'toast-copy' }))
}));

beforeEach(() => {
  vi.mocked(saveRecipe).mockClear().mockResolvedValue({ ok: true, id: 'toast' });
  vi.mocked(setRecipeStatus).mockClear().mockResolvedValue({ ok: true });
});

const ING: Ingredient[] = [
  { id: 'bread', name: 'Bread', unit: UNITS.slice, section: 'bakery', staple: false, avoid: ['gf'], retiredAt: null },
  { id: 'eggs', name: 'Eggs', unit: UNITS.egg, section: 'dairy', staple: false, avoid: [], retiredAt: null },
  { id: 'pancake-mix', name: 'Pancake mix', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['gf'], retiredAt: null }
];
const pkg = (id: string, ingredientId: string, name: string, price: number, yield_: number): Package => ({
  id, ingredientId, name, store: 'Kroger', price, yield: yield_, yieldUnitLabel: null, noun: 'pack',
  soldSize: null, soldUnit: null, note: null, asOf: '2026-09-01', retiredAt: null
});
const CATALOG: Catalog = {
  ingredients: ING,
  packages: [pkg('p-bread', 'bread', 'Kroger White', 1.99, 20), pkg('p-eggs', 'eggs', 'Eggs, dozen', 2.99, 12), pkg('p-mix', 'pancake-mix', 'Krusteaz 10 lb', 15, 36)],
  conversions: [],
  recipes: [
    { id: 'pancakes', name: 'Pancakes', status: 'published', mealFit: ['breakfast'], foodGroups: ['grain'], camp: true, trail: false, method: 'stove', stepsMd: null, sortOrder: 10,
      lines: [
        { ingredientId: 'pancake-mix', qtyPerPerson: 0.5, unitKey: null, servesRule: 'everyone', servesRestriction: null },
        { ingredientId: 'eggs', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestriction: null }
      ] },
    { id: 'toast', name: 'Toast', status: 'draft', mealFit: ['breakfast'], foodGroups: ['grain'], camp: true, trail: true, method: 'stove', stepsMd: null, sortOrder: 20, lines: [] }
  ]
};

const list = () => screen.getByRole('navigation', { name: 'Menu items' });

describe('Recipe builder', () => {
  it('Leader_SeesStatusPills_ComputedFromIssues', () => {
    render(<RecipeBuilder catalog={CATALOG} />);
    const toast = within(list()).getByRole('button', { name: /^Toast/ });
    expect(toast.textContent).toMatch(/Needs fixes/);
    const pancakes = within(list()).getByRole('button', { name: /^Pancakes/ });
    expect(pancakes.textContent).toMatch(/Published/);
  });

  it('Leader_CannotPublish_WhileRecipeHasBlockingIssue', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="toast" />);
    const editor = screen.getByRole('region', { name: 'Edit Toast' });

    const publish = within(editor).getByRole('button', { name: 'Publish' });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(publish.getAttribute('title')).toBe('Add at least one ingredient line.');
    expect(within(editor).getByRole('list', { name: 'Needs fixing' }).textContent).toMatch(/Add at least one ingredient line/);

    await user.click(within(editor).getByRole('button', { name: '+ Add a line' }));
    await user.selectOptions(within(editor).getByLabelText('Line 1 ingredient'), 'bread');
    await user.type(within(editor).getByLabelText('Line 1 amount'), '2');
    expect(within(editor).queryByRole('list', { name: 'Needs fixing' })).toBeNull();
    // Bread has gluten and everyone gets it — a warning, never a block.
    expect(within(editor).getByRole('list', { name: 'Worth a look' }).textContent).toMatch(/isn't gluten-free/);

    // Publish waits for the save.
    expect(publish.getAttribute('title')).toBe('Save changes first');
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({
      id: 'toast',
      name: 'Toast',
      lines: [{ ingredientId: 'bread', amount: '2', unitKey: null, servesRule: 'everyone', servesRestriction: null }]
    });

    await waitFor(() => expect((within(editor).getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(editor).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(setRecipeStatus).toHaveBeenCalledWith('toast', 'published'));
  });

  it('Leader_SeesDuplicateLineError_ForSameIngredientAndRule', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="pancakes" />);
    const editor = screen.getByRole('region', { name: 'Edit Pancakes' });

    await user.click(within(editor).getByRole('button', { name: '+ Add a line' }));
    await user.selectOptions(within(editor).getByLabelText('Line 3 ingredient'), 'eggs');
    await user.type(within(editor).getByLabelText('Line 3 amount'), '1');
    expect(within(editor).getByRole('list', { name: 'Needs fixing' }).textContent).toMatch(
      /Line 3: Eggs already has a line for everyone — combine them\./
    );
    const save = within(editor).getByRole('button', { name: 'Save changes' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(save.getAttribute('title')).toMatch(/combine them/);
  });

  it('Leader_SeesWhatOnePersonGets_AndCostPerPerson', () => {
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="pancakes" />);
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(preview.textContent).toMatch(/½ cup pancake mix/);
    expect(preview.textContent).toMatch(/1 egg/);
    // 10 people: 5 cups mix → 1 bag ($15) spent, 10 eggs → 1 dozen ($2.99): $17.99 spent → $1.80 per person.
    expect(preview.textContent).toMatch(/\$1\.80/);
  });
});
