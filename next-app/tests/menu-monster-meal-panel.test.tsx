import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Link from 'next/link';
import userEvent from '@testing-library/user-event';
import { CATALOG, ROWS } from './helpers/menu-monster-fixture';
import { mapCatalog } from '../src/lib/menu-monster/catalog';
import { PLAN_STORAGE_KEY } from '../src/lib/menu-monster/legacy-draft';
import type { Menu } from '../src/lib/menu-monster/menus';

/**
 * A meal, open inline on the Plan tab (MealPanel — "Meals inline on the Plan
 * tab", 2026-10-03; it was the meal page, a port of meal.html, and these are
 * that page's tests moved over). One quiet row per recipe (its name opens the
 * ingredient list), a dashed search to add or swap a recipe, a People dialer fed
 * from the menu, the Plan tab's Total / Per person switch, and the Plan tab's
 * one dirty-gated Save + Discard. No shopping controls here (Shopping tab) and a
 * menu's package choices, quantities and sources ride through Save untouched.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const saveMenuAction = vi.fn();
const addMenuIngredientAction = vi.fn();
const addScoutPackageAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a),
  addMenuIngredientAction: (...a: unknown[]) => addMenuIngredientAction(...a),
  addScoutPackageAction: (...a: unknown[]) => addScoutPackageAction(...a)
}));

import { PlanTab } from '../src/app/(public)/library/menu-monster/menus/_components/plan-tab';
// Planner part b (2026-10-06): a clean saved menu's primary is the link "Next: Gear ›" (Save becomes Next), not a disabled "Saved" button.

const VERSION = '2026-10-02T12:00:00.000Z';
const LANDED = { ok: true, updatedAt: '2026-10-02T13:00:00.000Z' };
const menu = (): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} },
    { id: 'm2', day: 0, slot: 'lunch', headcount: null, recipeIds: [], recipeEdits: {} }
  ]
});

let openId = 'm1';
/** The Plan tab with one meal open (?meal=), the way the meal page's links land now. */
const editor = (mealId = 'm1', m: Menu = menu()) => {
  openId = mealId;
  return <PlanTab catalog={CATALOG} menuId="menu-1" menu={m} updatedAt={VERSION} outings={[]} openMeal={mealId} />;
};
const panel = () => within(document.getElementById(`mm-meal-${openId}`) as HTMLElement);
/** The meal's row (its name, cost and badges) with its open panel, which holds the People dialer (it moved into the panel 2026-10-06). */
const mealRow = () => within((document.getElementById(`mm-meal-${openId}`) as HTMLElement).closest('li') as HTMLElement);
const people = () => mealRow().getByRole('spinbutton', { name: / people$/ }) as HTMLInputElement;
/** The meal's food search: at rest the row shows "+ Food", so tapping it is part of reaching the search (an empty meal has it open). */
const search = () => {
  if (!panel().queryByRole('combobox')) fireEvent.click(panel().getByRole('button', { name: '+ Food' }));
  return panel().getByRole('combobox');
};
const rowFor = (name: string) => panel().getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;
const addRecipe = async (user: ReturnType<typeof userEvent.setup>, text: string, option: string) => {
  await user.click(search());
  await user.type(search(), text);
  await user.click(screen.getByRole('option', { name: option }));
};
const saved = () => saveMenuAction.mock.calls[0][1] as Menu;

describe('MealEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  describe('page', () => {
    it('RecipeList_IsNamedForTheDayAndSlot', () => {
      render(editor());
      expect(screen.getByRole('list', { name: 'Recipes in Day 1 breakfast' })).toBeTruthy();
    });

    it('RecipeList_IsNamedForTheWeekday_WhenTheMenuHasADate', () => {
      render(editor('m1', { ...menu(), startDate: '2026-10-10' }));
      expect(screen.getByRole('list', { name: 'Recipes in Saturday breakfast' })).toBeTruthy();
    });

    it('BackLink_IsNotRenderedHere_TheKickerCarriesIt', () => {
      render(editor());
      expect(screen.queryByRole('link', { name: /Back to/ })).toBeNull();
    });

    it('Meal_HasNoShoppingControls', () => {
      render(editor());
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByText(/package|bringing|print|budget target/i)).toBeNull();
    });

    it('Meal_NeverTouchesTheBrowserDraft', async () => {
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      expect(window.localStorage.getItem(PLAN_STORAGE_KEY)).toBeNull();
    });
  });

  describe('recipe rows', () => {
    it('Row_ShowsEachRecipeOnTheMeal_WithTheMealsCost', () => {
      render(editor());
      // 8 people x 3 slices = 24 slices: two Oscar Mayer packs, $14.98.
      expect(within(rowFor('Bacon')).getByText('$14.98')).toBeTruthy();
    });

    it('PerPerson_ShowsEachRecipesCostForOnePerson', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'Per person' }));
      expect(within(rowFor('Bacon')).getByText('$1.87')).toBeTruthy();
    });

    it('View_SaysWhichSwitchIsOn', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'Per person' }));
      expect([screen.getByRole('button', { name: 'Per person' }).getAttribute('aria-pressed'), screen.getByRole('button', { name: 'Total to buy' }).getAttribute('aria-pressed')]).toEqual(['true', 'false']);
    });





    it('EmptyMeal_SaysSoAndPointsAtTheSearch', () => {
      render(editor('m2'));
      expect(panel().getByText('Nothing yet.')).toBeTruthy();
    });
  });

  describe('ingredient disclosure', () => {
    it('RecipeName_IsACollapsedDisclosureButton', () => {
      render(editor());
      expect(screen.getByRole('button', { name: 'Bacon' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('Click_OpensTheIngredientList_WithTotalsForThePeople', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'Bacon' }));
      expect(within(screen.getByRole('list', { name: 'Bacon ingredients' })).getByText('24 slices')).toBeTruthy();
    });

    it('Enter_OpensIt_AndEnterAgainClosesIt', async () => {
      const user = userEvent.setup();
      render(editor());
      screen.getByRole('button', { name: 'Bacon' }).focus();
      await user.keyboard('{Enter}');
      const opened = screen.getByRole('button', { name: 'Bacon' }).getAttribute('aria-expanded');
      await user.keyboard('{Enter}');
      expect([opened, screen.getByRole('button', { name: 'Bacon' }).getAttribute('aria-expanded')]).toEqual(['true', 'false']);
    });

    it('Space_OpensIt', async () => {
      const user = userEvent.setup();
      render(editor());
      screen.getByRole('button', { name: 'Bacon' }).focus();
      await user.keyboard(' ');
      expect(screen.getByRole('list', { name: 'Bacon ingredients' })).toBeTruthy();
    });

    it('PerPersonView_ShowsOnePersonsAmountInTheList', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Per person' }));
      expect(within(screen.getByRole('list', { name: 'Bacon ingredients' })).getByText('3 slices')).toBeTruthy();
    });

    it('List_ShowsTheMenusRecipeEdits', async () => {
      const m = menu();
      m.meals[0].recipeEdits = { B003: [{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 1 }] };
      const user = userEvent.setup();
      render(editor('m1', m));
      await user.click(screen.getByRole('button', { name: 'Bacon' }));
      expect(within(screen.getByRole('list', { name: 'Bacon ingredients' })).getByText('8 slices')).toBeTruthy();
    });

    it('List_LabelsADietSwap_ForTheMenusDiets', async () => {
      const m = menu();
      m.restrictions.gf = 1;
      m.meals[0].recipeIds = ['B001'];
      const user = userEvent.setup();
      render(editor('m1', m));
      await user.click(screen.getByRole('button', { name: 'Pancakes' }));
      expect(within(screen.getByText('Almond flour').closest('li') as HTMLElement).getByText('gluten-free only')).toBeTruthy();
    });
  });

  describe('add, swap, remove', () => {
    it('Search_AddsARecipe_WhenAnOptionIsClicked', async () => {
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      expect(screen.getByRole('button', { name: 'Pancakes' })).toBeTruthy();
    });

    it('Search_OnlyOffersRecipesThatFitTheSlot', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'Sand');
      expect(panel().getAllByRole('option').map((o) => o.textContent)).toEqual(['Add “Sand” as a new food…', 'Browse all recipes…']); // an unmatched name now also offers adding it as a new food
    });

    it('Search_LeavesOutRecipesAlreadyOnTheMeal', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      expect(screen.queryByRole('option', { name: 'Bacon' })).toBeNull();
    });

    it('Search_IsAComboboxWithAListbox', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'Pan');
      expect([search().getAttribute('aria-expanded'), screen.getByRole('listbox').id === search().getAttribute('aria-controls')]).toEqual(['true', true]);
    });

    it('Search_Enter_AddsTheFirstMatch', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'Oat{Enter}');
      expect(screen.getByRole('button', { name: 'Oatmeal' })).toBeTruthy();
    });

    it('Search_ArrowDown_MovesToTheNextMatch_ThenEnterAddsIt', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'o{ArrowDown}{Enter}');
      // Oatmeal, then Orange juice.
      expect(screen.getByRole('button', { name: 'Orange juice' })).toBeTruthy();
    });

    it('Search_NamesTheActiveOption_ForScreenReaders', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'o{ArrowDown}');
      const id = search().getAttribute('aria-activedescendant');
      expect(document.getElementById(id as string)?.textContent).toBe('Orange juice');
    });

    it('Search_Escape_ClearsTheFieldAndClosesTheList', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'Pan{Escape}');
      expect([(search() as HTMLInputElement).value, screen.queryByRole('listbox')]).toEqual(['', null]);
    });

    it('Search_ClearsItselfAfterAnAdd', async () => {
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      expect((search() as HTMLInputElement).value).toBe('');
    });

    it('Swap_TurnsTheSearchIntoSwapNameFor', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Swap for…' }));
      expect(screen.getByRole('combobox', { name: 'Swap Bacon for' })).toBeTruthy();
    });

    it('Swap_ReplacesTheRecipeInPlace', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Swap for…' }));
      await user.type(screen.getByRole('combobox', { name: 'Swap Bacon for' }), 'Oat{Enter}');
      expect([screen.queryByRole('button', { name: 'Bacon' }), screen.getByRole('button', { name: 'Oatmeal' })].map(Boolean)).toEqual([false, true]);
    });

    it('Swap_Escape_BacksOutAndTheSearchAddsAgain', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Swap for…' }));
      await user.keyboard('{Escape}');
      // Esc with nothing typed leaves the row (the add row's Cancel): the links come back, and the next search adds again.
      expect([screen.queryByRole('combobox'), panel().getByRole('button', { name: '+ Food' }) != null]).toEqual([null, true]);
      await user.click(panel().getByRole('button', { name: '+ Food' }));
      expect(screen.getByRole('combobox', { name: 'Add to Day 1 breakfast' })).toBeTruthy();
    });

    it('Remove_DropsTheRecipe_AndOffersUndoInTheStatusLine', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));
      const status = panel().getByRole('status');
      expect([screen.queryByRole('button', { name: 'Bacon' }), status.textContent]).toEqual([null, 'Bacon removed. Undo']);
    });

    it('Undo_BringsTheRecipeBack', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));
      await user.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.getByRole('button', { name: 'Bacon' })).toBeTruthy();
    });

    it('Undo_ReturnsSaveToSaved', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));
      await user.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
    });

    it('Undo_MovesFocusToItself_AfterARemove', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }));
    });
  });

  // "Browse all recipes…" (Patrick + Jenna, 2026-10-03): the Food & Recipes popup, opened from a meal, adds to that meal.
  describe('browse all recipes', () => {
    const library = () => screen.getByRole('dialog', { name: 'Food & Recipes' });
    async function browse(text = '') {
      const user = userEvent.setup();
      await user.click(search());
      if (text) await user.type(search(), text);
      await user.click(screen.getByRole('option', { name: 'Browse all recipes…' }));
      return user;
    }

    it('Search_EndsInBrowseAllRecipes', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      expect(panel().getAllByRole('option').at(-1)?.textContent).toBe('Browse all recipes…');
    });

    it('Search_StillOffersBrowse_WhenNothingMatches', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'zzz');
      expect([panel().getByText('Nothing for this meal matches “zzz”.'), panel().getByRole('option', { name: 'Browse all recipes…' })].every(Boolean)).toBe(true);
    });

    it('Search_Enter_DoesNotOpenBrowse_WhenNothingMatches', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'zzz{Enter}');
      expect(screen.queryByRole('dialog', { name: 'Food & Recipes' })).toBeNull();
    });

    it('Search_ArrowDown_ReachesBrowse_WhenNothingMatches', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      await user.type(search(), 'zzz{ArrowDown}{ArrowDown}{Enter}');
      expect(library().hasAttribute('open')).toBe(true);
    });

    it('Browse_NamesTheMealItAddsTo', async () => {
      render(editor());
      await browse();
      expect(within(library()).getByText('For Day 1 breakfast')).toBeTruthy();
    });

    it('Browse_StartsFilteredToThisMeal', async () => {
      render(editor());
      await browse();
      expect(within(library()).getByRole('button', { name: 'Breakfast' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('Browse_ShowsEveryRecipe_WhenTheFilterIsSetToAll', async () => {
      render(editor());
      const user = await browse();
      await user.click(within(library()).getByRole('button', { name: 'All' }));
      expect(within(library()).getByRole('button', { name: 'Add Sandwiches to breakfast' })).toBeTruthy();
    });

    it('Browse_ShowsWhatEachPersonGets_WhenARecipeIsOpened', async () => {
      render(editor());
      const user = await browse();
      await user.click(within(library()).getByRole('button', { name: /^Pancakes/ }));
      expect(within(library()).getByRole('list', { name: 'Pancakes ingredients' }).textContent).toContain('Pancake mix');
    });

    it('Browse_AddsThePickedRecipeToThisMeal_AndCloses', async () => {
      render(editor());
      const user = await browse();
      await user.click(within(library()).getByRole('button', { name: 'Add Pancakes to breakfast' }));
      expect([screen.queryByRole('dialog', { name: 'Food & Recipes' }), panel().getByRole('button', { name: 'Pancakes' })].map(Boolean)).toEqual([false, true]);
    });

    it('Browse_SaysARecipeIsAlreadyOnTheMeal', async () => {
      render(editor());
      await browse();
      expect((within(library()).getByRole('button', { name: 'Bacon is already on breakfast' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('Browse_ReturnsFocusToTheSearch_OnClose', async () => {
      render(editor());
      const user = await browse();
      await user.click(within(library()).getByRole('button', { name: 'Close' }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect([screen.queryByRole('dialog', { name: 'Food & Recipes' }), document.activeElement === search()]).toEqual([null, true]);
    });

    it('Browse_ChangesNothing_OnClose', async () => {
      render(editor());
      const user = await browse();
      await user.click(within(library()).getByRole('button', { name: 'Close' }));
      expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
    });

    it('Browse_Swaps_WhenOpenedWhileSwapping', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Swap for…' }));
      await browse();
      await user.click(within(library()).getByRole('button', { name: 'Swap Bacon for Oatmeal' }));
      expect([panel().queryByRole('button', { name: 'Bacon' }), panel().getByRole('button', { name: 'Oatmeal' })].map(Boolean)).toEqual([false, true]);
    });
  });

  describe('steps (gear lives only in the meal’s one Gear list)', () => {
    const GEARED = {
      ...CATALOG,
      recipes: CATALOG.recipes.map((r) => (r.id === 'B003' ? { ...r, stepsMd: 'Lay the slices in a cold skillet.\nTurn until crisp.', equipment: ['Camp stove', 'Skillet', 'Long tongs'] } : r))
    };
    const geared = (catalog = GEARED) => <PlanTab catalog={catalog} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={[]} openMeal="m1" />;

    it('AnOpenFood_ShowsItsSteps_WithNoToggle', async () => {
      const user = userEvent.setup();
      render(geared());
      await user.click(panel().getByRole('button', { name: /^Bacon/ }));
      expect(within(panel().getByRole('list', { name: 'How to make Bacon' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Lay the slices in a cold skillet.', 'Turn until crisp.']);
      expect([panel().getByRole('list', { name: 'How to make Bacon' }).tagName, panel().getByText('Steps', { selector: 'p' }) != null, panel().queryByRole('button', { name: /Steps/ })]).toEqual(['OL', true, null]);
    });

    it('AFood_WithNoSteps_ShowsNoStepsBlock', async () => {
      const user = userEvent.setup();
      const onlyGear = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'B003' ? { ...r, equipment: ['Skillet'] } : r)) };
      render(geared(onlyGear));
      await user.click(panel().getByRole('button', { name: /^Bacon/ }));
      expect([panel().queryByRole('list', { name: 'How to make Bacon' }), panel().queryByText('Steps', { selector: 'p' })]).toEqual([null, null]);
    });

    it('AnOpenFood_ShowsNoGearList_OfItsOwn', async () => {
      const user = userEvent.setup();
      render(geared());
      await user.click(panel().getByRole('button', { name: /^Bacon/ }));
      expect(within(rowFor('Bacon')).queryByRole('list', { name: 'Gear' })).toBeNull();
      expect(panel().queryByRole('button', { name: /Gear \(/ })).toBeNull();
    });
  });

  describe('people', () => {
    it('MealHeader_CarriesThePeopleBox_OnTheSlotLine', () => {
      render(editor());
      const head = screen.getByRole('button', { name: /^Breakfast/ }).closest('li') as HTMLElement;
      const box = people();
      // In the row, beside the slot name, and no longer inside the open panel.
      expect([head.contains(box), box.closest('[id="mm-meal-m1"]'), people().value]).toEqual([true, null, '8']);
    });

    it('MealHeader_PeopleBox_SitsBeforeTheCost', () => {
      render(editor());
      const cost = (screen.getByRole('button', { name: /^Breakfast/ }).closest('li') as HTMLElement).querySelector(':scope > [class*="cost"]') as HTMLElement;
      expect(people().compareDocumentPosition(cost) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('PeopleBox_IsOnTheRow_EvenWhenThePanelIsClosed', () => {
      render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={{ ...menu(), meals: [menu().meals[0]] }} updatedAt={VERSION} outings={[]} />);
      expect(screen.getByRole('spinbutton', { name: 'Day 1 breakfast people' })).toBeTruthy();
    });

    it('PeopleBox_DoesNotToggleTheMeal', async () => {
      const user = userEvent.setup();
      render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={{ ...menu(), meals: [menu().meals[0]] }} updatedAt={VERSION} outings={[]} />);
      const box = screen.getByRole('spinbutton', { name: 'Day 1 breakfast people' });
      await user.click(box);
      await user.clear(box);
      await user.type(box, '9');
      expect([document.getElementById('mm-meal-m1'), (box as HTMLInputElement).value]).toEqual([null, '9']);
    });

    it('Panel_LabelsTheFoodSection_FoodAndRecipes', () => {
      render(editor());
      expect([panel().getByText('Food and recipes') != null, panel().queryByText('People for this meal')]).toEqual([true, null]);
    });

    it('People_DialerDoesNotOpenOrCloseTheMeal', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.clear(people());
      await user.type(people(), '9');
      expect([people().value, document.getElementById('mm-meal-m1') != null]).toEqual(['9', true]);
    });

    it('AddList_IsAlphabetical', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(search());
      const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent ?? '').filter((t) => !t.startsWith('Browse'));
      expect(names.length).toBeGreaterThan(1);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it('People_StartsAtTheMenusNumber_WithNoResetOffered', () => {
      render(editor());
      expect([people().value, screen.queryByRole('button', { name: /^Reset / })]).toEqual(['8', null]);
    });

    it('People_CanBeOverridden_ForJustThisMeal', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(editor());
      await user.clear(people());
      await user.type(people(), '12');
      await user.tab();
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(saved().meals[0].headcount).toBe(12);
    });

    it('People_OffersResetToTheMenusNumber_OnlyWhenOverridden', async () => {
      const user = userEvent.setup();
      render(editor());
      expect(screen.queryByRole('button', { name: 'Reset Day 1 breakfast to 8 people' })).toBeNull();
      await user.clear(people());
      await user.type(people(), '12');
      await user.tab();
      expect(screen.getByRole('button', { name: 'Reset Day 1 breakfast to 8 people' })).toBeTruthy();
    });

    it('People_ResetClearsTheOverride', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.clear(people());
      await user.type(people(), '12');
      await user.tab();
      await user.click(screen.getByRole('button', { name: 'Reset Day 1 breakfast to 8 people' }));
      expect(people().value).toBe('8');
    });

    it('People_BackToTheMenusNumber_IsNotAChange', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.clear(people());
      await user.type(people(), '12');
      await user.tab();
      await user.click(screen.getByRole('button', { name: 'Reset Day 1 breakfast to 8 people' }));
      expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
    });

    it('People_SavesNull_WhenItEqualsTheMenusNumber', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const m = menu();
      m.meals[0].headcount = 12;
      const user = userEvent.setup();
      render(editor('m1', m));
      await user.click(screen.getByRole('button', { name: 'Reset Day 1 breakfast to 8 people' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(saved().meals[0].headcount).toBeNull();
    });

    it('People_ChangeTheMealsCosts', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.clear(people());
      await user.type(people(), '4');
      await user.tab();
      // 4 people x 3 slices = 12 slices: one Oscar Mayer pack, $7.49.
      expect(within(rowFor('Bacon')).getByText('$7.49')).toBeTruthy();
    });

    it('Diets_AreNotRepeatedInTheMeal_TheMenuDialersAboveCarryThem', () => {
      // No redundant text (Patrick's rule): on one page the menu's diet dialers are right above the meal.
      const m = menu();
      m.restrictions = { gf: 2, nut: 0, dairy: 0, veg: 1 };
      render(editor('m1', m));
      expect(panel().queryByText(/Gluten-free/)).toBeNull();
    });

    it('Diets_AreNotNoted_WhenTheMenuHasNone', () => {
      render(editor());
      expect(screen.queryByText(/from the menu/)).toBeNull();
    });
  });

  describe('save', () => {
    it('Save_IsDisabledAndSaid_WhenNothingChanged', () => {
      render(editor());
      expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
    });

    it('Save_Enables_WhenARecipeIsAdded', async () => {
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('Save_WritesTheNewRecipeIntoThatMealOfTheMenu', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(saved().meals[0].recipeIds).toEqual(['B003', 'B001']);
    });

    it('Save_LeavesTheOtherMealsAlone', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(saved().meals[1]).toEqual(menu().meals[1]);
    });

    it('Save_KeepsTheMenusShoppingChoicesAndTheMealsRecipeEditsUntouched', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const m = menu();
      m.shopping = {
        packageChoice: { bacon: 'p-bac-kirk' },
        qtyOverride: { bacon: { packageId: 'p-bac-kirk', qty: 2 } },
        lineSource: { bacon: { source: 'home', note: 'Mom has some' } }
      };
      m.meals[0].recipeEdits = { B003: [{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 2 }] };
      const user = userEvent.setup();
      render(editor('m1', m));
      await addRecipe(user, 'Pan', 'Pancakes');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect({ shopping: saved().shopping, recipeEdits: saved().meals[0].recipeEdits }).toEqual({
        shopping: m.shopping,
        recipeEdits: m.meals[0].recipeEdits
      });
    });

    it('Save_SendsTheMenuIdAndVersionToken', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect([saveMenuAction.mock.calls[0][0], saveMenuAction.mock.calls[0][2]]).toEqual(['menu-1', VERSION]);
    });

    it('Save_ReturnsToSaved_AfterItLands', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
    });

    it('Save_ShowsTheServersError_InAnAlert', async () => {
      saveMenuAction.mockResolvedValue({ ok: false, error: 'That menu isn’t one of yours.' });
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect((await screen.findByRole('alert')).textContent).toContain('isn’t one of yours');
    });

    it('Discard_RestoresTheLastSavedRecipes', async () => {
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      await user.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(screen.queryByRole('button', { name: 'Pancakes' })).toBeNull();
    });

    it('Discard_AfterASave_RestoresWhatWasSaved_NotWhatTheMealLoadedWith', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByRole('link', { name: 'Next: Gear ›' });
      await addRecipe(user, 'Oat', 'Oatmeal');
      await user.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect([screen.getByRole('button', { name: 'Pancakes' }), screen.queryByRole('button', { name: 'Oatmeal' })].map(Boolean)).toEqual([true, false]);
    });
  });

  describe('leaving', () => {
    it('LeavingByReload_AsksToConfirm_WhenThereAreUnsavedChanges', async () => {
      const user = userEvent.setup();
      render(editor());
      await addRecipe(user, 'Pan', 'Pancakes');
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    });

    it('LeavingByReload_IsNotBlocked_WhenNothingChanged', () => {
      render(editor());
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    });

    it('InAppLink_AsksToDiscard_WhenThereAreUnsavedChanges_AndStaysPutOnNo', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const user = userEvent.setup();
      render(
        <>
          <Link href="/library/menu-monster/menus/menu-1">Camporee food</Link>
          {editor()}
        </>
      );
      await addRecipe(user, 'Pan', 'Pancakes');
      expect(fireEvent.click(screen.getByRole('link', { name: 'Camporee food' }))).toBe(false);
      expect(confirm).toHaveBeenCalled();
      confirm.mockRestore();
    });
  });
});

/**
 * Phase 2 release A (P2.2): a recipe's open list is this menu's own version of
 * it. Edits live in the draft (dirty-gated Save), ride in meal.recipeEdits, and
 * never touch the shared recipe.
 */
describe('MealEditor recipe edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  const openBacon = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Bacon' }));
  };
  const leaveOutBacon = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Change Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Leave out' }));
  };

  it('OpenList_OffersEditing_WithoutAnyShoppingControls', async () => {
    const user = userEvent.setup();
    render(editor());
    await openBacon(user);
    expect(screen.getByRole('button', { name: 'Change Bacon' })).toBeTruthy();
  });

  it('RecipeRow_SaysYourVersion_WhenItHasEdits', async () => {
    const user = userEvent.setup();
    render(editor());
    await openBacon(user);
    await leaveOutBacon(user);
    expect(within(rowFor('Bacon')).getByText('Your version · 1')).toBeTruthy();
  });

  it('RecipeRow_HasNoVersionTag_WhenItHasNoEdits', () => {
    render(editor());
    expect(screen.queryByText(/Your version/)).toBeNull();
  });

  it('Edit_MakesSaveAvailable_WhenAnIngredientIsLeftOut', async () => {
    const user = userEvent.setup();
    render(editor());
    await openBacon(user);
    await leaveOutBacon(user);
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Edit_LowersTheMealCost_WhenAnIngredientIsLeftOut', async () => {
    const user = userEvent.setup();
    render(editor());
    // The meal's cost is its Plan tab row's right column now (no footer).
    const cost = () => (screen.getByRole('button', { name: /^Breakfast/ }).closest('li') as HTMLElement).querySelector('[class*="cost"]')?.textContent;
    const before = cost();
    await openBacon(user);
    await leaveOutBacon(user);
    expect(cost()).not.toBe(before);
  });

  it('Save_SendsTheRecipeEditsInTheMeal', async () => {
    saveMenuAction.mockResolvedValue(LANDED);
    const user = userEvent.setup();
    render(editor());
    await openBacon(user);
    await leaveOutBacon(user);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved().meals[0].recipeEdits).toEqual({ B003: [{ op: 'leave_out', ingredientId: 'bacon' }] });
  });

  it('Edit_DoesNotChangeTheOtherMeal', async () => {
    saveMenuAction.mockResolvedValue(LANDED);
    const user = userEvent.setup();
    render(editor());
    await openBacon(user);
    await leaveOutBacon(user);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved().meals[1]).toEqual(menu().meals[1]);
  });

  it('Discard_DropsTheEdits', async () => {
    const user = userEvent.setup();
    render(editor());
    await openBacon(user);
    await leaveOutBacon(user);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByText(/Your version/)).toBeNull();
  });

  it('Edit_ThenTheSameEditsInAnotherOrder_IsNotAChange', async () => {
    const user = userEvent.setup();
    const m = menu();
    m.meals[0].recipeEdits = { B003: [{ op: 'leave_out', ingredientId: 'bacon' }] };
    render(editor('m1', m));
    await openBacon(user);
    await user.click(screen.getByRole('button', { name: 'Change Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Put back' }));
    await leaveOutBacon(user);
    expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
  });

  it('RecipeMenu_GoesBackToTheTroopRecipe_AndUndoRestoresTheEdits', async () => {
    const user = userEvent.setup();
    const m = menu();
    m.meals[0].recipeEdits = { B003: [{ op: 'leave_out', ingredientId: 'bacon' }] };
    render(editor('m1', m));
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Back to the troop’s version' }));
    const gone = screen.queryByText(/Your version/);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect({ gone, back: screen.getByText('Your version · 1') != null }).toEqual({ gone: null, back: true });
  });

  it('RecipeMenu_HasNoBackToTheTroopRecipe_WhenThereAreNoEdits', async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    expect(screen.queryByRole('button', { name: 'Back to the troop’s version' })).toBeNull();
  });

  it('RemovingARecipe_DropsItsEdits_AndUndoBringsThemBack', async () => {
    const user = userEvent.setup();
    const m = menu();
    m.meals[0].recipeEdits = { B003: [{ op: 'leave_out', ingredientId: 'bacon' }] };
    render(editor('m1', m));
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Your version · 1')).toBeTruthy();
  });

  it('Edit_IsAnnouncedInTheStatusLine', async () => {
    const user = userEvent.setup();
    render(editor());
    await openBacon(user);
    await leaveOutBacon(user);
    expect(panel().getByRole('status').textContent).toContain('Bacon left out of your version.');
  });
});

describe('MealEditor — Share this version (Phase 4C)', () => {
  const edited = (): Menu => {
    const m = menu();
    return { ...m, meals: m.meals.map((x) => (x.id === 'm1' ? { ...x, recipeEdits: { B003: [{ op: 'amount' as const, ingredientId: 'bacon', qtyPerPerson: 4 }] } } : x)) };
  };

  it('EditedRecipe_OffersShareThisVersion_ToTheEditor', async () => {
    render(editor('m1', edited()));
    await userEvent.setup().click(screen.getByRole('button', { name: 'More for Bacon' }));
    expect(screen.getByRole('link', { name: 'Share this version as a new recipe…' }).getAttribute('href')).toBe('/library/menu-monster/recipes/new?menu=menu-1&meal=m1&recipe=B003');
  });

  it('UneditedRecipe_DoesNotOfferIt', async () => {
    render(editor());
    await userEvent.setup().click(screen.getByRole('button', { name: 'More for Bacon' }));
    expect(screen.queryByRole('link', { name: 'Share this version as a new recipe…' })).toBeNull();
  });
});

describe('MealEditor typed-in ingredients (release C)', () => {
  // Bacon is a single food in the fixture (no add row); a second line makes it a recipe, which has one.
  const BACON_RECIPE = mapCatalog({ ...ROWS, lines: [...ROWS.lines, { ...ROWS.lines[3], id: 9001, position: 2, ingredient_id: 'eggs' }] });
  const recipeEditor = () => <PlanTab catalog={BACON_RECIPE} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={[]} openMeal="m1" />;
  const openBacon = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Bacon' }));
  };
  async function typeNew(user: ReturnType<typeof userEvent.setup>, name = 'Gochujang') {
    await openBacon(user);
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient to your version' }), name);
    await user.click(screen.getByRole('option', { name: `Add “${name}” as a new ingredient` }));
    const form = screen.getByRole('group', { name: 'New ingredient' });
    await user.click(within(form).getByRole('button', { name: 'Weight' }));
    await user.type(within(form).getByRole('textbox', { name: 'One package holds' }), '1');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Package size unit' }), 'lb');
    await user.type(within(form).getByRole('textbox', { name: 'Price' }), '6.99');
    await user.click(within(form).getByRole('button', { name: 'Add ingredient' }));
  }

  beforeEach(() => {
    addMenuIngredientAction.mockReset();
    addMenuIngredientAction.mockResolvedValue({ ok: true, id: 'x-0000beef' });
    saveMenuAction.mockResolvedValue(LANDED);
  });

  it('Cancel_WhileNewIngredientFormIsUp_ClosesBoth', async () => {
    const user = userEvent.setup();
    render(recipeEditor());
    await openBacon(user);
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient to your version' }), 'Gochujang');
    await user.click(screen.getByRole('option', { name: 'Add “Gochujang” as a new ingredient' }));
    const rowCancel = screen.getAllByRole('button', { name: 'Cancel' }).find((b) => b.parentElement?.parentElement?.getAttribute('data-state') === 'open');
    await user.click(rowCancel as HTMLElement);
    expect([screen.queryByRole('group', { name: 'New ingredient' }), screen.getByRole('button', { name: '+ Ingredient' }) != null]).toEqual([null, true]);
  });

  it('SavedMenu_SendsTheNewIngredientToTheServer_InTheRecipeUnit', async () => {
    const user = userEvent.setup();
    render(recipeEditor());
    await typeNew(user);
    expect(addMenuIngredientAction.mock.calls[0][0]).toMatchObject({ name: 'Gochujang', kind: 'weight', size: 16, price: 6.99 });
  });

  it('SavedTypedIn_IsAddedToTheMeal_ByItsRealId', async () => {
    const user = userEvent.setup();
    render(recipeEditor());
    await typeNew(user);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved().meals[0].recipeEdits.B003).toContainEqual(expect.objectContaining({ op: 'add', ingredientId: 'x-0000beef' }));
  });

  it('Refusal_ShowsUnderTheForm_AndKeepsItOpen', async () => {
    addMenuIngredientAction.mockResolvedValue({ ok: false, error: 'You have 10 new ingredients waiting.' });
    const user = userEvent.setup();
    render(recipeEditor());
    await typeNew(user);
    expect(screen.getByText('You have 10 new ingredients waiting.')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'New ingredient' })).toBeTruthy();
  });

  it('LocalMenu_DoesNotOfferANewIngredient', async () => {
    const user = userEvent.setup();
    const store = { caps: { canSave: false, canPay: false, canReport: false }, hrefs: { plan: '/p', shopping: '/s', meal: () => '/m' }, load: () => null, save: vi.fn(), create: vi.fn(), afterCreate: () => '/' };
    openId = 'm1';
    render(<PlanTab catalog={BACON_RECIPE} menuId={null} menu={menu()} updatedAt={null} outings={[]} store={store as never} openMeal="m1" />);
    await openBacon(user);
    await user.click(screen.getByRole('button', { name: '+ Ingredient' }));
    await user.type(screen.getByRole('combobox', { name: 'Add an ingredient to your version' }), 'Gochujang');
    expect(screen.queryByRole('option', { name: 'Add “Gochujang” as a new ingredient' })).toBeNull();
  });
  it('IngredientAddRow_AtRest_IsALink_NoSearch', async () => {
    const user = userEvent.setup();
    render(recipeEditor());
    await openBacon(user);
    expect({ link: screen.queryByRole('button', { name: '+ Ingredient' }) != null, search: screen.queryByRole('combobox', { name: 'Add an ingredient to your version' }) }).toEqual({ link: true, search: null });
  });

  it('SingleFood_HasNoAddRow', async () => {
    const user = userEvent.setup();
    render(editor());
    await openBacon(user);
    expect(screen.queryByRole('button', { name: '+ Ingredient' })).toBeNull();
  });

  it('Recipe_HasAnAddRow', async () => {
    const user = userEvent.setup();
    render(recipeEditor());
    await openBacon(user);
    expect(screen.getByRole('button', { name: '+ Ingredient' })).toBeTruthy();
  });

});

/**
 * Ported from the retired single-meal planner (Planner_ShowsNotSuitable_…_AndWarnsWhenCounted):
 * a recipe that isn't for someone the menu counts says so under its row, open or not.
 */
describe('MealPanel diet warnings (ported from the planner)', () => {
  const unsuitableBacon = mapCatalog({
    ...ROWS,
    variations: [{ recipe_id: 'B003', restriction: 'veg', state: 'unsuitable', note: null, updated_at: '2026-09-08T00:00:00Z' }],
    variationLines: []
  });
  const withVeg = (n: number): Menu => ({ ...menu(), restrictions: { gf: 0, nut: 0, dairy: 0, veg: n } });

  it('Warning_SaysHowManyArentServed_WhenARecipeIsNotForADietTheMenuCounts', () => {
    openId = 'm1';
    render(<PlanTab catalog={unsuitableBacon} menuId="menu-1" menu={withVeg(2)} updatedAt={VERSION} outings={[]} openMeal="m1" />);
    expect(panel().getByText(/2 people are vegetarian and this isn’t for them/)).toBeTruthy();
  });

  it('SingleFood_UnsuitableWarning_OpensTheMealsFoodSearch', async () => {
    openId = 'm1';
    render(<PlanTab catalog={unsuitableBacon} menuId="menu-1" menu={withVeg(2)} updatedAt={VERSION} outings={[]} openMeal="m1" />);
    await userEvent.setup().click(panel().getByRole('button', { name: 'Add a food for vegetarian scouts…' }));
    await waitFor(() => expect(document.activeElement).toBe(panel().getByRole('combobox')));
  });

  it('AnOpenFood_WithADietWarning_KeepsItsMenuOnTheTitleLine', () => {
    openId = 'm1';
    render(<PlanTab catalog={unsuitableBacon} menuId="menu-1" menu={withVeg(2)} updatedAt={VERSION} outings={[]} openMeal="m1" />);
    const more = panel().getByRole('button', { name: 'More for Bacon' });
    const notice = panel().getByText(/2 people are vegetarian/).closest('[class*="mealWarn"]') as HTMLElement;
    expect(more.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Warning_IsAbsent_WhenTheMenuCountsNobodyOnThatDiet', () => {
    openId = 'm1';
    render(<PlanTab catalog={unsuitableBacon} menuId="menu-1" menu={withVeg(0)} updatedAt={VERSION} outings={[]} openMeal="m1" />);
    expect(panel().queryByText(/isn’t for them/)).toBeNull();
  });

  it('AllergenWarning_NamesTheIngredient_ForGlutenFreeWithNoSwap', () => {
    // Oatmeal without its gluten-free swap line: everyone gets the regular packets.
    const noSwap = mapCatalog({ ...ROWS, lines: ROWS.lines.filter((l) => l.ingredient_id !== 'gf-oatmeal').map((l) => (l.recipe_id === 'B014' ? { ...l, serves_rule: 'everyone', serves_restrictions: [] } : l)) });
    openId = 'm1';
    const m: Menu = { ...menu(), restrictions: { gf: 1, nut: 0, dairy: 0, veg: 0 } };
    m.meals[0].recipeIds = ['B014'];
    render(<PlanTab catalog={noSwap} menuId="menu-1" menu={m} updatedAt={VERSION} outings={[]} openMeal="m1" />);
    expect(panel().getByText(/1 person is gluten-free and this has instant oatmeal/)).toBeTruthy();
  });
});

describe('MealPanel ingredient list density (Patrick, 2026-10-03)', () => {
  it('OpenRecipe_ListsItsIngredientsDense_WithoutRulesBetweenThem', async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(panel().getByRole('button', { name: /^Bacon/ }));
    expect(screen.getByRole('list', { name: 'Bacon ingredients' }).className).toMatch(/dense/);
  });
});

describe('MealPanel — Gear (one list: the foods’ gear plus the meal’s own)', () => {
  const GEAR_LIST = [
    { id: 1, name: 'Dish soap', home: 'trailer' as const, perPerson: false, retiredAt: null },
    { id: 2, name: 'Skillet', home: 'trailer' as const, perPerson: false, retiredAt: null },
    { id: 3, name: 'Wash basin', home: 'trailer' as const, perPerson: false, retiredAt: null }
  ];
  const GEARED = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'B003' ? { ...r, equipment: ['Tongs', 'Skillet × 2'] } : r)) };
  const withGear = (gear?: string[]): Menu => ({ ...menu(), meals: menu().meals.map((m) => (m.id === 'm1' && gear ? { ...m, gear } : m)) });
  const plan = (m: Menu, over: Partial<Parameters<typeof PlanTab>[0]> = {}) => (
    <PlanTab catalog={GEARED} menuId="menu-1" menu={m} updatedAt={VERSION} outings={[]} openMeal="m1" gearList={GEAR_LIST} {...over} />
  );
  const gearList = () => screen.getByRole('list', { name: 'Gear' });
  const gearItems = () => within(gearList()).getAllByRole('listitem');
  /** The items by their count boxes' names ("Skillet count"), in list order. */
  const gearNames = () => within(gearList()).getAllByRole('spinbutton').map((n) => (n.getAttribute('aria-label') ?? '').replace(/ count$/, ''));
  const itemFor = (name: string) => gearItems().find((li) => within(li).queryByRole('spinbutton', { name: `${name} count` })) as HTMLElement;
  const gearBox = () => {
    if (!screen.queryByRole('combobox', { name: 'More gear for Day 1 breakfast' })) fireEvent.click(screen.getByRole('button', { name: '+ Gear' }));
    return screen.getByRole('combobox', { name: 'More gear for Day 1 breakfast' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    openId = 'm1';
  });

  it('Gear_IsOneList_DerivedFirst_ThenAddedWithMarker', () => {
    render(plan(withGear(['Dish soap'])));
    expect([gearNames(), screen.queryByRole('list', { name: 'Gear for the foods' }), screen.queryByRole('list', { name: 'More gear for this meal' })]).toEqual([['Skillet', 'Tongs', 'Dish soap'], null, null]);
    expect([within(itemFor('Dish soap')).queryByText('added') != null, within(itemFor('Skillet')).queryByText('added'), within(itemFor('Tongs')).queryByText('added')]).toEqual([true, null, null]);
  });

  it('TheMealGearList_ShowsMealLetters_AlignedInFixedSlots', () => {
    const base = withGear();
    const m: Menu = { ...base, meals: base.meals.map((x) => (x.id === 'm2' ? { ...x, gear: ['Skillet'] } : x)) };
    render(plan(m));
    const slotsOf = (name: string) => Array.from(itemFor(name).querySelectorAll('[data-slot]')).map((el) => `${el.getAttribute('data-slot')}:${el.textContent}`);
    expect(slotsOf('Tongs')).toEqual(['breakfast:B', 'lunch:', 'dinner:', 'snack:', 'dessert:']);
    expect(slotsOf('Skillet')).toEqual(['breakfast:B', 'lunch:L', 'dinner:', 'snack:', 'dessert:']);
    expect(within(itemFor('Tongs')).getByText('Used at Breakfast')).toBeTruthy();
    expect(itemFor('Tongs').querySelector('[data-slot]')?.parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('TheGearList_IsLabelledGear_AndIsABulletedList', () => {
    render(plan(withGear()));
    expect([gearList().tagName, screen.getByText('Gear', { selector: 'p' }) != null]).toEqual(['UL', true]);
  });

  it('TheFoodsGear_ShowsTheMostAnyOneFoodAsks_OncePerItem_AToZ', () => {
    const two = { ...CATALOG, recipes: CATALOG.recipes.map((r) => (r.id === 'B003' ? { ...r, equipment: ['Skillet', 'Tongs'] } : r.id === 'B014' ? { ...r, equipment: ['skillet × 3'] } : r)) };
    const base = withGear();
    render(plan({ ...base, meals: base.meals.map((m) => (m.id === 'm1' ? { ...m, recipeIds: ['B003', 'B014'] } : m)) }, { catalog: two }));
    expect([gearNames(), (within(gearList()).getByRole('spinbutton', { name: 'Skillet count' }) as HTMLInputElement).value]).toEqual([['Skillet', 'Tongs'], '3']);
  });

  it('AGearItem_ShowsItsDescription_UnderIt_WhenTheMasterListHasOne', () => {
    const described = GEAR_LIST.map((g) => (g.name === 'Skillet' ? { ...g, description: 'Cast iron, 12 inch' } : g));
    render(plan(withGear(), { gearList: described }));
    expect([within(itemFor('Skillet')).queryByText('Cast iron, 12 inch') != null, within(itemFor('Tongs')).queryByText('Cast iron, 12 inch')]).toEqual([true, null]);
  });

  it('AFoodlessMeal_StillOffersTheMealGearPicker', () => {
    openId = 'm2';
    render(plan(withGear(), { openMeal: 'm2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Gear' }));
    expect(screen.getByRole('combobox', { name: 'More gear for Day 1 lunch' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Gear' })).toBeNull();
  });

  it('Picker_OffersTheMasterList_AToZ_AndNeverACreateRow', async () => {
    const user = userEvent.setup();
    render(plan(withGear(['Dish soap'])));
    await user.click(gearBox());
    expect(within(screen.getByRole('listbox', { name: 'Gear on the list' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Wash basin']);
    await user.type(gearBox(), 'ladle');
    expect(screen.getByText(/Nothing on the gear list matches “ladle”/)).toBeTruthy();
    expect(screen.queryByText(/^Add “/)).toBeNull();
  });

  it('PickingGear_AppendsItToTheBottomOfTheList_AsAdded_AndSavesWithThePlan', async () => {
    saveMenuAction.mockResolvedValue(LANDED);
    const user = userEvent.setup();
    render(plan(withGear()));
    expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
    await user.type(gearBox(), 'wash{Enter}');
    expect([gearNames(), within(itemFor('Wash basin')).queryByText('added') != null]).toEqual([['Skillet', 'Tongs', 'Wash basin'], true]);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved().meals[0].gear).toEqual(['Wash basin']);
  });

  it('AddedGear_StaysBelowTheFoodsGear_AToZAmongItself', async () => {
    const user = userEvent.setup();
    render(plan(withGear(['Wash basin'])));
    await user.type(gearBox(), 'dish{Enter}');
    expect(gearNames()).toEqual(['Skillet', 'Tongs', 'Dish soap', 'Wash basin']);
  });

  it('AddedGear_CanBeRemoved_AndCountEdited', async () => {
    saveMenuAction.mockResolvedValue(LANDED);
    const user = userEvent.setup();
    render(plan(withGear(['Dish soap', 'Wash basin'])));
    const box = screen.getByRole('spinbutton', { name: 'Wash basin count' });
    await user.clear(box);
    await user.type(box, '2');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Remove Dish soap' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved().meals[0].gear).toEqual(['Wash basin × 2']);
  });

  it('DerivedGear_CanBeLeftOut_FromThisMeal', async () => {
    saveMenuAction.mockResolvedValue(LANDED);
    const user = userEvent.setup();
    render(plan(withGear()));
    await user.click(screen.getByRole('button', { name: 'Remove Tongs' }));
    expect(gearNames()).toEqual(['Skillet']);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect([saved().meals[0].gearOut, saved().meals[0].gear]).toEqual([['Tongs'], undefined]);
  });

  it('DerivedGear_CountEdit_WritesAnOverride_ShownAsChanged', async () => {
    saveMenuAction.mockResolvedValue(LANDED);
    const user = userEvent.setup();
    render(plan(withGear()));
    const box = screen.getByRole('spinbutton', { name: 'Tongs count' });
    await user.clear(box);
    await user.type(box, '3');
    await user.tab();
    expect([within(itemFor('Tongs')).queryByText('changed') != null, within(itemFor('Tongs')).queryByText('added')]).toEqual([true, null]);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved().meals[0].gear).toEqual(['Tongs × 3']);
  });

  it('DerivedGear_CountEditedBackToTheFoods_DropsTheOverride', async () => {
    const user = userEvent.setup();
    render(plan(withGear()));
    const box = screen.getByRole('spinbutton', { name: 'Tongs count' });
    await user.clear(box);
    await user.type(box, '3');
    await user.tab();
    await user.clear(box);
    await user.type(box, '1');
    await user.tab();
    expect([within(itemFor('Tongs')).queryByText('changed'), screen.getByRole('link', { name: 'Next: Gear ›' }) != null]).toEqual([null, true]);
  });

  it('RemovingAChangedItem_LeavesItOut_AndDropsItsOverride', async () => {
    saveMenuAction.mockResolvedValue(LANDED);
    const user = userEvent.setup();
    render(plan(withGear(['Tongs × 3'])));
    await user.click(screen.getByRole('button', { name: 'Remove Tongs' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect([saved().meals[0].gear, saved().meals[0].gearOut]).toEqual([undefined, ['Tongs']]);
  });

  it('PickingALeftOutItem_BringsBackTheFoodsGear_NotAnAddedCopy', async () => {
    const user = userEvent.setup();
    render(plan({ ...withGear(), meals: withGear().meals.map((m) => (m.id === 'm1' ? { ...m, gearOut: ['Skillet'] } : m)) }));
    expect(gearNames()).toEqual(['Tongs']);
    await user.type(gearBox(), 'skillet{Enter}');
    expect([gearNames(), within(itemFor('Skillet')).queryByText('added'), (screen.getByRole('spinbutton', { name: 'Skillet count' }) as HTMLInputElement).value]).toEqual([['Skillet', 'Tongs'], null, '2']);
  });

  it('PickingALeftOutName_WhoseFoodIsGone_AddsIt', async () => {
    const user = userEvent.setup();
    const base = withGear();
    render(plan({ ...base, meals: base.meals.map((m) => (m.id === 'm1' ? { ...m, recipeIds: [], gearOut: ['Skillet'] } : m)) }));
    await user.type(gearBox(), 'skillet{Enter}');
    expect([gearNames(), within(itemFor('Skillet')).queryByText('added') != null]).toEqual([['Skillet'], true]);
  });

  it('Reset_NamesTheMeal_ForScreenReaders', () => {
    const base = withGear();
    render(plan({ ...base, meals: base.meals.map((m) => (m.id === 'm1' ? { ...m, headcount: 5 } : m)) }));
    expect(screen.getByRole('button', { name: 'Reset Day 1 breakfast to 8 people' }).textContent).toBe('Reset to 8');
  });

  it('RemovingTheOnlyAddedGear_PutsThePlanBackToSaved', async () => {
    const user = userEvent.setup();
    render(plan(withGear()));
    await user.type(gearBox(), 'wash{Enter}');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Remove Wash basin' }));
    expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
  });

  it('AServerDrop_IsSaid_AndTheNameLeavesTheDraft', async () => {
    saveMenuAction.mockResolvedValue({ ...LANDED, dropped: ['Wash basin'] });
    const user = userEvent.setup();
    render(plan(withGear()));
    await user.type(gearBox(), 'wash{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Not on the gear list, so not kept: Wash basin.')).toBeTruthy();
    expect(gearNames()).toEqual(['Skillet', 'Tongs']);
  });

  it('AReadOnlyViewer_SeesOneGearList_WithMarkers_AndNoControls', () => {
    render(plan(withGear(['Dish soap', 'Wash basin × 2']), { readOnly: true }));
    const texts = gearItems().map((li) => li.querySelector('[class*="gearItemName"]')?.textContent);
    expect([texts, screen.queryByRole('combobox', { name: /More gear/ }), screen.queryByRole('spinbutton', { name: /count$/ }), screen.queryByRole('button', { name: /^Remove/ })]).toEqual([['Skillet × 2', 'Tongs', 'Dish soap added', 'Wash basin × 2 added'], null, null, null]);
  });

  it('AReadOnlyViewer_OfAMealWithNoGear_SeesNoEmptyBlock', () => {
    openId = 'm2';
    render(plan(withGear(), { readOnly: true, openMeal: 'm2' }));
    expect(screen.queryByRole('list', { name: 'Gear' })).toBeNull();
  });

  it('AMenuKeptOnThisComputer_HasNoPicker_AndNoGearControls', () => {
    render(plan(withGear(), { gearList: undefined }));
    expect([screen.queryByRole('combobox', { name: /More gear/ }), screen.queryByRole('spinbutton', { name: /count$/ })]).toEqual([null, null]);
  });
});

/**
 * Patrick, 2026-10-06: "Cookies" (a troop single food, still a draft) was missing from a meal's search and nothing
 * said why — the planner lists published items only. The no-match line now names a draft that matches, and a
 * leader gets a link to it. The "Add as a new food" option still follows.
 */
describe('a draft the search cannot list says so', () => {
  const DRAFTS = [{ id: 'cookies', name: 'Cookies', mealFit: ['lunch' as const] }, { id: 'chili', name: 'Chili', mealFit: ['dinner' as const] }];
  const withDrafts = (extra: { adminLinks?: boolean; draftItems?: typeof DRAFTS } = {}) => {
    openId = 'm2';
    return <PlanTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={[]} openMeal="m2" draftItems={DRAFTS} {...extra} />;
  };
  const type = async (text: string) => {
    const user = userEvent.setup();
    await user.click(search());
    await user.type(search(), text);
  };

  it('NoMatch_NamesTheDraft_AndSaysALeaderCanPublishIt', async () => {
    render(withDrafts());
    await type('cookies');
    expect(panel().getByText(/^Cookies is a draft in the troop’s list — a leader can publish it\.$/)).toBeTruthy();
  });

  it('NoMatch_StillSaysNothingMatches_BeforeNamingTheDraft', async () => {
    render(withDrafts());
    await type('cookies');
    expect(panel().getByText('Nothing for this meal matches “cookies”.')).toBeTruthy();
  });

  it('TheAddAsANewFoodOption_IsStillOffered_AfterTheDraftLine', async () => {
    render(withDrafts());
    await type('cookies');
    const items = Array.from(panel().getByRole('listbox', { name: /matches$/ }).children).map((li) => li.textContent);
    expect(items.indexOf('Add “cookies” as a new food…')).toBeGreaterThan(items.findIndex((t) => /is a draft/.test(t ?? '')));
  });

  it('ADraftForAnotherMeal_IsNotNamed', async () => {
    render(withDrafts());
    await type('chili');
    expect(panel().queryByText(/is a draft/)).toBeNull();
  });

  it('ForAViewerWithoutAdminAccess_TheNameIsPlainText', async () => {
    render(withDrafts());
    await type('cookies');
    expect(panel().queryByRole('link', { name: 'Cookies' })).toBeNull();
  });

  it('ForALeader_TheNameLinksToTheAdminRecipePage', async () => {
    render(withDrafts({ adminLinks: true }));
    await type('cookies');
    expect(panel().getByRole('link', { name: 'Cookies' }).getAttribute('href')).toBe('/admin/library/menu-monster/recipes/cookies');
  });

  it('AFoodThatMatches_ListsNormally_WithNoDraftLine', async () => {
    render(withDrafts());
    await type('bacon');
    expect(panel().queryByText(/is a draft/)).toBeNull();
  });
});

/**
 * "No price yet" is answered in place (Patrick, 2026-10-06: Hot Chocolate added on the fly had no price): the badge opens
 * the existing add-a-package form under the food, one form per meal, and the price clears the badge without a reload.
 */
describe('MealPanel: pricing a food from its badge', () => {
  const two = mapCatalog({
    ...ROWS,
    ingredients: [...ROWS.ingredients, { ...ROWS.ingredients[6], id: 'cocoa', name: 'Hot chocolate' }],
    recipes: [...ROWS.recipes, { ...ROWS.recipes[3], id: 'B024', name: 'Hot chocolate', sort_order: 9 }],
    lines: [...ROWS.lines, { ...ROWS.lines[6], id: 900, recipe_id: 'B024', ingredient_id: 'cocoa' }]
  });
  const unpriced = (): Menu => ({ ...menu(), meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B023', 'B024'], recipeEdits: {} }, menu().meals[1]] });
  const renderMeal = () => (openId = 'm1', render(<PlanTab catalog={two} menuId="menu-1" menu={unpriced()} updatedAt={VERSION} outings={[]} openMeal="m1" />));
  const badge = (food: string) => screen.getByRole('button', { name: new RegExp(`^No price yet — add one: ${food}`) });
  const fill = async (user: ReturnType<typeof userEvent.setup>, food: string) => {
    const form = within(screen.getByRole('group', { name: `Price for ${food}` }));
    await user.type(form.getByLabelText('One package holds'), '16');
    await user.type(form.getByLabelText('Price'), '4.50');
    await user.click(form.getByRole('button', { name: 'Add package' }));
  };
  beforeEach(() => {
    vi.clearAllMocks();
    addScoutPackageAction.mockResolvedValue({ ok: true, status: 'live', id: 'sp-1' });
  });

  it('Scout_OpensThePriceForm_FromTheNoPriceBadge_InsideTheMeal', async () => {
    renderMeal();
    const user = userEvent.setup();
    await user.click(badge('Hot chocolate'));
    const form = screen.getByRole('group', { name: 'Price for Hot chocolate' });
    expect([
      badge('Hot chocolate').getAttribute('aria-expanded'),
      panel().getByRole('group', { name: 'Price for Hot chocolate' }) === form,
      within(form).queryByLabelText('Store (optional)'),
      (within(form).getByLabelText('Name on the label') as HTMLInputElement).value,
      document.activeElement === within(form).getByLabelText('Name on the label')
    ]).toEqual(['true', true, null, 'Hot chocolate', true]);
  });

  it('Scout_SeesTheBadgeGo_AndTheCost_AfterAPriceLands', async () => {
    renderMeal();
    const user = userEvent.setup();
    await user.click(badge('Hot chocolate'));
    await fill(user, 'Hot chocolate');
    await waitFor(() => expect(screen.queryByRole('button', { name: /No price yet — add one: Hot chocolate/ })).toBeNull());
    expect([
      panel().getByRole('status').textContent,
      screen.queryByRole('group', { name: 'Price for Hot chocolate' }),
      addScoutPackageAction.mock.calls[0][0]
    ]).toEqual(['Hot chocolate priced at $4.50.', null, expect.objectContaining({ ingredientId: 'cocoa', price: 4.5, size: 16 })]);
  });

  it('Scout_HearsALeaderChecksItFirst_WhenThePriceIsHeld', async () => {
    addScoutPackageAction.mockResolvedValue({ ok: true, status: 'held', id: 'sp-2' });
    renderMeal();
    const user = userEvent.setup();
    await user.click(badge('Hot chocolate'));
    await fill(user, 'Hot chocolate');
    await waitFor(() => expect(panel().getByRole('status').textContent).toBe('Hot chocolate priced at $4.50. A leader checks it first.'));
  });

  it('Scout_HasOneOpenPriceForm_PerMeal', async () => {
    renderMeal();
    const user = userEvent.setup();
    await user.click(badge('Orange juice'));
    await user.click(badge('Hot chocolate'));
    expect([screen.getAllByRole('group', { name: /^Price for / }).map((g) => g.getAttribute('aria-label')), badge('Orange juice').getAttribute('aria-expanded')]).toEqual([['Price for Hot chocolate'], 'false']);
  });

  it('Badge_ReturnsFocus_OnEscape', async () => {
    renderMeal();
    const user = userEvent.setup();
    await user.click(badge('Hot chocolate'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(badge('Hot chocolate')));
    expect(screen.queryByRole('group', { name: 'Price for Hot chocolate' })).toBeNull();
  });
});

/** One add pattern per container (Plans/Menu-Monster-Add-Pattern.md, Phase 1): links at rest, search on tap, a bordered open food. */
describe('MealPanel — the add row and the open-food card', () => {
  const user = () => userEvent.setup();

  it('AddRow_AtRest_ShowsFoodAndGearLinks_AndNoSearch', () => {
    render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={[]} openMeal="m1" gearList={[{ id: 1, name: 'Skillet', home: 'trailer', perPerson: false, retiredAt: null }]} />);
    expect([panel().getByRole('button', { name: '+ Food' }) != null, panel().getByRole('button', { name: '+ Gear' }) != null, panel().queryByRole('combobox')]).toEqual([true, true, null]);
  });

  it('EmptyMeal_ShowsTheFoodSearchOpen', async () => {
    render(editor('m2'));
    expect(search()).toBeTruthy();
    await user().click(panel().getByRole('button', { name: 'Cancel' }));
    expect([panel().queryByRole('combobox'), panel().getByRole('button', { name: '+ Food' }) != null]).toEqual([null, true]);
  });

  it('Swap_OpensTheSearchRow_InSwapMode', async () => {
    const u = user();
    render(editor());
    expect(panel().queryByRole('combobox')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'More for Bacon' }));
    await u.click(screen.getByRole('button', { name: 'Swap for…' }));
    expect(screen.getByRole('combobox', { name: 'Swap Bacon for' })).toBeTruthy();
  });

  it('OpenFood_IsABorderedCard', async () => {
    render(editor());
    await user().click(panel().getByRole('button', { name: /^Bacon/ }));
    const open = document.getElementById(panel().getByRole('button', { name: /^Bacon/ }).getAttribute('aria-controls') as string) as HTMLElement;
    expect(open.firstElementChild?.className).toMatch(/foodCard/);
  });

  it('NoHint_UnderAnOpenFood', async () => {
    render(editor());
    await user().click(panel().getByRole('button', { name: /^Bacon/ }));
    expect(screen.queryByText(/Only this menu changes/)).toBeNull();
  });

  it('FoodMenu_ListsSwapBackShareRemove_InThatOrder', async () => {
    const m = menu();
    m.meals[0].recipeEdits = { B003: [{ op: 'amount', ingredientId: 'bacon', qtyPerPerson: 4 }] };
    render(editor('m1', m));
    await user().click(screen.getByRole('button', { name: 'More for Bacon' }));
    const pop = screen.getByRole('button', { name: 'More for Bacon' }).parentElement?.lastElementChild as HTMLElement;
    const items = Array.from(pop.children).map((i) => i.textContent);
    expect(items).toEqual(['Swap for…', 'Back to the troop’s version', 'Share this version as a new recipe…', 'Remove']);
  });

  it('PeopleForThisMeal_IsANumberBox_NotADialer', () => {
    render(editor());
    expect([people().value, mealRow().queryByRole('button', { name: 'One more person' })]).toEqual(['8', null]);
  });
});

describe('MealPanel — add row follow-ups (qa-lead)', () => {
  const u = () => userEvent.setup();

  it('Cancel_WhileNewFoodFormIsUp_ClosesBoth', async () => {
    const user = u();
    render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={[]} openMeal="m1" />);
    await user.type(search(), 'Zzzfood');
    await user.click(screen.getByRole('option', { name: /^Add “Zzzfood” as a new food/ }));
    const rowCancel = panel().getAllByRole('button', { name: 'Cancel' }).find((b) => b.parentElement?.parentElement?.getAttribute('data-state') === 'open');
    await user.click(rowCancel as HTMLElement);
    expect([panel().queryByRole('combobox'), panel().getByRole('button', { name: '+ Food' }) != null, panel().queryByText(/Zzzfood/)]).toEqual([null, true, null]);
  });

  it('RemoveLastFood_LeavesFocusOnUndo', async () => {
    const user = u();
    const m = menu();
    m.meals[0].recipeIds = ['B003'];
    render(editor('m1', m));
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(document.activeElement).toBe(panel().getByRole('button', { name: 'Undo' }));
  });

  it('EmptyMeal_StillOffersGear', () => {
    render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={menu()} updatedAt={VERSION} outings={[]} openMeal="m2" gearList={[{ id: 1, name: 'Skillet', home: 'trailer', perPerson: false, retiredAt: null }]} />);
    openId = 'm2';
    expect([panel().getByRole('combobox') != null, panel().getByRole('button', { name: '+ Gear' }) != null]).toEqual([true, true]);
  });
});
