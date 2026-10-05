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
  ownerCreditNamesWith: vi.fn(),
  family: [] as number[],
  epochCurrent: true
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }
}));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => mocks.session }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => mocks.actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/menus-store', () => ({ loadMenuWith: mocks.loadMenuWith, ownerCreditNamesWith: mocks.ownerCreditNamesWith }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => ({}) }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [], loadPatrolNamesWith: async () => [] }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  isEpochCurrent: async () => mocks.epochCurrent
}));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async () => mocks.family }));
// The rules are real; only the re-sanitizing is stubbed (the stub catalog is empty). Redaction is tested in menu-monster-menu-access.test.ts.
vi.mock('@/lib/menu-monster/menu-access', async (orig) => ({
  ...(await orig<typeof import('../src/lib/menu-monster/menu-access')>()),
  redactMenu: (menu: unknown) => ({ menu, hiddenRecipes: 0 })
}));
// The pages' client components are not under test here; capture their props.
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/plan-tab', () => ({ PlanTab: (p: unknown) => p }));
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/shopping-tab', () => ({ ShoppingTab: (p: unknown) => p }));

import { loadViewableMenu, menuViewer } from '../src/app/(public)/library/menu-monster/menus/_components/scout-menus';
import PlanPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/page';
import ShoppingPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/shopping/page';
import MealPage from '../src/app/(public)/library/menu-monster/menus/[menuId]/meals/[mealId]/page';

const ID = '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f';
const SCOUT = { subjectKind: 'scout', personId: 39, displayName: 'Charlie W.' };
const LEADER = { kind: 'identity', label: 'Pat B.', personId: 5, capabilities: new Set(['roster.view']) };
const NO_CAPS = { kind: 'identity', label: 'Parent P.', personId: 6, capabilities: new Set() };
const PARENT = { subjectKind: 'adult', personId: 6, displayName: 'Parent P.' };
const stored = (ownerPersonId: number, over: Record<string, unknown> = {}) => ({
  id: ID, ownerPersonId, menu: { meals: [{ id: 'm1' }] }, snapshot: null, createdAt: '', updatedAt: 'u', sharedAt: null, entryPublished: null, review: null, ...over
});

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
  mocks.family = [];
  mocks.epochCurrent = true;
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

  it('Adult_IsAParentViewer_WhenTheyHoldNoCapabilities', async () => {
    mocks.session = PARENT;
    mocks.actor = NO_CAPS;
    mocks.family = [6, 39];
    expect(await menuViewer()).toEqual({ kind: 'parent', personId: 6, familyIds: [6, 39] });
  });

  it('Parent_IsNobody_WhenTheirSessionWasRevoked', async () => {
    // qa-lead: a revoked parent must not keep reading unshared menus on a still-signed cookie.
    mocks.session = PARENT;
    mocks.actor = NO_CAPS;
    mocks.family = [6, 39];
    mocks.epochCurrent = false;
    expect(await menuViewer()).toBeNull();
  });

  it('Anonymous_IsNobody', async () => {
    expect(await menuViewer()).toBeNull();
  });

  it('Scout_IsNeverALeaderViewer_WhenTheirIdentityHoldsACapability', async () => {
    // The youth_leader bundle: a real capability on a scout identity, with no scout session found.
    mocks.actor = { ...LEADER, subjectKind: 'scout', capabilities: new Set(['meeting_plan.use']) };
    expect(await menuViewer()).toBeNull();
  });

  it('Adult_IsALeaderViewer_WhenTheIdentityIsAnAdultWithCapabilities', async () => {
    mocks.actor = { ...LEADER, subjectKind: 'adult' };
    expect(await menuViewer()).toMatchObject({ kind: 'leader' });
  });

  it('Scout_Wins_WhenALeaderActorAlsoApplies', async () => {
    mocks.session = SCOUT;
    mocks.actor = LEADER;
    expect(await menuViewer()).toMatchObject({ kind: 'scout' });
  });
});

const pages: [string, (id: string) => Promise<unknown>][] = [
  ['Plan', (menuId) => PlanPage({ params: Promise.resolve({ menuId }), searchParams: Promise.resolve({}) })],
  ['Shopping', (menuId) => ShoppingPage({ params: Promise.resolve({ menuId }) })]
];

describe.each(pages)('%s page access matrix', (_name, render) => {
  const readOnlyOf = async () => find(await render(ID), (p) => 'menuId' in p)?.readOnly;

  it('Owner_Edits_WhenTheScoutOwnsTheMenu', async () => {
    mocks.session = SCOUT;
    expect(await readOnlyOf()).toBeFalsy();
  });

  it('Leader_Edits_AScoutsMenu_WhenSignedInAsAPerson', async () => {
    // Patrick, 2026-10-05: leaders fix scout menus before the shopping trip.
    mocks.actor = LEADER;
    const props = find(await render(ID), (p) => 'menuId' in p);
    expect(props?.readOnly).toBeFalsy();
    expect(props?.helper).toBe(true);
  });

  it('Leader_StillOnlyReads_WhenTheirSignInNamesNoPerson', async () => {
    // A legacy leader cookie: nobody to credit a change to, so nothing saves.
    mocks.actor = { ...LEADER, personId: null };
    const props = find(await render(ID), (p) => 'menuId' in p);
    expect(props?.readOnly).toBe(true);
    expect(props?.helper).toBeFalsy();
  });

  it('Owner_IsNotAHelper_OnTheirOwnMenu', async () => {
    mocks.session = SCOUT;
    expect(find(await render(ID), (p) => 'menuId' in p)?.helper).toBeFalsy();
  });

  it('Leader_SeesWhoPlannedIt_WhenReadingReadOnly', async () => {
    mocks.actor = LEADER;
    expect(find(await render(ID), (p) => 'plannedBy' in p)?.plannedBy).toBe('Sam K.');
  });

  it('OtherScout_GetsNotFound_WhenTheMenuIsNotTheirs', async () => {
    mocks.session = { ...SCOUT, personId: 7 };
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('Parent_ReadsReadOnly_WhenTheMenuIsTheirScouts', async () => {
    mocks.session = PARENT;
    mocks.actor = NO_CAPS;
    mocks.family = [6, 39];
    expect(await readOnlyOf()).toBe(true);
  });

  it('Parent_GetsNotFound_ForAnotherFamilysUnsharedMenu', async () => {
    mocks.session = PARENT;
    mocks.actor = NO_CAPS;
    mocks.family = [6, 40];
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('Anonymous_GetsNotFound_WhenTheMenuIsNotShared', async () => {
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('Anonymous_ReadsReadOnly_WhenTheMenuIsShared', async () => {
    mocks.loadMenuWith.mockResolvedValue(stored(39, { sharedAt: '2026-10-03T12:00:00Z' }));
    expect(await readOnlyOf()).toBe(true);
  });

  it('Anonymous_GetsNotFound_WhenSharedOnAnUnpublishedOuting', async () => {
    mocks.loadMenuWith.mockResolvedValue(stored(39, { sharedAt: '2026-10-03T12:00:00Z', entryPublished: false }));
    await expect(render(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('OtherScout_ReadsReadOnly_WhenTheMenuIsShared', async () => {
    mocks.session = { ...SCOUT, personId: 7 };
    mocks.loadMenuWith.mockResolvedValue(stored(39, { sharedAt: '2026-10-03T12:00:00Z' }));
    expect(await readOnlyOf()).toBe(true);
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

describe('Meals inline (2026-10-03)', () => {
  it('OldMealUrl_RedirectsToThePlanTab_WithThatMealOpen', async () => {
    await expect(MealPage({ params: Promise.resolve({ menuId: ID, mealId: 'm1' }) })).rejects.toThrow(`NEXT_REDIRECT /library/menu-monster/menus/${ID}?meal=m1`);
  });

  it('PlanPage_OpensTheMealNamedInTheUrl', async () => {
    mocks.session = SCOUT;
    const out = await PlanPage({ params: Promise.resolve({ menuId: ID }), searchParams: Promise.resolve({ meal: 'm1' }) });
    expect(find(out, (p) => 'openMeal' in p)?.openMeal).toBe('m1');
  });
});

describe('loadViewableMenu redaction (the single redaction point)', () => {
  const full = () =>
    stored(39, {
      sharedAt: '2026-10-03T12:00:00Z',
      snapshot: { v: 1 },
      review: { note: 'Bring water.', at: '2026-10-03T12:00:00Z', byPersonId: 5 }
    });

  it('SharedView_HidesSnapshotAndReviewNote', async () => {
    mocks.loadMenuWith.mockResolvedValue(full());
    const view = await loadViewableMenu(ID, null);
    expect(view).toMatchObject({ access: 'shared', readOnly: true, canCopy: false });
    expect(view!.stored.snapshot).toBeNull();
    expect(view!.stored.review).toBeNull();
  });

  it('ParentView_KeepsTheReviewNote_ButNotTheSnapshot', async () => {
    mocks.loadMenuWith.mockResolvedValue(full());
    const view = await loadViewableMenu(ID, { kind: 'parent', personId: 6, familyIds: [6, 39] });
    expect(view!.access).toBe('parent');
    expect(view!.stored.review?.note).toBe('Bring water.');
    expect(view!.stored.snapshot).toBeNull();
  });

  it('OtherScout_CanCopy_ASharedMenu', async () => {
    mocks.loadMenuWith.mockResolvedValue(full());
    expect((await loadViewableMenu(ID, { kind: 'scout', personId: 7, displayName: 'Ava L.' }))!.canCopy).toBe(true);
  });

  it('Owner_GetsTheSnapshotAndNote_Unredacted', async () => {
    mocks.loadMenuWith.mockResolvedValue(full());
    const view = await loadViewableMenu(ID, { kind: 'scout', personId: 39, displayName: 'Charlie W.' });
    expect(view).toMatchObject({ access: 'owner', readOnly: false, canCopy: false });
    expect(view!.stored.snapshot).toEqual({ v: 1 });
  });
});
