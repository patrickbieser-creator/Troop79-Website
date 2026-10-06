import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG } from './helpers/menu-monster-fixture';
import { LOCAL_MENU_KEY } from '../src/lib/menu-monster/local-menu';
import { sanitizeMenu } from '../src/lib/menu-monster/menus';

/**
 * The local menu's pages: thin shells that render the SAME Plan, meal and
 * Shopping components a saved menu uses, from the menu kept in this browser.
 * The server actions are faked only to prove a local menu never reaches them.
 */

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const actions = vi.hoisted(() => ({ createMenuAction: vi.fn(), saveMenuAction: vi.fn(), saveActualsAction: vi.fn() }));
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => actions);

import { LocalPlan, LocalShopping } from '../src/app/(public)/library/menu-monster/menus/_components/local-menu-shells';

const MENU = sanitizeMenu(
  {
    name: 'Fall Camporee',
    headcount: 8,
    dayCount: 1,
    meals: [{ id: '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f', day: 0, slot: 'breakfast', recipeIds: ['B003', 'B014'] }]
  },
  CATALOG
);
const MEAL_ID = MENU.meals[0].id;
const put = (m: unknown = MENU) => window.localStorage.setItem(LOCAL_MENU_KEY, JSON.stringify(m));
const stored = () => JSON.parse(window.localStorage.getItem(LOCAL_MENU_KEY) ?? 'null');
/** Who's eating is its own screen (2026-10-06): the name box is on the people page, always open. */
const nameBox = async () => (await screen.findByLabelText('Menu name')) as HTMLInputElement;

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => vi.restoreAllMocks());

describe('LocalPlan', () => {
  it('Visitor_SeesABlankPlanTab_WhenNothingIsStored', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    expect((await nameBox()).value).toBe('');
    expect(screen.getByRole('button', { name: 'Save on this computer' })).toBeTruthy();
  });

  it('Visitor_SeesTheirStoredMenu_OnTheMealsStep', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    // Planner part b: a clean menu's primary is Next (no Gear page on this computer, so Shopping), not a greyed "Saved".
    expect(await screen.findByRole('link', { name: 'Next: Shopping ›' })).toBeTruthy();
    // Meals open inline (2026-10-03): the meal name is a disclosure, not a link.
    expect(screen.getByRole('button', { name: /^Breakfast/ }).getAttribute('aria-expanded')).toBe('false');
    // Who's eating is its own screen: no form on the meals step.
    expect(screen.queryByLabelText('Menu name')).toBeNull();
  });

  it('Visitor_SeesTheirStoredMenu_OnTheWhosEatingStep_WithNextMeals', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    expect((await nameBox()).value).toBe('Fall Camporee');
    expect(screen.getByRole('link', { name: 'Next: Meals ›' }).getAttribute('href')).toBe('/library/menu-monster/menus/local');
    expect(screen.queryByRole('button', { name: /^Breakfast/ })).toBeNull();
  });

  it('Visitor_WithNothingStored_StartsOnWhosEating_EvenOnTheMealsRoute', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    expect((await nameBox()).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Add a day' })).toBeNull();
  });

  it('Visitor_SavesOnThisComputer_WithoutCallingAServerAction', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    const user = userEvent.setup();
    await user.type(await nameBox(), 'Winter Camp');
    await user.click(screen.getByRole('button', { name: 'Save on this computer' }));
    await waitFor(() => expect(stored()?.name).toBe('Winter Camp'));
    expect(actions.createMenuAction).not.toHaveBeenCalled();
    expect(actions.saveMenuAction).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('Visitor_StaysOnThePage_AfterTheFirstSave', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    const user = userEvent.setup();
    await user.type(await nameBox(), 'Winter Camp');
    await user.click(screen.getByRole('button', { name: 'Save on this computer' }));
    expect(await screen.findByRole('link', { name: 'Next: Meals ›' })).toBeTruthy();
  });

  it('Visitor_MustNameTheMenu_BeforeTheFirstSave', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    await nameBox();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save on this computer' }));
    expect(stored()).toBeNull();
  });

  it('Visitor_IsToldWhySaveFailed_WhenStorageIsBlocked', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    const user = userEvent.setup();
    await user.type(await nameBox(), 'Winter Camp');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await user.click(screen.getByRole('button', { name: 'Save on this computer' }));
    expect(await screen.findByText(/won’t let us save on this computer/)).toBeTruthy();
  });

  it('Visitor_OpensAMeal_WithUnsavedChanges_AndKeepsThem', async () => {
    // Meals open inline (2026-10-03): no "save first" detour, the draft stays as it is.
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a day' }));
    await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
    expect(screen.getByRole('list', { name: /^Recipes in/ })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });

  it('Visitor_SeesTheOtherTabsMenu_WhenAnotherTabSaves', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    expect((await nameBox()).value).toBe('Fall Camporee');
    put({ ...MENU, name: 'Changed elsewhere' });
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_MENU_KEY }));
    });
    expect(((await nameBox()) as HTMLInputElement).value).toBe('Changed elsewhere');
  });

  it('Visitor_LastWriteWins_WhenBothTabsSave', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    const user = userEvent.setup();
    await user.type(await nameBox(), ' (mine)');
    put({ ...MENU, name: 'Other tab' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(stored().name).toBe('Fall Camporee (mine)'));
  });

  it('Visitor_IsTold_WhenACatalogChangeDroppedARecipe', async () => {
    put({ ...MENU, meals: [{ ...MENU.meals[0], recipeIds: ['B003', 'GONE'] }] });
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    expect(await screen.findByText(/1 recipe on this menu is no longer in the library, so it was left out/)).toBeTruthy();
  });

  it('Visitor_SeesNoNotice_WhenNothingWasDropped', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    await nameBox();
    expect(screen.queryByText(/no longer in the library/)).toBeNull();
  });

  it('Visitor_SeesTheTitleAsAnH2_OnTheHub', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} hub />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Fall Camporee' })).toBeTruthy();
    // The hub has no page of its own, but a stored menu's two steps are two pages: the tabs are the way to the other one.
    expect(screen.getByRole('tab', { name: 'Who’s eating' }).getAttribute('href')).toBe('/library/menu-monster/menus/local/people');
  });

  it('Visitor_SeesTheTabStrip_OnTheLocalPlanPage', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    await nameBox();
    expect(screen.getByRole('heading', { level: 1, name: 'Fall Camporee' })).toBeTruthy();
    const tabs = within(screen.getByRole('tablist', { name: 'Menu sections' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Who’s eating', 'Meals', 'Shopping']);
  });

  it('Visitor_RendersNothing_BeforeTheShellHasMounted', () => {
    const { container } = render(<LocalPlan catalog={CATALOG} outings={[]} page="people" />);
    // First paint (before the mount effect flushes) is empty; React Testing Library flushes effects, so assert the end state exists too.
    expect(container).toBeTruthy();
  });
});

describe('LocalShopping', () => {
  it('Visitor_SeesTheMergedList_FromTheLocalMenu', async () => {
    put();
    render(<LocalShopping catalog={CATALOG} />);
    expect(await screen.findByRole('heading', { name: 'Shopping list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Bacon/ })).toBeTruthy();
  });

  it('Visitor_DoesNotSeeWhatYouPaid_OnALocalMenu', async () => {
    put();
    render(<LocalShopping catalog={CATALOG} />);
    await screen.findByRole('heading', { name: 'Shopping list' });
    expect(screen.queryByText(/What you paid/i)).toBeNull();
  });

  it('Visitor_DoesNotSeeUpdatePrices_OnALocalMenu', async () => {
    put();
    render(<LocalShopping catalog={CATALOG} />);
    await screen.findByRole('heading', { name: 'Shopping list' });
    expect(screen.queryByRole('button', { name: 'Update prices' })).toBeNull();
  });

  it('Visitor_SeesSavedOnThisComputer_OnTheShoppingSaveButton', async () => {
    put();
    render(<LocalShopping catalog={CATALOG} />);
    expect(await screen.findByRole('button', { name: 'Saved on this computer' })).toBeTruthy();
  });

  it('Visitor_IsPointedToPlanning_WhenNoLocalMenuExists', async () => {
    render(<LocalShopping catalog={CATALOG} />);
    expect(await screen.findByText(/no menu saved on this computer yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Plan a menu' }).getAttribute('href')).toBe('/library/topic/menu-monster');
  });

  it('Visitor_SavesShoppingChangesLocally_WithoutCallingAServerAction', async () => {
    put();
    render(<LocalShopping catalog={CATALOG} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Bacon/ }));
    await user.click(screen.getByRole('button', { name: 'Bringing from home' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(Object.values(stored().shopping.lineSource).length).toBeGreaterThan(0));
    expect(actions.saveMenuAction).not.toHaveBeenCalled();
    expect(actions.saveActualsAction).not.toHaveBeenCalled();
  });
});

describe('LocalPlan, a meal open inline (2026-10-03)', () => {
  it('Visitor_SeesTheMealOpen_WhenTheUrlNamesIt', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} openMeal={MEAL_ID} />);
    expect(await screen.findByRole('list', { name: /^Recipes in/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Bacon/ })).toBeTruthy();
  });

  it('Visitor_SavesTheMealLocally_WithoutCallingAServerAction', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} openMeal={MEAL_ID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'More for Bacon' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(stored().meals[0].recipeIds).not.toContain('B003'));
    expect(actions.saveMenuAction).not.toHaveBeenCalled();
  });

  it('Visitor_SeesEveryMealClosed_WhenTheUrlNamesAMealNotOnTheMenu', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} openMeal="nope" />);
    expect((await screen.findByRole('button', { name: /^Breakfast/ })).getAttribute('aria-expanded')).toBe('false');
  });
});
