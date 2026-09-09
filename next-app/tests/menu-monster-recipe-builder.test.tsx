import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeBuilder } from '../src/app/admin/(workspace)/library/menu-monster/recipe-builder';
import { saveRecipe, setRecipeStatus } from '../src/app/admin/(workspace)/library/menu-monster/actions';
import { UNITS } from '../src/lib/menu-monster/units';
import type { Catalog, Ingredient, Package, Recipe } from '../src/lib/menu-monster/types';

/**
 * Menu Monster leader tools — Recipe builder (Plans/Menu-Monster-Leader-Tools.md
 * + Plans/Menu-Monster-Recipe-Variations.md). A recipe is an Everyone tab
 * (the base lines) plus a tab per restriction a leader has added, each a
 * diff on the base with a computed state chip. The publish gate the editor
 * shows is authoringIssues(); the mock boundary is the actions module.
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
  { id: 'pancake-mix', name: 'Pancake mix', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['gf'], retiredAt: null },
  { id: 'almond-flour', name: 'Almond flour', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['nut'], retiredAt: null },
  { id: 'bacon', name: 'Bacon', unit: UNITS.slice, section: 'meat', staple: false, avoid: ['veg'], retiredAt: null }
];
const pkg = (id: string, ingredientId: string, name: string, price: number, yield_: number): Package => ({
  id, ingredientId, name, store: 'Kroger', price, yield: yield_, yieldUnitLabel: null, noun: 'pack',
  soldSize: null, soldUnit: null, note: null, asOf: '2026-09-01', retiredAt: null
});
const recipe = (over: Partial<Recipe> & Pick<Recipe, 'id' | 'name' | 'lines'>): Recipe => ({
  status: 'published', mealFit: ['breakfast'], foodGroups: ['grain'], camp: true, trail: false, method: 'stove', stepsMd: null, sortOrder: 10, variations: [], ...over
});
const CATALOG: Catalog = {
  ingredients: ING,
  packages: [
    pkg('p-bread', 'bread', 'Kroger White', 1.99, 20),
    pkg('p-eggs', 'eggs', 'Eggs, dozen', 2.99, 12),
    pkg('p-mix', 'pancake-mix', 'Krusteaz 10 lb', 15, 36),
    pkg('p-alm', 'almond-flour', 'Almond flour, 1 lb', 8, 3),
    pkg('p-bac', 'bacon', 'Oscar Mayer, 16 oz', 7.49, 16)
  ],
  conversions: [],
  recipes: [
    recipe({
      id: 'pancakes', name: 'Pancakes',
      lines: [
        { ingredientId: 'pancake-mix', qtyPerPerson: 0.5, unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
        { ingredientId: 'eggs', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }
      ]
    }),
    recipe({ id: 'toast', name: 'Toast', status: 'draft', trail: true, sortOrder: 20, lines: [] }),
    recipe({ id: 'bacon', name: 'Bacon', foodGroups: ['protein'], sortOrder: 30, lines: [{ ingredientId: 'bacon', qtyPerPerson: 3, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })
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
      base: [{ ingredientId: 'bread', amount: '2', unitKey: null }],
      variations: []
    });

    await waitFor(() => expect((within(editor).getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(editor).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(setRecipeStatus).toHaveBeenCalledWith('toast', 'published'));
  });

  it('Leader_SeesDuplicateLineError_ForSameIngredient', async () => {
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

  // Plans/Menu-Monster-Recipe-Variations.md — the tab per restriction.
  it('Leader_AddsAVariation_AndSwapsOneLine', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="pancakes" />);
    const editor = screen.getByRole('region', { name: 'Edit Pancakes' });

    // Only Everyone to start; the add menu names the restrictions with a flagged ingredient.
    const tabs = within(editor).getByRole('tablist', { name: 'Recipe versions' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Everyone']);
    await user.click(within(editor).getByRole('button', { name: /\+ Add a variation/ }));
    const menu = within(editor).getByRole('group', { name: 'Variations to add' });
    expect(within(menu).getByRole('button', { name: /^Gluten-free/ }).textContent).toMatch(/Needs a look/);
    expect(within(menu).getByRole('button', { name: /^Vegetarian/ }).textContent).toMatch(/Nothing to change/);
    await user.click(within(menu).getByRole('button', { name: /^Gluten-free/ }));

    // The new tab is selected, the chip says what to do, the base lines are listed with a choice each.
    expect(within(tabs).getByRole('tab', { name: /Gluten-free/ }).getAttribute('aria-selected')).toBe('true');
    const panel = within(editor).getByRole('region', { name: 'Gluten-free version' });
    expect(within(panel).getByText('Needs a look')).toBeTruthy();
    expect(within(panel).getByText(/Flagged: Pancake mix/)).toBeTruthy();

    await user.selectOptions(within(panel).getByLabelText('Pancake mix for gluten-free scouts'), 'swap');
    await user.selectOptions(within(panel).getByLabelText('Swap Pancake mix for'), 'almond-flour');
    await user.type(within(panel).getByLabelText('Amount of Almond flour per person'), '1');
    expect(within(panel).getByText('Substituted')).toBeTruthy();
    // The preview follows the tab, and the cross-restriction warning fires (almond flour is a nut).
    expect(screen.getByRole('region', { name: 'Preview' }).textContent).toMatch(/1 cup almond flour/);
    expect(screen.getByRole('region', { name: 'Preview' }).textContent).not.toMatch(/pancake mix/);
    expect(within(editor).getByRole('list', { name: 'Worth a look' }).textContent).toMatch(/Almond flour in the gluten-free version isn't nut-free/);
    // The compile box shows the engine's rules.
    const compiled = within(editor).getByRole('list', { name: 'What the planner will compute' });
    expect(compiled.textContent).toMatch(/pancake mix.*everyone except gluten-free/);
    expect(compiled.textContent).toMatch(/almond flour.*only gluten-free/);

    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({
      base: [
        { ingredientId: 'pancake-mix', amount: '0.5', unitKey: null },
        { ingredientId: 'eggs', amount: '1', unitKey: null }
      ],
      variations: [
        { restriction: 'gf', state: 'substituted', lines: [{ op: 'swap', baseIngredientId: 'pancake-mix', ingredientId: 'almond-flour', amount: '1', unitKey: null }] }
      ]
    });
  });

  it('Leader_MarksNotSuitable_InOneClick', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="bacon" />);
    const editor = screen.getByRole('region', { name: 'Edit Bacon' });
    await user.click(within(editor).getByRole('button', { name: /\+ Add a variation/ }));
    await user.click(within(within(editor).getByRole('group', { name: 'Variations to add' })).getByRole('button', { name: /^Vegetarian/ }));
    const panel = within(editor).getByRole('region', { name: 'Vegetarian version' });
    await user.click(within(panel).getByRole('button', { name: 'Not suitable' }));
    expect(within(panel).getAllByText('Not suitable').length).toBeGreaterThan(0);
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({
      variations: [{ restriction: 'veg', state: 'unsuitable', lines: [] }]
    });
  });
});
