import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * A brand typed for an ingredient somebody typed in (brand-actions.ts addBrandAction, production 2026-10-06:
 * a leader added Hot Chocolate on a scout's menu, then "Swiss Miss" as its brand and was told the ingredient
 * was gone). A typed-in is private to its owner, so while a leader helps on the owner's menu the brand is
 * added AS the owner (the same rule as typed-in packages); the audit row still names the leader. Without a
 * menu, or from another scout, the privacy rule holds. Request glue is mocked at the session seams only;
 * the store, the menu lookup and mm_add_brand are real.
 *
 * Fixtures: one typed-in ingredient and one menu owned by person 39, named "ZZ Typedin …"; removed afterwards.
 */
const admin = adminClient();
const OWNER = 39;
const LEADER = 25;
const ING = 'x-0deadbee';
const MENU_NAME = 'ZZ Typedin menu';
let MENU = '';

const who = vi.hoisted(() => ({
  kind: 'leader' as 'leader' | 'scout',
  personId: 25,
  name: 'ZZ Typedin Leader'
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

import { addBrandAction } from '../src/app/(public)/library/_tools/menu-monster/brand-actions';

async function cleanup() {
  await admin.from('mm_brands').delete().eq('ingredient_id', ING);
  await admin.from('mm_menus').delete().eq('name', MENU_NAME);
  await admin.from('mm_ingredients').delete().eq('id', ING);
  await admin.from('audit_log').delete().like('summary', '%ZZ Typedin%');
}

beforeAll(async () => {
  await cleanup();
  const ing = { id: ING, name: 'ZZ Typedin cocoa', unit_kind: 'count', unit_key: 'count', unit_one: 'cup', unit_many: 'cups', section: 'bakery', staple: false, avoid: [], added_by_person_id: OWNER };
  const a = await admin.from('mm_ingredients').insert(ing);
  if (a.error) throw new Error(a.error.message);
  const m = await admin.from('mm_menus').insert({ owner_person_id: OWNER, name: MENU_NAME, context: 'camp', headcount: 8 }).select('id').single();
  if (m.error) throw new Error(m.error.message);
  MENU = m.data.id as string;
});
afterAll(cleanup);
beforeEach(async () => {
  await admin.from('mm_brands').delete().eq('ingredient_id', ING);
  who.kind = 'leader';
  who.personId = LEADER;
});

describe('addBrandAction on a typed-in ingredient', () => {
  it('Leader_AddsABrand_ToAScoutsTypedIn_WhileHelpingOnTheirMenu', async () => {
    const res = await addBrandAction(ING, 'ZZ Typedin Swiss', MENU);
    expect(res).toMatchObject({ ok: true });
    const { data } = await admin.from('mm_brands').select('added_by_person_id').eq('ingredient_id', ING);
    expect(data?.map((b) => b.added_by_person_id)).toEqual([OWNER]);
  });

  it('Leader_AddsABrand_AuditNamesTheLeader', async () => {
    await addBrandAction(ING, 'ZZ Typedin Swiss', MENU);
    const { data } = await admin.from('audit_log').select('summary').like('summary', '%ZZ Typedin Swiss%');
    expect(data?.[0].summary).toContain('ZZ Typedin Leader (a leader, on their menu)');
  });

  it('Scout_CannotAddABrand_ToAnotherScoutsTypedIn', async () => {
    who.kind = 'scout';
    who.personId = LEADER; // another scout, not the owner
    const res = await addBrandAction(ING, 'ZZ Typedin Swiss');
    expect(res).toEqual({ ok: false, error: expect.stringContaining('ingredient is gone') });
  });

  it('Scout_CannotUseSomeoneElsesMenu_ToReachATypedIn', async () => {
    who.kind = 'scout';
    who.personId = LEADER;
    const res = await addBrandAction(ING, 'ZZ Typedin Swiss', MENU);
    expect(res.ok).toBe(false);
  });
});
