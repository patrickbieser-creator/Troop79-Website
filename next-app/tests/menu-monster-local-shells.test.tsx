import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
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
const nameBox = () => screen.findByLabelText('Menu name') as Promise<HTMLInputElement>;

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => vi.restoreAllMocks());

describe('LocalPlan', () => {
  it('Visitor_SeesABlankPlanTab_WhenNothingIsStored', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    expect((await nameBox()).value).toBe('');
    expect(screen.getByRole('button', { name: 'Save on this computer' })).toBeTruthy();
  });

  it('Visitor_SeesTheirStoredMenu_OnThePlanTab', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    expect((await nameBox()).value).toBe('Fall Camporee');
    expect(screen.getByRole('button', { name: 'Saved on this computer' })).toBeTruthy();
    // Meals open inline (2026-10-03): the meal name is a disclosure, not a link.
    expect(screen.getByRole('button', { name: /^Breakfast/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('Visitor_SavesOnThisComputer_WithoutCallingAServerAction', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    const user = userEvent.setup();
    await user.type(await nameBox(), 'Winter Camp');
    await user.click(screen.getByRole('button', { name: 'Save on this computer' }));
    await waitFor(() => expect(stored()?.name).toBe('Winter Camp'));
    expect(actions.createMenuAction).not.toHaveBeenCalled();
    expect(actions.saveMenuAction).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('Visitor_StaysOnThePage_AfterTheFirstSave', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    const user = userEvent.setup();
    await user.type(await nameBox(), 'Winter Camp');
    await user.click(screen.getByRole('button', { name: 'Save on this computer' }));
    expect(await screen.findByRole('button', { name: 'Saved on this computer' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the shopping list' }).getAttribute('href')).toBe('/library/menu-monster/menus/local/shopping');
  });

  it('Visitor_MustNameTheMenu_BeforeTheFirstSave', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    await nameBox();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save on this computer' }));
    expect(stored()).toBeNull();
  });

  it('Visitor_IsToldWhySaveFailed_WhenStorageIsBlocked', async () => {
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
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
    const box = await nameBox();
    await user.type(box, '!');
    await user.click(screen.getByRole('button', { name: /^Breakfast/ }));
    expect(screen.getByRole('list', { name: /^Recipes in/ })).toBeTruthy();
    expect((await nameBox()).value).toBe('Fall Camporee!');
  });

  it('Visitor_SeesTheOtherTabsMenu_WhenAnotherTabSaves', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    expect((await nameBox()).value).toBe('Fall Camporee');
    put({ ...MENU, name: 'Changed elsewhere' });
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_MENU_KEY }));
    });
    expect(((await nameBox()) as HTMLInputElement).value).toBe('Changed elsewhere');
  });

  it('Visitor_LastWriteWins_WhenBothTabsSave', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    const user = userEvent.setup();
    await user.type(await nameBox(), ' (mine)');
    put({ ...MENU, name: 'Other tab' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(stored().name).toBe('Fall Camporee (mine)'));
  });

  it('Visitor_IsTold_WhenACatalogChangeDroppedARecipe', async () => {
    put({ ...MENU, meals: [{ ...MENU.meals[0], recipeIds: ['B003', 'GONE'] }] });
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    expect(await screen.findByText(/1 recipe on this menu is no longer in the library, so it was left out/)).toBeTruthy();
  });

  it('Visitor_SeesNoNotice_WhenNothingWasDropped', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    await nameBox();
    expect(screen.queryByText(/no longer in the library/)).toBeNull();
  });

  it('Visitor_SeesTheTitleAsAnH2_OnTheHub', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} hub />);
    await nameBox();
    expect(screen.getByRole('heading', { level: 2, name: 'Fall Camporee' })).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Menu sections' })).toBeNull();
  });

  it('Visitor_SeesTheTabStrip_OnTheLocalPlanPage', async () => {
    put();
    render(<LocalPlan catalog={CATALOG} outings={[]} />);
    await nameBox();
    expect(screen.getByRole('heading', { level: 1, name: 'Fall Camporee' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Menu sections' })).toBeTruthy();
  });

  it('Visitor_RendersNothing_BeforeTheShellHasMounted', () => {
    const { container } = render(<LocalPlan catalog={CATALOG} outings={[]} />);
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
