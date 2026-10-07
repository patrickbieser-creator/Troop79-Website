import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeBuilder } from '../src/app/admin/(workspace)/library/menu-monster/recipe-builder';
import { RecipeScreen } from '../src/app/admin/(workspace)/library/menu-monster/recipe-screen';
import { createBrand, createFood, createIngredient, deleteRecipe, finishFood, keepScoutFood, putFoodOnMenu, saveRecipe, setRecipeStatus, suggestRecipeBrand, updateIngredient } from '../src/app/admin/(workspace)/library/menu-monster/actions';
import { UNITS } from '../src/lib/menu-monster/units';
import type { Catalog, Ingredient, Package, Recipe } from '../src/lib/menu-monster/types';
import type { ScoutFood } from '../src/lib/menu-monster/scout-recipes-store';

/**
 * Menu Monster leader tools — Recipe builder (Plans/Menu-Monster-Leader-Tools.md
 * + Plans/Menu-Monster-Recipe-Variations.md). A recipe is an Everyone tab
 * (the base lines) plus a tab per restriction a leader has added, each a
 * diff on the base with a computed state chip. The publish gate the editor
 * shows is authoringIssues(); the mock boundary is the actions module.
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav
}));
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  saveRecipe: vi.fn(async () => ({ ok: true, id: 'toast' })),
  setRecipeStatus: vi.fn(async () => ({ ok: true })),
  duplicateRecipe: vi.fn(async () => ({ ok: true, id: 'toast-copy' })),
  deleteRecipe: vi.fn(async () => ({ ok: true })),
  updateIngredient: vi.fn(async () => ({ ok: true })),
  createIngredient: vi.fn(async () => ({ ok: true, id: 'toast-new' })),
  createFood: vi.fn(async () => ({ ok: true, id: 'sprinkles' })),
  finishFood: vi.fn(async () => ({ ok: true, id: 'sprinkles' })),
  suggestRecipeBrand: vi.fn(async () => ({ ok: true })),
  addBought: vi.fn(async () => ({ ok: true })),
  updatePackage: vi.fn(async () => ({ ok: true })),
  retirePackage: vi.fn(async () => ({ ok: true })),
  restorePackage: vi.fn(async () => ({ ok: true })),
  setPackageBrand: vi.fn(async () => ({ ok: true })),
  createBrand: vi.fn(async () => ({ ok: true, id: 'b-new' })),
  renameBrand: vi.fn(async () => ({ ok: true })),
  setBrandDiets: vi.fn(async () => ({ ok: true })),
  mergeBrand: vi.fn(async () => ({ ok: true })),
  moveBrand: vi.fn(async () => ({ ok: true })),
  removeBrand: vi.fn(async () => ({ ok: true })),
  putFoodOnMenu: vi.fn(async () => ({ ok: true })),
  keepScoutFood: vi.fn(async () => ({ ok: true, note: 'Kept it.' }))
}));

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  window.history.replaceState(null, '', '/');
  vi.mocked(saveRecipe).mockClear().mockResolvedValue({ ok: true, id: 'toast' });
  vi.mocked(setRecipeStatus).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(updateIngredient).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(createIngredient).mockClear().mockResolvedValue({ ok: true, id: 'toast-new' });
});

const ING: Ingredient[] = [
  { id: 'bread', name: 'Bread', unit: UNITS.slice, section: 'bakery', staple: false, avoid: ['gf'], retiredAt: null },
  { id: 'eggs', name: 'Eggs', unit: UNITS.egg, section: 'dairy', staple: false, avoid: [], retiredAt: null },
  { id: 'pancake-mix', name: 'Pancake mix', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['gf'], retiredAt: null },
  { id: 'almond-flour', name: 'Almond flour', unit: UNITS.cup, section: 'dry', staple: false, avoid: ['nut'], retiredAt: null },
  { id: 'bacon', name: 'Bacon', unit: UNITS.slice, section: 'meat', staple: false, avoid: ['veg'], retiredAt: null }
];
const pkg = (id: string, ingredientId: string, name: string, price: number, yield_: number): Package => ({
  id, ingredientId, name, store: 'Kroger', price, anchorPrice: price, yield: yield_, yieldUnitLabel: null, noun: 'pack',
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

/** The ingredient field is a type-to-search combobox: open it and click the option by name. */
const pickIng = async (user: ReturnType<typeof userEvent.setup>, field: HTMLElement, name: string) => {
  await user.click(field);
  await user.click(screen.getByRole('option', { name }));
};
/** The admin add row: '+ Ingredient' opens a search; picking an ingredient adds its line (amount still to type). */
const addIng = async (user: ReturnType<typeof userEvent.setup>, scope: ReturnType<typeof within>, name: string) => {
  await user.click(scope.getByRole('button', { name: '+ Ingredient' }));
  await pickIng(user, scope.getByRole('combobox', { name: 'Add an ingredient' }), name);
};
const list = () => screen.getByRole('table', { name: 'Food and recipes' });
/** Record-level commands live in the one "More actions…" menu (2026-10-05). */
const more = async (scope: ReturnType<typeof within>, value: string) => userEvent.setup().selectOptions(scope.getByRole('combobox', { name: 'More actions' }), value);

describe('Recipe builder', () => {
  it('Leader_SeesStatusPills_ComputedFromIssues', () => {
    render(<RecipeBuilder catalog={CATALOG} />);
    const status = (name: string) => (within(list()).getByText(name).closest('tr') as HTMLElement).lastElementChild?.textContent;
    expect([status('Toast'), status('Pancakes')]).toEqual(['Needs fixes', 'Published']);
  });

  // Many typed steps: under full-suite load it overran the 8 s default (2026-10-06), so it gets the long budget.
  it('Leader_CannotPublish_WhileRecipeHasBlockingIssue', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);
    const editor = screen.getByRole('region', { name: 'Edit Toast' });

    // Publish stays clickable (greyed means nothing to do, never not valid yet); a click says what is missing.
    const publish = within(editor).getByRole('button', { name: 'Publish' });
    expect((publish as HTMLButtonElement).disabled).toBe(false);
    await user.click(publish);
    expect(setRecipeStatus).not.toHaveBeenCalled();
    expect(within(editor).getByText(/^Can’t save yet/).textContent).toBe('Can’t save yet: Add at least one ingredient line.');
    expect(within(editor).getByRole('list', { name: 'Needs fixing' }).textContent).toMatch(/Add at least one ingredient line/);

    await addIng(user, within(editor), 'Bread');
    await user.type(within(editor).getByLabelText('Line 1 amount'), '2');
    expect(within(editor).queryByRole('list', { name: 'Needs fixing' })).toBeNull();
    // Bread has gluten and everyone gets it — a warning, never a block.
    expect(within(editor).getByRole('list', { name: 'Worth a look' }).textContent).toMatch(/isn't gluten-free/);

    // Publish waits for the save, and says so.
    expect(within(editor).getByRole('button', { name: 'Save, then publish' })).toBeTruthy();
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({
      id: 'toast',
      name: 'Toast',
      base: [{ ingredientId: 'bread', amount: '2', unitKey: null }],
      variations: []
    });

    await waitFor(() => expect(within(editor).getByRole('button', { name: 'Publish' })).toBeTruthy());
    await user.click(within(editor).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(setRecipeStatus).toHaveBeenCalledWith('toast', 'published'));
  });

  it('Leader_SeesWhatNeedsFixing_AboveTheForm_OnAPublishedItem', () => {
    // Published, but it fits no meal: the list says "Needs fixes".
    const catalog: Catalog = {
      ...CATALOG,
      recipes: [recipe({ id: 'oj', name: 'Orange juice', mealFit: [], lines: [{ ingredientId: 'eggs', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })]
    };
    render(<RecipeBuilder catalog={catalog} initialRecipeId="oj" />);
    const editor = screen.getByRole('region', { name: 'Edit Orange juice' });
    const fixes = within(editor).getByRole('list', { name: 'Needs fixing' });
    expect(fixes.textContent).toMatch(/Pick at least one meal it fits/);
    // It sits before the first field, not under the whole form.
    const name = within(editor).getByLabelText('Name');
    expect(fixes.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Published already: the heading does not talk about publishing.
    expect(within(editor).queryByText('Needs fixing before it can publish')).toBeNull();
  });

  it('Leader_SeesDuplicateLineError_ForSameIngredient', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    const editor = screen.getByRole('region', { name: 'Edit Pancakes' });

    await addIng(user, within(editor), 'Eggs');
    await user.type(within(editor).getByLabelText('Line 3 amount'), '1');
    expect(within(editor).getByRole('list', { name: 'Needs fixing' }).textContent).toMatch(
      /Line 3: Eggs already has a line for everyone — combine them\./
    );
    // Save stays clickable; the click says the reason in words and saves nothing.
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    expect(saveRecipe).not.toHaveBeenCalled();
    expect(within(editor).getByText(/^Can’t save yet/).textContent).toMatch(/combine them/);
  });

  it('Leader_MarksALine_ForTheWholeMeal', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    const editor = screen.getByRole('region', { name: 'Edit Pancakes' });

    await addIng(user, within(editor), 'Almond flour');
    await user.type(within(editor).getByLabelText('Line 3 amount'), '4');
    const group = within(editor).getByRole('radiogroup', { name: 'Line 3 amount is for' });
    expect((within(group).getByRole('radio', { name: 'per person' }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(group).getByRole('radio', { name: 'whole meal' }));
    expect(within(editor).getByText('Amount for the whole meal')).toBeTruthy();

    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(saveRecipe).mock.calls[0][0] as { base: { ingredientId: string; scale?: string }[] };
    expect(saved.base.find((b) => b.ingredientId === 'almond-flour')?.scale).toBe('meal');
    expect(saved.base.find((b) => b.ingredientId === 'eggs')?.scale).toBeUndefined();
  });

  it('Leader_SeesWhatOnePersonGets_AndCostPerPerson', () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(preview.textContent).toMatch(/½ cup pancake mix/);
    expect(preview.textContent).toMatch(/1 egg/);
    // 10 people: 5 cups mix → 1 bag ($15) spent, 10 eggs → 1 dozen ($2.99): $17.99 spent → $1.80 per person.
    expect(preview.textContent).toMatch(/\$1\.80/);
  });

  // Plans/Menu-Monster-Recipe-Variations.md — the tab per restriction.
  it('Leader_AddsAVariation_AndSwapsOneLine', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
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
    await pickIng(user, within(panel).getByLabelText('Swap Pancake mix for'), 'Almond flour');
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
    render(<RecipeScreen catalog={CATALOG} recipeId="bacon" />);
    const editor = screen.getByRole('region', { name: 'Edit Bacon' });
    // Bacon is a single food: its diet swaps live in the full editor, which is its own page.
    await user.click(within(editor).getByRole('button', { name: /\+ Add a variation/ }));
    await user.click(within(within(editor).getByRole('group', { name: 'Variations to add' })).getByRole('button', { name: /^Vegetarian/ }));
    const panel = within(editor).getByRole('region', { name: 'Vegetarian version' });
    await user.click(within(panel).getByRole('radio', { name: 'Not suitable' }));
    expect((within(panel).getByRole('radio', { name: 'Not suitable' }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({
      variations: [{ restriction: 'veg', state: 'unsuitable', lines: [] }]
    });
  });
});

describe('Recipe builder — a single food opens in the short form (2026-10-04)', () => {
  const bacon = () => within(screen.getByRole('region', { name: 'Edit Bacon' }));
  const GEAR_LIST = ['Griddle', 'Ladle', 'Tongs'].map((name, i) => ({ id: i + 1, name, home: 'trailer' as const, perPerson: false, retiredAt: null }));
  const open = (catalog: Catalog = CATALOG) => render(<RecipeBuilder catalog={catalog} initialRecipeId="bacon" gearList={GEAR_LIST} />);
  const save = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(bacon().getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
  };

  it('ASingleFood_HasNoIngredientLinesAndNoSteps', () => {
    open();
    expect([bacon().queryByRole('list', { name: 'Ingredient lines' }), bacon().queryByLabelText(/How to make it/)]).toEqual([null, null]);
  });

  it('ASingleFood_ShowsWhatEachPersonGets', () => {
    open();
    expect((bacon().getByLabelText('Each person gets') as HTMLInputElement).value).toBe('3');
  });

  it('ARecipeWithSeveralIngredients_StillOpensInTheFullEditor', () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    expect(within(screen.getByRole('region', { name: 'Edit Pancakes' })).getByRole('list', { name: 'Ingredient lines' })).toBeTruthy();
  });

  it('ChangingTheAmount_SavesTheOneLine', async () => {
    const user = userEvent.setup();
    open();
    await user.clear(bacon().getByLabelText('Each person gets'));
    await user.type(bacon().getByLabelText('Each person gets'), '4');
    await save(user);
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({ id: 'bacon', base: [{ ingredientId: 'bacon', amount: '4', unitKey: null }] });
  });

  it('ANewName_RenamesTheIngredientToo_WhileTheyMatch', async () => {
    const user = userEvent.setup();
    open();
    await user.clear(bacon().getByLabelText('Name'));
    await user.type(bacon().getByLabelText('Name'), 'Thick bacon');
    await save(user);
    await waitFor(() => expect(updateIngredient).toHaveBeenCalledWith('bacon', { name: 'Thick bacon', section: 'meat', staple: false, avoid: ['veg'] }));
  });

  it('ANewName_LeavesTheIngredientAlone_WhenItWasAlreadyCalledSomethingElse', async () => {
    const user = userEvent.setup();
    open({ ...CATALOG, ingredients: CATALOG.ingredients.map((i) => (i.id === 'bacon' ? { ...i, name: 'Bacon, sliced' } : i)) });
    await user.clear(bacon().getByLabelText('Name'));
    await user.type(bacon().getByLabelText('Name'), 'Thick bacon');
    await save(user);
    expect(updateIngredient).not.toHaveBeenCalled();
  });

  it('SavingWithoutANewName_DoesNotTouchTheIngredient', async () => {
    const user = userEvent.setup();
    open();
    await user.click(bacon().getByRole('checkbox', { name: 'Lunch' }));
    await save(user);
    expect(updateIngredient).not.toHaveBeenCalled();
  });

  it('ADietThatNeedsALook_IsSaid', () => {
    open();
    expect(bacon().getByText('Vegetarian').closest('div')?.textContent).toMatch(/Vegetarian.*Needs an answer/);
  });

  // Patrick, 2026-10-05: "there is no obvious way to add a variation for vegetarian bacon" — now the short form asks.
  describe('diets are answered in the short form', () => {
    const veg = () => within(bacon().getByRole('radiogroup', { name: 'What vegetarian scouts get' }));

    it('NotSuitable_IsOneClick_AndSaves', async () => {
      const user = userEvent.setup();
      open();
      await user.click(veg().getByRole('radio', { name: 'Not suitable' }));
      expect(bacon().getByText(/No vegetarian version/)).toBeTruthy();
      await save(user);
      expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({ variations: [{ restriction: 'veg', state: 'unsuitable', lines: [] }] });
    });

    it('Instead_AsksWhatTheyGet_AndItStaysAFood', async () => {
      const user = userEvent.setup();
      open();
      await user.click(veg().getByRole('radio', { name: 'Instead…' }));
      const pick = bacon().getByLabelText('What vegetarian scouts get instead of Bacon');
      // Marked until a food is picked; the amount starts as the food's own.
      expect([pick.getAttribute('aria-invalid'), (bacon().getByLabelText('Amount of the swap per vegetarian scout') as HTMLInputElement).value]).toEqual(['true', '3']);
      await pickIng(user, pick, 'Eggs');
      expect(bacon().queryByText(/Adding a second ingredient makes/)).toBeNull();
      await save(user);
      expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({
        base: [{ ingredientId: 'bacon' }],
        variations: [{ restriction: 'veg', state: 'substituted', lines: [{ op: 'swap', baseIngredientId: 'bacon', ingredientId: 'eggs', amount: '3' }] }]
      });
    });

    it('ADietNotFlagged_CanStillBeAdded', async () => {
      const user = userEvent.setup();
      open();
      await user.selectOptions(bacon().getByRole('combobox', { name: 'Add a diet' }), 'gf');
      const gf = within(bacon().getByRole('radiogroup', { name: 'What gluten-free scouts get' }));
      expect((gf.getByRole('radio', { name: 'Same as everyone' }) as HTMLInputElement).checked).toBe(true);
    });

    it('AnAnsweredDiet_CanBeRemoved', async () => {
      const user = userEvent.setup();
      open();
      await user.click(veg().getByRole('radio', { name: 'Not suitable' }));
      await user.click(bacon().getByRole('button', { name: 'Remove' }));
      // A Not suitable answer is something: the dialog names it before it goes.
      await user.click(screen.getByRole('button', { name: 'Remove answer' }));
      expect((veg().getByRole('radio', { name: 'Not suitable' }) as HTMLInputElement).checked).toBe(false);
    });
  });

  it('OpenTheFullEditor_GoesToTheFoodsOwnPage', async () => {
    open();
    await userEvent.setup().click(bacon().getByRole('button', { name: 'Open the full editor' }));
    expect(nav.push).toHaveBeenCalledWith('/admin/library/menu-monster/recipes/bacon');
  });

  it('OnItsOwnPage_ASingleFoodShowsItsIngredientLines', () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="bacon" />);
    expect(bacon().getByRole('list', { name: 'Ingredient lines' })).toBeTruthy();
  });

  it('OnItsOwnPage_BackToTheShortForm_ReturnsToTheListWithTheFoodOpen', async () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="bacon" />);
    await more(bacon(), 'short');
    expect(nav.push).toHaveBeenCalledWith('/admin/library/menu-monster?tab=recipes&recipe=bacon');
  });

  it('UnderItsRow_TheNameAndStatusAreNotRepeated', () => {
    open();
    expect([bacon().queryByRole('heading', { name: 'Bacon' }), bacon().queryByText('Published')]).toEqual([null, null]);
  });

  it('AFoodWithNoStepsOrGear_ShowsNoStepsField_ButAlwaysTheGearPicker', () => {
    open();
    expect([bacon().queryByLabelText('How to make it') == null, bacon().queryByRole('combobox', { name: 'Search gear' }) != null]).toEqual([true, true]);
  });

  it('AFoodThatIsCooked_KeepsItsStepsAndGear_InTheShortForm', async () => {
    const user = userEvent.setup();
    open({ ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'bacon' ? { ...r, stepsMd: 'Fry until crisp.', equipment: ['Griddle'] } : r)) });
    expect((bacon().getByLabelText('How to make it') as HTMLTextAreaElement).value).toBe('Fry until crisp.');
    // Gear is picked from the master list now (2026-10-05), no longer typed as a comma list.
    await user.type(bacon().getByRole('combobox', { name: 'Search gear' }), 'ton{Enter}');
    await save(user);
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({ stepsMd: 'Fry until crisp.', gear: ['Griddle', 'Tongs'] });
  });

  it('AGearNameTheServerDropped_IsSaid_AndTakenOffTheForm', async () => {
    const user = userEvent.setup();
    vi.mocked(saveRecipe).mockResolvedValueOnce({ ok: true, id: 'bacon', dropped: ['Spork'] });
    open({ ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'bacon' ? { ...r, stepsMd: 'Fry until crisp.', equipment: ['Griddle', 'Spork'] } : r)) });
    await user.type(bacon().getByLabelText('How to make it'), '!');
    await save(user);
    expect((await screen.findByText(/Not on the gear list, so not kept: Spork/)).textContent).toContain('Spork');
    expect(bacon().queryByRole('button', { name: 'Remove Spork' })).toBeNull();
  });

  it('ItsBrands_AreRightThere', () => {
    open();
    expect(bacon().getByRole('region', { name: 'Bacon brands and prices' })).toBeTruthy();
  });

  // Patrick, 2026-10-06: "consolidate the suggested brands into the main brand list ... promote it to the suggested
  // brand ... put a star behind the brand name ... Only one is allowed to be promoted."
  describe('the one suggested brand lives on the brand list', () => {
    const BRANDED: Catalog = {
      ...CATALOG,
      brands: [
        { id: 'b-om', ingredientId: 'bacon', name: 'Oscar Mayer', avoid: null },
        { id: 'b-hf', ingredientId: 'bacon', name: 'Hormel', avoid: null }
      ],
      packages: CATALOG.packages.map((p) => (p.id === 'p-bac' ? { ...p, brandId: 'b-om' } : p)),
      recipes: CATALOG.recipes.map((r) => (r.id === 'bacon' ? { ...r, brandSuggestions: { bacon: 'b-om' } } : r))
    };

    it('TheSuggestedBrand_WearsAStar_AndTheOthersDoNot', () => {
      open(BRANDED);
      const list = bacon().getByRole('region', { name: 'Bacon brands and prices' });
      expect(within(list).getByRole('heading', { name: /Oscar Mayer/ }).textContent).toMatch(/★/);
      expect(within(list).getByRole('heading', { name: /Hormel/ }).textContent).not.toMatch(/★/);
      expect(bacon().queryByRole('region', { name: /Suggested brands/ })).toBeNull();
    });

    it('SuggestThisBrand_PromotesIt_AndTheOldOneCanBeCleared', async () => {
      const { suggestRecipeBrand } = await import('../src/app/admin/(workspace)/library/menu-monster/actions');
      const user = userEvent.setup();
      open(BRANDED);
      await user.selectOptions(bacon().getByRole('combobox', { name: 'More for Hormel' }), 'suggest');
      await waitFor(() => expect(suggestRecipeBrand).toHaveBeenCalledWith('bacon', 'bacon', 'b-hf'));
      await user.selectOptions(bacon().getByRole('combobox', { name: 'More for Oscar Mayer' }), 'unsuggest');
      await waitFor(() => expect(suggestRecipeBrand).toHaveBeenCalledWith('bacon', 'bacon', null));
    });
  });

  it('ThePriceBook_IsOneLinkAway', () => {
    open();
    expect(bacon().getByRole('link', { name: /Price book →/ }).getAttribute('href')).toBe('/admin/library/menu-monster?tab=prices&ingredient=bacon');
  });
});

describe('Recipe builder — the problem is marked where it is (2026-10-04)', () => {
  const OJ: Catalog = {
    ...CATALOG,
    ingredients: [...ING, { id: 'oj', name: 'Orange juice', unit: UNITS.cup, section: 'dairy', staple: false, avoid: [], retiredAt: null }],
    recipes: [
      recipe({
        id: 'oj', name: 'Orange juice',
        lines: [
          { ingredientId: 'oj', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
          { ingredientId: 'eggs', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }
        ]
      }),
      recipe({ id: 'ojf', name: 'Juice box', lines: [{ ingredientId: 'oj', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })
    ]
  };

  it('TheNeedsFixingBox_IsAnAlert', () => {
    render(<RecipeScreen catalog={{ ...OJ, recipes: OJ.recipes.map((r) => (r.id === 'oj' ? { ...r, mealFit: [] } : r)) }} recipeId="oj" />);
    const fixes = within(screen.getByRole('region', { name: 'Edit Orange juice' })).getByRole('list', { name: 'Needs fixing' });
    expect(fixes.closest('[role="alert"], [role="status"], [class*="notice" i]')).not.toBeNull();
  });

  // No price is not a problem that blocks anything (2026-10-05): the item publishes, is not "Needs fixes",
  // and the editor mentions it under "Worth a look" with the way to add one.
  it('AnIngredientWithNoPrice_IsWorthALook_NotAFix', () => {
    render(<RecipeScreen catalog={OJ} recipeId="oj" />);
    const editor = within(screen.getByRole('region', { name: 'Edit Orange juice' }));
    expect(editor.queryByRole('list', { name: 'Needs fixing' })).toBeNull();
    const look = editor.getByRole('list', { name: 'Worth a look' });
    expect(look.textContent).toContain('Orange juice has no price yet. Menus will show it as not priced until one is added.');
    expect(within(look).getByRole('link', { name: 'Add a price for Orange juice →' }).getAttribute('href')).toBe('/admin/library/menu-monster?tab=prices&ingredient=oj');
    expect(editor.queryByText('Needs fixes')).toBeNull();
  });

  it('ALineWithNoProblem_SaysNothing', () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    const lines = within(screen.getByRole('list', { name: 'Ingredient lines' })).getAllByRole('listitem');
    expect(lines.some((l) => /priced package|pick an ingredient/.test(l.textContent ?? ''))).toBe(false);
  });

  it('NoMealPicked_MarksMealFit', () => {
    render(<RecipeScreen catalog={{ ...CATALOG, recipes: [recipe({ id: 'pancakes', name: 'Pancakes', mealFit: [], lines: CATALOG.recipes[0].lines })] }} recipeId="pancakes" />);
    expect(within(screen.getByRole('group', { name: 'Meal fit' })).getByText('Pick at least one meal.')).toBeTruthy();
  });

  it('ASingleFoodWithNoPrice_SaysSoWhereThePriceGoes_AndOffersToAddOne', () => {
    render(<RecipeBuilder catalog={OJ} initialRecipeId="ojf" />);
    const editor = within(screen.getByRole('region', { name: 'Edit Juice box' }));
    expect(editor.getByText(/^No price yet\. Menus can use orange juice and show it as not priced until one is added\./)).toBeTruthy();
    expect(editor.getByRole('button', { name: 'Add a price' })).toBeTruthy();
  });
});

/**
 * Patrick, 2026-10-05: "cookies are listed under a recipe. I need a way to move it to a single food
 * classification." What something is follows from what it holds — one ingredient, no swap — so the move is
 * choosing that one thing. Toast here is a draft with no ingredients at all, the same state Cookies was in.
 */
describe('Recipe builder — make a recipe a single food (2026-10-05)', () => {
  const toast = () => within(screen.getByRole('region', { name: 'Edit Toast' }));
  const openToast = () => render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);

  const option = (scope: ReturnType<typeof within>, name: string) => within(scope.getByRole('combobox', { name: 'More actions' })).queryByRole('option', { name });

  it('ARecipe_OffersToBecomeASingleFood_AndASingleFoodDoesNot', () => {
    openToast();
    expect(option(toast(), 'Make it a single food')).toBeTruthy();
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="bacon" />);
    expect(option(within(screen.getByRole('region', { name: 'Edit Bacon' })), 'Make it a single food')).toBeNull();
  });

  it('PickingAnIngredientOnFile_PutsThatOneThingOnTheRecipe_ReadyToSave', async () => {
    const user = userEvent.setup();
    openToast();
    await more(toast(), 'food');
    const panel = within(screen.getByRole('region', { name: 'Make Toast a single food' }));
    await user.selectOptions(panel.getByLabelText('What each person gets'), 'bread');
    const amount = panel.getByLabelText('How many each');
    await user.clear(amount);
    await user.type(amount, '2');
    await user.click(panel.getByRole('button', { name: 'Use this' }));
    // Nothing is written until the leader saves, like every other edit here.
    expect(saveRecipe).not.toHaveBeenCalled();
    await user.click(toast().getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({ id: 'toast', base: [{ ingredientId: 'bread', amount: '2', unitKey: null }] });
  });

  it('ANewIngredient_IsMadeFromTheRecipesName_WhenNothingOnFileFits', async () => {
    const user = userEvent.setup();
    openToast();
    await more(toast(), 'food');
    const panel = within(screen.getByRole('region', { name: 'Make Toast a single food' }));
    // Nothing on file is called Toast, so the form starts on a new ingredient named after it.
    expect((panel.getByLabelText('What each person gets') as HTMLSelectElement).value).toBe('__new');
    expect((panel.getByLabelText('Name') as HTMLInputElement).value).toBe('Toast');
    await user.clear(panel.getByLabelText('One is called'));
    await user.type(panel.getByLabelText('One is called'), 'slice');
    await user.clear(panel.getByLabelText('Several are called'));
    await user.type(panel.getByLabelText('Several are called'), 'slices');
    await user.click(panel.getByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(createIngredient).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createIngredient).mock.calls[0][0]).toMatchObject({ name: 'Toast', unit: { kind: 'count', key: 'count', one: 'slice', many: 'slices' } });
    // The panel closes and the recipe now has unsaved edits (the new line; Save follows once the page reloads the catalog).
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Make Toast a single food' })).toBeNull());
    expect(toast().getByText('Unsaved edits')).toBeTruthy();
  });

  it('ARecipeWithIngredients_IsToldWhatTheMoveReplaces', async () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    await more(within(screen.getByRole('region', { name: 'Edit Pancakes' })), 'food');
    expect(within(screen.getByRole('region', { name: 'Make Pancakes a single food' })).getByText(/This replaces its 2 ingredients with that one thing\./)).toBeTruthy();
  });
});

describe('Recipe builder — one A–Z list with filters (2026-10-04)', () => {
  // Menu items only: the list now also carries a row per Price book ingredient with no item (2026-10-06), tested below.
  const names = () =>
    Array.from(list().querySelectorAll('tbody tr:not(:has(td[colspan]))'))
      .filter((tr) => tr.children[1]?.textContent !== 'Ingredient')
      .map((tr) => tr.children[0].textContent);
  const BIG: Catalog = {
    ...CATALOG,
    recipes: [
      ...CATALOG.recipes,
      recipe({ id: 'apple', name: 'Apple', mealFit: ['lunch', 'breakfast'], lines: [{ ingredientId: 'eggs', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] }),
      recipe({ id: 'old', name: 'Aardvark stew', status: 'retired', lines: CATALOG.recipes[0].lines })
    ]
  };

  it('Items_AreListedAToZ_WithRetiredLast', () => {
    render(<RecipeBuilder catalog={BIG} />);
    expect(names()).toEqual(['Apple', 'Bacon', 'Pancakes', 'Toast', 'Aardvark stew']);
  });

  it('SingleFoods_ShowsOnlyOneIngredientItems', async () => {
    render(<RecipeBuilder catalog={BIG} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Single foods/ }));
    expect(names()).toEqual(['Apple', 'Bacon']);
  });

  it('Recipes_ShowsTheRest_WithoutRetired', async () => {
    render(<RecipeBuilder catalog={BIG} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Recipes/ }));
    expect(names()).toEqual(['Pancakes', 'Toast']);
  });

  it('NeedsFixes_IsItsOwnList', async () => {
    render(<RecipeBuilder catalog={BIG} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Needs fixes/ }));
    expect(names()).toEqual(['Toast']);
  });

  it('Tabs_CarryCounts', () => {
    render(<RecipeBuilder catalog={BIG} />);
    expect(screen.getByRole('tab', { name: /^Single foods/ }).textContent).toMatch(/2/);
  });

  it('Search_FindsByName', async () => {
    render(<RecipeBuilder catalog={BIG} />);
    // 2026-10-06: 'pan' now also finds recipes through the Pancake mix ingredient, so this asserts a name only an item has.
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search food and recipes' }), 'toa');
    expect(names()).toEqual(['Toast']);
  });

  it('TheMealFilter_FindsAnItemUnderEveryMealItFits', async () => {
    render(<RecipeBuilder catalog={BIG} />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Meal' }), 'lunch');
    expect(names()).toEqual(['Apple']);
  });

  it('NothingMatching_OffersToClearTheFilters', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={BIG} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search food and recipes' }), 'zzz');
    await user.click(within(list()).getByRole('button', { name: 'Clear filters' }));
    expect(names()).toHaveLength(5);
  });

  it('TheOpenFood_StaysOpen_WhenFilteredOutOfTheList', async () => {
    render(<RecipeBuilder catalog={BIG} initialRecipeId="bacon" />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Recipes/ }));
    expect(screen.getByRole('region', { name: 'Edit Bacon' })).toBeTruthy();
  });
});

/**
 * Patrick, 2026-10-05: "more like the UX of the Price Book tab — a screen wide list with useful columns of
 * data with an editor that opens." A single food opens under its row; a recipe's editor is too long for
 * that, so its name is a link to its own page and the list's filters go with it.
 */
describe('Recipe builder — a wide list; foods open in it, recipes on their own page (2026-10-05)', () => {
  const cells = (name: string) => within(within(list()).getByText(name).closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);

  it('TheList_HasAColumnForEachThingALeaderScansFor', () => {
    render(<RecipeBuilder catalog={CATALOG} />);
    expect(within(list()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Kind', 'Meals', 'Each person gets', 'Variations', 'Cost / person', 'Status']);
  });

  // 2026-10-06: tied to its food, as every real single food is — else Bacon would also be an ingredient row.
  const TIED: Catalog = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'bacon' ? { ...r, foodIngredientId: 'bacon' } : r)) };

  it('ASingleFoodRow_SaysWhatEachPersonGets_AndItsCost', () => {
    render(<RecipeBuilder catalog={TIED} />);
    // 3 slices of a $7.49 / 16-slice pack.
    expect(cells('Bacon')).toEqual(['Bacon', 'Food', 'Breakfast', '3 slices', '1 needs a look', '$1.40', 'Published']);
  });

  it('AFoodWithADietSwap_IsStillAFood_AndTheListSaysSo', () => {
    const swapped: Catalog = {
      ...CATALOG,
      recipes: TIED.recipes.map((r) =>
        r.id === 'bacon' ? { ...r, variations: [{ restriction: 'veg', state: 'substituted', note: null, lines: [{ op: 'swap', baseIngredientId: 'bacon', ingredientId: 'eggs', qtyPerPerson: 2, unitKey: null }] }] } : r
      )
    };
    render(<RecipeBuilder catalog={swapped} />);
    expect(cells('Bacon')[1]).toBe('Food · diet swaps');
  });

  it('ARecipeRow_CountsItsIngredients', () => {
    render(<RecipeBuilder catalog={CATALOG} />);
    expect(cells('Pancakes').slice(1, 4)).toEqual(['Recipe', 'Breakfast', '2 ingredients']);
  });

  it('ASingleFood_OpensUnderItsRow_AndClosesOnASecondClick', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={CATALOG} />);
    const name = within(list()).getByRole('button', { name: 'Bacon' });
    await user.click(name);
    const opened = within(list()).getByRole('row', { name: 'Details for Bacon' }).previousElementSibling === name.closest('tr');
    await user.click(name);
    expect([opened, screen.queryByRole('region', { name: 'Edit Bacon' })]).toEqual([true, null]);
  });

  it('ARecipe_IsALinkToItsOwnPage_CarryingTheFilter', async () => {
    render(<RecipeBuilder catalog={CATALOG} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Recipes/ }));
    expect(within(list()).getByRole('link', { name: 'Pancakes' }).getAttribute('href')).toBe('/admin/library/menu-monster/recipes/pancakes?kind=recipes');
  });

  it('ALinkThatNamesARecipe_OpensNothingInTheList', () => {
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="pancakes" />);
    expect(screen.queryByRole('region', { name: 'Edit Pancakes' })).toBeNull();
  });

  it('NewRecipe_IsALinkToABlankPage', () => {
    render(<RecipeBuilder catalog={CATALOG} />);
    expect(screen.getByRole('link', { name: '+ New recipe' }).getAttribute('href')).toBe('/admin/library/menu-monster/recipes/new');
  });

  it('TheList_StartsFromTheFilterInTheUrl', () => {
    render(<RecipeBuilder catalog={CATALOG} initialFilter={{ kind: 'recipes', meal: '', q: 'pan' }} />);
    expect(within(list()).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Pancakes']);
  });

  it('AFilterChange_IsRememberedInTheAddress', async () => {
    render(<RecipeBuilder catalog={CATALOG} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Single foods/ }));
    expect(window.location.search).toBe('?tab=recipes&kind=foods');
  });
});

describe('Recipe page — Close (2026-10-05)', () => {
  const others = () => within(screen.getByRole('navigation', { name: 'Recipe page' }));

  it('ThePage_HasOnlyClose_AtTheTop', () => {
    // Patrick, 2026-10-05: Previous / Next at the top of a long form were one pair of links too many.
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    expect(others().getAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  });

  it('ANewRecipe_CanBeClosedToo', () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="new" />);
    expect(others().getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('Close_ReturnsToTheListItCameFrom', async () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" filter={{ kind: 'recipes', meal: 'breakfast', q: '' }} />);
    await userEvent.setup().click(others().getByRole('button', { name: 'Close' }));
    expect(nav.push).toHaveBeenCalledWith('/admin/library/menu-monster?tab=recipes&kind=recipes&meal=breakfast');
  });

  it('ABlockedSave_SaysWhyBesideTheButton_AndFocusesTheField', async () => {
    // Patrick, 2026-10-05: a swap line with no amount blocked the save, and the only word of it was a tooltip.
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);
    const editor = within(screen.getByRole('region', { name: 'Edit Toast' }));
    await addIng(user, editor, 'Bread');
    // Nothing said while they are still typing…
    expect(editor.queryByText(/^Can’t save yet/)).toBeNull();
    const save = editor.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await user.click(save);
    // …and on the click: nothing saved, the reason in words, the field marked and focused.
    expect(saveRecipe).not.toHaveBeenCalled();
    expect(editor.getByText(/^Can’t save yet/).textContent).toBe('Can’t save yet: Line 1: type an amount per person.');
    const amount = editor.getByLabelText('Line 1 amount');
    expect([amount.getAttribute('aria-invalid'), document.activeElement === amount]).toEqual(['true', true]);
    // Fixed: the note goes away by itself.
    await user.type(amount, '2');
    expect(editor.queryByText(/^Can’t save yet/)).toBeNull();
  });

  it('ABlockedSave_OnAnotherVersionTab_SwitchesToIt_AndMarksTheTab', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    const editor = within(screen.getByRole('region', { name: 'Edit Pancakes' }));
    await user.click(editor.getByRole('button', { name: /\+ Add a variation/ }));
    await user.click(within(editor.getByRole('group', { name: 'Variations to add' })).getByRole('button', { name: /^Gluten-free/ }));
    const panel = within(editor.getByRole('region', { name: 'Gluten-free version' }));
    await user.selectOptions(panel.getByLabelText('Pancake mix for gluten-free scouts'), 'swap');
    await pickIng(user, panel.getByLabelText('Swap Pancake mix for'), 'Almond flour');
    await user.click(editor.getByRole('tab', { name: 'Everyone' }));
    await user.click(editor.getByRole('button', { name: 'Save changes' }));
    const gf = editor.getByRole('tab', { name: /Gluten-free/ });
    expect([gf.getAttribute('aria-selected'), within(gf).getByRole('img', { name: 'needs fixing' }) != null]).toEqual(['true', true]);
    // The panel re-rendered with the tab switch: query it afresh.
    expect(document.activeElement).toBe(within(editor.getByRole('region', { name: 'Gluten-free version' })).getByRole('textbox', { name: 'Amount of Almond flour per person' }));
  });

  it('Retire_AsksFirst_FromTheMoreMenu', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    await more(within(screen.getByRole('region', { name: 'Edit Pancakes' })), 'retire');
    expect(setRecipeStatus).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(setRecipeStatus).toHaveBeenCalledWith('pancakes', 'retired'));
  });

  it('OnlyOnePrimary_SaveWhileDirty', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);
    const region = screen.getByRole('region', { name: 'Edit Toast' });
    const primaries = () => Array.from(region.querySelectorAll('button')).filter((b) => /primary/.test(b.className)).map((b) => b.textContent);
    expect(primaries()).toEqual(['Saved']);
    await user.type(within(region).getByLabelText('Name'), '!');
    expect(primaries()).toEqual(['Save changes']);
  });

  it('ASwapWithNoAmount_IsOutlinedInPlace', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    const editor = within(screen.getByRole('region', { name: 'Edit Pancakes' }));
    await user.click(editor.getByRole('button', { name: /\+ Add a variation/ }));
    await user.click(within(editor.getByRole('group', { name: 'Variations to add' })).getByRole('button', { name: /^Gluten-free/ }));
    const panel = within(editor.getByRole('region', { name: 'Gluten-free version' }));
    await user.selectOptions(panel.getByLabelText('Pancake mix for gluten-free scouts'), 'swap');
    await pickIng(user, panel.getByLabelText('Swap Pancake mix for'), 'Almond flour');
    expect(panel.getByRole('textbox', { name: 'Amount of Almond flour per person' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('ANewRecipe_OnceSaved_MovesToItsOwnAddress', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="new" />);
    const editor = within(screen.getByRole('region', { name: 'New recipe' }));
    await user.type(editor.getByLabelText('Name'), 'Trail mix');
    await user.click(editor.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/admin/library/menu-monster/recipes/toast'));
  });

  it('TheStatus_IsSaidOnThePage', () => {
    render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);
    expect(within(screen.getByRole('region', { name: 'Edit Toast' })).getByText('Needs fixes')).toBeTruthy();
  });
});

/**
 * Patrick, 2026-10-06: a food added at the meal planner (hot chocolate) and an ingredient inside a recipe (hot
 * cocoa in "Hot beverages") were both missing from this search. Search reads the ingredients on a recipe's
 * lines; a Price book food with no menu item is a row of its own, always listed; a scout's own new food shows
 * when searched for, with a way to keep it.
 */
describe('Recipe builder — ingredients in the list and in the search (2026-10-06)', () => {
  const COCOA: Ingredient = { id: 'cocoa', name: 'Hot cocoa', unit: UNITS.cup, section: 'dry', staple: false, avoid: [], retiredAt: null };
  const WITH_COCOA: Catalog = {
    ...CATALOG,
    ingredients: [...ING, COCOA],
    recipes: [
      // Bacon is tied to its food, so only Bread, Eggs, Pancake mix, Almond flour and Hot cocoa are ingredient rows.
      ...CATALOG.recipes.map((r) => (r.id === 'bacon' ? { ...r, foodIngredientId: 'bacon' } : r)),
      recipe({ id: 'hot-beverages', name: 'Hot beverages', mealFit: ['snack'], lines: [{ ingredientId: 'cocoa', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }, { ingredientId: 'eggs', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })
    ]
  };
  const SCOUT: ScoutFood = {
    id: 'S-0000aaaa', name: 'Hot chocolate', status: 'draft', owner: 'Sam K.', createdAt: '2026-10-06T15:00:00Z', mealFit: ['snack'], amount: 1,
    ingredientId: 'x-0000aaaa', ingredientName: 'Hot chocolate', section: 'dry', avoid: [], unit: { key: 'cup', one: 'cup', many: 'cups', kind: 'volume' }, pkg: null
  };
  const rowOf = (name: string) => within(list()).getByText(name).closest('tr') as HTMLElement;
  const cellsOf = (name: string) => within(rowOf(name)).getAllByRole('cell').map((c) => c.textContent);

  beforeEach(() => {
    vi.mocked(putFoodOnMenu).mockClear().mockResolvedValue({ ok: true });
    vi.mocked(keepScoutFood).mockClear().mockResolvedValue({ ok: true, note: 'Kept “Hot chocolate” for the troop and put it on the menu.' });
  });

  it('APriceBookFoodWithNoMenuItem_IsARowWithNoSearch', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} />);
    expect(cellsOf('Hot cocoa')).toEqual(['Hot cocoaPut it on the menu by itself', 'Ingredient', '—', '—', '—', '—', 'In the Price book']);
  });

  it('AFoodWithAMenuItem_IsNotAlsoAnIngredientRow', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} />);
    expect(within(list()).getAllByText('Bacon')).toHaveLength(1);
  });

  it('TheKindStrip_HasAnIngredientsTab_WithItsCount', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} />);
    expect(screen.getByRole('tab', { name: /^Ingredients/ }).textContent).toMatch(/5/);
  });

  it('TheIngredientsTab_ListsOnlyIngredients', async () => {
    render(<RecipeBuilder catalog={WITH_COCOA} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Ingredients/ }));
    expect(within(list()).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['Ingredient', 'Ingredient', 'Ingredient', 'Ingredient', 'Ingredient']);
  });

  it('Search_FindsARecipeThroughItsIngredient_AndSaysSo', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} initialFilter={{ kind: 'all', meal: '', q: 'cocoa' }} />);
    expect(within(rowOf('Hot beverages')).getByText('has hot cocoa')).toBeTruthy();
  });

  it('Search_ByTheRecipesOwnName_SaysNothingExtra', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} initialFilter={{ kind: 'all', meal: '', q: 'hot bev' }} />);
    expect(screen.queryByText(/^has /)).toBeNull();
  });

  it('PutItOnTheMenuByItself_AsksHowMuchAndWhichMeals_ThenCallsTheAction', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={WITH_COCOA} />);
    await user.click(within(rowOf('Hot cocoa')).getByRole('button', { name: 'Put it on the menu by itself' }));
    const form = screen.getByRole('region', { name: 'Put Hot cocoa on the menu' });
    await user.click(within(form).getByRole('checkbox', { name: 'Snack' }));
    await user.click(within(form).getByRole('button', { name: 'Put it on the menu' }));
    await waitFor(() => expect(putFoodOnMenu).toHaveBeenCalledWith('cocoa', { amount: '1', mealFit: ['snack'], foodGroups: [] }));
  });

  it('PutItOnTheMenu_WithNoMeal_SaysWhatIsMissing', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={WITH_COCOA} />);
    await user.click(within(rowOf('Hot cocoa')).getByRole('button', { name: 'Put it on the menu by itself' }));
    await user.click(within(screen.getByRole('region', { name: 'Put Hot cocoa on the menu' })).getByRole('button', { name: 'Put it on the menu' }));
    expect(screen.getByRole('alert').textContent).toBe('Pick at least one meal it fits.');
  });

  it('PutItOnTheMenu_WithNoMeal_SavesNothing', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={WITH_COCOA} />);
    await user.click(within(rowOf('Hot cocoa')).getByRole('button', { name: 'Put it on the menu by itself' }));
    await user.click(within(screen.getByRole('region', { name: 'Put Hot cocoa on the menu' })).getByRole('button', { name: 'Put it on the menu' }));
    expect(putFoodOnMenu).not.toHaveBeenCalled();
  });

  it('AScoutsNewFood_IsNotListed_WithNoSearch', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} scoutFoods={[SCOUT]} />);
    expect(screen.queryByText('Hot chocolate')).toBeNull();
  });

  it('AScoutsNewFood_AppearsWhenSearched_WithWhoAndWhen', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} scoutFoods={[SCOUT]} initialFilter={{ kind: 'all', meal: '', q: 'choc' }} />);
    expect(cellsOf('Hot chocolate')[0]).toBe('Hot chocolateKeep for the troopSam K. · Oct 6, 2026');
  });

  it('AScoutsNewFood_IsTagged_WaitingForALeader', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} scoutFoods={[SCOUT]} initialFilter={{ kind: 'all', meal: '', q: 'choc' }} />);
    expect(cellsOf('Hot chocolate')[6]).toBe('Scout’s — waiting for a leader');
  });

  it('AScoutsNewFood_StaysHidden_WhenTheSearchDoesNotMatchIt', () => {
    render(<RecipeBuilder catalog={WITH_COCOA} scoutFoods={[SCOUT]} initialFilter={{ kind: 'all', meal: '', q: 'bacon' }} />);
    expect(screen.queryByText('Hot chocolate')).toBeNull();
  });

  it('KeepForTheTroop_CallsTheKeepAction', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={WITH_COCOA} scoutFoods={[SCOUT]} initialFilter={{ kind: 'all', meal: '', q: 'choc' }} />);
    await user.click(within(rowOf('Hot chocolate')).getByRole('button', { name: 'Keep for the troop' }));
    await waitFor(() => expect(keepScoutFood).toHaveBeenCalledWith('S-0000aaaa'));
  });

  it('KeepForTheTroop_SaysWhatHappened_InWords', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={WITH_COCOA} scoutFoods={[SCOUT]} initialFilter={{ kind: 'all', meal: '', q: 'choc' }} />);
    await user.click(within(rowOf('Hot chocolate')).getByRole('button', { name: 'Keep for the troop' }));
    expect((await screen.findByText(/Kept “Hot chocolate” for the troop/)).textContent).toMatch(/put it on the menu/);
  });

  it('KeepForTheTroop_WhenRefused_ShowsTheReasonInPlace', async () => {
    vi.mocked(keepScoutFood).mockResolvedValue({ ok: false, error: 'That item isn’t waiting for a leader any more.' });
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={WITH_COCOA} scoutFoods={[SCOUT]} initialFilter={{ kind: 'all', meal: '', q: 'choc' }} />);
    await user.click(within(rowOf('Hot chocolate')).getByRole('button', { name: 'Keep for the troop' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn’t waiting/);
  });
});

describe('Recipe builder — a searchable ingredient picker (2026-10-06)', () => {
  const editorOf = () => screen.getByRole('region', { name: 'Edit Toast' });
  const openLine = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);
    await addIng(user, within(editorOf()), 'Bread');
    await user.click(within(editorOf()).getByRole('button', { name: 'Clear Line 1 ingredient' }));
    return within(editorOf()).getByLabelText('Line 1 ingredient') as HTMLInputElement;
  };
  const optionNames = () => within(screen.getByRole('listbox', { name: 'Line 1 ingredient options' })).getAllByRole('option').map((o) => o.firstChild?.textContent);

  it('Leader_FindsAnIngredient_ByTypingPartOfItsName', async () => {
    const user = userEvent.setup();
    const field = await openLine(user);
    await user.type(field, 'FLOU');
    expect(optionNames()).toEqual(['Almond flour']);
  });

  it('Leader_PicksWithTheKeyboard_AndEscapeRestoresTheOldPick', async () => {
    const user = userEvent.setup();
    const field = await openLine(user);
    await pickIng(user, field, 'Bread');
    await user.clear(field);
    await user.type(field, 'e');
    const names = optionNames();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(field.value).toBe(names[1]);
    await user.type(field, 'zzz');
    await user.keyboard('{Escape}');
    expect(field.value).toBe(names[1]);
  });

  it('Leader_ClearsAPick_WithTheXBesideIt', async () => {
    const user = userEvent.setup();
    const field = await openLine(user);
    await pickIng(user, field, 'Bread');
    await user.click(within(editorOf()).getByRole('button', { name: 'Clear Line 1 ingredient' }));
    expect(field.value).toBe('');
  });
});

describe('Recipe builder — a new ingredient that did not save cleanly (2026-10-06)', () => {
  const newIngredient = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<RecipeScreen catalog={CATALOG} recipeId="new" stores={['Kroger']} today="2026-10-06" />);
    const editor = screen.getByRole('region', { name: 'New recipe' });
    await user.click(within(editor).getByRole('button', { name: 'Not in the list? New ingredient…' }));
    const form = within(editor).getByRole('region', { name: 'New ingredient' });
    await user.type(within(form).getByLabelText('Name'), 'All Purpose Flour');
    return { editor, form };
  };

  it('Leader_ContinuesANewIngredient_AfterAPartialFailure_WithoutADuplicate', async () => {
    const user = userEvent.setup();
    vi.mocked(createFood).mockResolvedValueOnce({ ok: false, id: 'all-purpose-flour', error: 'All Purpose Flour is in the price book, but its package was not saved: boom' });
    vi.mocked(finishFood).mockResolvedValueOnce({ ok: true, id: 'all-purpose-flour' });
    const { editor, form } = await newIngredient(user);
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
    await user.click(await within(editor).findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(finishFood).toHaveBeenCalledTimes(1));
    expect([vi.mocked(createFood).mock.calls.length, vi.mocked(finishFood).mock.calls[0][0], within(editor).queryByLabelText('Line 2 amount'), within(editor).queryByRole('region', { name: 'New ingredient' })]).toEqual([1, 'all-purpose-flour', null, null]);
  });

  it('Leader_ReopensAJustCreatedIngredient_FromItsLine', async () => {
    const user = userEvent.setup();
    vi.mocked(createFood).mockResolvedValueOnce({ ok: true, id: 'all-purpose-flour' });
    const { editor, form } = await newIngredient(user);
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
    const link = await within(editor).findByRole('link', { name: 'Edit ingredient on line 1' });
    expect([link.getAttribute('href'), link.getAttribute('target')]).toEqual(['/admin/library/menu-monster?tab=prices&ingredient=all-purpose-flour', '_blank']);
  });
});

describe('Recipe page — delete at the foot, and a new brand from the pull-down (2026-10-06)', () => {
  const editorOf = (name: string) => within(screen.getByRole('region', { name: `Edit ${name}` }));
  const BRANDED: Catalog = {
    ...CATALOG,
    brands: [{ id: 'b-krus', ingredientId: 'pancake-mix', name: 'Krusteaz', avoid: null }],
    recipes: CATALOG.recipes.map((r) => (r.id === 'pancakes' ? { ...r, brandSuggestions: { 'pancake-mix': 'b-krus' } } : r))
  };

  beforeEach(() => {
    vi.mocked(deleteRecipe).mockClear().mockResolvedValue({ ok: true });
    vi.mocked(createBrand).mockClear().mockResolvedValue({ ok: true, id: 'b-new' });
    vi.mocked(suggestRecipeBrand).mockClear().mockResolvedValue({ ok: true });
  });

  it('Leader_DeletesARecipe_FromTheFootOfTheDetail_AfterConfirming', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" filter={{ kind: 'recipes', meal: 'breakfast', q: '' }} menusUsing={{ count: 0, names: [] }} />);
    const editor = editorOf('Pancakes');
    // At the foot, outlined danger (never the primary), and not in the sticky bar.
    const del = editor.getByRole('button', { name: 'Delete recipe' });
    expect(/danger/.test(del.className) && !/primary/.test(del.className)).toBe(true);
    expect(del.closest('[class*="saveBar"]')).toBeNull();
    await user.click(del);
    expect(deleteRecipe).not.toHaveBeenCalled();
    expect(screen.getByText('Delete Pancakes?')).toBeTruthy();
    expect(screen.getByText('It is removed from the troop’s list for good.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteRecipe).toHaveBeenCalledWith('pancakes'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/library/menu-monster?tab=recipes&kind=recipes&meal=breakfast'));
  });

  it('Leader_CannotDelete_ARecipeStillOnAMenu_AndIsOfferedRetire', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" menusUsing={{ count: 4, names: ['Spring campout', 'Summer camp', 'Winter hike'] }} />);
    await user.click(editorOf('Pancakes').getByRole('button', { name: 'Delete recipe' }));
    expect(screen.getByText('Pancakes is on 4 menus (Spring campout, Summer camp, Winter hike…)')).toBeTruthy();
    expect(screen.getByText('Take it off those menus first, or Retire it so no new menu picks it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(setRecipeStatus).toHaveBeenCalledWith('pancakes', 'retired'));
    expect(deleteRecipe).not.toHaveBeenCalled();
  });

  it('Leader_IsSentToTakeItOffTheMenu_ForATiedSingleFood', async () => {
    const user = userEvent.setup();
    const tied: Catalog = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'bacon' ? { ...r, foodIngredientId: 'bacon' } : r)) };
    render(<RecipeScreen catalog={tied} recipeId="bacon" menusUsing={{ count: 0, names: [] }} />);
    await user.click(editorOf('Bacon').getByRole('button', { name: 'Delete recipe' }));
    expect(screen.getByText(/Take it off the menu/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(deleteRecipe).not.toHaveBeenCalled();
  });

  it('Leader_AddsANewBrand_FromTheSuggestedBrandPulldown', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={BRANDED} recipeId="pancakes" />);
    const select = screen.getByRole('combobox', { name: 'Pancake mix' }) as HTMLSelectElement;
    expect([...select.options].at(-1)?.textContent).toBe('New brand…');
    await user.selectOptions(select, 'New brand…');
    await user.type(screen.getByRole('textbox', { name: 'New brand of pancake mix' }), 'Bisquick');
    await user.click(screen.getByRole('button', { name: 'Add brand' }));
    await waitFor(() => expect(createBrand).toHaveBeenCalledWith('pancake-mix', 'Bisquick'));
    await waitFor(() => expect(suggestRecipeBrand).toHaveBeenCalledWith('pancakes', 'pancake-mix', 'b-new'));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'New brand of pancake mix' })).toBeNull());
  });

  it('Leader_CancelsANewBrand_AndThePreviousPickComesBack', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={BRANDED} recipeId="pancakes" />);
    const select = screen.getByRole('combobox', { name: 'Pancake mix' }) as HTMLSelectElement;
    await user.selectOptions(select, 'New brand…');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'New brand of pancake mix' })).toBeNull();
    expect(select.value).toBe('b-krus');
    expect(createBrand).not.toHaveBeenCalled();
  });
});

/** Jenna's audit of the recipe form, 2026-10-06: every item on it can be added, edited and removed, with safeguards. */
describe('Recipe builder — edit and delete safeguards (2026-10-06)', () => {
  const pancakes = () => within(screen.getByRole('region', { name: 'Edit Pancakes' }));
  const addGfSwap = async (user: ReturnType<typeof userEvent.setup>) => {
    const editor = pancakes();
    await user.click(editor.getByRole('button', { name: /\+ Add a variation/ }));
    await user.click(within(editor.getByRole('group', { name: 'Variations to add' })).getByRole('button', { name: /^Gluten-free/ }));
    const panel = within(editor.getByRole('region', { name: 'Gluten-free version' }));
    await user.selectOptions(panel.getByLabelText('Pancake mix for gluten-free scouts'), 'swap');
    await pickIng(user, panel.getByLabelText('Swap Pancake mix for'), 'Almond flour');
    await user.type(panel.getByLabelText('Amount of Almond flour per person'), '1');
  };

  it('Leader_RemovesABaseLine_AndItsSwapGoesWithIt', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    await addGfSwap(user);
    await user.click(pancakes().getByRole('tab', { name: 'Everyone' }));
    await user.click(pancakes().getByRole('button', { name: 'Remove line 1' }));
    // Nothing is left behind that says "remove this change" and blocks Save.
    await user.click(pancakes().getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(saveRecipe).mock.calls[0][0];
    expect([sent.base.map((b) => b.ingredientId), sent.variations.flatMap((v) => v.lines)]).toEqual([['eggs'], []]);
  });

  it('Leader_IsToldWhatAVariationRemoveTakes', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    await addGfSwap(user);
    await user.click(pancakes().getByRole('button', { name: 'Remove this variation' }));
    // Not gone yet: a danger dialog names what goes with it.
    expect(screen.getByText(/Its 1 change goes too/)).toBeTruthy();
    expect(pancakes().getByRole('region', { name: 'Gluten-free version' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove version' }));
    expect(pancakes().queryByRole('region', { name: 'Gluten-free version' })).toBeNull();
  });

  it('SwitchingAVersionAway_FromItsChanges_SaysSoBeforeDroppingThem', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    await addGfSwap(user);
    const panel = within(pancakes().getByRole('region', { name: 'Gluten-free version' }));
    await user.click(panel.getByRole('radio', { name: 'Not suitable' }));
    expect(panel.getByText(/drops its 1 change/)).toBeTruthy();
    expect((panel.getByRole('radio', { name: 'Substitute' }) as HTMLInputElement).checked).toBe(true);
    await user.click(panel.getByRole('button', { name: 'Switch and drop them' }));
    expect((panel.getByRole('radio', { name: 'Not suitable' }) as HTMLInputElement).checked).toBe(true);
  });

  it('Leader_SeesWhyUseThisIsBlocked_InPlace', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);
    await more(within(screen.getByRole('region', { name: 'Edit Toast' })), 'food');
    const panel = within(screen.getByRole('region', { name: 'Make Toast a single food' }));
    await user.clear(panel.getByLabelText('How many each'));
    const use = panel.getByRole('button', { name: 'Use this' }) as HTMLButtonElement;
    expect(use.disabled).toBe(false);
    await user.click(use);
    expect(createIngredient).not.toHaveBeenCalled();
    expect(panel.getByLabelText('How many each').getAttribute('aria-invalid')).toBe('true');
    expect(panel.getByText('Type how many each person gets.')).toBeTruthy();
  });

  it('Duplicate_WhileDirty_SaysWhyInPlace_EvenOnAPublishedRecipe', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    expect(pancakes().queryByText(/Duplicate and the short form wait for a save/)).toBeNull();
    await user.type(pancakes().getByLabelText('Name'), '!');
    expect(pancakes().getByText(/Duplicate and the short form wait for a save/)).toBeTruthy();
  });
});

/**
 * Patrick, 2026-10-06: the oil is measured in tablespoons but the recipe needs 3 or 4 cups. The line's unit is
 * any the engine can bridge; the builder says in place when a unit cannot change, and takes a unit typed after
 * the number ("4 cups").
 */
describe('Recipe builder — the unit of a line (2026-10-06)', () => {
  const OIL: Ingredient = { id: 'oil', name: 'Cooking oil', unit: UNITS.tbsp, section: 'dry', staple: false, avoid: [], retiredAt: null };
  const WITH_OIL: Catalog = {
    ...CATALOG,
    ingredients: [...ING, OIL],
    recipes: [
      recipe({
        id: 'cakes', name: 'Potato pancakes',
        lines: [
          { ingredientId: 'oil', qtyPerPerson: 2, unitKey: null, servesRule: 'everyone', servesRestrictions: [] },
          { ingredientId: 'eggs', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }
        ]
      })
    ]
  };
  const lineItem = (n: number) => within(screen.getByRole('list', { name: 'Ingredient lines' })).getAllByRole('listitem')[n - 1];

  it('Leader_IsToldInPlace_WhyTheUnitCannotChange_WithAPriceBookLink', () => {
    render(<RecipeScreen catalog={WITH_OIL} recipeId="cakes" />);
    const line = within(lineItem(2));
    expect(line.getByText(/^Only eggs so far/)).toBeTruthy();
    expect(line.getByRole('link', { name: 'Price book' }).getAttribute('href')).toBe('/admin/library/menu-monster?tab=prices&ingredient=eggs');
    expect((line.getByLabelText('Line 2 unit') as HTMLSelectElement).disabled).toBe(true);
  });

  it('Leader_TypesFourCups_AndTheUnitFollows', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={WITH_OIL} recipeId="cakes" />);
    const amount = within(lineItem(1)).getByLabelText('Line 1 amount');
    await user.clear(amount);
    await user.type(amount, '4 cups');
    await user.tab();
    expect((amount as HTMLInputElement).value).toBe('4');
    expect((within(lineItem(1)).getByLabelText('Line 1 unit') as HTMLSelectElement).value).toBe('cup');
  });

  it('Leader_IsToldInPlace_WhenTheTypedUnitCannotBeConverted', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={WITH_OIL} recipeId="cakes" />);
    const amount = within(lineItem(2)).getByLabelText('Line 2 amount');
    await user.clear(amount);
    await user.type(amount, '4 cups');
    await user.tab();
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(within(lineItem(2)).getByText(/^cups is not a unit the Price book can convert for Eggs/)).toBeTruthy();
    expect(within(lineItem(2)).getAllByRole('link', { name: 'Price book' }).length).toBeGreaterThan(0);
    expect(lineItem(2).textContent).not.toMatch(/isn.t a number/);
  });
});

describe('Recipe builder — admin add rows (Menu-Monster-Add-Pattern Phase 2)', () => {
  it('Leader_CancelsTheIngredientSearch_AndFocusGoesBackToTheLink', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);
    const editor = within(screen.getByRole('region', { name: 'Edit Toast' }));
    await user.click(editor.getByRole('button', { name: '+ Ingredient' }));
    const open = editor.getByRole('combobox', { name: 'Add an ingredient' }) != null;
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    expect([open, editor.queryByRole('combobox', { name: 'Add an ingredient' }), editor.queryByLabelText('Line 1 ingredient'), document.activeElement === editor.getByRole('button', { name: '+ Ingredient' })]).toEqual([true, null, null, true]);
  });

  it('Leader_PickingFromTheSearch_AddsItsLine_AndFocusesTheAmount', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="toast" />);
    const editor = within(screen.getByRole('region', { name: 'Edit Toast' }));
    await addIng(user, editor, 'Bread');
    await waitFor(() => expect(document.activeElement).toBe(editor.getByLabelText('Line 1 amount')));
    expect([(editor.getByLabelText('Line 1 ingredient') as HTMLInputElement).value, editor.queryByRole('combobox', { name: 'Add an ingredient' })]).toEqual(['Bread', null]);
  });

  it('Leader_AddsAnExtraLineForADiet_FromTheSameKindOfRow', async () => {
    const user = userEvent.setup();
    render(<RecipeScreen catalog={CATALOG} recipeId="pancakes" />);
    const editor = within(screen.getByRole('region', { name: 'Edit Pancakes' }));
    await user.click(editor.getByRole('button', { name: /\+ Add a variation/ }));
    await user.click(within(editor.getByRole('group', { name: 'Variations to add' })).getByRole('button', { name: /^Gluten-free/ }));
    const panel = within(editor.getByRole('region', { name: 'Gluten-free version' }));
    await user.click(panel.getByRole('button', { name: '+ Ingredient' }));
    await pickIng(user, panel.getByRole('combobox', { name: 'Add an ingredient for gluten-free scouts' }), 'Almond flour');
    expect((panel.getByLabelText('Extra line 1 ingredient') as HTMLInputElement).value).toBe('Almond flour');
  });
});
