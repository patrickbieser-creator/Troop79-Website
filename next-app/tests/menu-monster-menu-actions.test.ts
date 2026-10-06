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
  loadOutingsWith: vi.fn(),
  resolveMealGearWith: vi.fn(),
  actor: null as unknown
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  verifyIdentitySession: async () => mocks.session,
  isEpochCurrent: async () => mocks.epochCurrent
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async () => [5] }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => mocks.actor }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => CATALOG }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: mocks.loadOutingsWith }));
// The real resolver is db-tested (menu-monster-gear-store-db); here only the wiring is observable.
vi.mock('@/lib/menu-monster/gear-store', () => ({ resolveMealGearWith: mocks.resolveMealGearWith }));
vi.mock('@/lib/menu-monster/menus-store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/menu-monster/menus-store')>()),
  ownerCreditNamesWith: async (_sb: unknown, ids: number[]) => new Map(ids.map((id) => [id, 'Pat B.'])),
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
  mocks.actor = null;
  mocks.createMenuWith.mockResolvedValue(ID);
  mocks.saveMenuWith.mockResolvedValue({ status: 'saved', updatedAt: STAMP });
  mocks.duplicateMenuWith.mockResolvedValue(ID);
  mocks.deleteMenuWith.mockResolvedValue(true);
  mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 39, menu: { calendarEntryId: null } });
  mocks.loadOutingsWith.mockResolvedValue([]);
  mocks.resolveMealGearWith.mockImplementation(async (_sb: unknown, menu: unknown) => ({ menu, dropped: [] }));
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

  it('Adult_SavesTheirOwnMenu_AsThemselves', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5, displayName: 'Pat B.' };
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 5, menu: { calendarEntryId: null } });
    await saveMenuAction(ID, payload(), STAMP);
    expect(mocks.saveMenuWith.mock.calls[0][1]).toMatchObject({ personId: 5 });
    expect(mocks.saveMenuWith.mock.calls[0][6]).toEqual({ asLeader: false });
  });

  it('Adult_CreatesTheirOwnMenu_AsThemselves', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5, displayName: 'Pat B.' };
    await createMenuAction(payload({ ownerPersonId: 7 }));
    expect(mocks.createMenuWith.mock.calls[0][1]).toMatchObject({ personId: 5 });
  });

  it('Adult_DeletesAndDuplicates_AsThemselves', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5, displayName: 'Pat B.' };
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 5, menu: { calendarEntryId: null } });
    await Promise.all([duplicateMenuAction(ID), deleteMenuAction(ID)]);
    expect([mocks.duplicateMenuWith.mock.calls[0][1], mocks.deleteMenuWith.mock.calls[0][1]]).toEqual([
      expect.objectContaining({ personId: 5 }),
      expect.objectContaining({ personId: 5 })
    ]);
  });

  it('RevokedAdult_IsRefused_OnEveryAction', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5, displayName: 'Pat B.' };
    mocks.epochCurrent = false;
    for (const r of await Promise.all(callAll())) expect(r.ok).toBe(false);
    expect(mocks.createMenuWith).not.toHaveBeenCalled();
  });

  it('Anonymous_IsToldToSignIn_WhenSaving', async () => {
    mocks.session = null;
    expect(await saveMenuAction(ID, payload(), STAMP)).toEqual({ ok: false, error: 'Sign in to save your menu.' });
  });

  it('Leader_WithAPerson_SavesTheirOwnMenu_AsThemselves', async () => {
    mocks.session = null;
    mocks.actor = { subjectKind: 'adult', personId: 82, label: 'Patrick B.', capabilities: new Set(['library.moderate']) };
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 82, menu: { calendarEntryId: null } });
    await saveMenuAction(ID, payload(), STAMP);
    expect(mocks.saveMenuWith.mock.calls[0][1]).toMatchObject({ personId: 82 });
  });

  // Patrick, 2026-10-05: "Adult leaders need full rights to edit (and fix) scout menus before they go shopping."
  it('Leader_SavesAScoutsMenu_AsALeader_NotAsItsOwner', async () => {
    mocks.session = null;
    mocks.actor = { subjectKind: 'adult', personId: 82, label: 'Patrick B.', capabilities: new Set(['library.moderate']) };
    expect(await saveMenuAction(ID, payload(), STAMP)).toEqual({ ok: true, updatedAt: STAMP });
    expect(mocks.saveMenuWith.mock.calls[0][1]).toMatchObject({ personId: 82 });
    expect(mocks.saveMenuWith.mock.calls[0][6]).toEqual({ asLeader: true });
  });

  it('Leader_KeepsTheOutingTheScoutLinked_WhenSavingTheirMenu', async () => {
    mocks.session = null;
    mocks.actor = { subjectKind: 'adult', personId: 82, label: 'Patrick B.', capabilities: new Set(['library.moderate']) };
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 39, menu: { calendarEntryId: 5 } });
    mocks.loadOutingsWith.mockResolvedValue([{ id: 5 }]);
    await saveMenuAction(ID, payload({ calendarEntryId: 5 }), STAMP);
    expect(mocks.loadOutingsWith.mock.calls[0][2]).toEqual([5]);
    expect(mocks.saveMenuWith.mock.calls[0][3].calendarEntryId).toBe(5);
  });

  it('AdultWithNoAdminAccess_CannotSaveAScoutsMenu', async () => {
    // A parent reads their scout's menu; reading is not editing.
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5, displayName: 'Pat B.' };
    mocks.actor = { subjectKind: 'adult', personId: 5, label: 'Pat B.', capabilities: new Set() };
    expect(await saveMenuAction(ID, payload(), STAMP)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
    expect(mocks.saveMenuWith).not.toHaveBeenCalled();
  });

  it('Scout_CannotSaveAnotherScoutsMenu_EvenWhenTheirIdentityHoldsACapability', async () => {
    mocks.actor = { subjectKind: 'scout', personId: 39, label: 'Charlie W.', capabilities: new Set(['library.moderate']) };
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 7, menu: { calendarEntryId: null } });
    expect(await saveMenuAction(ID, payload(), STAMP)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
    expect(mocks.saveMenuWith).not.toHaveBeenCalled();
  });

  it('CrewScout_CannotSaveTheOutingMenuTheyCanRead', async () => {
    // A scout on the outing reads the menu and ticks gear; the plan is not theirs to change.
    mocks.session = { ...SCOUT, personId: 7 };
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 39, menu: { calendarEntryId: 5 }, entryPublished: true });
    expect(await saveMenuAction(ID, payload(), STAMP)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
    expect(mocks.saveMenuWith).not.toHaveBeenCalled();
  });

  // Patrick, 2026-10-05: "Leaders need full rights to scout menus. They often will work side by side with scouts."
  it('Leader_DeletesAndDuplicatesAScoutsMenu_AsTheScoutsMenu', async () => {
    mocks.session = null;
    mocks.actor = { subjectKind: 'adult', personId: 82, label: 'Patrick B.', capabilities: new Set(['library.moderate']) };
    expect((await duplicateMenuAction(ID)).ok).toBe(true);
    expect((await deleteMenuAction(ID)).ok).toBe(true);
    // The leader is who did it (the audit actor); the scout (39) is whose menu it is — the copy is the scout's.
    expect(mocks.duplicateMenuWith.mock.calls[0].slice(1)).toEqual([expect.objectContaining({ personId: 82 }), ID, 39]);
    expect(mocks.deleteMenuWith.mock.calls[0].slice(1)).toEqual([expect.objectContaining({ personId: 82 }), ID, 39]);
  });

  it('AdultWithNoAdminAccess_CannotDeleteOrDuplicateAScoutsMenu', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5, displayName: 'Pat B.' };
    mocks.actor = { subjectKind: 'adult', personId: 5, label: 'Pat B.', capabilities: new Set() };
    expect((await duplicateMenuAction(ID)).ok).toBe(false);
    expect((await deleteMenuAction(ID)).ok).toBe(false);
    expect(mocks.duplicateMenuWith).not.toHaveBeenCalled();
    expect(mocks.deleteMenuWith).not.toHaveBeenCalled();
  });

  it('Scout_CannotDeleteOrDuplicateAnotherScoutsMenu', async () => {
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 7, menu: { calendarEntryId: null } });
    expect((await duplicateMenuAction(ID)).ok).toBe(false);
    expect((await deleteMenuAction(ID)).ok).toBe(false);
    expect(mocks.deleteMenuWith).not.toHaveBeenCalled();
  });

  it('Anyone_IsToldTheMenuIsntTheirs_WhenItDoesNotExist', async () => {
    mocks.loadMenuWith.mockResolvedValue(null);
    expect(await saveMenuAction(ID, payload(), STAMP)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
    expect(mocks.saveMenuWith).not.toHaveBeenCalled();
  });

  it('Leader_WithoutAPerson_IsRefused', async () => {
    // A legacy leader cookie resolves to no one person, so there is nobody to own a menu.
    mocks.session = null;
    mocks.actor = { subjectKind: 'adult', personId: null, label: 'Leader', capabilities: new Set(['library.moderate']) };
    expect((await createMenuAction(payload())).ok).toBe(false);
  });

  it('Leader_WithoutAScoutIdentity_IsRefused', async () => {
    // No identity cookie and no leader actor: anonymous.
    mocks.session = null;
    expect((await createMenuAction(payload())).ok).toBe(false);
  });

  it('Adult_IsToldTheMenuIsntTheirs_WhenSavingSomeoneElsesMenu', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5, displayName: 'Pat B.' };
    mocks.saveMenuWith.mockResolvedValue({ status: 'not_found' });
    expect(await saveMenuAction(ID, payload(), STAMP)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
  });

  it('Adult_IsToldTheMenuIsntTheirs_WhenDeletingSomeoneElsesMenu', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5, displayName: 'Pat B.' };
    mocks.deleteMenuWith.mockResolvedValue(false);
    expect(await deleteMenuAction(ID)).toMatchObject({ ok: false });
  });

  it('LegacyLeaderCookie_CannotSaveDeleteOrDuplicate_WithNoIdentitySession', async () => {
    mocks.session = null;
    const results = await Promise.all([saveMenuAction(ID, payload(), STAMP), duplicateMenuAction(ID), deleteMenuAction(ID)]);
    for (const r of results) expect(r.ok).toBe(false);
    expect(mocks.saveMenuWith).not.toHaveBeenCalled();
    expect(mocks.deleteMenuWith).not.toHaveBeenCalled();
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
    expect(r.ok === false && r.error).toMatch(/changed since you opened it, in another window or by someone else/);
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
    // Someone else's menu is refused outright, before any outing is looked up or anything is written.
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 7, menu: { calendarEntryId: 5 } });
    expect(await saveMenuAction(ID, payload({ calendarEntryId: 5 }), STAMP)).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
    expect(mocks.loadOutingsWith).not.toHaveBeenCalled();
    expect(mocks.saveMenuWith).not.toHaveBeenCalled();
  });

  it('Scout_SkipsTheOutingLookup_WhenNoOutingIsChosen', async () => {
    await createMenuAction(payload());
    expect(mocks.loadOutingsWith).not.toHaveBeenCalled();
  });
});

describe('menu actions: gear for a meal is kept to the troop’s list', () => {
  const MEAL = { id: 'm1', day: 0, slot: 'breakfast', headcount: null, recipeIds: [], gear: ['Soap', 'Wash basin'] };

  it('Save_HandsTheMealGearToTheResolver_AndSavesWhatItKept', async () => {
    mocks.resolveMealGearWith.mockImplementation(async (_sb: unknown, menu: { meals: object[] }) => ({ menu: { ...menu, meals: menu.meals.map((m) => ({ ...m, gear: ['Soap'] })) }, dropped: ['Wash basin'] }));
    const res = await saveMenuAction(ID, payload({ meals: [MEAL] }), STAMP);
    expect(mocks.resolveMealGearWith.mock.calls[0][1].meals[0].gear).toEqual(['Soap', 'Wash basin']);
    expect(mocks.saveMenuWith.mock.calls[0][3].meals[0].gear).toEqual(['Soap']);
    expect(res).toEqual({ ok: true, updatedAt: STAMP, dropped: ['Wash basin'] });
  });

  it('Save_ChecksRetiredGearAgainstTheMenuAsStored', async () => {
    const stored = { calendarEntryId: null, meals: [MEAL] };
    mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 39, menu: stored });
    await saveMenuAction(ID, payload({ meals: [MEAL] }), STAMP);
    expect(mocks.resolveMealGearWith.mock.calls[0][2]).toBe(stored);
  });

  it('Save_SaysNothingAboutGear_WhenNothingWasDropped', async () => {
    expect(await saveMenuAction(ID, payload({ meals: [MEAL] }), STAMP)).toEqual({ ok: true, updatedAt: STAMP });
  });

  it('Create_ReportsDroppedMealGear_Too', async () => {
    mocks.resolveMealGearWith.mockImplementation(async (_sb: unknown, menu: unknown) => ({ menu, dropped: ['Wash basin'] }));
    expect(await createMenuAction(payload({ meals: [MEAL] }))).toEqual({ ok: true, id: ID, dropped: ['Wash basin'] });
  });
});
