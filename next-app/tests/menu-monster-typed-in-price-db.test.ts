import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * A price for a food somebody typed in on the fly (addScoutPackageAction; production 2026-10-06, Hot Chocolate
 * had no price). Only the author prices their unkept typed-in; a leader on the author's menu prices it AS the
 * author; another scout cannot. The first price goes live. Request glue is mocked at the session seams only;
 * the store, the menu lookup and mm_add_brand are real.
 *
 * Fixtures: one typed-in ingredient and one menu owned by person 39, named "ZZ Typedprice …"; removed afterwards.
 */
const admin = adminClient();
const OWNER = 39;
const LEADER = 25;
const ING = 'x-0deadbed';
const MENU_NAME = 'ZZ Typedprice menu';
let MENU = '';

const who = vi.hoisted(() => ({
  kind: 'leader' as 'leader' | 'scout',
  personId: 25,
  name: 'ZZ Typedprice Leader'
}));

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/family-access', () => ({
  requireVerifiedScoutIdentity: async () => {
    if (who.kind !== 'scout') throw new Error('Sign in to save your menu.');
    return { personId: who.personId, displayName: who.name };
  }
}));
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => (who.kind === 'leader' ? { personId: who.personId, label: who.name, subjectKind: 'adult', capabilities: new Set(['roster.view']) } : null)
}));
vi.mock('../src/app/(public)/library/menu-monster/menus/_components/scout-menus', () => ({
  menuViewer: async () => ({ kind: who.kind, personId: who.personId, label: who.name }),
  recipeAuthor: async () => ({ personId: who.personId, displayName: who.name })
}));

// data.ts is the server-only wrapper around the real loader; the loader itself is what runs here.
vi.mock('@/lib/menu-monster/data', async () => {
  const { loadCatalogWith } = await import('../src/lib/menu-monster/catalog');
  return { loadMenuMonsterCatalog: (ownerPersonId: number | null) => loadCatalogWith(adminClient(), { ownerPersonId }) };
});

import { addScoutPackageAction } from '../src/app/(public)/library/_tools/menu-monster/menu-actions';

const PKG = { ingredientId: ING, name: 'ZZ Typedprice box', store: '', size: 10, sizeUnit: 'count', price: 4.5 };

async function cleanup() {
  await admin.from('mm_packages').delete().eq('ingredient_id', ING);
  await admin.from('mm_menus').delete().eq('name', MENU_NAME);
  await admin.from('mm_ingredients').delete().eq('id', ING);
  await admin.from('audit_log').delete().like('summary', '%ZZ Typedprice%');
}

beforeAll(async () => {
  await cleanup();
  const ing = { id: ING, name: 'ZZ Typedprice cocoa', unit_kind: 'count', unit_key: 'count', unit_one: 'cup', unit_many: 'cups', section: 'beverage', staple: false, avoid: [], added_by_person_id: OWNER, needs_match_at: new Date().toISOString() };
  const a = await admin.from('mm_ingredients').insert(ing);
  if (a.error) throw new Error(a.error.message);
  const m = await admin.from('mm_menus').insert({ owner_person_id: OWNER, name: MENU_NAME, context: 'camp', headcount: 8 }).select('id').single();
  if (m.error) throw new Error(m.error.message);
  MENU = m.data.id as string;
});
afterAll(cleanup);
beforeEach(async () => {
  await admin.from('mm_packages').delete().eq('ingredient_id', ING);
  who.kind = 'scout';
  who.personId = OWNER;
});

describe('addScoutPackageAction on a typed-in food', () => {
  it('Scout_PricesTheirOwnTypedIn_AfterAddingItOnTheFly', async () => {
    const res = await addScoutPackageAction(PKG);
    expect(res).toMatchObject({ ok: true, status: 'live' });
    const { data } = await admin.from('mm_packages').select('added_by_person_id, held_at').eq('ingredient_id', ING);
    expect(data).toEqual([{ added_by_person_id: OWNER, held_at: null }]);
  });

  it('Leader_PricesAScoutsTypedIn_WhileHelpingOnTheirMenu', async () => {
    who.kind = 'leader';
    who.personId = LEADER;
    const res = await addScoutPackageAction(PKG, MENU);
    expect(res).toMatchObject({ ok: true, status: 'live' });
    const { data } = await admin.from('mm_packages').select('added_by_person_id').eq('ingredient_id', ING);
    expect(data?.map((p) => p.added_by_person_id)).toEqual([OWNER]);
  });

  it('Scout_CannotPrice_AnotherScoutsTypedIn', async () => {
    who.personId = LEADER; // another scout, not the owner
    const res = await addScoutPackageAction(PKG);
    expect(res.ok).toBe(false);
    const { data } = await admin.from('mm_packages').select('id').eq('ingredient_id', ING);
    expect(data).toEqual([]);
  });
});
