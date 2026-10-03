import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadAuthoringCatalogWith, loadCatalogWith } from '../src/lib/menu-monster/catalog';
import { isPickable } from '../src/lib/menu-monster/scout-recipes';

/**
 * Phase 4A: who sees which scout recipe. The menu-side catalog carries published
 * + retired recipes (so a menu keeps a retired one) and only its owner's drafts;
 * the leader tools never see a scout's unshared draft. Rows are S-0000ac** ids.
 */
const SCOUT = 39;
const OTHER = 25;
const DRAFT = 'S-0000ac01';
const SHARED = 'S-0000ac02';
const RETIRED = 'S-0000ac03';
const admin = adminClient();

beforeAll(async () => {
  await cleanup();
  const now = new Date().toISOString();
  const { error } = await admin.from('mm_recipes').insert([
    { id: DRAFT, name: 'vitest draft', status: 'draft', meal_fit: ['dinner'], author_person_id: SCOUT },
    { id: SHARED, name: 'vitest shared', status: 'published', meal_fit: ['dinner'], author_person_id: SCOUT, shared_at: now, attribution_label: 'Charlie W.' },
    { id: RETIRED, name: 'vitest retired', status: 'retired', meal_fit: ['dinner'], author_person_id: SCOUT, shared_at: now, attribution_label: 'Charlie W.' }
  ]);
  if (error) throw new Error(`fixture: ${error.message}`);
});

async function cleanup() {
  await admin.from('mm_recipes').delete().like('id', 'S-0000ac%');
}
afterEach(() => undefined);

const ids = async (owner?: number) => (await loadCatalogWith(admin, { ownerPersonId: owner ?? null })).recipes.map((r) => r.id);

describe('scout recipes in the catalog', () => {
  it('OtherScout_CannotSeeRecipe_UntilShared', async () => {
    expect(await ids(OTHER)).not.toContain(DRAFT);
  });

  it('Visitor_CannotSeeAScoutsDraft', async () => {
    expect(await ids()).not.toContain(DRAFT);
  });

  it('Scout_CanSeeOwnDraft_InTheirCatalog', async () => {
    expect(await ids(SCOUT)).toContain(DRAFT);
  });

  it('SharedRecipe_CarriesItsCredit', async () => {
    const r = (await loadCatalogWith(admin, {})).recipes.find((x) => x.id === SHARED);
    expect(r?.credit).toBe('Charlie W.');
  });

  it('Catalog_KeepsRetiredRecipes_SoMenusKeepThem', async () => {
    expect(await ids()).toContain(RETIRED);
  });

  it('RetiredRecipe_IsNotPickable', async () => {
    const r = (await loadCatalogWith(admin, {})).recipes.find((x) => x.id === RETIRED)!;
    expect(isPickable(r)).toBe(false);
  });

  it('Leader_DoesNotSeeUnsharedDrafts', async () => {
    const leaderIds = (await loadAuthoringCatalogWith(admin)).recipes.map((r) => r.id);
    expect(leaderIds.includes(DRAFT) || !leaderIds.includes(SHARED)).toBe(false);
  });

  it('Teardown_RemovesFixtures', async () => {
    await cleanup();
    expect(await ids(SCOUT)).not.toContain(DRAFT);
  });
});
