import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { IdentitySession } from '../src/lib/identity-session';

/**
 * Scout Workspace Phase 3 actions (menu-actions.ts): share / stop sharing and
 * copy are verified-scout only and take the actor from the session; the review
 * note and Hide from the shelf are admin-viewer only. The store is a stub
 * (menu-monster-menus-sharing-db.test.ts covers it); the scout session check
 * is REAL, only its cookie and epoch read are faked.
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  actor: null as unknown,
  setMenuSharedWith: vi.fn(),
  copyMenuWith: vi.fn(),
  setReviewNoteWith: vi.fn(),
  hideMenuWith: vi.fn(),
  addMenuIngredientWith: vi.fn(),
  addScoutPackageWith: vi.fn()
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  verifyIdentitySession: async () => mocks.session,
  isEpochCurrent: async () => true
}));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => mocks.actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => CATALOG }));
vi.mock('@/lib/menu-monster/scout-packages-store', () => ({ addScoutPackageWith: mocks.addScoutPackageWith }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [], loadPatrolNamesWith: async () => [] }));
vi.mock('@/lib/menu-monster/menus-store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/menu-monster/menus-store')>()),
  setMenuSharedWith: mocks.setMenuSharedWith,
  copyMenuWith: mocks.copyMenuWith,
  setReviewNoteWith: mocks.setReviewNoteWith,
  hideMenuWith: mocks.hideMenuWith,
  addMenuIngredientWith: mocks.addMenuIngredientWith
}));

import { addMenuIngredientAction, addScoutPackageAction, copyMenuAction, hideMenuAction, setReviewNoteAction, shareMenuAction } from '../src/app/(public)/library/_tools/menu-monster/menu-actions';
import { MENU_LIMIT } from '../src/lib/menu-monster/menus-store';

const SCOUT = { role: 'identity', subjectKind: 'scout', personId: 39, householdKey: 'h', displayName: 'Charlie W.', epoch: 1, iat: 0 } as IdentitySession;
const LEADER = { kind: 'identity', subjectKind: 'adult', label: 'Pat B.', personId: 5, capabilities: new Set(['roster.view']) };
const ID = '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.actor = null;
  mocks.setMenuSharedWith.mockResolvedValue(true);
  mocks.copyMenuWith.mockResolvedValue({ id: ID, droppedRecipes: 0 });
  mocks.setReviewNoteWith.mockResolvedValue(true);
  mocks.hideMenuWith.mockResolvedValue(true);
  mocks.addMenuIngredientWith.mockResolvedValue({ status: 'added', id: 'x-0000beef' });
  mocks.addScoutPackageWith.mockResolvedValue({ status: 'live', id: 'sp-0000beef' });
});

describe('shareMenuAction', () => {
  it('Scout_SharesAsThemselves_NeverAClientNamedPerson', async () => {
    expect(await shareMenuAction(ID, true)).toEqual({ ok: true });
    expect(mocks.setMenuSharedWith).toHaveBeenCalledWith({ stub: true }, { personId: 39, label: 'Charlie W.' }, ID, true);
  });

  it('Share_Fails_WhenNotSignedInAsAScout', async () => {
    mocks.session = null;
    expect((await shareMenuAction(ID, true)).ok).toBe(false);
    expect(mocks.setMenuSharedWith).not.toHaveBeenCalled();
  });

  it('Share_SaysNotYours_WhenTheStoreFindsNoOwnMenu', async () => {
    mocks.setMenuSharedWith.mockResolvedValue(false);
    expect(await shareMenuAction(ID, false)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
  });

  it('Share_RejectsAMalformedId', async () => {
    expect((await shareMenuAction('nope', true)).ok).toBe(false);
    expect(mocks.setMenuSharedWith).not.toHaveBeenCalled();
  });
});

describe('copyMenuAction', () => {
  it('Scout_GetsTheNewIdAndDroppedCount', async () => {
    mocks.copyMenuWith.mockResolvedValue({ id: ID, droppedRecipes: 2 });
    expect(await copyMenuAction(ID)).toEqual({ ok: true, id: ID, droppedRecipes: 2 });
  });

  it('Copy_SaysSo_WhenTheMenuIsNotShared', async () => {
    mocks.copyMenuWith.mockResolvedValue(null);
    expect((await copyMenuAction(ID)).ok).toBe(false);
  });

  it('Copy_SaysTheLimit_WhenAtTheCap', async () => {
    mocks.copyMenuWith.mockResolvedValue(MENU_LIMIT);
    const res = await copyMenuAction(ID);
    expect(res.ok === false && res.error).toMatch(/delete one/);
  });

  it('Copy_Fails_ForAnAdult', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult' };
    expect((await copyMenuAction(ID)).ok).toBe(false);
    expect(mocks.copyMenuWith).not.toHaveBeenCalled();
  });
});

describe('leader actions', () => {
  it('Leader_CanSetReviewNote', async () => {
    mocks.session = null;
    mocks.actor = LEADER;
    expect(await setReviewNoteAction(ID, 'Nice.')).toEqual({ ok: true });
    expect(mocks.setReviewNoteWith).toHaveBeenCalledWith({ stub: true }, { personId: 5, label: 'Pat B.' }, ID, 'Nice.');
  });

  it('Scout_CannotSetReviewNote', async () => {
    expect((await setReviewNoteAction(ID, 'Nice.')).ok).toBe(false);
    expect(mocks.setReviewNoteWith).not.toHaveBeenCalled();
  });

  it('ScoutIdentityWithACapability_CannotSetReviewNote', async () => {
    mocks.session = null;
    mocks.actor = { ...LEADER, subjectKind: 'scout' };
    expect((await setReviewNoteAction(ID, 'Nice.')).ok).toBe(false);
  });

  it('ReviewNote_RejectsANonString', async () => {
    mocks.session = null;
    mocks.actor = LEADER;
    expect((await setReviewNoteAction(ID, 42 as unknown as string)).ok).toBe(false);
  });

  it('Leader_CanHideASharedMenu', async () => {
    mocks.session = null;
    mocks.actor = LEADER;
    expect(await hideMenuAction(ID)).toEqual({ ok: true });
  });

  it('Scout_CannotHideAMenu', async () => {
    expect((await hideMenuAction(ID)).ok).toBe(false);
    expect(mocks.hideMenuWith).not.toHaveBeenCalled();
  });
});

describe('addMenuIngredientAction (release C)', () => {
  const JAM = { key: 'new:0000beef', name: 'Strawberry jam', kind: 'count', one: 'jar', many: 'jars', avoid: ['x', 'nut'], size: 1, price: 3.5, store: '' };

  it('Scout_AddsACleanTypedIn_AsThemselves', async () => {
    expect(await addMenuIngredientAction(JAM)).toEqual({ ok: true, id: 'x-0000beef' });
    expect(mocks.addMenuIngredientWith).toHaveBeenCalledWith(
      { stub: true },
      { personId: 39, label: 'Charlie W.' },
      expect.objectContaining({ name: 'Strawberry jam', avoid: ['nut'], store: null })
    );
  });

  it('TypedIn_NeedsSizeAndPrice', async () => {
    expect((await addMenuIngredientAction({ ...JAM, size: 0 })).ok).toBe(false);
    expect(mocks.addMenuIngredientWith).not.toHaveBeenCalled();
  });

  it('TypedIn_SaysTheCap_InWords', async () => {
    mocks.addMenuIngredientWith.mockResolvedValue({ status: 'ingredient_cap' });
    const res = await addMenuIngredientAction(JAM);
    expect(res.ok === false && res.error).toMatch(/10 new ingredients/);
  });

  it('TypedIn_Fails_ForAnAdult', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult' };
    expect((await addMenuIngredientAction(JAM)).ok).toBe(false);
  });
});

describe('addScoutPackageAction (release C)', () => {
  const PKG = { ingredientId: 'eggs', name: 'Eggs, 18 ct', store: 'Aldi', size: 18, sizeUnit: 'egg', price: 4.29 };

  it('Scout_AddsACleanPackage_AsThemselves', async () => {
    expect(await addScoutPackageAction(PKG)).toEqual({ ok: true, status: 'live', id: 'sp-0000beef' });
    expect(mocks.addScoutPackageWith).toHaveBeenCalledWith({ stub: true }, { personId: 39, label: 'Charlie W.' }, expect.objectContaining({ ingredientId: 'eggs', size: 18, price: 4.29 }));
  });

  it('Package_IsRefused_BeforeTheDb_WithoutAPrice', async () => {
    expect((await addScoutPackageAction({ ...PKG, price: 0 })).ok).toBe(false);
    expect(mocks.addScoutPackageWith).not.toHaveBeenCalled();
  });

  it('Package_SaysTheCap_InWords', async () => {
    mocks.addScoutPackageWith.mockResolvedValue({ status: 'cap' });
    const res = await addScoutPackageAction(PKG);
    expect(res.ok === false && res.error).toMatch(/waiting for a leader/);
  });

  it('Package_Fails_ForAnAdult', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult' };
    expect((await addScoutPackageAction(PKG)).ok).toBe(false);
  });
});
