import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { Menu } from '../src/lib/menu-monster/menus';
import type { Outing } from '../src/lib/menu-monster/menu-view';

/**
 * Scout Workspace slice 4: the Plan tab, rendered with a fixture catalog and
 * menu. Next's router and the server actions are the only things faked — the
 * component's own state, clamping and dirty-gating are real.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const createMenuAction = vi.fn();
const saveMenuAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  createMenuAction: (...a: unknown[]) => createMenuAction(...a),
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a)
}));

import { PlanTab } from '../src/app/(public)/library/menu-monster/menus/_components/plan-tab';

const OUTINGS: Outing[] = [
  { id: 7, title: 'Fall Camporee', startDate: '2026-10-09', endDate: '2026-10-11', category: 'Campout / Overnight' },
  { id: 8, title: 'Winter Camp', startDate: '2026-12-04', endDate: '2026-12-06', category: 'Campout / Overnight' }
];

const base = (over: Partial<Menu> = {}): Menu => ({
  name: 'Camporee food',
  context: 'camp',
  calendarEntryId: null,
  startDate: null,
  headcount: 8,
  restrictions: { gf: 5, nut: 0, dairy: 0, veg: 0 },
  budgetPerPersonMeal: 4,
  dayCount: 2,
  shopping: { packageChoice: {}, qtyOverride: {}, lineSource: {} },
  actuals: {},
  meals: [
    { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003'], recipeEdits: {} }
  ],
  ...over
});

const VERSION = '2026-10-02T12:00:00.000Z';
const existing = (menu: Menu = base()) => (
  <PlanTab catalog={CATALOG} menuId="menu-1" menu={menu} updatedAt={VERSION} outings={OUTINGS} />
);
const fresh = () => (
  <PlanTab catalog={CATALOG} menuId={null} menu={base({ name: '', meals: [], restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 } })} updatedAt={null} outings={OUTINGS} />
);

const num = (name: RegExp | string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
async function typeInto(el: HTMLInputElement, text: string) {
  const user = userEvent.setup();
  await user.clear(el);
  await user.type(el, text);
  await user.tab();
}

describe('PlanTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Save_IsDisabledAndSaid_WhenNothingChanged', () => {
    render(existing());
    const save = screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('Discard_IsDisabled_WhenNothingChanged', () => {
    render(existing());
    expect((screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save_SaysSaveChangesAndEnables_WhenTheNameChanges', async () => {
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('NewMenu_OffersSaveMenu', () => {
    render(fresh());
    expect(screen.getByRole('button', { name: 'Save menu' })).toBeTruthy();
  });

  it('Diets_ClampToPeople_WhenPeopleDropsBelowThem', async () => {
    render(existing());
    await typeInto(num(/^People/), '3');
    expect(num(/^Gluten-free/).value).toBe('3');
  });

  it('Diets_CannotExceedPeople_WhenTyped', async () => {
    render(existing());
    await typeInto(num(/^Nut-free/), '20');
    expect(num(/^Nut-free/).value).toBe('8');
  });

  it('People_StopAtFifty', async () => {
    render(existing());
    await typeInto(num(/^People/), '99');
    expect(num(/^People/).value).toBe('50');
  });

  it('People_StartAtTwo', async () => {
    render(existing());
    await typeInto(num(/^People/), '1');
    expect(num(/^People/).value).toBe('2');
  });

  it('Dialers_ReadPeopleThenDietsInTheApprovedOrder', () => {
    render(existing());
    const names = screen.getAllByRole('spinbutton').map((e) => e.getAttribute('id'));
    const labels = names.map((id) => document.querySelector(`label[for="${id}"]`)?.textContent);
    expect(labels.slice(0, 5)).toEqual(['People:', 'Gluten-free:', 'Vegetarian:', 'Nut-free:', 'Dairy-free:']);
  });

  it('Context_IsASelect', () => {
    render(existing());
    expect(screen.getByRole('combobox', { name: /Where you.re cooking/ }).tagName).toBe('SELECT');
  });

  it('Outing_IsASelect_WithNoOutingLast', () => {
    render(existing());
    const sel = screen.getByRole('combobox', { name: 'Outing' });
    const opts = within(sel).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['Fall Camporee · Oct 9–11, 2026', 'Winter Camp · Dec 4–6, 2026', 'No outing']);
  });

  it('Outing_NamesAnUnnamedMenu_WhenPicked', async () => {
    render(fresh());
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    expect((screen.getByRole('textbox', { name: 'Menu name' }) as HTMLInputElement).value).toBe('Fall Camporee');
  });

  it('Outing_KeepsAnExistingName_WhenPicked', async () => {
    render(existing());
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    expect((screen.getByRole('textbox', { name: 'Menu name' }) as HTMLInputElement).value).toBe('Camporee food');
  });

  it('Outing_SetsOneDayPerOutingDate_WhenTheMenuHasNoMeals', async () => {
    render(fresh());
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Day 1 · Fri, Oct 9',
      'Day 2 · Sat, Oct 10',
      'Day 3 · Sun, Oct 11'
    ]);
  });

  it('Meals_AreGroupedUnderTheirDay', () => {
    render(existing(base({ meals: [...base().meals, { id: 'm9', day: 1, slot: 'dinner', headcount: null, recipeIds: [], recipeEdits: {} }] })));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Day 1', 'Day 2']);
  });

  it('Meal_ShowsItsSlotRecipesAndCost', () => {
    render(existing());
    const row = screen.getByRole('button', { name: /^Breakfast/ }).closest('li') as HTMLElement;
    expect(row.textContent).toContain('Bacon');
    expect(row.textContent).toContain('$14.98');
  });

  const library = () => screen.getByRole('dialog', { name: 'Recipe library' });
  async function openLibrary(n: number) {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: new RegExp(`^Search recipes for Day ${n}$`) }));
    return user;
  }

  it('Day_EndsInASearchRecipesButton_WithoutRepeatingTheDay', () => {
    render(existing());
    const btn = screen.getByRole('button', { name: 'Search recipes for Day 1' });
    expect(btn.textContent).toBe('⌕Search recipes');
  });

  it('PlusAddAMeal_IsGone_BecauseTheDaySearchReplacedIt', () => {
    render(existing());
    expect(screen.queryByRole('button', { name: /Add a meal/ })).toBeNull();
  });

  it('SearchRecipes_OpensTheRecipeLibraryPopup', async () => {
    render(existing());
    await openLibrary(1);
    expect(library().hasAttribute('open')).toBe(true);
  });

  it('RecipeLibrary_ListsEveryRecipe_BeforeAnythingIsTyped', async () => {
    render(existing());
    await openLibrary(2);
    expect(within(library()).getAllByRole('button', { expanded: false }).map((b) => b.textContent?.replace('›', ''))).toEqual([
      'Pancakes',
      'Bacon',
      'Oatmeal',
      'Orange juice',
      'Sandwiches'
    ]);
  });

  it('RecipeLibrary_NarrowsByName_WhenTyping', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.type(within(library()).getByRole('searchbox', { name: 'Search recipes' }), 'sandw');
    expect(within(library()).getAllByRole('button', { name: /^Add / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Add Sandwiches to lunch']);
  });

  it('RecipeLibrary_NarrowsByMeal_WhenAFilterIsPressed', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(within(library()).getByRole('button', { name: 'Lunch' }));
    expect(within(library()).queryByRole('button', { name: 'Add Pancakes to breakfast' })).toBeNull();
  });

  it('RecipeLibrary_MealButtonSaysJustAdd_WhenTheFilterAlreadyNamesTheMeal', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(within(library()).getByRole('button', { name: 'Lunch' }));
    expect(within(library()).getByRole('button', { name: 'Add Sandwiches to lunch' }).textContent).toBe('+ Add');
  });

  it('RecipeLibrary_FilterButton_SaysItIsPressed', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(within(library()).getByRole('button', { name: 'Lunch' }));
    expect(within(library()).getByRole('button', { name: 'Lunch' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('RecipeLibrary_ShowsWhatEachPersonGets_WhenARecipeIsOpened', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(within(library()).getByRole('button', { name: /^Sandwiches/ }));
    expect(within(library()).getByRole('list', { name: 'Sandwiches ingredients' }).textContent).toContain('Bread');
  });

  it('Scout_AddsRecipeToExistingMeal_WhenPickingItInTheLibrary', async () => {
    render(existing());
    const user = await openLibrary(1);
    await user.click(screen.getByRole('button', { name: 'Add Pancakes to breakfast' }));
    // The meal opens inline to show it (2026-10-03).
    const list = screen.getByRole('list', { name: 'Recipes in Day 1 breakfast' });
    expect([within(list).getByRole('button', { name: /^Bacon/ }), within(list).getByRole('button', { name: /^Pancakes/ })].every(Boolean)).toBe(true);
  });

  it('Scout_CreatesTheMeal_WhenPickingARecipeForASlotTheDayLacks', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(screen.getByRole('button', { name: 'Add Sandwiches to lunch' }));
    expect(screen.getByRole('button', { name: 'More for Day 2 lunch' })).toBeTruthy();
  });

  it('RecipeLibrary_Closes_WhenARecipeIsPicked', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(screen.getByRole('button', { name: 'Add Sandwiches to lunch' }));
    expect(screen.queryByRole('dialog', { name: 'Recipe library' })).toBeNull();
  });

  it('Scout_MustSave_AfterAddingARecipeFromTheLibrary', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(screen.getByRole('button', { name: 'Add Sandwiches to lunch' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('Scout_HearsWhatHappened_WhenARecipeIsAddedFromTheLibrary', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(screen.getByRole('button', { name: 'Add Sandwiches to lunch' }));
    expect(screen.getByText('Sandwiches added to Day 2 lunch.').getAttribute('aria-live')).toBe('polite');
  });

  it('RecipeLibrary_ClosesWithoutAdding_OnClose', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(within(library()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Recipe library' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('Scout_IsNotOfferedARecipeTwice_OnTheSameMeal', async () => {
    render(existing());
    await openLibrary(1);
    expect((within(library()).getByRole('button', { name: 'Bacon is already on breakfast' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Scout_GetsAnEmptyMealOpenInline_WhenPlanningAMealWithoutARecipe', async () => {
    render(existing());
    const user = await openLibrary(2);
    await user.click(within(library()).getByRole('button', { name: 'Lunch' }));
    await user.click(within(library()).getByRole('button', { name: 'Plan lunch without a recipe' }));
    expect(screen.getByRole('button', { name: 'More for Day 2 lunch' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Recipes in Day 2 lunch' })).toBeTruthy();
  });

  it('Scout_SavesTheNewMeal_WithTheMenu_AndStaysOnThePage', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    render(existing());
    const user = await openLibrary(2);
    await user.click(within(library()).getByRole('button', { name: 'Lunch' }));
    await user.click(within(library()).getByRole('button', { name: 'Plan lunch without a recipe' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((saveMenuAction.mock.calls[0][1] as Menu).meals.some((m) => m.day === 1 && m.slot === 'lunch')).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
  });


  it('Meal_CanBeRemoved_FromItsMenu', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'More for Day 1 breakfast' }));
    await user.click(screen.getByRole('button', { name: 'Remove meal' }));
    expect(screen.queryByText('Bacon')).toBeNull();
  });

  it('RemovingAMeal_MovesFocusToTheDaysRecipeSearch', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'More for Day 1 breakfast' }));
    await user.click(screen.getByRole('button', { name: 'Remove meal' }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement?.id).toBe('mm-lib-0');
  });

  it('MealButtons_AreNamedWithTheirDay', () => {
    render(existing());
    expect(screen.getByRole('button', { name: 'Breakfast, Day 1' })).toBeTruthy();
  });

  it('Day_CanBeAdded_AndMakesTheMenuDirty', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'Add a day' }));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(3);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('Day_Added_IsSavedWithTheMenu', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'Add a day' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ dayCount: 3 }), VERSION);
  });

  it('Day_Added_IsDiscarded_WithDiscardChanges', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'Add a day' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(2);
  });

  it('Day_EmptyLastDay_CanBeRemoved', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'Remove Day 2' }));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(1);
  });

  it('Day_WithMeals_CannotBeRemoved', () => {
    render(existing());
    expect(screen.queryByRole('button', { name: 'Remove Day 1' })).toBeNull();
  });

  it('Day_StoredCount_ShowsEmptyDaysAfterReload', () => {
    render(existing(base({ dayCount: 4 })));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(4);
  });

  it('Outing_SavesItsSpanAsTheDayCount', async () => {
    createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
    const user = userEvent.setup();
    render(fresh());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save menu' }));
    expect(createMenuAction).toHaveBeenCalledWith(expect.objectContaining({ dayCount: 3 }));
  });

  it('Title_IsOneH1_ThatFollowsTheMenuName', async () => {
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Camporee food!']);
  });

  it('Discard_IsAbsent_OnABrandNewMenu', () => {
    render(fresh());
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
  });

  it('Saving_IsAnnounced_WhileTheSaveRuns', async () => {
    let finish: (v: unknown) => void = () => {};
    saveMenuAction.mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    const { container } = render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Saving…');
    finish({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('RowMenu_IsAPlainDisclosure_NotAnAriaMenu', async () => {
    const user = userEvent.setup();
    render(existing());
    const trigger = screen.getByRole('button', { name: 'More for Day 1 breakfast' });
    await user.click(trigger);
    expect(trigger.getAttribute('aria-haspopup')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('RowMenu_ClosesAndReturnsFocus_OnEscape', async () => {
    const user = userEvent.setup();
    render(existing());
    const trigger = screen.getByRole('button', { name: 'More for Day 1 breakfast' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('RowMenu_Closes_WhenFocusMovesOutOfIt', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'More for Day 1 breakfast' }));
    act(() => screen.getByRole('textbox', { name: 'Menu name' }).focus());
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('Save_IsBlockedWithTheNameError_WhenTheNameIsEmpty', async () => {
    render(fresh());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save menu' }));
    expect(screen.getByRole('alert').textContent).toContain('Give your menu a name');
  });

  it('Save_DoesNotCallTheServer_WhenTheNameIsEmpty', async () => {
    render(fresh());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save menu' }));
    expect(createMenuAction).not.toHaveBeenCalled();
  });

  it('NewMenu_CreatesThenReplacesTheUrlWithTheNewId', async () => {
    createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
    const user = userEvent.setup();
    render(fresh());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), 'Spring hike');
    await user.click(screen.getByRole('button', { name: 'Save menu' }));
    expect(router.replace).toHaveBeenCalledWith('/library/menu-monster/menus/new-id');
  });

  it('Save_SendsTheVersionTokenItLoaded', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ name: 'Camporee food!' }), VERSION);
  });

  it('Save_ReturnsToSaved_AfterItLands', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('Save_ShowsTheServersError_InAnAlert', async () => {
    saveMenuAction.mockResolvedValue({ ok: false, error: 'This menu was changed in another window since you opened it.' });
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed in another window');
  });

  it('Save_StaysDirty_WhenTheServerRefuses', async () => {
    saveMenuAction.mockResolvedValue({ ok: false, error: 'nope' });
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('Discard_RestoresTheLastSavedMenu', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((screen.getByRole('textbox', { name: 'Menu name' }) as HTMLInputElement).value).toBe('Camporee food');
  });

  it('Shopping_ShowsTheMenuTotalAndBudgetReadout', () => {
    render(existing());
    expect(screen.getByRole('status').textContent).toMatch(/\$14\.98.*under budget/i);
  });

  it('OpeningAMeal_WithUnsavedChanges_KeepsThemAndAsksNothing', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('list', { name: 'Recipes in Day 1 breakfast' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Menu name' }) as HTMLInputElement).value.endsWith('!')).toBe(true);
  });

  it('MealEdit_IsPartOfTheMenusOneSave', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const sent = saveMenuAction.mock.calls[0][1] as Menu;
    expect([sent.name.endsWith('!'), sent.meals.find((m) => m.id === 'm1')?.recipeIds.includes('B003')]).toEqual([true, false]);
  });

  it('Discard_UndoesAMealEdit_Too', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(within(screen.getByRole('list', { name: 'Recipes in Day 1 breakfast' })).getByRole('button', { name: /^Bacon/ })).toBeTruthy();
  });


  it('LeavingByReload_AsksToConfirm_WhenTheMenuIsDirty', async () => {
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('LeavingByReload_IsNotBlocked_WhenTheMenuIsSaved', () => {
    render(existing());
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('InAppLink_StaysPut_WhenDirtyAndTheScoutDeclines', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    const proceeded = fireEvent.click(screen.getByRole('link', { name: 'Open the shopping list' }));
    expect(proceeded).toBe(false);
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('InAppLink_Proceeds_WhenDirtyAndTheScoutConfirms', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(existing());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect(fireEvent.click(screen.getByRole('link', { name: 'Open the shopping list' }))).toBe(true);
    confirm.mockRestore();
  });

  it('InAppLink_DoesNotAsk_WhenTheMenuIsSaved', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(existing());
    fireEvent.click(screen.getByRole('link', { name: 'Open the shopping list' }));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('Meals_StartClosed', () => {
    render(existing());
    expect(screen.getByRole('button', { name: /^Breakfast/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: /^Recipes in/ })).toBeNull();
  });

  it('MealName_TogglesItsRecipeList_OpenAndClosed', async () => {
    const user = userEvent.setup();
    render(existing());
    const name = screen.getByRole('button', { name: /^Breakfast/ });
    await user.click(name);
    expect(screen.getByRole('list', { name: 'Recipes in Day 1 breakfast' })).toBeTruthy();
    await user.click(name);
    expect(screen.queryByRole('list', { name: 'Recipes in Day 1 breakfast' })).toBeNull();
  });

  it('PerPerson_SwitchesTheMealsCostToOnePerson', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'Per person' }));
    const row = screen.getByRole('button', { name: /^Breakfast/ }).closest('li') as HTMLElement;
    expect(row.textContent).toContain('$1.87');
  });


  describe('layout', () => {
    it('Basics_SpanThePageAboveTheTwoColumns_SoTheDialerLineIsNotCrampedByTheMealsColumn', () => {
      render(existing());
      const basics = screen.getByRole('region', { name: 'Menu name and basics' });
      const mealsHeading = screen.getByRole('heading', { level: 2, name: 'Meals' });
      // The basics are not in the narrow left column with the meals; they sit above both columns.
      expect(mealsHeading.closest('section')?.parentElement?.contains(basics)).toBe(false);
      expect(basics.nextElementSibling?.contains(mealsHeading)).toBe(true);
    });
  });
});
