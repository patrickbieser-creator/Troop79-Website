import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The local menu routes (/menus/local, /local/shopping, /local/meals/[mealId]):
 * a signed-in scout is redirected to the hub (where the save offer shows);
 * visitors, adults and leaders get the page. Also the server MenuStore adapter:
 * a thin pass-through to the existing create / save actions.
 */

const mocks = vi.hoisted(() => ({ session: null as unknown, actor: null as unknown }));
const actions = vi.hoisted(() => ({ createMenuAction: vi.fn(), saveMenuAction: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  }
}));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => mocks.session }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => mocks.actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => ({}) }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [] }));
vi.mock('../src/app/(public)/library/_tools/menu-monster/menu-actions', () => actions);

import LocalPlanPage from '../src/app/(public)/library/menu-monster/menus/local/page';
import LocalShoppingPage from '../src/app/(public)/library/menu-monster/menus/local/shopping/page';
import LocalMealPage from '../src/app/(public)/library/menu-monster/menus/local/meals/[mealId]/page';
import { serverMenuStore } from '../src/app/(public)/library/menu-monster/menus/_components/server-menu-store';
import { blankMenu } from '../src/lib/menu-monster/menus';

const HUB = 'NEXT_REDIRECT /library/topic/menu-monster';
const pages: [string, () => Promise<unknown>][] = [
  ['Plan', () => LocalPlanPage()],
  ['Shopping', () => LocalShoppingPage()],
  ['Meal', () => LocalMealPage({ params: Promise.resolve({ mealId: 'm1' }) })]
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = null;
  mocks.actor = null;
});

describe.each(pages)('Local %s page', (_name, render) => {
  it('Scout_IsSentToTheHub_WhenTheyOpenALocalPage', async () => {
    mocks.session = { subjectKind: 'scout', personId: 39, displayName: 'Charlie W.' };
    await expect(render()).rejects.toThrow(HUB);
  });

  it('Visitor_GetsThePage_WithoutSigningIn', async () => {
    await expect(render()).resolves.toBeTruthy();
  });

  it('Adult_GetsThePage', async () => {
    mocks.session = { subjectKind: 'adult', personId: 5, displayName: 'Pat' };
    await expect(render()).resolves.toBeTruthy();
  });

  it('Leader_GetsThePage', async () => {
    mocks.actor = { kind: 'identity', label: 'Pat B.', personId: 5, subjectKind: 'adult', capabilities: new Set(['roster.view']) };
    await expect(render()).resolves.toBeTruthy();
  });
});

describe('serverMenuStore', () => {
  it('Scout_SavesThroughSaveMenuAction_WithTheVersionToken', async () => {
    actions.saveMenuAction.mockResolvedValue({ ok: true, updatedAt: 'v2' });
    const menu = blankMenu();
    const res = await serverMenuStore('menu-1').save(menu, 'v1');
    expect(actions.saveMenuAction).toHaveBeenCalledWith('menu-1', menu, 'v1');
    expect(res).toEqual({ ok: true, updatedAt: 'v2' });
  });

  it('Scout_SeesTheServersError_WhenSaveIsRefused', async () => {
    actions.saveMenuAction.mockResolvedValue({ ok: false, error: 'Changed in another window' });
    expect(await serverMenuStore('menu-1').save(blankMenu(), 'v1')).toEqual({ ok: false, error: 'Changed in another window' });
  });

  it('Scout_CreatesThroughCreateMenuAction', async () => {
    actions.createMenuAction.mockResolvedValue({ ok: true, id: 'new-id' });
    const menu = blankMenu();
    expect(await serverMenuStore(null).create(menu)).toEqual({ ok: true, id: 'new-id' });
    expect(actions.createMenuAction).toHaveBeenCalledWith(menu);
  });

  it('Scout_CannotSave_BeforeTheMenuHasAnId', async () => {
    expect(await serverMenuStore(null).save(blankMenu(), null)).toMatchObject({ ok: false });
    expect(actions.saveMenuAction).not.toHaveBeenCalled();
  });

  it('Scout_MovesToTheNewMenusOwnUrl_AfterACreate', () => {
    const store = serverMenuStore(null);
    expect(store.afterCreate('abc')).toBe('/library/menu-monster/menus/abc');
    expect(store.afterCreate('abc', 'm1')).toBe('/library/menu-monster/menus/abc/meals/m1');
  });

  it('Scout_CanSaveAndPayAndReport_OnAServerMenu', () => {
    expect(serverMenuStore('menu-1').caps).toEqual({ canSave: true, canPay: true, canReport: true });
  });
});
