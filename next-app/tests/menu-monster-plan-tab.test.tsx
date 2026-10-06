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

/** A saved menu's "Who's eating" is one summary line with Edit (2026-10-06): a test that uses the form opens it first. */
const openBasics = () => fireEvent.click(screen.getByRole('button', { name: 'Edit menu basics' }));

describe('PlanTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Foods and recipes go in long before anyone has shopped (Patrick, 2026-10-05), so a menu marks what has no
  // price yet instead of letting it read as free. B023 in the fixture is orange juice, which has none.
  const withJuice = () => existing(base({ restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B023'], recipeEdits: {} }] }));

  it('Meal_SaysHowManyOfItsFoodsHaveNoPriceYet_AndWhich', () => {
    render(withJuice());
    const tag = screen.getByText('1 not priced');
    expect(tag.textContent).toBe('1 not priced: Orange juice');
  });

  it('Menu_SaysWhatItsTotalLeavesOut', () => {
    render(withJuice());
    expect(screen.getByText('Not counting 1 food with no price yet: Orange juice.')).toBeTruthy();
  });

  it('OpenMeal_MarksTheItemThatHasNoPriceYet_AndNotTheOthers', async () => {
    render(withJuice());
    await userEvent.setup().click(screen.getByRole('button', { name: /^Breakfast/ }));
    const tags = screen.getAllByText('No price yet');
    expect(tags).toHaveLength(1);
    expect(tags[0].closest('li')?.textContent).toMatch(/juice/i);
  });

  it('Menu_SaysNothingAboutPrices_WhenEverythingHasOne', () => {
    render(existing(base({ restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 } })));
    expect(screen.queryByText(/not priced|no price yet/i)).toBeNull();
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
    openBasics();
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('NewMenu_OffersSaveMenu', () => {
    render(fresh());
    expect(screen.getByRole('button', { name: 'Save menu' })).toBeTruthy();
  });

  it('Diets_ClampToPeople_WhenPeopleDropsBelowThem', async () => {
    render(existing());
    openBasics();
    await typeInto(num(/^People/), '3');
    expect(num(/^Gluten-free/).value).toBe('3');
  });

  it('Diets_CannotExceedPeople_WhenTyped', async () => {
    render(existing());
    openBasics();
    // Gluten-free, not Nut-free: only diets above zero show a dialer (2026-10-06); the cap is the same for each.
    await typeInto(num(/^Gluten-free/), '20');
    expect(num(/^Gluten-free/).value).toBe('8');
  });

  it('People_StopAtFifty', async () => {
    render(existing());
    openBasics();
    await typeInto(num(/^People/), '99');
    expect(num(/^People/).value).toBe('50');
  });

  it('People_StartAtTwo', async () => {
    render(existing());
    openBasics();
    await typeInto(num(/^People/), '1');
    expect(num(/^People/).value).toBe('2');
  });

  it('Dialers_ReadPeopleThenDietsInTheApprovedOrder', () => {
    // Every diet above zero, so every dialer shows (a diet at zero is behind "Add a diet…").
    render(existing(base({ restrictions: { gf: 1, nut: 1, dairy: 1, veg: 1 } })));
    openBasics();
    const names = screen.getAllByRole('spinbutton').map((e) => e.getAttribute('id'));
    const labels = names.map((id) => document.querySelector(`label[for="${id}"]`)?.textContent);
    expect(labels.slice(0, 5)).toEqual(['People:', 'Gluten-free:', 'Vegetarian:', 'Nut-free:', 'Dairy-free:']);
  });

  it('Context_IsASelect', () => {
    render(existing());
    openBasics();
    expect(screen.getByRole('combobox', { name: /Where you.re cooking/ }).tagName).toBe('SELECT');
  });

  it('Outing_IsASelect_WithNoOutingLast', () => {
    render(existing());
    openBasics();
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
    openBasics();
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

  // One control per job (Patrick + Jenna, 2026-10-03): the day adds MEALS, the meal's own search adds food.
  const addMeal = (n: number) => screen.getByRole('button', { name: new RegExp(`^Add a meal to Day ${n}$`) });
  async function pickMeal(n: number, slot: string) {
    const user = userEvent.setup();
    await user.click(addMeal(n));
    await user.click(within(screen.getByRole('group', { name: `Meals not yet on Day ${n}` })).getByRole('button', { name: slot }));
    return user;
  }
  const everyMeal = (day: number) =>
    (['breakfast', 'lunch', 'dinner', 'snack', 'dessert'] as const).map((slot) => ({ id: `${slot}-${day}`, day, slot, headcount: null, recipeIds: [], recipeEdits: {} }));

  it('Day_EndsInAnAddAMealButton', () => {
    render(existing());
    expect(addMeal(1).textContent).toBe('+Add a meal');
  });

  it('DayRecipeSearch_IsGone_BecauseTheMealsOwnSearchAddsFood', () => {
    render(existing());
    expect(screen.queryByRole('button', { name: /^Add to Day/ })).toBeNull();
  });

  it('AddAMeal_OffersOnlyTheMealsTheDayLacks', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(addMeal(1));
    const group = screen.getByRole('group', { name: 'Meals not yet on Day 1' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Lunch', 'Dinner', 'Snack', 'Dessert']);
  });

  it('AddAMeal_CreatesTheMealOpenInline', async () => {
    render(existing());
    await pickMeal(2, 'Lunch');
    expect(screen.getByRole('list', { name: 'Recipes in Day 2 lunch' })).toBeTruthy();
  });

  it('AddAMeal_PutsFocusInTheNewMealsSearch', async () => {
    render(existing());
    await pickMeal(2, 'Lunch');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Add to Day 2 lunch' }));
  });

  it('AddAMeal_IsAnnounced', async () => {
    render(existing());
    await pickMeal(2, 'Lunch');
    expect(screen.getByText('Lunch added to Day 2.').getAttribute('aria-live')).toBe('polite');
  });

  it('AddAMeal_MakesTheMenuDirty', async () => {
    render(existing());
    await pickMeal(2, 'Lunch');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('Scout_SavesTheNewMeal_WithTheMenu_AndStaysOnThePage', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    render(existing());
    const user = await pickMeal(2, 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((saveMenuAction.mock.calls[0][1] as Menu).meals.some((m) => m.day === 1 && m.slot === 'lunch')).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('AddAMeal_IsGone_WhenTheDayHasEveryMeal', () => {
    render(existing(base({ meals: everyMeal(0) })));
    expect(screen.queryByRole('button', { name: 'Add a meal to Day 1' })).toBeNull();
  });

  it('AddAMeal_IsGreyedWithTheReason_AtTheMenusMealCap', () => {
    const meals = Array.from({ length: 6 }, (_, d) => everyMeal(d)).flat();
    render(existing(base({ dayCount: 7, meals })));
    expect([(addMeal(7) as HTMLButtonElement).disabled, screen.getByText('Menu has 30 meals')].map(Boolean)).toEqual([true, true]);
  });

  it('AddAMeal_IsAbsent_WhenReadOnly', () => {
    render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={base()} updatedAt={VERSION} outings={OUTINGS} readOnly />);
    expect(screen.queryByRole('button', { name: /^Add a meal/ })).toBeNull();
  });


  it('Meal_CanBeRemoved_FromItsMenu', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'More for Day 1 breakfast' }));
    await user.click(screen.getByRole('button', { name: 'Remove meal' }));
    expect(screen.queryByText('Bacon')).toBeNull();
  });

  it('RemovingAMeal_MovesFocusToTheDaysAddAMeal', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'More for Day 1 breakfast' }));
    await user.click(screen.getByRole('button', { name: 'Remove meal' }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement?.id).toBe('mm-add-0');
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
    openBasics();
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
    openBasics();
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
    openBasics();
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
    openBasics();
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ name: 'Camporee food!' }), VERSION);
  });

  it('Save_ReturnsToSaved_AfterItLands', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(existing());
    openBasics();
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('Save_ShowsTheServersError_InAnAlert', async () => {
    saveMenuAction.mockResolvedValue({ ok: false, error: 'This menu was changed in another window since you opened it.' });
    const user = userEvent.setup();
    render(existing());
    openBasics();
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed in another window');
  });

  it('Save_StaysDirty_WhenTheServerRefuses', async () => {
    saveMenuAction.mockResolvedValue({ ok: false, error: 'nope' });
    const user = userEvent.setup();
    render(existing());
    openBasics();
    await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('Discard_RestoresTheLastSavedMenu', async () => {
    const user = userEvent.setup();
    render(existing());
    openBasics();
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
    openBasics();
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
    openBasics();
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
    openBasics();
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
    openBasics();
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
    const proceeded = fireEvent.click(screen.getByRole('link', { name: 'Open the shopping list' }));
    expect(proceeded).toBe(false);
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('InAppLink_Proceeds_WhenDirtyAndTheScoutConfirms', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(existing());
    openBasics();
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

describe('PlanTab patrol (release 5)', () => {
  const withPatrols = (menu: Menu) => <PlanTab catalog={CATALOG} menuId="menu-1" menu={menu} updatedAt={VERSION} outings={OUTINGS} patrols={['FireQuacker', 'Screaming Eagles', 'Whole troop']} />;

  it('Patrol_SuggestsTheTroopsPatrols', () => {
    const { container } = render(withPatrols(base()));
    openBasics();
    expect([...container.querySelectorAll('#mm-patrols option')].map((o) => o.getAttribute('value'))).toEqual(['FireQuacker', 'Screaming Eagles', 'Whole troop']);
  });

  it('Patrol_ShowsWhatIsSaved', () => {
    render(withPatrols(base({ patrol: 'FireQuacker' })));
    openBasics();
    expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLInputElement).value).toBe('FireQuacker');
  });

  it('Patrol_IsSaved_WithTheMenu', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    render(withPatrols(base()));
    openBasics();
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox', { name: 'Patrol' }), 'Whole troop');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ patrol: 'Whole troop' }), VERSION);
  });
});

describe('PlanTab outing: who can open the menu (2026-10-04)', () => {
  const HINT = /Signed-in scouts and leaders can open this menu from the outing/;

  it('NoOuting_SaysNothing', () => {
    render(fresh());
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('PickingAnOuting_SaysTheCrewCanOpenIt', async () => {
    render(fresh());
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
    expect(screen.getByText(HINT)).toBeTruthy();
  });
});

describe('PlanTab planner flow, this week (2026-10-06)', () => {
  beforeEach(() => vi.clearAllMocks());
  const withJuice = () => existing(base({ restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B023'], recipeEdits: {} }] }));
  const blank = (over: Partial<Menu> = {}) => base({ name: '', meals: [], restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, ...over });
  const newMenu = (over: Partial<Menu> = {}, extra: { myPatrol?: string | null } = {}) => (
    <PlanTab catalog={CATALOG} menuId={null} menu={blank(over)} updatedAt={null} outings={OUTINGS} {...extra} />
  );

  describe('badges become answers', () => {
    it('NotPriced_LinksToTheShoppingItem', () => {
      render(withJuice());
      const link = screen.getByRole('link', { name: /1 not priced: Orange juice/ });
      expect(link.getAttribute('href')).toBe('/library/menu-monster/menus/menu-1/shopping?item=oj');
    });

    it('NotPriced_IsPlainText_ForAReadOnlyViewer', () => {
      const m = base({ restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B023'], recipeEdits: {} }] });
      render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={m} updatedAt={VERSION} outings={OUTINGS} readOnly />);
      expect([screen.getByText('1 not priced').tagName, screen.queryByRole('link', { name: /not priced/ })]).toEqual(['SPAN', null]);
    });

    it('NotPriced_InTheMealPanel_LinksToTheShoppingItem', async () => {
      render(withJuice());
      await userEvent.setup().click(screen.getByRole('button', { name: /^Breakfast/ }));
      const link = screen.getByRole('link', { name: /No price yet — add one/ });
      expect(link.getAttribute('href')).toBe('/library/menu-monster/menus/menu-1/shopping?item=oj');
    });
  });

  describe("who's eating", () => {
    it('WhosEating_IsOneLineWithEdit_OnASavedMenu', () => {
      render(existing());
      expect(screen.getByText('Camporee food · 8 people · 5 gluten-free · Camp')).toBeTruthy();
      expect([screen.queryByRole('textbox', { name: 'Menu name' }), screen.getByRole('button', { name: 'Edit menu basics' }).getAttribute('aria-expanded')]).toEqual([null, 'false']);
    });

    it('WhosEating_EditExpandsTheForm_AndFocusesTheName', async () => {
      render(existing());
      await userEvent.setup().click(screen.getByRole('button', { name: 'Edit menu basics' }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Menu name' }));
    });

    it('WhosEating_IsExpanded_OnANewMenu', () => {
      render(fresh());
      expect([screen.getByRole('textbox', { name: 'Menu name' }) != null, screen.queryByRole('button', { name: 'Edit menu basics' })]).toEqual([true, null]);
    });

    it('WhosEating_DoneCollapsesItAgain_WithoutLosingTheEdit', async () => {
      const user = userEvent.setup();
      render(existing());
      await user.click(screen.getByRole('button', { name: 'Edit menu basics' }));
      await user.type(screen.getByRole('textbox', { name: 'Menu name' }), '!');
      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByText(/^Camporee food! · 8 people/)).toBeTruthy();
    });

    it('Diets_ShowOnlyThoseAboveZero_WithAddADietForTheRest', async () => {
      const user = userEvent.setup();
      render(existing());
      openBasics();
      expect(screen.queryByRole('spinbutton', { name: /^Nut-free/ })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Add a diet' }));
      expect(within(screen.getByRole('group', { name: 'Diets the menu does not count yet' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Vegetarian', 'Nut-free', 'Dairy-free']);
      await user.click(screen.getByRole('button', { name: 'Nut-free' }));
      expect(num(/^Nut-free/).value).toBe('0');
    });

    it('Diets_AddADietIsGone_WhenEveryDietShows', () => {
      render(existing(base({ restrictions: { gf: 1, nut: 1, dairy: 1, veg: 1 } })));
      openBasics();
      expect(screen.queryByRole('button', { name: 'Add a diet' })).toBeNull();
    });

    it('Save_KeepsTheNameFieldReachable_WhenTheNameIsEmpty', async () => {
      const user = userEvent.setup();
      render(existing(base({ name: 'x' })));
      openBasics();
      await user.clear(screen.getByRole('textbox', { name: 'Menu name' }));
      await user.click(screen.getByRole('button', { name: 'Done' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(screen.getByRole('alert').textContent).toContain('Give your menu a name');
      expect(screen.getByRole('textbox', { name: 'Menu name' })).toBeTruthy();
    });
  });

  describe('cost line', () => {
    it('CostLine_RendersAboveMeals', () => {
      render(existing());
      const line = screen.getByTestId('cost-compact');
      expect(line.textContent).toBe('$1.87/person/meal · budget $4.00');
      expect(line.compareDocumentPosition(screen.getByRole('heading', { level: 2, name: 'Meals' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('CostLine_CountsWhatIsNotPriced', () => {
      render(withJuice());
      expect(screen.getByTestId('cost-compact').textContent).toBe('$1.87/person/meal · budget $4.00 · 1 not priced');
    });

    it('CostLine_IsAbsent_UntilAMealHasFood', () => {
      render(fresh());
      expect(screen.queryByTestId('cost-compact')).toBeNull();
    });
  });

  describe('per-meal people', () => {
    it('MealRow_ShowsPeople_OnlyWhenDifferent', () => {
      const row = () => screen.getByRole('button', { name: /^Breakfast/ }).closest('li') as HTMLElement;
      const { unmount } = render(existing());
      expect(row().textContent).not.toMatch(/\d+ people/);
      unmount();
      render(existing(base({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: 6, recipeIds: ['B003'], recipeEdits: {} }] })));
      expect(within(row()).getByText('6 people')).toBeTruthy();
    });

    it('MealRow_HasNoStepper', () => {
      render(existing(base({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: 6, recipeIds: ['B003'], recipeEdits: {} }] })));
      expect(screen.queryByRole('spinbutton', { name: / people$/ })).toBeNull();
    });

    it('Stepper_LivesInTheMealPanel', async () => {
      render(existing());
      await userEvent.setup().click(screen.getByRole('button', { name: /^Breakfast/ }));
      expect(screen.getByRole('spinbutton', { name: 'Day 1 breakfast people' })).toBeTruthy();
    });
  });

  describe('defaults', () => {
    const context = () => (screen.getByRole('combobox', { name: /Where you.re cooking/ }) as HTMLSelectElement).value;

    it('PickingAnOuting_SetsCampByDefault', async () => {
      render(newMenu({ context: 'home' }));
      await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
      expect(context()).toBe('camp');
    });

    it('PickingAnOuting_KeepsWhatTheScoutChose', async () => {
      const user = userEvent.setup();
      render(newMenu({ context: 'home' }));
      await user.selectOptions(screen.getByRole('combobox', { name: /Where you.re cooking/ }), 'trail');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
      expect(context()).toBe('trail');
    });

    it('PickingAnOuting_LeavesASavedMenusContextAlone', async () => {
      render(existing(base({ context: 'home' })));
      openBasics();
      await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Outing' }), '7');
      expect(context()).toBe('home');
    });

    it('Patrol_DefaultsToTheScoutsOwn', () => {
      render(newMenu({}, { myPatrol: 'FireQuacker' }));
      expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLInputElement).value).toBe('FireQuacker');
    });

    it('Patrol_Default_IsSentOnTheFirstSave', async () => {
      createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
      const user = userEvent.setup();
      render(newMenu({}, { myPatrol: 'FireQuacker' }));
      await user.type(screen.getByRole('textbox', { name: 'Menu name' }), 'Hike');
      await user.click(screen.getByRole('button', { name: 'Save menu' }));
      expect(createMenuAction).toHaveBeenCalledWith(expect.objectContaining({ patrol: 'FireQuacker' }));
    });

    it('Patrol_KeepsTheMenusOwn_OverTheScoutsPatrol', () => {
      render(newMenu({ patrol: 'Screaming Eagles' }, { myPatrol: 'FireQuacker' }));
      expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLInputElement).value).toBe('Screaming Eagles');
    });

    it('Patrol_IsBlank_WhenThereIsNoPatrolToDefaultTo', () => {
      render(newMenu());
      expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLInputElement).value).toBe('');
    });

    it('Patrol_IsNotDefaulted_OnASavedMenu', () => {
      render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={base()} updatedAt={VERSION} outings={OUTINGS} myPatrol="FireQuacker" />);
      openBasics();
      expect((screen.getByRole('combobox', { name: 'Patrol' }) as HTMLInputElement).value).toBe('');
    });
  });
});
