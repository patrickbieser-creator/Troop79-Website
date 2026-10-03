import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import Link from 'next/link';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import { PLAN_STORAGE_KEY } from '../src/lib/menu-monster/legacy-draft';
import type { Menu } from '../src/lib/menu-monster/menus';

/**
 * Scout Workspace slice 4b: the meal page, a port of meal.html. One quiet row
 * per recipe (its name opens the ingredient list), a dashed search to add or
 * swap a recipe, a People dialer fed from the menu, a Total / Per person
 * switch, a dirty-gated Save + Discard on the title line. No shopping controls
 * here (they live on the Shopping tab, slice 5) and a meal's package choices,
 * quantities and sources ride through Save untouched.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const saveMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a)
}));

import { MealEditor } from '../src/app/(public)/library/menu-monster/menus/_components/meal-editor';

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

const editor = (mealId = 'm1', m: Menu = menu()) => <MealEditor catalog={CATALOG} menuId="menu-1" menu={m} mealId={mealId} updatedAt={VERSION} />;
const people = () => screen.getByRole('spinbutton', { name: /^People/ }) as HTMLInputElement;
const search = () => screen.getByRole('combobox');
const rowFor = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;
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
    it('Title_IsTheDayAndSlot_AsTheMealsOwnH1', () => {
      render(editor());
      expect(screen.getByRole('heading', { level: 1, name: 'Day 1 breakfast' })).toBeTruthy();
    });

    it('Title_IsTheWeekdayAndSlot_WhenTheMenuHasADate', () => {
      render(editor('m1', { ...menu(), startDate: '2026-10-10' }));
      expect(screen.getByRole('heading', { level: 1, name: 'Saturday breakfast' })).toBeTruthy();
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

    it('Footer_SaysWhatTheMealCosts_AndPerPerson', () => {
      render(editor());
      expect(screen.getByText(/This meal:/).textContent).toBe('This meal: $14.98, $1.87 a person.');
    });

    it('Footer_IsAbsent_WhenNothingIsPicked', () => {
      render(editor('m2'));
      expect(screen.queryByText(/This meal:/)).toBeNull();
    });

    it('EmptyMeal_SaysSoAndPointsAtTheSearch', () => {
      render(editor('m2'));
      expect(screen.getByText(/Nothing picked yet/)).toBeTruthy();
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
      expect(screen.queryByRole('option')).toBeNull();
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
      await user.click(screen.getByRole('button', { name: 'Swap recipe…' }));
      expect(screen.getByRole('combobox', { name: 'Swap Bacon for' })).toBeTruthy();
    });

    it('Swap_ReplacesTheRecipeInPlace', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Swap recipe…' }));
      await user.type(screen.getByRole('combobox', { name: 'Swap Bacon for' }), 'Oat{Enter}');
      expect([screen.queryByRole('button', { name: 'Bacon' }), screen.getByRole('button', { name: 'Oatmeal' })].map(Boolean)).toEqual([false, true]);
    });

    it('Swap_Escape_BacksOutAndTheSearchAddsAgain', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Swap recipe…' }));
      await user.keyboard('{Escape}');
      expect(screen.getByRole('combobox', { name: 'Add a recipe' })).toBeTruthy();
    });

    it('Remove_DropsTheRecipe_AndOffersUndoInTheStatusLine', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));
      const status = screen.getByRole('status');
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
      expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('Undo_MovesFocusToItself_AfterARemove', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }));
    });
  });

  describe('people', () => {
    it('People_StartsAtTheMenusNumber_WithAQuietSourceNote', () => {
      render(editor());
      expect([people().value, screen.getByText(/same as the menu/).textContent]).toEqual(['8', '· same as the menu']);
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
      expect(screen.queryByRole('button', { name: 'Reset to 8' })).toBeNull();
      await user.clear(people());
      await user.type(people(), '12');
      await user.tab();
      expect(screen.getByText(/your menu says 8/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reset to 8' })).toBeTruthy();
    });

    it('People_ResetClearsTheOverride', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.clear(people());
      await user.type(people(), '12');
      await user.tab();
      await user.click(screen.getByRole('button', { name: 'Reset to 8' }));
      expect(people().value).toBe('8');
    });

    it('People_BackToTheMenusNumber_IsNotAChange', async () => {
      const user = userEvent.setup();
      render(editor());
      await user.clear(people());
      await user.type(people(), '12');
      await user.tab();
      await user.click(screen.getByRole('button', { name: 'Reset to 8' }));
      expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('People_SavesNull_WhenItEqualsTheMenusNumber', async () => {
      saveMenuAction.mockResolvedValue(LANDED);
      const m = menu();
      m.meals[0].headcount = 12;
      const user = userEvent.setup();
      render(editor('m1', m));
      await user.click(screen.getByRole('button', { name: 'Reset to 8' }));
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

    it('Diets_AreAQuietSourceNote_OnThePeopleLine', () => {
      const m = menu();
      m.restrictions = { gf: 2, nut: 0, dairy: 0, veg: 1 };
      render(editor('m1', m));
      expect(screen.getByText(/Gluten-free: 2/).textContent).toContain('Gluten-free: 2 · Vegetarian: 1 (from the menu)');
    });

    it('Diets_AreNotNoted_WhenTheMenuHasNone', () => {
      render(editor());
      expect(screen.queryByText(/from the menu/)).toBeNull();
    });
  });

  describe('save', () => {
    it('Save_IsDisabledAndSaid_WhenNothingChanged', () => {
      render(editor());
      expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
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
      expect(await screen.findByRole('button', { name: 'Saved' })).toBeTruthy();
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
      await screen.findByRole('button', { name: 'Saved' });
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
    const before = screen.getByText(/This meal:/).textContent;
    await openBacon(user);
    await leaveOutBacon(user);
    expect(screen.getByText(/This meal:/).textContent).not.toBe(before);
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
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('RecipeMenu_GoesBackToTheTroopRecipe_AndUndoRestoresTheEdits', async () => {
    const user = userEvent.setup();
    const m = menu();
    m.meals[0].recipeEdits = { B003: [{ op: 'leave_out', ingredientId: 'bacon' }] };
    render(editor('m1', m));
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Back to the troop recipe' }));
    const gone = screen.queryByText(/Your version/);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect({ gone, back: screen.getByText('Your version · 1') != null }).toEqual({ gone: null, back: true });
  });

  it('RecipeMenu_HasNoBackToTheTroopRecipe_WhenThereAreNoEdits', async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    expect(screen.queryByRole('button', { name: 'Back to the troop recipe' })).toBeNull();
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
    expect(screen.getByRole('status').textContent).toContain('Bacon left out of your version.');
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
    expect(screen.getByRole('link', { name: 'Share this version as a new recipe' }).getAttribute('href')).toBe('/library/menu-monster/recipes/new?menu=menu-1&meal=m1&recipe=B003');
  });

  it('UneditedRecipe_DoesNotOfferIt', async () => {
    render(editor());
    await userEvent.setup().click(screen.getByRole('button', { name: 'More for Bacon' }));
    expect(screen.queryByRole('link', { name: 'Share this version as a new recipe' })).toBeNull();
  });
});
