import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { IdentitySession } from '../src/lib/identity-session';

/**
 * Phase 4A scout recipe actions (recipe-actions.ts): the verified-scout gate, the
 * author is always the session, and the friendly messages. The store has its own
 * db tests; here it is a stub. The session check is REAL — only the cookie and the
 * epoch read underneath it are faked (the menu-actions precedent).
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  epochCurrent: true,
  save: vi.fn(),
  share: vi.fn(),
  del: vi.fn(),
  resolveGear: vi.fn()
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  verifyIdentitySession: async () => mocks.session,
  isEpochCurrent: async () => mocks.epochCurrent
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async () => [39] }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null }));
vi.mock('@/lib/menu-monster/menus-store', async (orig) => ({
  ...(await orig<object>()),
  ownerCreditNamesWith: async (_sb: unknown, ids: number[]) => new Map(ids.map((id) => [id, 'Pat W.']))
}));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => CATALOG }));
// Gear is resolved against the troop's master list (gear-store has its own db tests); here it is a stub.
vi.mock('@/lib/menu-monster/gear-store', () => ({ resolveGearWith: mocks.resolveGear, storedRecipeGearWith: async () => [] }));
vi.mock('@/lib/menu-monster/scout-recipes-store', () => ({
  saveScoutRecipeWith: mocks.save,
  shareScoutRecipeWith: mocks.share,
  deleteScoutDraftWith: mocks.del
}));

import { deleteScoutRecipeAction, saveScoutRecipeAction, shareScoutRecipeAction } from '../src/app/(public)/library/_tools/menu-monster/recipe-actions';

const SCOUT: IdentitySession = { role: 'identity', subjectKind: 'scout', personId: 39, householdKey: 'h', displayName: 'Charlie W.', epoch: 1, iat: 0 } as IdentitySession;
const ID = 'S-0000abcd';
const STAMP = '2026-10-02T12:00:00.000Z';
const payload = (over: Record<string, unknown> = {}) => ({ name: 'Chili', mealFit: ['dinner'], lines: [{ ingredientId: 'bacon', qtyPerPerson: 2, unitKey: null }], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.epochCurrent = true;
  mocks.save.mockResolvedValue({ status: 'saved', id: ID, updatedAt: STAMP });
  mocks.share.mockResolvedValue({ status: 'shared', credit: 'Charlie W.' });
  mocks.del.mockResolvedValue({ status: 'deleted' });
  mocks.resolveGear.mockImplementation(async (_sb: unknown, entries: string[]) => ({ kept: entries, dropped: [] }));
});

describe('recipe actions: the gate', () => {
  it('Visitor_IsRefused_OnEveryAction', async () => {
    mocks.session = null;
    const all = await Promise.all([saveScoutRecipeAction(payload(), null), shareScoutRecipeAction(ID), deleteScoutRecipeAction(ID)]);
    expect(all.every((r) => r.ok === false)).toBe(true);
  });

  it('Visitor_ReachesNoStore', async () => {
    mocks.session = null;
    await Promise.all([saveScoutRecipeAction(payload(), null), shareScoutRecipeAction(ID), deleteScoutRecipeAction(ID)]);
    expect([mocks.save, mocks.share, mocks.del].some((m) => m.mock.calls.length > 0)).toBe(false);
  });
});

describe('recipe actions: the author is the session', () => {
  it('Scout_RecipeOwner_IgnoresClientSentPerson', async () => {
    await saveScoutRecipeAction(payload({ authorPersonId: 7, author_person_id: 7 }), null);
    expect(mocks.save.mock.calls[0][1]).toMatchObject({ personId: 39 });
  });

  it('Draft_SentToTheStore_CarriesNoPerson', async () => {
    await saveScoutRecipeAction(payload({ authorPersonId: 7 }), null);
    expect(mocks.save.mock.calls[0][2]).not.toHaveProperty('authorPersonId');
  });
});

describe('recipe actions: save', () => {
  it('Save_ReturnsTheIdAndVersion', async () => {
    expect(await saveScoutRecipeAction(payload(), null)).toEqual({ ok: true, id: ID, updatedAt: STAMP, dropped: [] });
  });

  it('Save_StoresOnlyTheGearTheMasterListKept_AndSaysWhatItDropped', async () => {
    mocks.resolveGear.mockResolvedValue({ kept: ['Skillet'], dropped: ['Ladle'] });
    const res = await saveScoutRecipeAction(payload({ equipment: ['skillet', 'Ladle'] }), null);
    expect(res).toMatchObject({ ok: true, dropped: ['Ladle'] });
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ equipment: ['Skillet'] });
  });

  it('Save_NeedsAName', async () => {
    expect(await saveScoutRecipeAction(payload({ name: '  ' }), null)).toEqual({ ok: false, error: 'Give your recipe a name.' });
  });

  it('Save_ExplainsAConflict', async () => {
    mocks.save.mockResolvedValue({ status: 'conflict' });
    expect(await saveScoutRecipeAction(payload({ id: ID }), STAMP)).toEqual({ ok: false, error: 'This recipe changed somewhere else. Reload it, then make your change again.' });
  });

  it('Save_ExplainsTheCap', async () => {
    mocks.save.mockResolvedValue({ status: 'cap' });
    expect(await saveScoutRecipeAction(payload(), null)).toEqual({ ok: false, error: 'You have 25 recipes. Delete a draft you don’t need to make room.' });
  });
});

describe('recipe actions: share and delete', () => {
  it('Share_ReturnsTheCredit', async () => {
    expect(await shareScoutRecipeAction(ID)).toEqual({ ok: true, credit: 'Charlie W.' });
  });

  it('Share_ExplainsWhatIsMissing', async () => {
    mocks.share.mockResolvedValue({ status: 'not_ready' });
    expect(await shareScoutRecipeAction(ID)).toEqual({ ok: false, error: 'Save it with at least one meal and one ingredient, then share.' });
  });

  it('Delete_ExplainsAMenuStillUsesIt', async () => {
    mocks.del.mockResolvedValue({ status: 'in_use' });
    expect(await deleteScoutRecipeAction(ID)).toEqual({ ok: false, error: 'One of your menus uses this recipe. Take it off the menu first.' });
  });
});

describe('recipe actions: anyone signed in writes recipes (release 6)', () => {
  const PARENT = { ...SCOUT, subjectKind: 'adult', personId: 50, displayName: 'Patricia Walters' } as IdentitySession;

  it('Parent_SavesARecipe_AsThemselves', async () => {
    mocks.session = PARENT;
    await saveScoutRecipeAction(payload({ authorPersonId: 7 }), null);
    expect(mocks.save.mock.calls[0][1]).toEqual({ personId: 50, label: 'Pat W.' });
  });

  it('Parent_CanShareAndDelete', async () => {
    mocks.session = PARENT;
    const [shared, deleted] = [await shareScoutRecipeAction(ID), await deleteScoutRecipeAction(ID)];
    expect([shared.ok, deleted.ok]).toEqual([true, true]);
  });

  it('Parent_IsRefused_WhenTheSignInWasRevoked', async () => {
    mocks.session = PARENT;
    mocks.epochCurrent = false;
    expect((await saveScoutRecipeAction(payload(), null)).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('Scout_IsRefused_WhenTheSignInWasRevoked_NotLetInAsSomeoneElse', async () => {
    mocks.epochCurrent = false;
    expect((await saveScoutRecipeAction(payload(), null)).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
