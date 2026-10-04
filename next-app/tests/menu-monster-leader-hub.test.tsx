import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

/**
 * Leader read-only view, hub + list page: an admin viewer sees a "Scouts' menus"
 * section on the Menu Monster shelf (newest first, ~10 rows, All scouts' menus
 * when more) and every scout's menu on the menus page; a scout still sees only
 * their own. Rows carry the scout's credit name and last-edited date, and no
 * row menu (no Duplicate / Delete). Since 2026-10-04 a leader or parent with a
 * personId also has their own saved menus (My menus + New menu) above those lists.
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  actor: null as unknown,
  own: [] as unknown[],
  mine: [] as unknown[],
  all: [] as unknown[],
  listMenusWith: vi.fn(),
  listAllMenusWith: vi.fn(),
  family: [] as number[],
  shared: [] as unknown[]
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
  listSharedMenusWith: async () => mocks.shared,
  loadMenuWith: async () => null,
  loadMenusWith: async () => [],
  ownerCreditNamesWith: async (_sb: unknown, ids: number[]) => new Map(ids.map((i) => [i, i === 40 ? 'Sam K.' : 'Ava L.']))
}));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [{ id: 7, title: 'Fall Camporee' }] }));
vi.mock('@/lib/identity-session', async (orig) => ({ ...(await orig<object>()), isEpochCurrent: async () => true }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async () => mocks.family }));
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => ({
  deleteMenuAction: vi.fn(),
  duplicateMenuAction: vi.fn(),
  createMenuAction: vi.fn()
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
const shelf = async (tab?: string) => render(await MenuMonsterShelfTool({ searchParams: tab ? { tab } : {} }));
const page = async (sp: Record<string, string> = {}) => render(await MyMenusPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  mocks.family = [];
  mocks.shared = [];
  vi.clearAllMocks();
  mocks.session = null;
  mocks.actor = LEADER;
  mocks.own = [];
  mocks.mine = [];
  mocks.all = [];
  // A number is one person's own menus; an array is a parent's scouts.
  mocks.listMenusWith.mockImplementation(async (_sb: unknown, who: unknown) => (typeof who === 'number' ? mocks.mine : mocks.own));
  mocks.listAllMenusWith.mockImplementation(async () => mocks.all);
});

describe('hub, leader', () => {
  it('Leader_SeesScoutsMenusSection_WithEachRowsScoutOutingAndDate', async () => {
    mocks.all = [summary(1), summary(2, 41)];
    await shelf();
    expect(screen.getByRole('heading', { name: 'Everyone’s menus' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Menu 1' }).getAttribute('href')).toBe('/library/menu-monster/menus/id-1');
    expect(screen.getByText(/Sam K\. · Camp · Fall Camporee · 3 meals · edited Oct 1, 2026/)).toBeTruthy();
    expect(screen.getByText(/Ava L\./)).toBeTruthy();
  });

  it('Leader_SeesOnlyTenMenusAndAllScoutsMenus_WhenThereAreMore', async () => {
    mocks.all = Array.from({ length: 12 }, (_, i) => summary(i + 1));
    await shelf();
    expect(screen.getByRole('link', { name: 'Menu 10' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Menu 11' })).toBeNull();
    expect(screen.getByRole('link', { name: 'All saved menus' }).getAttribute('href')).toBe('/library/menu-monster/menus');
  });

  it('Leader_DoesNotSeeAllScoutsMenus_WhenTenOrFewer', async () => {
    mocks.all = Array.from({ length: 10 }, (_, i) => summary(i + 1));
    await shelf();
    expect(screen.queryByRole('link', { name: 'All saved menus' })).toBeNull();
  });

  it('Leader_SeesAnEmptyLine_WhenNoScoutHasAMenu', async () => {
    await shelf();
    expect(screen.getByText('Nobody else has saved a menu yet.')).toBeTruthy();
  });

  it('Leader_HasNoRowMenusOnTheReadOnlyList_OnTheHub', async () => {
    mocks.all = [summary(1)];
    await shelf();
    expect(screen.queryByRole('button', { name: /^More for/ })).toBeNull();
  });

  it('Leader_SeesNoScoutsPrefix_OnTheHub', async () => {
    mocks.all = [summary(1)];
    await shelf();
    expect(screen.queryByText(/Scouts: /)).toBeNull();
  });

  it('Leader_SeesMyMenusAndNewMenu_OnTheHub', async () => {
    await shelf();
    expect(screen.getByRole('heading', { name: 'My menus' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New menu' })).toBeTruthy();
  });

  it('Leader_SeesTheirOwnMenusWithARowMenu_OnTheHub', async () => {
    mocks.mine = [summary(3, 5)];
    await shelf();
    expect(screen.getByRole('button', { name: /^More for/ })).toBeTruthy();
  });

  it('Leader_SeesMyMenus_AboveScoutsMenus', async () => {
    await shelf();
    const mine = screen.getByRole('heading', { name: 'My menus' });
    const list = screen.getByRole('heading', { name: 'Everyone’s menus' });
    expect(mine.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Leader_WithAPerson_DoesNotGetTheLocalPlan', async () => {
    await shelf();
    expect(screen.queryByLabelText('Menu name')).toBeNull();
  });

  it('Leader_WithoutAPerson_SeesTheLocalPlanAndSignInStrip_AboveScoutsMenus', async () => {
    mocks.actor = { ...LEADER, personId: null };
    await shelf();
    const plan = await screen.findByLabelText('Menu name');
    const strip = screen.getByText(/To save menus, sign in as yourself/);
    const list = screen.getByRole('heading', { name: 'Everyone’s menus' });
    expect(strip.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plan.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Adult_SeesNoScoutsMenus_WhenTheyHoldNoCapabilities', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.all = [summary(1)];
    mocks.family = [6];
    await shelf();
    expect(screen.queryByRole('heading', { name: 'Everyone’s menus' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Menu 1' })).toBeNull();
    expect(mocks.listAllMenusWith).not.toHaveBeenCalled();
  });

  it('Parent_SeesTheirScoutsMenus_UnderTheirOwnMenus', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.family = [6, 40];
    mocks.own = [summary(1)];
    mocks.mine = [summary(2, 6)];
    await shelf();
    const mine = screen.getByRole('heading', { name: 'My menus' });
    const scouts = screen.getByRole('heading', { name: 'Your scouts’ menus' });
    expect(mine.compareDocumentPosition(scouts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Parent_ReadsTheirScoutsMenus_ThroughTheFamilyScope', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.family = [6, 40];
    mocks.own = [summary(1)];
    await shelf();
    expect(mocks.listMenusWith).toHaveBeenCalledWith(expect.anything(), [40]);
  });

  it('Parent_HasNoRowMenuOnTheirScoutsRows_OnTheHub', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.family = [6, 40];
    mocks.own = [summary(1)];
    await shelf();
    expect(screen.queryByRole('button', { name: /^More for/ })).toBeNull();
  });

  it('Parent_SeesTheirOwnMenusAndNewMenu_OnTheHub', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.mine = [summary(2, 6)];
    await shelf();
    expect(screen.getByRole('link', { name: 'Menu 2' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New menu' })).toBeTruthy();
  });

  it('Everyone_SeesSharedWithTheTroop_WhenMenusAreShared', async () => {
    mocks.actor = null;
    mocks.shared = [{ id: 's1', name: 'Shared stew', ownerPersonId: 40, credit: 'Sam K.', calendarEntryId: null, outingTitle: null, mealCount: 2, sharedAt: '2026-10-03T12:00:00Z' }];
    await shelf();
    expect(screen.getByRole('heading', { name: 'Shared with the troop' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Shared stew' })).toBeTruthy();
    expect(screen.getByText(/Sam K\. · 2 meals/)).toBeTruthy();
  });

  it('Scout_SeesOnlyTheirOwnMenus_NotTheLeadersSection', async () => {
    mocks.session = SCOUT;
    mocks.actor = LEADER;
    mocks.mine = [summary(1, 39)];
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
    expect(screen.queryByText(/Sign in to save your menu/)).toBeNull();
  });

  it('Leader_HasNoDuplicateOrDeleteOnTheReadOnlyList_OnTheMenusPage', async () => {
    mocks.all = [summary(1)];
    await page();
    expect(screen.queryByRole('button', { name: /^More for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete|Duplicate/ })).toBeNull();
  });

  it('Leader_SeesMyMenusAndNewMenu_OnTheMenusPage', async () => {
    mocks.mine = [summary(3, 5)];
    await page();
    const section = screen.getByRole('heading', { name: 'My menus' }).closest('section') as HTMLElement;
    expect(within(section).getByRole('link', { name: 'New menu' })).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Menu 3' })).toBeTruthy();
  });

  it('Leader_OwnMenusSitAboveTheScoutsList_OnTheMenusPage', async () => {
    mocks.mine = [summary(3, 5)];
    mocks.all = [summary(1)];
    await page();
    const own = screen.getByRole('link', { name: 'Menu 3' });
    const theirs = screen.getByRole('link', { name: 'Menu 1' });
    expect(own.compareDocumentPosition(theirs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Leader_WithoutAPerson_HasNoMyMenus_OnTheMenusPage', async () => {
    mocks.actor = { ...LEADER, personId: null };
    await page();
    expect(screen.queryByRole('heading', { name: 'My menus' })).toBeNull();
  });

  it('Scout_SeesOnlyTheirOwnMenus_OnTheMenusPage', async () => {
    mocks.session = SCOUT;
    mocks.mine = [summary(1, 39)];
    mocks.all = [summary(1, 39), summary(2)];
    await page();
    expect(screen.getByRole('link', { name: 'Menu 1' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Menu 2' })).toBeNull();
    expect(screen.getByRole('link', { name: 'New menu' })).toBeTruthy();
  });

  it('Parent_SeesTheirScoutsMenusReadOnly_WhenTheyHoldNoCapabilities', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.family = [6, 40];
    mocks.own = [summary(1)];
    await page();
    expect(screen.getByRole('heading', { name: 'Your scouts’ menus' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Menu 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^More for/ })).toBeNull();
  });

  it('Parent_ReadsOnlyTheirScoutsAndNeverEveryonesMenus_OnTheMenusPage', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.family = [6, 40];
    await page();
    expect(mocks.listMenusWith).toHaveBeenCalledWith(expect.anything(), [40]);
    expect(mocks.listAllMenusWith).not.toHaveBeenCalled();
  });

  it('Parent_SeesMyMenusAndNewMenu_OnTheMenusPage', async () => {
    mocks.actor = NO_CAPS;
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.family = [6, 40];
    mocks.mine = [summary(2, 6)];
    await page();
    const section = screen.getByRole('heading', { name: 'My menus' }).closest('section') as HTMLElement;
    expect(within(section).getByRole('link', { name: 'New menu' })).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Menu 2' })).toBeTruthy();
  });

  it('Leader_FiltersTheList_FromTheUrl', async () => {
    mocks.actor = LEADER;
    await page({ scout: '40', shared: '1', outing: 'x' });
    expect(mocks.listAllMenusWith).toHaveBeenCalledWith(expect.anything(), { scout: 40, outing: undefined, shared: true });
  });

  it('Anonymous_SeesTheLockedLine', async () => {
    mocks.actor = null;
    await page();
    expect(screen.getByText(/Sign in to save your menu/)).toBeTruthy();
  });
});
