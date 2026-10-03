import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Scout Workspace menu pages: who gets a menu and who gets notFound().
 * loadOwnMenu is owner-only and refuses a malformed id before the database;
 * the three menu pages (Plan, Shopping, meal) turn every miss — no scout
 * session, an adult, a non-UUID id, someone else's menu — into notFound().
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  loadMenuWith: vi.fn()
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  }
}));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => mocks.session }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/menus-store', () => ({ loadMenuWith: mocks.loadMenuWith }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => ({}) }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [] }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async (_sb: unknown, id: number) => [id] }));

import { loadOwnMenu } from '../src/app/(public)/library/menu-monster/menus/_components/scout-menus';
import PlanPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/page';
import ShoppingPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/shopping/page';
import MealPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/meals/[mealId]/page';

const ID = '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f';
const SCOUT = { subjectKind: 'scout', personId: 39, displayName: 'Charlie W.' };
const VIEWER = { personId: 39, displayName: 'Charlie W.' };
const stored = (ownerPersonId: number) => ({ id: ID, ownerPersonId, menu: { meals: [] }, snapshot: null, createdAt: '', updatedAt: '' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.loadMenuWith.mockResolvedValue(stored(39));
});

describe('loadOwnMenu', () => {
  it('Scout_GetsTheirMenu_WhenTheyOwnIt', async () => {
    expect(await loadOwnMenu(ID, VIEWER)).toMatchObject({ id: ID });
  });

  it('Scout_GetsNothing_WhenTheIdIsNotAUuid', async () => {
    expect(await loadOwnMenu('not-a-uuid', VIEWER)).toBeNull();
    expect(mocks.loadMenuWith).not.toHaveBeenCalled();
  });

  it('Scout_GetsNothing_WhenTheMenuBelongsToAnotherScout', async () => {
    mocks.loadMenuWith.mockResolvedValue(stored(7));
    expect(await loadOwnMenu(ID, VIEWER)).toBeNull();
  });

  it('Scout_GetsNothing_WhenTheMenuDoesNotExist', async () => {
    mocks.loadMenuWith.mockResolvedValue(null);
    expect(await loadOwnMenu(ID, VIEWER)).toBeNull();
  });
});

const pages: [string, (id: string) => Promise<unknown>][] = [
  ['Plan', (menuId) => PlanPage({ params: Promise.resolve({ menuId }) })],
  ['Shopping', (menuId) => ShoppingPage({ params: Promise.resolve({ menuId }) })],
  ['Meal', (menuId) => MealPage({ params: Promise.resolve({ menuId, mealId: 'm1' }) })]
];

describe.each(pages)('%s page notFound paths', (_name, render) => {
  it('Anonymous_GetsNotFound', async () => {
    mocks.session = null;
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('Adult_GetsNotFound_WhenTheUnsharedMenuIsNotTheirScouts', async () => {
    mocks.session = { ...SCOUT, personId: 6, subjectKind: 'adult' };
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('Scout_GetsNotFound_WhenTheIdIsNotAUuid', async () => {
    await expect(render('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.loadMenuWith).not.toHaveBeenCalled();
  });

  it('Scout_GetsNotFound_WhenTheMenuIsAnotherScouts', async () => {
    mocks.loadMenuWith.mockResolvedValue(stored(7));
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Meal page', () => {
  it('Scout_GetsNotFound_WhenTheMealIsNotOnTheirMenu', async () => {
    await expect(pages[2][1](ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
