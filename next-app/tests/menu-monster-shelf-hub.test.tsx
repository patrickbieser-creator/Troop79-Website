import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Scout Workspace hub: /library/topic/menu-monster opens with a "My menus"
 * section for everyone — a scout's recent menus + New menu, or one quiet
 * sign-in line for everybody else — and the anonymous planner stays below.
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  summaries: [] as unknown[]
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => mocks.session }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => ({ recipes: [] }) }));
vi.mock('@/lib/menu-monster/menus-store', () => ({
  listMenusWith: async () => mocks.summaries,
  loadMenuWith: async () => null
}));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [] }));
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  deleteMenuAction: vi.fn(),
  duplicateMenuAction: vi.fn(),
  createMenuAction: vi.fn()
}));
vi.mock('../src/app/(public)/library/_tools/menu-monster/planner', () => ({
  PLAN_STORAGE_KEY: 'k',
  MenuMonsterPlanner: () => <div data-testid="planner" />
}));

import { MenuMonsterShelfTool } from '../src/app/(public)/library/_tools/menu-monster/shelf-tool';

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
const shelf = async () => render(await MenuMonsterShelfTool());

beforeEach(() => {
  mocks.session = SCOUT;
  mocks.summaries = [];
});

describe('MenuMonsterShelfTool hub', () => {
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

  it('Scout_SeesTheQuickPlanHeadingAndPlanner_WhenSignedIn', async () => {
    await shelf();
    expect(screen.getByRole('heading', { name: 'Quick plan (not saved to My menus)' })).toBeTruthy();
    expect(screen.getByTestId('planner')).toBeTruthy();
  });

  it('Anonymous_SeesTheSignInLineAndNoRows_WhenNotSignedIn', async () => {
    mocks.session = null;
    mocks.summaries = [summary(1)];
    await shelf();
    expect(screen.getByText(/to save menus, plan several meals and share a shopping list/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /sign in/ }).getAttribute('href')).toBe(
      '/signin?next=%2Flibrary%2Ftopic%2Fmenu-monster'
    );
    expect(screen.queryByRole('link', { name: 'Menu 1' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'New menu' })).toBeNull();
  });

  it('Anonymous_SeesThePlannerUnderItsHeading_WhenNotSignedIn', async () => {
    mocks.session = null;
    await shelf();
    expect(screen.getByRole('heading', { name: 'Plan a meal without signing in' })).toBeTruthy();
    expect(screen.getByTestId('planner')).toBeTruthy();
  });

  it('Adult_SeesTheSignInLineAndNoRows_WhenSignedInAsAnAdult', async () => {
    mocks.session = { subjectKind: 'adult', personId: 5, displayName: 'Pat' };
    mocks.summaries = [summary(1)];
    await shelf();
    expect(screen.getByText(/Scouts: /)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Menu 1' })).toBeNull();
    expect(screen.getByTestId('planner')).toBeTruthy();
  });
});
