import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { IdentitySession } from '../src/lib/identity-session';

/**
 * addFoodToMealAction (menu-actions.ts, Patrick 2026-10-06): the typed-in and the scout's one-line recipe
 * for it, both under the menu's OWNER, refusals in words. The stores are stubs (the db tests cover them);
 * the scout session check is REAL, only its cookie and epoch read are faked.
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  actor: null as unknown,
  loadMenuWith: vi.fn(),
  addMenuIngredientWith: vi.fn(),
  listMyRecipesWith: vi.fn(),
  saveScoutRecipeWith: vi.fn()
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  verifyIdentitySession: async () => mocks.session,
  isEpochCurrent: async () => true
}));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => mocks.actor }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async () => [5] }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => CATALOG }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: async () => [], loadPatrolNamesWith: async () => [], loadScoutPatrolWith: async () => null }));
vi.mock('@/lib/menu-monster/menus-store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/menu-monster/menus-store')>()),
  ownerCreditNamesWith: async (_sb: unknown, ids: number[]) => new Map(ids.map((id) => [id, 'Pat B.'])),
  loadMenuWith: mocks.loadMenuWith,
  addMenuIngredientWith: mocks.addMenuIngredientWith
}));
vi.mock('@/lib/menu-monster/scout-recipes-store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/menu-monster/scout-recipes-store')>()),
  listMyRecipesWith: mocks.listMyRecipesWith,
  saveScoutRecipeWith: mocks.saveScoutRecipeWith
}));

import { addFoodToMealAction } from '../src/app/(public)/library/_tools/menu-monster/menu-actions';

const SCOUT = { role: 'identity', subjectKind: 'scout', personId: 39, householdKey: 'h', displayName: 'Charlie W.', epoch: 1, iat: 0 } as IdentitySession;
const LEADER = { kind: 'identity', subjectKind: 'adult', label: 'Pat B.', personId: 5, capabilities: new Set(['roster.view']) };
const ID = '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f';

const food = (over: Record<string, unknown> = {}, ing: Record<string, unknown> = {}) => ({
  ingredient: { key: 'new:0000beef', name: 'Kool-Aid', section: 'beverage', kind: 'count', one: 'packet', many: 'packets', avoid: [], ...ing },
  eachPerson: 1,
  mealSlot: 'snack',
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.actor = null;
  mocks.loadMenuWith.mockResolvedValue({ ownerPersonId: 39, menu: { calendarEntryId: null } });
  mocks.addMenuIngredientWith.mockResolvedValue({ status: 'added', id: 'x-0000beef' });
  mocks.listMyRecipesWith.mockResolvedValue([]);
  mocks.saveScoutRecipeWith.mockResolvedValue({ status: 'saved', id: 'S-0000beef', updatedAt: 't', ids: {} });
});

describe('addFoodToMealAction', () => {
  it('Scout_AddsAFood_AsTheirIngredientAndTheirRecipe', async () => {
    expect(await addFoodToMealAction(food())).toEqual({ ok: true, ingredientId: 'x-0000beef', recipeId: 'S-0000beef', name: 'Kool-Aid' });
    expect(mocks.addMenuIngredientWith).toHaveBeenCalledWith({ stub: true }, { personId: 39, label: 'Charlie W.' }, expect.objectContaining({ name: 'Kool-Aid', section: 'beverage', size: 0, price: 0 }));
  });

  it('Recipe_IsNamedForTheFood_FitsTheSlot_HasOneLineOnTheNewIngredient', async () => {
    await addFoodToMealAction(food({ eachPerson: 2 }));
    const [, , draft, expected] = mocks.saveScoutRecipeWith.mock.calls[0];
    expect([draft, expected]).toEqual([expect.objectContaining({ id: null, name: 'Kool-Aid', mealFit: ['snack'], foodGroups: [], steps: [], lines: [{ ingredientId: 'x-0000beef', qtyPerPerson: 2, unitKey: null }] }), null]);
  });

  it('MissingSection_IsRefused_NothingIsWritten', async () => {
    const res = await addFoodToMealAction(food({}, { section: undefined }));
    expect(res).toEqual({ ok: false, error: 'Can’t save yet: pick what kind of food it is.' });
    expect([mocks.addMenuIngredientWith.mock.calls.length, mocks.saveScoutRecipeWith.mock.calls.length]).toEqual([0, 0]);
  });

  it('ABookName_IsRefused_ThatOffersTheExistingFood', async () => {
    const res = await addFoodToMealAction(food({}, { name: 'orange juice' }));
    expect(res).toMatchObject({ ok: false, existingIngredientId: 'oj' });
    expect(mocks.addMenuIngredientWith).not.toHaveBeenCalled();
  });

  it('AnExistingFood_GetsOnlyTheRecipe', async () => {
    const res = await addFoodToMealAction({ existingIngredientId: 'oj', mealSlot: 'breakfast' });
    expect(res).toMatchObject({ ok: true, ingredientId: 'oj', name: 'Orange juice' });
    expect(mocks.addMenuIngredientWith).not.toHaveBeenCalled();
  });

  it('TenWaitingIngredients_IsExplained_AndNoRecipeIsMade', async () => {
    mocks.addMenuIngredientWith.mockResolvedValue({ status: 'ingredient_cap' });
    const res = await addFoodToMealAction(food());
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('10 new ingredients') });
    expect(mocks.saveScoutRecipeWith).not.toHaveBeenCalled();
  });

  it('AFullRecipeShelf_IsRefusedInWords_BeforeAnythingIsWritten', async () => {
    mocks.listMyRecipesWith.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: `S-${i}`, status: 'draft' })));
    const res = await addFoodToMealAction(food());
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('25 recipes') });
    expect(mocks.addMenuIngredientWith).not.toHaveBeenCalled();
  });

  it('RetiredRecipes_DoNotCountAgainstTheShelf', async () => {
    mocks.listMyRecipesWith.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: `S-${i}`, status: i === 0 ? 'retired' : 'draft' })));
    expect((await addFoodToMealAction(food())).ok).toBe(true);
  });

  it('ARecipeSaveThatSaysCap_IsExplainedToo', async () => {
    mocks.saveScoutRecipeWith.mockResolvedValue({ status: 'cap' });
    expect(await addFoodToMealAction(food())).toMatchObject({ ok: false, error: expect.stringContaining('25 recipes') });
  });

  it('SignedOut_IsToldToSignIn', async () => {
    mocks.session = null;
    expect(await addFoodToMealAction(food())).toMatchObject({ ok: false });
    expect(mocks.addMenuIngredientWith).not.toHaveBeenCalled();
  });

  it('Leader_OnAScoutsMenu_FilesBothUnderTheScout', async () => {
    mocks.session = null;
    mocks.actor = LEADER;
    await addFoodToMealAction(food(), ID);
    const owner = { personId: 39, label: 'Pat B. (a leader, on their menu)' };
    expect([mocks.addMenuIngredientWith.mock.calls[0][1], mocks.saveScoutRecipeWith.mock.calls[0][1]]).toEqual([owner, owner]);
  });

  it('OversizedPayload_IsRefused', async () => {
    expect(await addFoodToMealAction(food({ junk: 'x'.repeat(5000) }))).toMatchObject({ ok: false });
  });
});
