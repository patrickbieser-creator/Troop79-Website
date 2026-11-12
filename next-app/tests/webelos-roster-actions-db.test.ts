import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Webelos on the roster, the app side (Plans/Webelos-On-The-Roster.md):
 * "+ Add Webelos" creates one, the household lists them with its youth (so
 * they can be signed up), and Cross over / Undo go through the RPCs as the
 * leader. Real local DB; request glue mocked as in person-record-writes.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import { createScout } from '../src/app/admin/(workspace)/advancement/lookups/actions';
import {
  crossOverWebelos,
  undoCrossOver
} from '../src/app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions';
import { loadHouseholdByKey } from '../src/lib/households';
import { loadScoutDetail } from '../src/lib/scout-detail';

const admin = adminClient();
const ID = 'ZZWAC1';
const LAST = 'ZZWebelosAct';
let householdId = 0;
let personId = 0;

beforeAll(async () => {
  const { data } = await admin.from('households').insert({ label: 'ZZ Webelos House' }).select('id').single();
  householdId = (data as { id: number }).id;
});

afterAll(async () => {
  await admin.from('audit_log').delete().eq('entity_id', ID);
  await admin.from('ledger_entries').delete().eq('scout_id', ID);
  await admin.from('scouts').delete().eq('id', ID);
  await admin.from('household_members').delete().eq('household_id', householdId);
  await admin.from('households').delete().eq('id', householdId);
  await admin.from('people').delete().eq('last_name', LAST);
});

describe('Webelos — roster actions', () => {
  it('Leader_AddsAWebelos_ItIsCreatedNotActive_WithNoReason', async () => {
    const fd = new FormData();
    fd.set('id', ID);
    fd.set('first_name', 'Logan');
    fd.set('last_name', LAST);
    fd.set('is_webelos', 'true');
    fd.set('active', 'false');
    fd.set('inactive_reason', '');
    const res = await createScout(fd);
    expect(res).toEqual({ ok: true });
    const { data } = await admin.from('scouts').select('active, is_webelos, inactive_reason, person_id').eq('id', ID).single();
    personId = (data as { person_id: number }).person_id;
    expect({ ...data, person_id: undefined }).toEqual({ active: false, is_webelos: true, inactive_reason: null, person_id: undefined });
  });

  it('Household_ListsItsWebelos_WithItsYouth_MarkedWebelos', async () => {
    await admin.from('household_members').insert({ household_id: householdId, person_id: personId });
    const h = await loadHouseholdByKey(String(householdId));
    expect(h?.scouts).toEqual([{ id: ID, displayName: `Logan ${LAST}`, personId, isWebelos: true }]);
  });

  it('Leader_CrossesOverAWebelos_TheyBecomeAnActiveScout', async () => {
    const res = await crossOverWebelos(ID, '2027-02-28', '');
    const { data } = await admin.from('scouts').select('active, is_webelos, crossed_over_on').eq('id', ID).single();
    expect({ res, data }).toEqual({ res: { ok: true }, data: { active: true, is_webelos: false, crossed_over_on: '2027-02-28' } });
  });

  it('Leader_CrossesOverTwice_IsToldTheyAlreadyCrossedOver', async () => {
    const res = await crossOverWebelos(ID, '2027-02-28', '');
    expect(res.error).toBe('This scout has already crossed over.');
  });

  it('Leader_TypesABadBsaId_IsRefusedBeforeAnythingIsWritten', async () => {
    const res = await crossOverWebelos(ID, '2027-02-28', 'abc');
    expect(res.error).toMatch(/6–12 digits/);
  });

  it('Leader_UndoesTheCrossover_BackToWebelos', async () => {
    const res = await undoCrossOver(ID);
    const { data } = await admin.from('scouts').select('active, is_webelos').eq('id', ID).single();
    expect({ res, data }).toEqual({ res: { ok: true }, data: { active: false, is_webelos: true } });
  });

  it('PublicScoutPage_ForAWebelos_IsNotFound', async () => {
    // Back to Webelos after the undo above: no public page until crossover.
    expect(await loadScoutDetail(ID)).toBeNull();
  });

  it('Leader_PicksAnImpossibleDate_IsRefusedBeforeAnythingIsWritten', async () => {
    expect((await crossOverWebelos(ID, '2027-02-31', '')).error).toBe('Pick the crossover date.');
  });

  it('Leader_CannotUndo_OnceTheScoutHasTroopAdvancementAfterCrossover', async () => {
    await crossOverWebelos(ID, '2027-02-28', '');
    await admin.from('ledger_entries').insert({
      scout_id: ID, date: '2027-03-15', kind: 'rank_requirement', code: 'tenderfoot-1a', label: 'ZZ', by: 'ZZ', entered_by: 'ZZ'
    });
    const res = await undoCrossOver(ID);
    const { data } = await admin.from('scouts').select('is_webelos').eq('id', ID).single();
    expect({ error: res.error, data }).toEqual({
      error: 'This scout has advancement recorded after crossing over, so the crossover can’t be undone.',
      data: { is_webelos: false }
    });
  });
});

describe('Webelos — roster actions need roster.manage', () => {
  it('SomeoneWithoutRosterManage_CannotCrossOver', async () => {
    const cap = await import('@/lib/require-capability');
    vi.spyOn(cap, 'requireCapability').mockRejectedValueOnce(new Error('forbidden'));
    expect((await crossOverWebelos(ID, '2027-02-28', '')).error).toBe('Not authenticated');
  });
});
