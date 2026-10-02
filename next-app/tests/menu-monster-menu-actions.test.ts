import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { IdentitySession } from '../src/lib/identity-session';

/**
 * Scout Workspace menu actions (menu-actions.ts): the session gate, the
 * validate-before-the-DB rules, and the friendly messages. The store has its
 * own db tests; here it is a stub so each branch is observable. The session
 * check itself is REAL (requireVerifiedScoutIdentity) — only the cookie and the
 * epoch read underneath it are faked.
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  epochCurrent: true,
  createMenuWith: vi.fn(),
  saveMenuWith: vi.fn(),
  duplicateMenuWith: vi.fn(),
  deleteMenuWith: vi.fn(),
  loadMenuWith: vi.fn(),
  loadOutingsWith: vi.fn()
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  verifyIdentitySession: async () => mocks.session,
  isEpochCurrent: async () => mocks.epochCurrent
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => CATALOG }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: mocks.loadOutingsWith }));
vi.mock('@/lib/menu-monster/menus-store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/menu-monster/menus-store')>()),
  createMenuWith: mocks.createMenuWith,
  saveMenuWith: mocks.saveMenuWith,
  duplicateMenuWith: mocks.duplicateMenuWith,
  deleteMenuWith: mocks.deleteMenuWith,
  loadMenuWith: mocks.loadMenuWith
}));

import {
  createMenuAction,
  deleteMenuAction,
  duplicateMenuAction,
  saveMenuAction
} from '../src/app/(public)/library/_tools/menu-monster/menu-actions';
import { MENU_LIMIT } from '../src/lib/menu-monster/menus-store';
import { MAX_MENUS_PER_SCOUT } from '../src/lib/menu-monster/menus';

const SCOUT: IdentitySession = { role: 'identity', subjectKind: 'scout', personId: 39, householdKey: 'h', displayName: 'Charlie W.', epoch: 1, iat: 0 } as IdentitySession;
const ID = '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f';
const STAMP = '2026-10-02T12:00:00.000Z';
const payload = (over: Record<string, unknown> = {}) => ({ name: 'Camporee', context: 'camp', headcount: 8, meals: [], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.epochCurrent = true;
  mocks.createMenuWith.mockResolvedValue(ID);
  mocks.saveMenuWith.mockResolvedValue({ status: 'saved', updatedAt: STAMP });
  mocks.duplicateMenuWith.mockResolvedValue(ID);
  mocks.deleteMenuWith.mockResolvedValue(true);
  mocks.loadMenuWith.mockResolvedValue(null);
  mocks.loadOutingsWith.mockResolvedValue([]);
});

describe('menu actions: who may call them', () => {
  const callAll = () => [
    createMenuAction(payload()),
    saveMenuAction(ID, payload(), STAMP),
    duplicateMenuAction(ID),
    deleteMenuAction(ID)
  ];

  it('Anonymous_IsRefused_OnEveryAction', async () => {
    mocks.session = null;
    for (const r of await Promise.all(callAll())) expect(r.ok).toBe(false);
    expect(mocks.createMenuWith).not.toHaveBeenCalled();
  });

  it('Adult_IsRefused_OnEveryAction', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult' };
    for (const r of await Promise.all(callAll())) expect(r.ok).toBe(false);
  });

  it('Leader_WithoutAScoutIdentity_IsRefused', async () => {
    // A leader session has no identity cookie at all, so it reads as anonymous here.
    mocks.session = null;
    expect((await createMenuAction(payload())).ok).toBe(false);
  });

  it('RevokedScout_IsRefused_OnEveryAction', async () => {
    mocks.epochCurrent = false;
    for (const r of await Promise.all(callAll())) expect(r).toMatchObject({ ok: false });
    expect(mocks.deleteMenuWith).not.toHaveBeenCalled();
  });
});

describe('menu actions: the owner is the session', () => {
  it('Scout_OwnsTheNewMenu_EvenWhenThePayloadNamesSomeoneElse', async () => {
    await createMenuAction(payload({ ownerPersonId: 7, owner_person_id: 7 }));
    expect(mocks.createMenuWith.mock.calls[0][1]).toMatchObject({ personId: 39 });
    expect(mocks.createMenuWith.mock.calls[0][2]).not.toHaveProperty('ownerPersonId');
  });

  it('Scout_SavesAsTheSessionPerson_EvenWhenThePayloadNamesSomeoneElse', async () => {
    await saveMenuAction(ID, payload({ ownerPersonId: 7 }), STAMP);
    expect(mocks.saveMenuWith.mock.calls[0][1]).toMatchObject({ personId: 39 });
  });
});

describe('menu actions: messages', () => {
  it('Scout_IsToldTheMenuIsntTheirs_WhenSavingSomeoneElsesMenu', async () => {
    mocks.saveMenuWith.mockResolvedValue({ status: 'not_found' });
    expect(await saveMenuAction(ID, payload(), STAMP)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
  });

  it('Scout_IsToldToReload_WhenTheMenuChangedInAnotherWindow', async () => {
    mocks.saveMenuWith.mockResolvedValue({ status: 'conflict' });
    const r = await saveMenuAction(ID, payload(), STAMP);
    expect(r.ok === false && r.error).toMatch(/changed in another window/);
  });

  it('Scout_IsToldToDeleteOne_WhenCreatingPastTheCap', async () => {
    mocks.createMenuWith.mockResolvedValue(MENU_LIMIT);
    const r = await createMenuAction(payload());
    expect(r).toEqual({ ok: false, error: `You have ${MAX_MENUS_PER_SCOUT} menus — delete one you don’t need to make room.` });
  });

  it('Scout_IsToldToDeleteOne_WhenDuplicatingPastTheCap', async () => {
    mocks.duplicateMenuWith.mockResolvedValue(MENU_LIMIT);
    const r = await duplicateMenuAction(ID);
    expect(r.ok === false && r.error).toMatch(/delete one you don’t need/);
  });

  it('Scout_IsToldTheMenuIsntTheirs_WhenDeletingSomeoneElsesMenu', async () => {
    mocks.deleteMenuWith.mockResolvedValue(false);
    expect(await deleteMenuAction(ID)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
  });

  it('Scout_IsAskedForAName_WhenTheNameIsBlank', async () => {
    const r = await createMenuAction(payload({ name: '  ' }));
    expect(r.ok).toBe(false);
    expect(mocks.createMenuWith).not.toHaveBeenCalled();
  });

  it('Scout_IsToldTheMenuIsTooBig_WhenThePayloadPassesTheSizeCap', async () => {
    const r = await createMenuAction(payload({ junk: 'x'.repeat(201 * 1024) }));
    expect(r.ok === false && r.error).toMatch(/too big/);
    expect(mocks.createMenuWith).not.toHaveBeenCalled();
  });
});

describe('menu actions: malformed input never reaches the database', () => {
  it.each(['not-a-uuid', '', "x' or 1=1 --", '../../etc'])('Scout_IsRefused_WhenTheMenuIdIs_%s', async (bad) => {
    for (const r of [await saveMenuAction(bad, payload(), STAMP), await duplicateMenuAction(bad), await deleteMenuAction(bad)]) {
      expect(r.ok).toBe(false);
    }
    expect(mocks.saveMenuWith).not.toHaveBeenCalled();
    expect(mocks.duplicateMenuWith).not.toHaveBeenCalled();
    expect(mocks.deleteMenuWith).not.toHaveBeenCalled();
    expect(mocks.loadMenuWith).not.toHaveBeenCalled();
  });

  it.each(['yesterday', '', 'NaN'])('Scout_IsRefused_WhenTheVersionStampIs_%s', async (bad) => {
    const r = await saveMenuAction(ID, payload(), bad);
    expect(r.ok).toBe(false);
    expect(mocks.saveMenuWith).not.toHaveBeenCalled();
  });

  it('Scout_IsRefused_WhenTheVersionStampIsNotAString', async () => {
    const r = await saveMenuAction(ID, payload(), undefined as unknown as string);
    expect(r.ok).toBe(false);
  });

  it('Scout_GetsAResultNotAThrow_WhenTheStoreFindsNothing', async () => {
    mocks.duplicateMenuWith.mockResolvedValue(null);
    expect((await duplicateMenuAction(ID)).ok).toBe(false);
  });
});

describe('menu actions: the outing link', () => {
  it('Scout_KeepsTheOuting_WhenItIsOneTheyMayPick', async () => {
    mocks.loadOutingsWith.mockResolvedValue([{ id: 12 }]);
    await createMenuAction(payload({ calendarEntryId: 12 }));
    expect(mocks.createMenuWith.mock.calls[0][2].calendarEntryId).toBe(12);
  });

  it('Scout_LosesTheOuting_WhenItIsADraftOrOffCategoryEntry', async () => {
    mocks.loadOutingsWith.mockResolvedValue([{ id: 12 }]);
    await createMenuAction(payload({ calendarEntryId: 99 }));
    expect(mocks.createMenuWith.mock.calls[0][2].calendarEntryId).toBeNull();
  });

  it('Scout_KeepsTheLinkedPastOuting_WhenSavingAnExistingMenu', async () => {
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 39, menu: { calendarEntryId: 5 } });
    mocks.loadOutingsWith.mockResolvedValue([{ id: 5 }]);
    await saveMenuAction(ID, payload({ calendarEntryId: 5 }), STAMP);
    expect(mocks.loadOutingsWith.mock.calls[0][2]).toEqual([5]);
    expect(mocks.saveMenuWith.mock.calls[0][3].calendarEntryId).toBe(5);
  });

  it('Scout_CannotLinkSomeoneElsesLinkedOuting_ByNamingAnotherScoutsMenu', async () => {
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 7, menu: { calendarEntryId: 5 } });
    await saveMenuAction(ID, payload({ calendarEntryId: 5 }), STAMP);
    expect(mocks.loadOutingsWith.mock.calls[0][2]).toEqual([]);
  });

  it('Scout_SkipsTheOutingLookup_WhenNoOutingIsChosen', async () => {
    await createMenuAction(payload());
    expect(mocks.loadOutingsWith).not.toHaveBeenCalled();
  });
});
