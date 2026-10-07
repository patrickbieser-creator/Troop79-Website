import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const addScoutPackageAction = vi.fn();
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  createMenuAction: (...a: unknown[]) => createMenuAction(...a),
  saveMenuAction: (...a: unknown[]) => saveMenuAction(...a),
  addScoutPackageAction: (...a: unknown[]) => addScoutPackageAction(...a)
}));

import { PlanTab, type PlanTabProps } from '../src/app/(public)/library/menu-monster/menus/_components/plan-tab';

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

/** Who's eating is its own screen now (whos-eating.test.tsx); on the Meals screen the quickest edit to the draft is another day. */
const dirtyIt = () => fireEvent.click(screen.getByRole('button', { name: 'Add a day' }));

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

  // Planner part b (2026-10-06): "Save becomes Next when clean" — the one primary lives in the summary rail, so a clean
  // saved menu shows "Next: Gear ›" (a link) where it used to show a disabled "Saved", and Discard goes with it.
  it('Save_BecomesNextGear_WhenNothingChanged', () => {
    render(existing());
    expect(screen.queryByRole('button', { name: 'Saved' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Next: Gear ›' }).getAttribute('href')).toBe('/library/menu-monster/menus/menu-1/gear');
  });

  it('Discard_IsGreyedNotHidden_WhenCleanMenuShowsNext', async () => {
    render(existing());
    expect(screen.getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(true);
    dirtyIt();
    expect((screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  afterEach(() => window.history.replaceState(null, '', '/'));

  it('RailFixLink_ToThisPagesMeal_OpensTheMealInPlace', async () => {
    const plan = '/library/menu-monster/menus/menu-1';
    const empty = base({ meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: [], recipeEdits: {} }] });
    window.history.replaceState(null, '', plan);
    render(existing(empty));
    expect(screen.getByRole('button', { name: /^Breakfast/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /^8 people/ }));
    fireEvent.click(screen.getByRole('link', { name: /meal empty/ }));
    expect(window.location.hash).toBe('#meal-m1');
    // jsdom fires hashchange on a later task.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Breakfast/ }).getAttribute('aria-expanded')).toBe('true'));
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
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('Bacon')).toBeNull();
  });

  it('RemovingAMeal_MovesFocusToTheDaysAddAMeal', async () => {
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: 'More for Day 1 breakfast' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
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
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More for Day 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(1);
  });

  it('Day_WithMeals_CannotBeRemoved', () => {
    render(existing());
    expect(screen.queryByRole('button', { name: 'More for Day 1' })).toBeNull();
  });

  it('Day_StoredCount_ShowsEmptyDaysAfterReload', () => {
    render(existing(base({ dayCount: 4 })));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(4);
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
    act(() => screen.getByRole('button', { name: 'Add a day' }).focus());
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('Shopping_ShowsTheMenuTotalAndBudgetReadout', () => {
    render(existing());
    expect(screen.getByRole('status').textContent).toMatch(/\$14\.98.*under budget/i);
  });

  it('OpeningAMeal_WithUnsavedChanges_KeepsThemAndAsksNothing', async () => {
    const user = userEvent.setup();
    render(existing());
    dirtyIt();
    await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('list', { name: 'Recipes in Day 1 breakfast' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('MealEdit_IsPartOfTheMenusOneSave', async () => {
    saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
    const user = userEvent.setup();
    render(existing());
    await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
    await user.click(screen.getByRole('button', { name: 'More for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    dirtyIt();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const sent = saveMenuAction.mock.calls[0][1] as Menu;
    expect([sent.dayCount, sent.meals.find((m) => m.id === 'm1')?.recipeIds.includes('B003')]).toEqual([3, false]);
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


  it('LeavingByReload_IsNotBlocked_WhenTheMenuIsSaved', () => {
    render(existing());
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  // 2026-10-06: "Open the shopping list" left the Meals step (the strip and the rail's Next are the way there);
  // the rail's Next and the strip's steps are the in-app links now.
  it('InAppLink_DoesNotAsk_WhenTheMenuIsSaved', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(existing());
    fireEvent.click(screen.getByRole('link', { name: 'Next: Gear ›' }));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('TheMealsStep_HasNoOpenTheShoppingListLink', () => {
    render(existing());
    expect(screen.queryByRole('link', { name: 'Open the shopping list' })).toBeNull();
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


});

describe('PlanTab planner flow, this week (2026-10-06)', () => {
  beforeEach(() => vi.clearAllMocks());
  const withJuice = () => existing(base({ restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 }, meals: [{ id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: ['B003', 'B023'], recipeEdits: {} }] }));

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

    it('NotPriced_InTheMealPanel_IsAButtonThatOpensThePriceForm', async () => {
      render(withJuice());
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
      expect(screen.queryByRole('link', { name: /No price yet/ })).toBeNull();
      await user.click(screen.getByRole('button', { name: /No price yet — add one/ }));
      expect(screen.getByRole('group', { name: 'Price for Orange juice' })).toBeTruthy();
    });

    it('PricingAFood_ClearsTheToFixCount_WithoutAReload', async () => {
      addScoutPackageAction.mockResolvedValue({ ok: true, status: 'live', id: 'sp-new' });
      render(withJuice());
      const user = userEvent.setup();
      expect(within(screen.getByRole('region', { name: 'Menu summary' })).getByRole('button', { name: /people?/ }).textContent).toContain('1 to fix');
      await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
      await user.click(screen.getByRole('button', { name: /No price yet — add one/ }));
      const form = within(screen.getByRole('group', { name: 'Price for Orange juice' }));
      await user.type(form.getByLabelText('One package holds'), '16');
      await user.type(form.getByLabelText('Price'), '4.50');
      await user.click(form.getByRole('button', { name: 'Add package' }));
      await waitFor(() => expect(within(screen.getByRole('region', { name: 'Menu summary' })).getByRole('button', { name: /people?/ }).textContent).toContain('nothing to fix'));
    });
  });

  // The compact cost line above Meals is superseded by the summary rail on every width (2026-10-06, part b).
  describe('summary rail', () => {
    const rail = () => screen.getByRole('region', { name: 'Menu summary' });
    const summary = () => within(rail()).getByRole('button', { name: /people?/ });

    it('CostLine_IsGone_TheRailCarriesIt', () => {
      render(existing());
      expect(screen.queryByTestId('cost-compact')).toBeNull();
      expect(summary().textContent).toBe('8 people · $1.87/person/meal · nothing to fix›');
    });

    it('Rail_CountsWhatIsNotPriced_AsThingsToFix', () => {
      render(withJuice());
      expect(summary().textContent).toBe('8 people · $1.87/person/meal · 1 to fix›');
    });

    it('Rail_HasNoCost_UntilAMealHasFood', () => {
      render(fresh());
      expect(summary().textContent).toMatch(/^8 people · \d to fix›$/);
    });

    it('Rail_EndsInNextShopping_OnAMenuKeptOnThisComputer', () => {
      const store = { caps: { canSave: false, canPay: false, canReport: false }, hrefs: { plan: '/p', shopping: '/s', meal: () => '/m' }, load: () => null, save: vi.fn(), create: vi.fn(), afterCreate: () => null };
      render(<PlanTab catalog={CATALOG} menuId="local" menu={base()} updatedAt={null} outings={OUTINGS} store={store} />);
      expect(screen.getByRole('link', { name: 'Next: Shopping ›' }).getAttribute('href')).toBe('/s');
    });

    it('Rail_ReadOnly_HasNextAndNoSave', () => {
      render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={base()} updatedAt={VERSION} outings={OUTINGS} readOnly />);
      expect(within(rail()).getByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    });

    it('Meals_HaveAnAnchor_AndEachRowItsOwn', () => {
      const { container } = render(existing());
      expect(container.querySelector('section#meals')).toBeTruthy();
      expect(container.querySelector('li#meal-m1')).toBeTruthy();
    });

    it('MealRow_OpensFromAHash_OnLoad', () => {
      window.location.hash = '#meal-m1';
      try {
        render(existing());
        expect(screen.getByRole('button', { name: /^Breakfast/ }).getAttribute('aria-expanded')).toBe('true');
      } finally {
        window.location.hash = '';
      }
    });
  });

  describe('step strip', () => {
    const CFG = { people: '/p/people', plan: '/p', gear: '/p/gear', shopping: '/p/shopping' };
    const withSteps = (menu: Menu) => <PlanTab catalog={CATALOG} menuId="menu-1" menu={menu} updatedAt={VERSION} outings={OUTINGS} steps={CFG} />;
    const strip = () => screen.getByRole('navigation', { name: 'Menu steps' });

    it('Strip_ReplacesTheTabs_OnTheSameRoutes', () => {
      render(withSteps(base()));
      expect(within(strip()).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/p/people', '/p', '/p/gear', '/p/shopping']);
      expect(screen.queryByRole('tablist')).toBeNull();
    });

    const texts = () => within(strip()).getAllByRole('link').map((a) => a.textContent);

    it('Strip_MarksOnlyMealsCurrent_OnTheMealsPage', () => {
      render(withSteps(base()));
      const cur = within(strip()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'step');
      expect(cur.map((a) => a.textContent)).toEqual(['✓Meals (done)']);
    });

    it('Strip_ShowsTheDraftsEatingTick_OnTheMealsPage_Too', () => {
      render(withSteps(base({ name: '' })));
      expect(texts()[0]).toBe('Who’s eating');
    });
  });

  describe("who's eating is not on the Meals page", () => {
    it('MealsPage_HasNoWhosEatingForm_NoSummaryLine_AndNoEditButton', () => {
      render(existing());
      expect([
        screen.queryByRole('textbox', { name: 'Menu name' }),
        screen.queryByRole('button', { name: 'Edit menu basics' }),
        screen.queryByRole('region', { name: /Who.s eating/ }),
        screen.queryByText(/Camporee food · 8 people/)
      ]).toEqual([null, null, null, null]);
    });

    it('MealsPage_HoldsTheMeals_AndTheAddADayButton', () => {
      render(existing());
      expect([screen.getByRole('heading', { level: 2, name: 'Meals' }) != null, screen.getByRole('button', { name: 'Add a day' }) != null]).toEqual([true, true]);
    });

    it('MealsPage_ClaimsNoDialers_People_Diets_Budget', () => {
      render(existing());
      expect([screen.queryByRole('spinbutton', { name: /^People/ }), screen.queryByRole('spinbutton', { name: /^Budget/ })]).toEqual([null, null]);
    });

    it('MealsPage_Save_SendsTheVersionTokenItLoaded', async () => {
      saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
      render(existing());
      dirtyIt();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
      expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ dayCount: 3 }), VERSION);
    });

    it('MealsPage_Save_ReturnsToNextGear_AfterItLands', async () => {
      saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
      render(existing());
      dirtyIt();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByRole('link', { name: 'Next: Gear ›' })).toBeTruthy();
    });

    it('LeavingByReload_AsksToConfirm_WhenTheMealsDraftIsDirty', () => {
      render(existing());
      dirtyIt();
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    });

    it('InAppLink_StaysPut_WhenTheMealsDraftIsDirtyAndTheScoutDeclines', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      // With the strip, a step is the in-app link a dirty draft guards.
      render(<PlanTab catalog={CATALOG} menuId="menu-1" menu={base()} updatedAt={VERSION} outings={OUTINGS} steps={{ people: '/m/1/people', plan: '/m/1', gear: '/m/1/gear', shopping: '/m/1/shopping' }} />);
      dirtyIt();
      expect(fireEvent.click(screen.getByRole('link', { name: /^Shopping/ }))).toBe(false);
      expect(confirm).toHaveBeenCalled();
      confirm.mockRestore();
    });

    it('Rail_SendsAnEatingFix_ToTheWhosEatingStep', () => {
      render(existing(base({ name: '' })));
      fireEvent.click(within(screen.getByRole('region', { name: 'Menu summary' })).getByRole('button', { name: /people?/ }));
      expect(within(screen.getByRole('dialog')).getByRole('link', { name: /Name the menu/ }).getAttribute('href')).toBe('/library/menu-monster/menus/menu-1/people');
    });
  });

  describe('meal as its own page', () => {
    const page = (menu: Menu = base(), extra: Partial<PlanTabProps> = {}) => (
      <PlanTab catalog={CATALOG} menuId="menu-1" menu={menu} updatedAt={VERSION} outings={OUTINGS} mealOnly="m1" {...extra} />
    );
    const BACK = '/library/menu-monster/menus/menu-1#meal-m1';

    it('MealPage_ShowsOnlyThatMeal_WithItsPanelOpen', () => {
      render(page());
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Day 1 breakfast');
      expect(screen.getByRole('spinbutton', { name: 'Day 1 breakfast people' })).toBeTruthy();
      expect(screen.queryByRole('heading', { level: 2, name: 'Meals' })).toBeNull();
    });

    it('MealPage_HasABackLinkToTheMealsList', () => {
      render(page());
      expect(screen.getByRole('link', { name: '← Back to meals' }).getAttribute('href')).toBe(BACK);
    });

    it('MealPage_Clean_PrimaryIsDone_BackToTheMeal', () => {
      render(page());
      expect(screen.getByRole('link', { name: 'Done' }).getAttribute('href')).toBe(BACK);
      expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('MealPage_Edited_OffersSaveAndCancel_AndSaveIsDirtyGated', async () => {
      render(page());
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
      const u = userEvent.setup();
      await u.clear(screen.getByRole('spinbutton', { name: / people$/ }));
      await u.type(screen.getByRole('spinbutton', { name: / people$/ }), '9');
      expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('MealPage_Save_SendsTheWholeMenu_AndStaysOnTheMeal', async () => {
      saveMenuAction.mockResolvedValue({ ok: true, updatedAt: '2026-10-02T13:00:00.000Z' });
      const user = userEvent.setup();
      render(page());
      await user.clear(screen.getByRole('spinbutton', { name: / people$/ }));
      await user.type(screen.getByRole('spinbutton', { name: / people$/ }), '9');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(saveMenuAction).toHaveBeenCalledWith('menu-1', expect.objectContaining({ name: 'Camporee food' }), VERSION);
      expect(await screen.findByRole('link', { name: 'Done' })).toBeTruthy();
      expect(router.push).not.toHaveBeenCalled();
    });

    it('MealPage_Cancel_DiscardsTheEdit_AndGoesBack', async () => {
      const user = userEvent.setup();
      render(page());
      await user.clear(screen.getByRole('spinbutton', { name: / people$/ }));
      await user.type(screen.getByRole('spinbutton', { name: / people$/ }), '9');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(router.push).toHaveBeenCalledWith(BACK);
      expect(saveMenuAction).not.toHaveBeenCalled();
      expect(screen.getByRole('link', { name: 'Done' })).toBeTruthy();
    });

    it('MealPage_ReadOnly_HasNoSave_JustDone', () => {
      render(page(base(), { readOnly: true }));
      expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
      expect(screen.getByRole('link', { name: 'Done' })).toBeTruthy();
    });

    it('MealPage_UnknownMeal_SaysSoAndLinksBack', () => {
      render(page(base(), { mealOnly: 'nope' }));
      expect(screen.getByRole('link', { name: 'Back to meals' }).getAttribute('href')).toBe('/library/menu-monster/menus/menu-1');
    });

    it('MealPage_TheRailStillShowsTheMenusHeadcountAndCost', () => {
      render(page());
      expect(screen.getByRole('region', { name: 'Menu summary' }).textContent).toContain('8 people');
    });
  });

  describe('meal row on a phone', () => {
    const phone = (matches: boolean) => {
      window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
    };
    afterEach(() => {
      // @ts-expect-error restore jsdom's lack of matchMedia
      delete window.matchMedia;
    });

    it('Open_GoesToTheMealPage_OnAPhone', async () => {
      phone(true);
      render(existing());
      await userEvent.setup().click(screen.getByRole('button', { name: /^Breakfast/ }));
      expect(router.push).toHaveBeenCalledWith('/library/menu-monster/menus/menu-1/meals/m1');
    });

    it('Open_StaysInline_OnAWideScreen', async () => {
      phone(false);
      render(existing());
      await userEvent.setup().click(screen.getByRole('button', { name: /^Breakfast/ }));
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.getByRole('spinbutton', { name: 'Day 1 breakfast people' })).toBeTruthy();
    });

    it('Open_StaysInline_OnAPhone_WhileThereAreUnsavedEdits', async () => {
      phone(true);
      const user = userEvent.setup();
      render(existing());
      dirtyIt();
      await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.getByRole('spinbutton', { name: 'Day 1 breakfast people' })).toBeTruthy();
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

});
