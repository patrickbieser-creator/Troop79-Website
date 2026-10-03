import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Leader read-only view, hub + list page: an admin viewer sees a "Scouts' menus"
 * section on the Menu Monster shelf (newest first, ~10 rows, All scouts' menus
 * when more) and every scout's menu on the menus page; a scout still sees only
 * their own. Rows carry the scout's credit name and last-edited date, and no
 * row menu (no Duplicate / Delete).
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  actor: null as unknown,
  own: [] as unknown[],
  all: [] as unknown[],
  listMenusWith: vi.fn(),
  listAllMenusWith: vi.fn()
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => mocks.session }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => mocks.actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/data', async () => {
  const { CATALOG } = await import('./helpers/menu-monster-fixture');
  return { loadMenuMonsterCatalog: async () => CATALOG };
});
vi.mock('@/lib/menu-monster/menus-store', () => ({
  listMenusWith: (...a: unknown[]) => mocks.listMenusWith(...a),
  listAllMenusWith: (...a: unknown[]) => mocks.listAllMenusWith(...a),
  loadMenuWith: async () => null,
  ownerCreditNamesWith: async (_sb: unknown, ids: number[]) => new Map(ids.map((i) => [i, i === 40 ? 'Sam K.' : 'Ava L.']))
}));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [{ id: 7, title: 'Fall Camporee' }] }));
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  deleteMenuAction: vi.fn(),
  duplicateMenuAction: vi.fn(),
  createMenuAction: vi.fn()
}));
vi.mock('../src/app/(public)/library/_tools/menu-monster/planner', () => ({
  MenuMonsterPlanner: () => <div data-testid="planner" />
}));

import { MenuMonsterShelfTool } from '../src/app/(public)/library/_tools/menu-monster/shelf-tool';
import MyMenusPage from '../src/app/(public)/library/menu-monster/menus/page';

const SCOUT = { subjectKind: 'scout', personId: 39, displayName: 'Charlie W.' };
const LEADER = { kind: 'identity', label: 'Pat B.', personId: 5, capabilities: new Set(['roster.view']) };
const NO_CAPS = { kind: 'identity', label: 'Parent P.', personId: 6, capabilities: new Set() };
const summary = (n: number, ownerPersonId = 40) => ({
  id: `id-${n}`,
  name: `Menu ${n}`,
  context: 'camp',
  calendarEntryId: n === 1 ? 7 : null,
  headcount: 8,
  mealCount: 3,
  updatedAt: '2026-10-01T15:00:00Z',
  ownerPersonId
});
const shelf = async () => render(await MenuMonsterShelfTool());
const page = async () => render(await MyMenusPage());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = null;
  mocks.actor = LEADER;
  mocks.own = [];
  mocks.all = [];
  mocks.listMenusWith.mockImplementation(async () => mocks.own);
  mocks.listAllMenusWith.mockImplementation(async () => mocks.all);
});

describe('hub, leader', () => {
  it('Leader_SeesScoutsMenusSection_WithEachRowsScoutOutingAndDate', async () => {
    mocks.all = [summary(1), summary(2, 41)];
    await shelf();
    expect(screen.getByRole('heading', { name: 'Scouts’ menus' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Menu 1' }).getAttribute('href')).toBe('/library/menu-monster/menus/id-1');
    expect(screen.getByText(/Sam K\. · Camp · Fall Camporee · 3 meals · edited Oct 1, 2026/)).toBeTruthy();
    expect(screen.getByText(/Ava L\./)).toBeTruthy();
  });

  it('Leader_SeesOnlyTenMenusAndAllScoutsMenus_WhenThereAreMore', async () => {
    mocks.all = Array.from({ length: 12 }, (_, i) => summary(i + 1));
    await shelf();
    expect(screen.getByRole('link', { name: 'Menu 10' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Menu 11' })).toBeNull();
    expect(screen.getByRole('link', { name: 'All scouts’ menus' }).getAttribute('href')).toBe('/library/menu-monster/menus');
  });

  it('Leader_DoesNotSeeAllScoutsMenus_WhenTenOrFewer', async () => {
    mocks.all = Array.from({ length: 10 }, (_, i) => summary(i + 1));
    await shelf();
    expect(screen.queryByRole('link', { name: 'All scouts’ menus' })).toBeNull();
  });

  it('Leader_SeesAnEmptyLine_WhenNoScoutHasAMenu', async () => {
    await shelf();
    expect(screen.getByText('No scout has saved a menu yet.')).toBeTruthy();
  });

  it('Leader_HasNoNewMenuOrRowMenus_OnTheHub', async () => {
    mocks.all = [summary(1)];
    await shelf();
    expect(screen.queryByRole('link', { name: 'New menu' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^More for/ })).toBeNull();
    expect(screen.queryByText(/Scouts: /)).toBeNull();
  });

  it('Leader_SeesTheLocalPlanAndSignInStrip_AboveScoutsMenus', async () => {
    await shelf();
    const plan = await screen.findByLabelText('Menu name');
    const strip = screen.getByText(/Saving to My menus is for signed-in scouts/);
    expect(screen.queryByRole('link', { name: 'Sign in to save your menus' })).toBeNull();
    const list = screen.getByRole('heading', { name: 'Scouts’ menus' });
    expect(strip.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plan.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Leader_DoesNotSeeTheOldPlanner', async () => {
    await shelf();
    await screen.findByLabelText('Menu name');
    expect(screen.queryByTestId('planner')).toBeNull();
  });

  it('Adult_SeesNoScoutsMenus_WhenTheyHoldNoCapabilities', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.all = [summary(1)];
    await shelf();
    expect(screen.queryByRole('heading', { name: 'Scouts’ menus' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Menu 1' })).toBeNull();
    expect(mocks.listAllMenusWith).not.toHaveBeenCalled();
  });

  it('Scout_SeesOnlyTheirOwnMenus_NotTheLeadersSection', async () => {
    mocks.session = SCOUT;
    mocks.actor = LEADER;
    mocks.own = [summary(1, 39)];
    mocks.all = [summary(1, 39), summary(2)];
    await shelf();
    expect(screen.getByRole('heading', { name: 'My menus' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Menu 2' })).toBeNull();
    expect(mocks.listAllMenusWith).not.toHaveBeenCalled();
  });
});

describe('menus page', () => {
  it('Leader_SeesEveryScoutsMenus_InsteadOfTheLockedLine', async () => {
    mocks.all = [summary(1), summary(2, 41)];
    await page();
    expect(screen.getByRole('link', { name: 'Menu 1' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Menu 2' })).toBeTruthy();
    expect(screen.queryByText(/sign in to save your menu/)).toBeNull();
  });

  it('Leader_HasNoNewMenuDuplicateOrDelete_OnTheMenusPage', async () => {
    mocks.all = [summary(1)];
    await page();
    expect(screen.queryByRole('link', { name: 'New menu' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^More for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete|Duplicate/ })).toBeNull();
  });

  it('Scout_SeesOnlyTheirOwnMenus_OnTheMenusPage', async () => {
    mocks.session = SCOUT;
    mocks.own = [summary(1, 39)];
    mocks.all = [summary(1, 39), summary(2)];
    await page();
    expect(screen.getByRole('link', { name: 'Menu 1' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Menu 2' })).toBeNull();
    expect(screen.getByRole('link', { name: 'New menu' })).toBeTruthy();
  });

  it('Adult_SeesTheLockedLine_WhenTheyHoldNoCapabilities', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    await page();
    expect(screen.getByText(/sign in to save your menu/)).toBeTruthy();
    expect(mocks.listAllMenusWith).not.toHaveBeenCalled();
  });

  it('Anonymous_SeesTheLockedLine', async () => {
    mocks.actor = null;
    await page();
    expect(screen.getByText(/sign in to save your menu/)).toBeTruthy();
  });
});
