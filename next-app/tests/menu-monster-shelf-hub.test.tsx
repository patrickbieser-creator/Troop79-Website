import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Scout Workspace hub: /library/topic/menu-monster. A scout sees My menus, New
 * menu, a Continue link and (with an unsaved local menu) the save offer; a
 * visitor or adult sees the local Plan tab under one sign-in strip. The old
 * anonymous planner is never rendered.
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  summaries: [] as unknown[],
  recipes: [] as unknown[]
}));

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => mocks.session }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/data', async () => {
  const { CATALOG } = await import('./helpers/menu-monster-fixture');
  return { loadMenuMonsterCatalog: async () => CATALOG };
});
vi.mock('@/lib/menu-monster/menus-store', () => ({
  listMenusWith: async () => mocks.summaries,
  listSharedMenusWith: async () => [],
  ownerCreditNamesWith: async () => new Map(),
  loadMenuWith: async () => null,
  loadMenusWith: async () => []
}));
vi.mock('@/lib/identity-session', async (orig) => ({ ...(await orig<object>()), isEpochCurrent: async () => true }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async (_sb: unknown, id: number) => [id] }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [], loadPatrolNamesWith: async () => [], loadScoutPatrolWith: async () => null }));
vi.mock('@/lib/menu-monster/scout-recipes-store', () => ({ listMyRecipesWith: async () => mocks.recipes }));
vi.mock('../src/app/(public)/library/_tools/menu-monster/recipe-actions', () => ({ deleteScoutRecipeAction: vi.fn() }));
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  deleteMenuAction: vi.fn(),
  duplicateMenuAction: vi.fn(),
  createMenuAction: vi.fn(),
  saveMenuAction: vi.fn()
}));

import { MenuMonsterShelfTool } from '../src/app/(public)/library/_tools/menu-monster/shelf-tool';
import { createMenuAction } from '../src/app/(public)/library/_tools/menu-monster/menu-actions';
import { LOCAL_MENU_KEY } from '../src/lib/menu-monster/local-menu';
import { PLAN_STORAGE_KEY } from '../src/lib/menu-monster/legacy-draft';

const SCOUT = { subjectKind: 'scout', personId: 39, displayName: 'Charlie W.' };
const summary = (n: number) => ({
  id: `id-${n}`,
  name: `Menu ${n}`,
  context: 'camp',
  calendarEntryId: null,
  headcount: 8,
  mealCount: 3,
  updatedAt: ''
});
const shelf = async (tab?: string) => render(await MenuMonsterShelfTool({ searchParams: tab ? { tab } : {} }));
const putLocal = () => window.localStorage.setItem(LOCAL_MENU_KEY, JSON.stringify({ name: 'Fall Camporee', headcount: 10 }));

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.summaries = [];
  mocks.recipes = [];
});

describe('MenuMonsterShelfTool hub, scout', () => {
  it('Scout_SeesTheirMenusAndNewMenu_WhenTheyHaveSome', async () => {
    mocks.summaries = [summary(1), summary(2)];
    await shelf();
    expect(screen.getByRole('link', { name: 'Menu 1' }).getAttribute('href')).toBe('/library/menu-monster/menus/id-1');
    expect(screen.getByRole('link', { name: 'Menu 2' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New menu' }).getAttribute('href')).toBe('/library/menu-monster/menus/new');
  });

  it('Scout_SeesOnlyFiveMenusAndAllMyMenus_WhenTheyHaveMore', async () => {
    mocks.summaries = [1, 2, 3, 4, 5, 6, 7].map(summary);
    await shelf();
    expect(screen.getByRole('link', { name: 'Menu 5' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Menu 6' })).toBeNull();
    expect(screen.getByRole('link', { name: 'All my menus' }).getAttribute('href')).toBe('/library/menu-monster/menus');
  });

  it('Scout_DoesNotSeeAllMyMenus_WhenFiveOrFewer', async () => {
    mocks.summaries = [1, 2, 3, 4, 5].map(summary);
    await shelf();
    expect(screen.queryByRole('link', { name: 'All my menus' })).toBeNull();
  });

  it('Scout_SeesTheEmptyLineAndNewMenu_WhenTheyHaveNoMenus', async () => {
    await shelf();
    expect(screen.getByText('No menus yet. Start one to save meals, people and a shopping list.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New menu' })).toBeTruthy();
  });

  it('Scout_SeesContinueWithTheMostRecentMenu_WhenTheyHaveMenus', async () => {
    mocks.summaries = [summary(1), summary(2)];
    await shelf();
    expect(screen.getByRole('link', { name: 'Continue Menu 1' }).getAttribute('href')).toBe('/library/menu-monster/menus/id-1');
  });

  it('Scout_SeesNoContinue_WhenTheyHaveNoMenus', async () => {
    await shelf();
    expect(screen.queryByRole('link', { name: /^Continue/ })).toBeNull();
  });

  it('Scout_DoesNotSeeTheLocalPlan', async () => {
    await shelf();
    expect(screen.queryByLabelText('Menu name')).toBeNull();
  });

  it('Scout_SeesTheSaveOfferRow_WhenThisComputerHoldsAMenu', async () => {
    putLocal();
    await shelf();
    expect(await screen.findByText(/Unsaved menu on this computer/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save it to My menus' })).toBeTruthy();
  });

  it('Scout_SeesNoSaveOffer_WhenThisComputerHoldsNoMenu', async () => {
    await shelf();
    expect(screen.queryByText(/Unsaved menu on this computer/)).toBeNull();
  });
});

describe('MenuMonsterShelfTool hub, handoff', () => {
  it('Scout_SavesTheLocalMenuAndClearsIt_WhenTheyAcceptTheOffer', async () => {
    vi.mocked(createMenuAction).mockResolvedValue({ ok: true, id: 'new-id' });
    putLocal();
    await shelf();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save it to My menus' }));
    await waitFor(() => expect(window.localStorage.getItem(LOCAL_MENU_KEY)).toBeNull());
    expect(createMenuAction).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fall Camporee' }));
    expect(router.push).toHaveBeenCalledWith('/library/menu-monster/menus/new-id');
  });

  it('Scout_KeepsTheLocalMenu_WhenSavingFails', async () => {
    vi.mocked(createMenuAction).mockResolvedValue({ ok: false, error: 'You have 50 menus' });
    putLocal();
    await shelf();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save it to My menus' }));
    expect(await screen.findByText(/You have 50 menus/)).toBeTruthy();
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).not.toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('Scout_KeepsTheLocalMenu_WhenTheSaveThrows', async () => {
    vi.mocked(createMenuAction).mockRejectedValue(new Error('network'));
    putLocal();
    await shelf();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save it to My menus' }));
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).not.toBeNull();
  });

  it('Scout_ClearsTheLocalMenu_OnlyAfterConfirmingDiscard', async () => {
    putLocal();
    await shelf();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Discard it' }));
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Yes, discard' }));
    expect(window.localStorage.getItem(LOCAL_MENU_KEY)).toBeNull();
    expect(screen.queryByText(/Unsaved menu on this computer/)).toBeNull();
  });

  it('Scout_IsOfferedTheOldPlannerDraft_AsTheUnsavedMenu', async () => {
    window.localStorage.setItem(
      PLAN_STORAGE_KEY,
      JSON.stringify({ meal: 'breakfast', headcount: 10, recipeIds: ['B003'], restrictions: {}, budgetPerPerson: 4, date: '2026-10-10' })
    );
    await shelf();
    expect(await screen.findByText(/Breakfast from this computer/)).toBeTruthy();
  });
});

describe('MenuMonsterShelfTool hub, visitor', () => {
  it('Visitor_SeesTheSignInStripAndTheLocalPlanAndNoRows_WhenNotSignedIn', async () => {
    mocks.session = null;
    mocks.summaries = [summary(1)];
    await shelf();
    expect(screen.getByRole('link', { name: 'Sign in to save your menus' }).getAttribute('href')).toBe('/signin?next=%2Flibrary%2Ftopic%2Fmenu-monster');
    expect(await screen.findByLabelText('Menu name')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Menu 1' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'New menu' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'My menus' })).toBeNull();
  });

  it('Visitor_SeesTheLocalPlan_WhenNotSignedIn', async () => {
    mocks.session = null;
    await shelf();
    await screen.findByLabelText('Menu name');
    expect(screen.queryByRole('heading', { name: 'Plan a meal without signing in' })).toBeNull();
  });

  it('Visitor_SeesTheBasicsFirst_OnTheHub', async () => {
    mocks.session = null;
    await shelf();
    expect(await screen.findByLabelText('Menu name')).toBeTruthy();
    expect(screen.getByText('Where you’re cooking')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'People' })).toBeTruthy();
  });

  it('Visitor_SeesSaveOnThisComputer_OnALocalMenu', async () => {
    mocks.session = null;
    await shelf();
    expect(await screen.findByRole('button', { name: 'Save on this computer' })).toBeTruthy();
  });

  it('Adult_SeesTheirMenusAndNewMenu_WhenSignedInAsAnAdult', async () => {
    mocks.session = { subjectKind: 'adult', personId: 5, displayName: 'Pat' };
    mocks.summaries = [summary(1)];
    await shelf();
    expect(screen.getByRole('link', { name: 'Menu 1' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New menu' })).toBeTruthy();
  });

  it('Adult_DoesNotGetTheLocalPlan_WhenSignedInAsAnAdult', async () => {
    mocks.session = { subjectKind: 'adult', personId: 5, displayName: 'Pat' };
    await shelf();
    expect(screen.queryByLabelText('Menu name')).toBeNull();
  });

  it('Adult_SeesNoSignInStrip_WhenSignedInAsAnAdult', async () => {
    mocks.session = { subjectKind: 'adult', personId: 5, displayName: 'Pat' };
    await shelf();
    expect(screen.queryByText(/Your menu stays on this computer/)).toBeNull();
  });

  it('Visitor_KeepsAnOldPlannerDraft_AsTheLocalMenu', async () => {
    mocks.session = null;
    window.localStorage.setItem(
      PLAN_STORAGE_KEY,
      JSON.stringify({ meal: 'breakfast', headcount: 10, recipeIds: ['B003'], restrictions: {}, budgetPerPerson: 4, date: '2026-10-10' })
    );
    await shelf();
    // The adopted draft is a saved menu: its basics are the one summary line with Edit (2026-10-06), not the form.
    expect(await screen.findByText(/^Breakfast from this computer · 10 people/)).toBeTruthy();
  });
});

describe('MenuMonsterShelfTool hub, tabs', () => {
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('Hub_ShowsFourTabs_InOrder', async () => {
    await shelf();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Meal Planner', 'Food & Recipes', 'Ingredients', 'Recipe Builder']);
  });

  it('Hub_OpensOnTheMealPlanner_ByDefault', async () => {
    await shelf();
    expect(tab('Meal Planner').getAttribute('aria-selected')).toBe('true');
  });

  it('Tabs_AreLinks_SoEachCanBeShared', async () => {
    await shelf();
    expect(tab('Ingredients').getAttribute('href')).toBe('/library/topic/menu-monster?tab=ingredients');
  });

  it('Hub_FallsBackToTheMealPlanner_OnAnUnknownTab', async () => {
    await shelf('nope');
    expect(tab('Meal Planner').getAttribute('aria-selected')).toBe('true');
  });

  it('RecipeLibraryTab_ListsRecipes_WithTheMealsTheyFit', async () => {
    await shelf('recipes');
    const row = screen.getByRole('button', { name: /^Sandwiches/ }).closest('li') as HTMLElement;
    expect(row.textContent).toContain('Lunch');
  });

  it('RecipeLibraryTab_HidesThePlanner', async () => {
    mocks.summaries = [summary(1)];
    await shelf('recipes');
    expect(screen.queryByRole('heading', { name: 'My menus' })).toBeNull();
  });

  it('RecipeLibraryTab_NarrowsByMeal_WhenAFilterIsPressed', async () => {
    await shelf('recipes');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lunch' }));
    expect(screen.queryByRole('button', { name: /^Pancakes/ })).toBeNull();
  });

  it('IngredientsTab_ShowsEachIngredientsLowestPrice', async () => {
    await shelf('ingredients');
    const row = screen.getByRole('button', { name: /^Bacon/ }).closest('li') as HTMLElement;
    expect(row.textContent).toContain('$7.49');
  });

  it('IngredientsTab_OpensAnIngredientsPackages', async () => {
    await shelf('ingredients');
    await userEvent.setup().click(screen.getByRole('button', { name: /^Bacon/ }));
    expect(screen.getByRole('list', { name: 'Bacon packages' }).textContent).toContain('Costco');
  });

  it('IngredientsTab_NarrowsBySection_WhenAFilterIsPressed', async () => {
    await shelf('ingredients');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bakery' }));
    expect(screen.queryByRole('button', { name: /^Bacon/ })).toBeNull();
  });

  it('RecipeBuilderTab_ListsTheScoutsRecipes', async () => {
    mocks.recipes = [{ id: 'S-0000abcd', name: 'Campfire chili', status: 'published', credit: 'Charlie W.' }];
    await shelf('builder');
    expect(screen.getByRole('link', { name: 'Campfire chili' }).getAttribute('href')).toBe('/library/menu-monster/recipes/S-0000abcd');
  });

  it('RecipeBuilderTab_OffersANewRecipe', async () => {
    await shelf('builder');
    expect(screen.getByRole('link', { name: 'New recipe' }).getAttribute('href')).toBe('/library/menu-monster/recipes/new');
  });

  it('RecipeBuilderTab_OffersAParentANewRecipe', async () => {
    mocks.session = { subjectKind: 'adult', personId: 5, displayName: 'Pat' };
    await shelf('builder');
    expect(screen.getByRole('link', { name: 'New recipe' }).getAttribute('href')).toBe('/library/menu-monster/recipes/new');
  });

  it('RecipeBuilderTab_AsksAVisitorToSignIn', async () => {
    mocks.session = null;
    await shelf('builder');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toContain('tab%3Dbuilder');
  });

});
