import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeBuilder } from '../src/app/admin/(workspace)/library/menu-monster/recipe-builder';
import { saveRecipe, setRecipeStatus, updateIngredient } from '../src/app/admin/(workspace)/library/menu-monster/actions';
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
  duplicateRecipe: vi.fn(async () => ({ ok: true, id: 'toast-copy' })),
  updateIngredient: vi.fn(async () => ({ ok: true })),
  suggestRecipeBrand: vi.fn(async () => ({ ok: true })),
  addBought: vi.fn(async () => ({ ok: true })),
  updatePackage: vi.fn(async () => ({ ok: true })),
  retirePackage: vi.fn(async () => ({ ok: true })),
  restorePackage: vi.fn(async () => ({ ok: true })),
  setPackageBrand: vi.fn(async () => ({ ok: true })),
  renameBrand: vi.fn(async () => ({ ok: true })),
  setBrandDiets: vi.fn(async () => ({ ok: true })),
  mergeBrand: vi.fn(async () => ({ ok: true })),
  moveBrand: vi.fn(async () => ({ ok: true })),
  removeBrand: vi.fn(async () => ({ ok: true }))
}));

beforeEach(() => {
  vi.mocked(saveRecipe).mockClear().mockResolvedValue({ ok: true, id: 'toast' });
  vi.mocked(setRecipeStatus).mockClear().mockResolvedValue({ ok: true });
  vi.mocked(updateIngredient).mockClear().mockResolvedValue({ ok: true });
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

    await user.click(within(editor).getByRole('button', { name: '+ Add an ingredient' }));
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

  it('Leader_SeesWhatNeedsFixing_AboveTheForm_OnAPublishedItem', () => {
    // Published, but its one ingredient has no priced package: the list says "Needs fixes".
    const catalog: Catalog = {
      ...CATALOG,
      ingredients: [...ING, { id: 'oj', name: 'Orange juice', unit: UNITS.cup, section: 'dairy', staple: false, avoid: [], retiredAt: null }],
      recipes: [recipe({ id: 'oj', name: 'Orange juice', lines: [{ ingredientId: 'oj', qtyPerPerson: 1, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }] })]
    };
    render(<RecipeBuilder catalog={catalog} initialRecipeId="oj" />);
    const editor = screen.getByRole('region', { name: 'Edit Orange juice' });
    const fixes = within(editor).getByRole('list', { name: 'Needs fixing' });
    expect(fixes.textContent).toMatch(/Orange juice has no priced package yet/);
    // The link goes straight to the ingredient that has no price.
    expect(within(fixes).getByRole('link', { name: 'Add a price for Orange juice →' }).getAttribute('href')).toBe('/admin/library/menu-monster?tab=prices&ingredient=oj');
    // It sits before the first field, not under the whole form.
    const name = within(editor).getByLabelText('Name');
    expect(fixes.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Published already: the heading does not talk about publishing.
    expect(within(editor).queryByText('Needs fixing before it can publish')).toBeNull();
  });

  it('Leader_SeesDuplicateLineError_ForSameIngredient', async () => {
    const user = userEvent.setup();
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="pancakes" />);
    const editor = screen.getByRole('region', { name: 'Edit Pancakes' });

    await user.click(within(editor).getByRole('button', { name: '+ Add an ingredient' }));
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
    // Bacon is a single food: its diet swaps live in the full editor.
    await user.click(within(editor).getByRole('button', { name: 'Open the full editor' }));
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

describe('Recipe builder — a single food opens in the short form (2026-10-04)', () => {
  const bacon = () => within(screen.getByRole('region', { name: 'Edit Bacon' }));
  const open = (catalog: Catalog = CATALOG) => render(<RecipeBuilder catalog={catalog} initialRecipeId="bacon" />);
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
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="pancakes" />);
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
    expect(within(bacon().getByRole('list', { name: 'Diets' })).getByRole('listitem').textContent).toMatch(/Vegetarian.*Needs a look/);
  });

  it('OpenTheFullEditor_ShowsTheIngredientLines_AndAWayBack', async () => {
    const user = userEvent.setup();
    open();
    await user.click(bacon().getByRole('button', { name: 'Open the full editor' }));
    expect([bacon().getByRole('list', { name: 'Ingredient lines' }) != null, bacon().getByRole('button', { name: 'Back to the short form' }) != null]).toEqual([true, true]);
  });

  it('AFoodWithNoStepsOrGear_ShowsNeitherField', () => {
    open();
    expect([bacon().queryByLabelText('How to make it'), bacon().queryByLabelText(/Gear you.ll need/)]).toEqual([null, null]);
  });

  it('AFoodThatIsCooked_KeepsItsStepsAndGear_InTheShortForm', async () => {
    const user = userEvent.setup();
    open({ ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'bacon' ? { ...r, stepsMd: 'Fry until crisp.', equipment: ['Griddle'] } : r)) });
    expect((bacon().getByLabelText('How to make it') as HTMLTextAreaElement).value).toBe('Fry until crisp.');
    await user.type(bacon().getByLabelText(/Gear you.ll need/), ', Tongs');
    await save(user);
    expect(vi.mocked(saveRecipe).mock.calls[0][0]).toMatchObject({ stepsMd: 'Fry until crisp.', gear: 'Griddle, Tongs' });
  });

  it('ItsBrands_AreRightThere', () => {
    open();
    expect(bacon().getByRole('region', { name: 'Bacon brands and prices' })).toBeTruthy();
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
    render(<RecipeBuilder catalog={OJ} initialRecipeId="oj" />);
    const fixes = within(screen.getByRole('region', { name: 'Edit Orange juice' })).getByRole('list', { name: 'Needs fixing' });
    expect(fixes.closest('[role="alert"], [role="status"], [class*="notice" i]')).not.toBeNull();
  });

  it('TheLineWithTheProblem_SaysItRightThere', () => {
    render(<RecipeBuilder catalog={OJ} initialRecipeId="oj" />);
    const [juice, eggs] = within(screen.getByRole('list', { name: 'Ingredient lines' })).getAllByRole('listitem');
    expect([/Orange juice has no priced package yet/.test(juice.textContent ?? ''), /priced package/.test(eggs.textContent ?? '')]).toEqual([true, false]);
  });

  it('ALineWithNoProblem_SaysNothing', () => {
    render(<RecipeBuilder catalog={CATALOG} initialRecipeId="pancakes" />);
    const lines = within(screen.getByRole('list', { name: 'Ingredient lines' })).getAllByRole('listitem');
    expect(lines.some((l) => /priced package|pick an ingredient/.test(l.textContent ?? ''))).toBe(false);
  });

  it('NoMealPicked_MarksMealFit', () => {
    render(<RecipeBuilder catalog={{ ...CATALOG, recipes: [recipe({ id: 'pancakes', name: 'Pancakes', mealFit: [], lines: CATALOG.recipes[0].lines })] }} initialRecipeId="pancakes" />);
    expect(within(screen.getByRole('group', { name: 'Meal fit' })).getByText('Pick at least one meal.')).toBeTruthy();
  });

  it('ASingleFoodWithNoPrice_MarksItsBrandsAndPrices', () => {
    render(<RecipeBuilder catalog={OJ} initialRecipeId="ojf" />);
    expect(within(screen.getByRole('region', { name: 'Edit Juice box' })).getByText('Orange juice has no priced package yet, so menus can’t cost it.')).toBeTruthy();
  });
});

describe('Recipe builder — one A–Z list with filters (2026-10-04)', () => {
  const names = () => within(list()).getAllByRole('button').map((b) => (b.textContent ?? '').split(' · ')[0].replace(/(Needs fixes|Draft|Published|Retired)$/, ''));
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
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search food and recipes' }), 'pan');
    expect(names()).toEqual(['Pancakes']);
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

  it('TheOpenItem_StaysOpen_WhenFilteredOutOfTheList', async () => {
    render(<RecipeBuilder catalog={BIG} initialRecipeId="pancakes" />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Single foods/ }));
    expect(screen.getByRole('region', { name: 'Edit Pancakes' })).toBeTruthy();
  });
});
