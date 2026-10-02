import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Leader read-only view (pulled forward from Scout Workspace Phase 3, Decision 2:
 * any adult with admin access). menuViewer() says who is looking; the three menu
 * pages answer owner -> edit, leader -> read-only, everyone else -> notFound().
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  actor: null as unknown,
  loadMenuWith: vi.fn(),
  ownerCreditNamesWith: vi.fn()
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  }
}));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => mocks.session }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => mocks.actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/menus-store', () => ({ loadMenuWith: mocks.loadMenuWith, ownerCreditNamesWith: mocks.ownerCreditNamesWith }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => ({}) }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [] }));
// The pages' client components are not under test here; capture their props.
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/plan-tab', () => ({ PlanTab: (p: unknown) => p }));
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/shopping-tab', () => ({ ShoppingTab: (p: unknown) => p }));
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/meal-editor', () => ({ MealEditor: (p: unknown) => p }));

import { menuViewer } from '../src/app/(public)/library/menu-monster/menus/_components/scout-menus';
import PlanPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/page';
import ShoppingPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/shopping/page';
import MealPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/meals/[mealId]/page';

const ID = '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f';
const SCOUT = { subjectKind: 'scout', personId: 39, displayName: 'Charlie W.' };
const LEADER = { kind: 'identity', label: 'Pat B.', personId: 5, capabilities: new Set(['roster.view']) };
const NO_CAPS = { kind: 'identity', label: 'Parent P.', personId: 6, capabilities: new Set() };
const stored = (ownerPersonId: number) => ({ id: ID, ownerPersonId, menu: { meals: [{ id: 'm1' }] }, snapshot: null, createdAt: '', updatedAt: 'u' });

/** The element a page returns: find the first node whose props satisfy `pred`. */
function find(node: unknown, pred: (p: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as { props?: Record<string, unknown> };
  if (el.props && pred(el.props)) return el.props;
  for (const v of Object.values(el.props ?? {})) {
    for (const c of Array.isArray(v) ? v : [v]) {
      const hit = find(c, pred);
      if (hit) return hit;
    }
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = null;
  mocks.actor = null;
  mocks.loadMenuWith.mockResolvedValue(stored(39));
  mocks.ownerCreditNamesWith.mockResolvedValue(new Map([[39, 'Sam K.']]));
});

describe('menuViewer', () => {
  it('Scout_IsAScoutViewer_WhenSignedInAsAScout', async () => {
    mocks.session = SCOUT;
    expect(await menuViewer()).toEqual({ kind: 'scout', personId: 39, displayName: 'Charlie W.' });
  });

  it('Leader_IsALeaderViewer_WhenTheActorHasCapabilities', async () => {
    mocks.actor = LEADER;
    expect(await menuViewer()).toEqual({ kind: 'leader', personId: 5, label: 'Pat B.' });
  });

  it('Adult_IsNobody_WhenTheyHoldNoCapabilities', async () => {
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.actor = NO_CAPS;
    expect(await menuViewer()).toBeNull();
  });

  it('Anonymous_IsNobody', async () => {
    expect(await menuViewer()).toBeNull();
  });

  it('Scout_Wins_WhenALeaderActorAlsoApplies', async () => {
    mocks.session = SCOUT;
    mocks.actor = LEADER;
    expect(await menuViewer()).toMatchObject({ kind: 'scout' });
  });
});

const pages: [string, (id: string) => Promise<unknown>][] = [
  ['Plan', (menuId) => PlanPage({ params: Promise.resolve({ menuId }) })],
  ['Shopping', (menuId) => ShoppingPage({ params: Promise.resolve({ menuId }) })],
  ['Meal', (menuId) => MealPage({ params: Promise.resolve({ menuId, mealId: 'm1' }) })]
];

describe.each(pages)('%s page access matrix', (_name, render) => {
  const readOnlyOf = async () => find(await render(ID), (p) => 'menuId' in p)?.readOnly;

  it('Owner_Edits_WhenTheScoutOwnsTheMenu', async () => {
    mocks.session = SCOUT;
    expect(await readOnlyOf()).toBeFalsy();
  });

  it('Leader_ReadsReadOnly_WhenTheMenuBelongsToAScout', async () => {
    mocks.actor = LEADER;
    expect(await readOnlyOf()).toBe(true);
  });

  it('Leader_SeesWhoPlannedIt_WhenReadingReadOnly', async () => {
    mocks.actor = LEADER;
    expect(find(await render(ID), (p) => 'plannedBy' in p)?.plannedBy).toBe('Sam K.');
  });

  it('OtherScout_GetsNotFound_WhenTheMenuIsNotTheirs', async () => {
    mocks.session = { ...SCOUT, personId: 7 };
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('Parent_GetsNotFound_WhenTheyHoldNoCapabilities', async () => {
    mocks.session = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
    mocks.actor = NO_CAPS;
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.loadMenuWith).not.toHaveBeenCalled();
  });

  it('Anonymous_GetsNotFound', async () => {
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('Leader_GetsNotFound_WhenTheIdIsNotAUuid', async () => {
    mocks.actor = LEADER;
    await expect(render('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.loadMenuWith).not.toHaveBeenCalled();
  });

  it('Leader_GetsNotFound_WhenTheMenuDoesNotExist', async () => {
    mocks.actor = LEADER;
    mocks.loadMenuWith.mockResolvedValue(null);
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Meal page (leader)', () => {
  it('Leader_GetsNotFound_WhenTheMealIsNotOnTheMenu', async () => {
    mocks.actor = LEADER;
    await expect(MealPage({ params: Promise.resolve({ menuId: ID, mealId: 'zzz' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
