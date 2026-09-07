import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Person Editor Rethink, Phase 4 (Plans/Person-Editor-Rethink.md) — the
 * record page's History is the audit_log filtered to one person. Two rules
 * this pins:
 *
 *   1. Every action the page can fire records a field-level from→to diff in
 *      `details` (the summary names people and FIELD NAMES only, D-257), and
 *      getPersonHistory hands it back as-is — while a row written before the
 *      cutover (details NULL) still shows, summary only, without crashing.
 *   2. The query finds every row ABOUT the person, whichever entity the
 *      action was keyed on: the people row, the scout row (by scout id), and
 *      the related rows — a role, an email, a relationship (from BOTH sides).
 *
 * Same request-glue mocks as person-record-writes.test.ts; the DB is real.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { getPersonHistory } from '../src/app/admin/(workspace)/advancement/roster/[personId]/get-person-history';
import { setScoutActive } from '../src/app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions';
import {
  addPersonEmailAction,
  addRelationship,
  addRole,
  endRole,
  setPersonActive,
  updatePersonDemographics
} from '../src/app/admin/(workspace)/advancement/roster/person-actions';

const admin = adminClient();
const SCOUT_ID = 'ZZHIS1';
let adultId = 0;
let scoutPersonId = 0;

async function insertPerson(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin.from('people').insert(row).select('id').single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  return (data as { id: number }).id;
}

beforeAll(async () => {
  adultId = await insertPerson({
    first_name: 'ZZHist',
    last_name: 'Adult',
    display_name: 'ZZHist Adult',
    city: 'Milwaukee',
    active: true
  });
  scoutPersonId = await insertPerson({
    first_name: 'ZZHist',
    last_name: 'Scout',
    display_name: 'ZZHist Scout',
    active: true
  });
  const { error: scoutErr } = await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZHist',
    last_name: 'Scout',
    display_name: 'ZZHist Scout',
    active: true,
    person_id: scoutPersonId
  });
  if (scoutErr) throw new Error(`fixture: scouts insert failed: ${scoutErr.message}`);
});

afterAll(async () => {
  const ids = [adultId, scoutPersonId].filter(Boolean);
  await admin
    .from('audit_log')
    .delete()
    .in('entity_id', [SCOUT_ID, ...ids.map(String)]);
  for (const id of ids) await admin.from('audit_log').delete().contains('details', { people: [id] });
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
  if (ids.length) await admin.from('people').delete().in('id', ids);
});

describe('Phase 4 — History is the audit_log filtered to one person', () => {
  it('Leader_ViewsHistory_SeesFieldLevelOldToNew_ForActionsLoggedAfterCutover', async () => {
    expect(await setPersonActive(adultId, false, 'Moved to Madison')).toEqual({ ok: true });
    const fd = new FormData();
    fd.set('city', 'Madison');
    expect(await updatePersonDemographics(adultId, fd)).toEqual({ ok: true });
    expect(await setScoutActive(SCOUT_ID, false, 'aged_out')).toEqual({ ok: true });

    const adult = await getPersonHistory(adultId);
    const status = adult.find((e) => e.details?.some((d) => d.field === 'Status'));
    expect(status?.details).toEqual([
      { field: 'Status', from: 'Active', to: 'Inactive' },
      { field: 'Reason', from: '—', to: 'Moved to Madison' }
    ]);
    expect(status?.summary).not.toContain('Madison');
    expect(status?.actorLabel).toBe('ZZ Vitest Leader');
    const city = adult.find((e) => e.details?.some((d) => d.field === 'City'));
    expect(city?.details).toEqual([{ field: 'City', from: 'Milwaukee', to: 'Madison' }]);

    // The scout's status is keyed on the scouts row, not the person — the
    // scout's history must still find it.
    const scout = await getPersonHistory(scoutPersonId);
    const scoutStatus = scout.find((e) => e.details?.some((d) => d.field === 'Status'));
    expect(scoutStatus?.details).toEqual([
      { field: 'Status', from: 'Active', to: 'Inactive' },
      { field: 'Reason', from: '—', to: 'Aged out' }
    ]);
  });

  it('Leader_ViewsHistoryForPreCutoverAction_SeesSummaryOnly_NoDetailsCrash', async () => {
    const { error } = await admin.from('audit_log').insert({
      actor_label: 'ZZ Old Leader',
      area: 'roster',
      action: 'update',
      entity_type: 'person',
      entity_id: String(adultId),
      summary: `Updated person ${adultId}'s demographics (fields: primary_phone)`,
      details: null
    });
    expect(error).toBeNull();

    const history = await getPersonHistory(adultId);
    const old = history.find((e) => e.actorLabel === 'ZZ Old Leader');
    expect(old).toBeTruthy();
    expect(old!.details).toBeNull();
    expect(old!.summary).toContain('primary_phone');
  });

  it('History_IncludesActionsKeyedOnRelatedRows', async () => {
    expect(await addRole(adultId, 'committee_member')).toEqual({ ok: true });
    const { data: roleRow } = await admin
      .from('person_roles')
      .select('id')
      .eq('person_id', adultId)
      .eq('role', 'committee_member')
      .is('end_date', null)
      .single();
    const roleId = (roleRow as { id: number }).id;
    expect(await endRole(roleId)).toEqual({ ok: true });
    expect(await addPersonEmailAction(adultId, 'zzhist.adult@example.com', 'home')).toEqual({ ok: true });
    expect(await addRelationship(adultId, scoutPersonId, 'parent_of', true)).toEqual({ ok: true });

    const adult = await getPersonHistory(adultId);
    const granted = adult.find((e) => e.details?.some((d) => d.field === 'Committee member' && d.to === 'granted'));
    expect(granted).toBeTruthy();
    const ended = adult.find((e) => e.details?.some((d) => d.field === 'Committee member' && /^ended /.test(d.to)));
    expect(ended, 'endRole is keyed on the role id — it must still be findable by person').toBeTruthy();
    expect(ended!.details![0].from).toMatch(/^since /);
    const email = adult.find((e) => e.details?.some((d) => d.field === 'zzhist.adult@example.com'));
    expect(email?.details).toEqual([{ field: 'zzhist.adult@example.com', from: 'not on file', to: 'home (primary)' }]);
    const rel = adult.find((e) => e.details?.some((d) => /^Parent of ZZHist Scout/.test(d.field)));
    expect(rel?.details).toEqual([{ field: 'Parent of ZZHist Scout', from: 'not linked', to: 'linked (guardian)' }]);

    // The same one relationship row shows on the scout's side too.
    const scout = await getPersonHistory(scoutPersonId);
    expect(scout.some((e) => e.id === rel!.id)).toBe(true);
  });

  it('History_IsNewestFirst_AndRespectsLimit', async () => {
    const all = await getPersonHistory(adultId);
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].occurredAt >= all[i].occurredAt, `entry ${i - 1} is not newer than entry ${i}`).toBe(true);
    }
    const two = await getPersonHistory(adultId, { limit: 2 });
    expect(two).toHaveLength(2);
    expect(two.map((e) => e.id)).toEqual(all.slice(0, 2).map((e) => e.id));
  });
});
