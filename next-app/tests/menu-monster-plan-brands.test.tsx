import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG as BASE } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Brand, Catalog } from '../src/lib/menu-monster/types';

/**
 * Brands on the Plan tab (Plans/Menu-Monster-Brands-Gear.md, release 3): an open food's ingredient reads
 * "any brand" with "Choose a brand", or its brands with "Change"; the chooser opens under the row, several stay
 * open together, and the choice rides the menu's one Save.
 */
const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const saveMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a),
  addMenuIngredientAction: vi.fn()
}));
const addBrandAction = vi.fn();
const suggestRecipeBrandAction = vi.fn();
vi.mock('@/app/(public)/library/_tools/menu-monster/brand-actions', () => ({
  addBrandAction: (...a: unknown[]) => addBrandAction(...a),
  suggestRecipeBrandAction: (...a: unknown[]) => suggestRecipeBrandAction(...a)
}));

import { PlanTab } from '../src/app/(public)/library/menu-monster/menus/_components/plan-tab';

const brand = (id: string, ingredientId: string, name: string, over: Partial<Brand> = {}): Brand => ({ id, ingredientId, name, avoid: null, ...over });
const CATALOG: Catalog = {
  ...BASE,
  packages: BASE.packages.map((p) =>
    p.id === 'p-bac-kirk' ? { ...p, brandId: 'b-kirk', sizeLabel: '4 × 1 lb' } : p.id === 'p-bac-om' ? { ...p, brandId: 'b-om', sizeLabel: '16 oz' } : { ...p, brandId: null, sizeLabel: null }
  ),
  brands: [brand('b-kirk', 'bacon', 'Kirkland'), brand('b-om', 'bacon', 'Oscar Mayer')]
};
const VERSION = '2026-10-02T12:00:00.000Z';
const menu = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food', context: 'camp', calendarEntryId: null, startDate: null, headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, budgetPerPersonMeal: 4, dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} }, actuals: {},
  meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B001'], recipeEdits: {} }],
  ...over
});
const plan = (m: Menu = menu(), props: Partial<Parameters<typeof PlanTab>[0]> = {}) => (
  <PlanTab catalog={CATALOG} menuId="menu-1" menu={m} updatedAt={VERSION} outings={[]} openMeal="m1" {...props} />
);
const panel = () => within(document.getElementById('mm-meal-m1') as HTMLElement);
const openBacon = async (user: ReturnType<typeof userEvent.setup>) => user.click(panel().getByRole('button', { name: /^Bacon/ }));
const sent = () => saveMenuAction.mock.calls[0][1] as Menu;

beforeEach(() => {
  vi.clearAllMocks();
  saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
});

describe('Plan tab — brands', () => {
  it('AnIngredientWithBrands_ReadsAnyBrand_WithChooseABrand', async () => {
    const user = userEvent.setup();
    render(plan());
    await openBacon(user);
    const list = within(panel().getByRole('list', { name: 'Bacon ingredients' }));
    expect(list.getByText('any brand')).toBeTruthy();
    expect(list.getByRole('button', { name: 'Choose a brand for Bacon' }).textContent).toBe('Choose a brand');
  });

  it('AChosenBrand_IsNamed_AndTheActionBecomesChange', async () => {
    const user = userEvent.setup();
    render(plan(menu({ shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {}, brands: { bacon: [{ brandId: 'b-kirk', qty: null }] } } })));
    await openBacon(user);
    const list = within(panel().getByRole('list', { name: 'Bacon ingredients' }));
    expect(list.getByText('Kirkland')).toBeTruthy();
    expect(list.getByRole('button', { name: 'Change for Bacon' }).textContent).toBe('Change');
  });

  it('ChoosingBrands_OnThePlan_RidesTheMenusOneSave', async () => {
    const user = userEvent.setup();
    render(plan());
    await openBacon(user);
    await user.click(panel().getByRole('button', { name: 'Choose a brand for Bacon' }));
    const chips = within(panel().getByRole('group', { name: 'Brand for Bacon' }));
    await user.click(chips.getByRole('button', { name: /^Oscar Mayer/ }));
    await user.click(chips.getByRole('button', { name: /^Kirkland/ }));
    expect(panel().getByRole('spinbutton', { name: 'Packages of Kirkland' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMenuAction).toHaveBeenCalledTimes(1));
    expect(sent().shopping.brands).toEqual({ bacon: [{ brandId: 'b-om', qty: null }, { brandId: 'b-kirk', qty: null }] });
  });

  it('TheMealsCost_FollowsTheBrand', async () => {
    const user = userEvent.setup();
    render(plan(menu({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }] })));
    const row = () => (document.getElementById('mm-meal-m1') as HTMLElement).closest('li') as HTMLElement;
    expect(row().textContent).toContain('$14.98');
    await openBacon(user);
    await user.click(panel().getByRole('button', { name: 'Choose a brand for Bacon' }));
    await user.click(within(panel().getByRole('group', { name: 'Brand for Bacon' })).getByRole('button', { name: /^Kirkland/ }));
    expect(row().textContent).toContain('$18.15');
  });

  it('ATypedBrand_IsAddedThroughTheAction_AndChosen', async () => {
    addBrandAction.mockResolvedValue({ ok: true, brand: brand('xb-0001', 'bacon', 'Farm stand', { isNew: true }) });
    const user = userEvent.setup();
    render(plan());
    await openBacon(user);
    await user.click(panel().getByRole('button', { name: 'Choose a brand for Bacon' }));
    await user.type(panel().getByRole('textbox', { name: 'Type a brand of Bacon' }), 'Farm stand{Enter}');
    await waitFor(() => expect(addBrandAction).toHaveBeenCalledWith('bacon', 'Farm stand', 'menu-1'));
    await waitFor(() => expect(within(panel().getByRole('list', { name: 'Bacon ingredients' })).getAllByText(/^Farm stand/).length).toBeGreaterThan(0));
  });

  it('AReader_SeesTheBrand_WithNothingToPress', async () => {
    const user = userEvent.setup();
    render(plan(menu({ shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {}, brands: { bacon: [{ brandId: 'b-kirk', qty: null }] } } }), { readOnly: true, plannedBy: 'Sam K.' }));
    await openBacon(user);
    expect(panel().getByText('Kirkland')).toBeTruthy();
    expect(panel().queryByRole('button', { name: /brand|Change for/i })).toBeNull();
  });

  it('AnIngredientWithNoBrands_OnAMenuKeptOnThisComputer_HasNoBrandControl', async () => {
    const user = userEvent.setup();
    const store = { caps: { canSave: false, canPay: false, canReport: false }, hrefs: { plan: '/p', shopping: '/s', meal: () => '/m' }, load: () => null, save: vi.fn(), create: vi.fn(), afterCreate: () => null };
    render(plan(menu(), { store: store as never }));
    await user.click(panel().getByRole('button', { name: /^Pancakes/ }));
    // Pancake mix has no brands in this catalog, and a local menu cannot type one.
    expect(within(panel().getByRole('list', { name: 'Pancakes ingredients' })).queryByRole('button', { name: /Choose a brand/ })).toBeNull();
  });
});

describe('Plan tab — a recipe’s suggested brand (release 6)', () => {
  const withRecipe = (over: Record<string, unknown>): Catalog => ({ ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'B003' ? { ...r, ...over } : r)) });
  const empty = (over: Partial<Menu> = {}) => menu({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: [], recipeEdits: {} }], ...over });
  const addBacon = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(panel().getByRole('combobox'));
    await user.type(panel().getByRole('combobox'), 'Bac');
    await user.click(screen.getByRole('option', { name: /^Bacon/ }));
  };
  const save = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMenuAction).toHaveBeenCalledTimes(1));
  };

  it('AddingTheRecipe_ChoosesItsSuggestedBrand', async () => {
    const user = userEvent.setup();
    render(plan(empty(), { catalog: withRecipe({ brandSuggestions: { bacon: 'b-kirk' } }) }));
    await addBacon(user);
    await save(user);
    expect(sent().shopping.brands).toEqual({ bacon: [{ brandId: 'b-kirk', qty: null }] });
  });

  it('AddingTheRecipe_SaysWhichBrandItUsed', async () => {
    const user = userEvent.setup();
    render(plan(empty(), { catalog: withRecipe({ brandSuggestions: { bacon: 'b-kirk' } }) }));
    await addBacon(user);
    expect(panel().getByText(/Using Kirkland, as the recipe suggests\./)).toBeTruthy();
  });

  it('ABrandTheMenuAlreadyChose_IsKept', async () => {
    const user = userEvent.setup();
    const m = empty({ shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {}, brands: { bacon: [{ brandId: 'b-om', qty: null }] } } });
    render(plan(m, { catalog: withRecipe({ brandSuggestions: { bacon: 'b-kirk' } }) }));
    await addBacon(user);
    await save(user);
    expect(sent().shopping.brands).toEqual({ bacon: [{ brandId: 'b-om', qty: null }] });
  });

  it('ASuggestionForABrandThatIsGone_IsIgnored', async () => {
    const user = userEvent.setup();
    render(plan(empty(), { catalog: withRecipe({ brandSuggestions: { bacon: 'b-gone' } }) }));
    await addBacon(user);
    await save(user);
    expect(sent().shopping.brands ?? {}).toEqual({});
  });

  const chooseKirkland = async (user: ReturnType<typeof userEvent.setup>) => {
    await openBacon(user);
    await user.click(panel().getByRole('button', { name: 'Choose a brand for Bacon' }));
    await user.click(within(panel().getByRole('group', { name: 'Brand for Bacon' })).getByRole('button', { name: /^Kirkland/ }));
  };

  it('TheAuthor_IsOfferedToSuggestTheOneChosenBrand', async () => {
    suggestRecipeBrandAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(plan(menu(), { catalog: withRecipe({ mine: true }) }));
    await chooseKirkland(user);
    await user.click(panel().getByRole('button', { name: 'Suggest Kirkland for the recipe' }));
    expect(suggestRecipeBrandAction).toHaveBeenCalledWith('B003', 'bacon', 'b-kirk');
    await waitFor(() => expect(panel().getByText(/Your recipe suggests Kirkland\./)).toBeTruthy());
  });

  it('TheAuthor_CanStopSuggesting', async () => {
    suggestRecipeBrandAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(plan(menu(), { catalog: withRecipe({ mine: true, brandSuggestions: { bacon: 'b-kirk' } }) }));
    await openBacon(user);
    await user.click(panel().getByRole('button', { name: 'Choose a brand for Bacon' }));
    await user.click(panel().getByRole('button', { name: 'Stop suggesting' }));
    expect(suggestRecipeBrandAction).toHaveBeenCalledWith('B003', 'bacon', null);
  });

  it('SomeoneWhoDidNotWriteTheRecipe_IsNotOffered', async () => {
    const user = userEvent.setup();
    render(plan());
    await chooseKirkland(user);
    expect(panel().queryByRole('button', { name: /Suggest .* for the recipe/ })).toBeNull();
  });

  it('ARefusal_IsSaid', async () => {
    suggestRecipeBrandAction.mockResolvedValue({ ok: false, error: 'Only the person who wrote a recipe can suggest a brand for it.' });
    const user = userEvent.setup();
    render(plan(menu(), { catalog: withRecipe({ mine: true }) }));
    await chooseKirkland(user);
    await user.click(panel().getByRole('button', { name: 'Suggest Kirkland for the recipe' }));
    await waitFor(() => expect(panel().getByText(/Only the person who wrote a recipe/)).toBeTruthy());
  });
});

describe('Plan tab — closing the brand chooser (2026-10-04)', () => {
  const pickKirkland = async (user: ReturnType<typeof userEvent.setup>) => {
    await openBacon(user);
    await user.click(panel().getByRole('button', { name: 'Choose a brand for Bacon' }));
    await user.click(within(panel().getByRole('group', { name: 'Brand for Bacon' })).getByRole('button', { name: /^Kirkland/ }));
  };

  it('Done_ClosesTheChooser', async () => {
    const user = userEvent.setup();
    render(plan());
    await pickKirkland(user);
    await user.click(panel().getByRole('button', { name: 'Done choosing a brand for Bacon' }));
    expect(panel().queryByRole('group', { name: 'Brand for Bacon' })).toBeNull();
  });

  it('AfterDone_TheRowShowsTheBrandChosen_AndOffersChange', async () => {
    const user = userEvent.setup();
    render(plan());
    await pickKirkland(user);
    await user.click(panel().getByRole('button', { name: 'Done choosing a brand for Bacon' }));
    const list = within(panel().getByRole('list', { name: 'Bacon ingredients' }));
    expect([list.getByText('Kirkland') != null, list.getByRole('button', { name: 'Change for Bacon' }).getAttribute('aria-expanded')]).toEqual([true, 'false']);
  });

  it('Done_SaysWhatWasChosen', async () => {
    const user = userEvent.setup();
    render(plan());
    await pickKirkland(user);
    await user.click(panel().getByRole('button', { name: 'Done choosing a brand for Bacon' }));
    expect(panel().getByText('Bacon: Kirkland.')).toBeTruthy();
  });

  it('Done_KeepsTheChoice_ForTheMenusSave', async () => {
    const user = userEvent.setup();
    render(plan());
    await pickKirkland(user);
    await user.click(panel().getByRole('button', { name: 'Done choosing a brand for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveMenuAction).toHaveBeenCalledTimes(1));
    expect(sent().shopping.brands).toEqual({ bacon: [{ brandId: 'b-kirk', qty: null }] });
  });
});
