import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { cleanupTypedIns } from './helpers/typed-in-cleanup';
import { keepTypedInWith, listTypedInsWith, rejectTypedInWith, submitIngredientWith } from '../src/lib/menu-monster/scout-recipes-store';
import { loadAuthoringCatalogWith, loadCatalogWith } from '../src/lib/menu-monster/catalog';
import type { NewIngredient } from '../src/lib/menu-monster/scout-ingredients';

/**
 * Asking for an ingredient from the public Ingredients tab
 * (20261006100000_mm_submit_ingredient.sql): the request is a typed-in marked
 * submitted_at — private to the person who asked, listed for a leader, safe
 * from the orphan cleanup — until a leader keeps it (it joins the book) or
 * rejects it (it leaves the queue). Every x- row is removed after each test,
 * as in menu-monster-scout-ingredients-db.test.ts.
 */
const SCOUT = 39;
const OTHER = 25;
const admin = adminClient();

afterEach(async () => {
  await cleanupTypedIns(admin);
});

const cookies = (over: Partial<NewIngredient> = {}): NewIngredient => ({
  key: 'new:0000c00c', name: 'Vitest cookies', kind: 'count', one: 'cookie', many: 'cookies', avoid: ['gf'], section: 'dry', size: 36, price: 4.29, store: 'Kroger', ...over
});

async function submit(person = SCOUT, n = cookies()) {
  const res = await submitIngredientWith(admin, person, n);
  if (res.status !== 'added') throw new Error(`submit: ${res.status}`);
  return res.id;
}
const has = async (owner: number | null, id: string) => (await loadCatalogWith(admin, { ownerPersonId: owner })).ingredients.find((i) => i.id === id);

describe('asking for an ingredient from the Ingredients tab', () => {
  it('Request_IsATypedIn_MarkedSubmitted_WithItsPackage', async () => {
    const id = await submit();
    expect(id).toMatch(/^x-[0-9a-f]{8}$/);
    const { data: ing } = await admin.from('mm_ingredients').select('name, added_by_person_id, needs_match_at, submitted_at, shared_at').eq('id', id).single();
    expect({ ...ing, needs_match_at: ing!.needs_match_at != null, submitted_at: ing!.submitted_at != null }).toEqual({
      name: 'Vitest cookies', added_by_person_id: SCOUT, needs_match_at: true, submitted_at: true, shared_at: null
    });
    const { data: pkg } = await admin.from('mm_packages').select('price, yield').eq('ingredient_id', id).single();
    expect({ price: Number(pkg!.price), yield: Number(pkg!.yield) }).toEqual({ price: 4.29, yield: 36 });
  });

  it('Request_ShowsOnlyToThePersonWhoAsked_UntilALeaderDecides', async () => {
    const id = await submit();
    expect(await has(SCOUT, id)).toMatchObject({ waiting: true, needsMatch: true });
    expect(await has(OTHER, id)).toBeUndefined();
    expect(await has(null, id)).toBeUndefined();
    expect((await loadAuthoringCatalogWith(admin)).ingredients.find((i) => i.id === id)).toBeUndefined();
  });

  it('Request_IsListedForALeader_AsARequest', async () => {
    const id = await submit();
    const row = (await listTypedInsWith(admin)).find((t) => t.id === id);
    expect(row).toMatchObject({ name: 'Vitest cookies', requested: true, usedIn: [], pkg: { price: 4.29, size: 36, store: 'Kroger' } });
  });

  it('Request_SurvivesTheOrphanCleanup_ThoughNothingUsesIt', async () => {
    const id = await submit();
    await admin.from('mm_ingredients').update({ created_at: '2026-01-01T00:00:00Z' }).eq('id', id);
    const { error } = await admin.rpc('mm_drop_orphan_typed_ins', { p_person: SCOUT });
    expect(error).toBeNull();
    const { data } = await admin.from('mm_ingredients').select('id').eq('id', id);
    expect(data).toHaveLength(1);
  });

  it('Request_CannotCopyABookName', async () => {
    const { data } = await admin.from('mm_ingredients').select('name').is('retired_at', null).is('added_by_person_id', null).limit(1).single();
    const res = await submitIngredientWith(admin, SCOUT, cookies({ name: (data!.name as string).toUpperCase() }));
    expect(res).toEqual({ status: 'duplicate_ingredient' });
  });

  it('Keep_PutsTheRequestInEveryonesCatalog', async () => {
    const id = await submit();
    expect(await keepTypedInWith(admin, id, 'bakery', ['gf'])).toBe('Vitest cookies');
    const seen = await has(null, id);
    expect(seen).toMatchObject({ name: 'Vitest cookies', section: 'bakery', avoid: ['gf'] });
    expect(seen?.waiting).toBeUndefined();
    expect(seen?.needsMatch).toBeUndefined();
    expect((await listTypedInsWith(admin)).find((t) => t.id === id)).toBeUndefined();
  });

  it('Reject_RemovesARequestNothingUses_SoItNeverHoldsTheCapOrTheName', async () => {
    const id = await submit();
    expect(await rejectTypedInWith(admin, id)).toBe('Vitest cookies');
    expect((await listTypedInsWith(admin)).find((t) => t.id === id)).toBeUndefined();
    const { data } = await admin.from('mm_ingredients').select('id').eq('id', id);
    expect(data).toHaveLength(0);
    const { data: pkgs } = await admin.from('mm_packages').select('id').eq('ingredient_id', id);
    expect(pkgs).toHaveLength(0);
    // Deciding twice is refused; asking again under the same name is not.
    expect(await rejectTypedInWith(admin, id)).toBeNull();
    expect((await submitIngredientWith(admin, SCOUT, cookies())).status).toBe('added');
  });

  it('Reject_LeavesARequestItsAuthorsOwnDraftUses_AsAPrivateTypedIn', async () => {
    const id = await submit();
    await admin.from('mm_recipes').insert({ id: 'S-0000ad01', name: 'Vitest cookie plate', status: 'draft', author_person_id: SCOUT, sort_order: 1000 });
    await admin.from('mm_recipe_lines').insert({ recipe_id: 'S-0000ad01', position: 0, ingredient_id: id, qty_per_person: 2, serves_rule: 'everyone' });
    try {
      // The leader sees the request, never the private draft's name.
      expect((await listTypedInsWith(admin)).find((t) => t.id === id)).toMatchObject({ requested: true, usedIn: [] });
      expect(await rejectTypedInWith(admin, id)).toBe('Vitest cookies');
      expect((await listTypedInsWith(admin)).find((t) => t.id === id)).toBeUndefined();
      expect(await has(null, id)).toBeUndefined();
      const mine = await has(SCOUT, id);
      expect(mine).toMatchObject({ needsMatch: true });
      expect(mine?.waiting).toBeUndefined();
    } finally {
      await admin.from('mm_recipe_lines').delete().eq('recipe_id', 'S-0000ad01');
      await admin.from('mm_recipes').delete().eq('id', 'S-0000ad01');
    }
  });

  it('Reject_OnlyAppliesToARequest_NeverToATypedInAShareRevealed', async () => {
    const id = await submit();
    await admin.from('mm_ingredients').update({ shared_at: new Date().toISOString() }).eq('id', id);
    expect(await rejectTypedInWith(admin, id)).toBeNull();
  });
});
