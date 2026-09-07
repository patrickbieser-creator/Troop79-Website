import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Person Editor Rethink, Phase 1 (Plans/Person-Editor-Rethink.md) — the
 * record page's server half. A page.tsx can't be rendered here (Tests/
 * CLAUDE.md), so this covers what it composes: the loader that shapes one
 * PersonRecord for a scout or an adult (404 for an unknown id, redirect for
 * a merged-away row), the roster's ?open= → person id resolution behind the
 * deep-link redirect, and the two status actions — which must write the row
 * AND an audit_log row whose `details` carries the Status/Reason from→to
 * diff (summary stays field-names-only, D-257).
 *
 * The request-scoped glue is mocked the way suggestion-action.test.ts does
 * it: the capability gate and actor resolve to a test leader, `next/cache`
 * is a no-op, and createAdminClient() hands back the SAME local service-role
 * client the fixtures use — the database itself is never mocked.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import { loadPersonRecord, resolveRosterOpenParam } from '../src/app/admin/(workspace)/advancement/roster/[personId]/load-person-record';
import { setScoutActive } from '../src/app/admin/(workspace)/advancement/roster/[personId]/scout-status-actions';
import { setPersonActive } from '../src/app/admin/(workspace)/advancement/roster/person-actions';

const admin = adminClient();
const SCOUT_ID = 'ZZREC1';
let adultId = 0;
let scoutPersonId = 0;
let mergedId = 0;
let householdId = 0;

async function insertPerson(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin.from('people').insert(row).select('id').single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  return (data as { id: number }).id;
}

beforeAll(async () => {
  adultId = await insertPerson({
    first_name: 'ZZRec',
    last_name: 'Adult',
    display_name: 'ZZRec Adult',
    primary_phone: '(414) 555-0100',
    birthdate: '1980-05-04',
    active: true
  });
  scoutPersonId = await insertPerson({
    first_name: 'ZZRec',
    last_name: 'Scout',
    display_name: 'ZZRec Scout',
    birthdate: '2012-09-01',
    active: true
  });
  mergedId = await insertPerson({
    first_name: 'ZZRec',
    last_name: 'Merged',
    display_name: 'ZZRec Merged',
    merged_into_person_id: adultId,
    active: false
  });
  const { error: scoutErr } = await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZRec',
    last_name: 'Scout',
    display_name: 'ZZRec Scout',
    patrol: 'ZZ Patrol',
    active: true,
    person_id: scoutPersonId
  });
  if (scoutErr) throw new Error(`fixture: scouts insert failed: ${scoutErr.message}`);
  const { data: hh, error: hhErr } = await admin
    .from('households')
    .insert({ label: 'ZZRec Household' })
    .select('id')
    .single();
  if (hhErr || !hh) throw new Error(`fixture: households insert failed: ${hhErr?.message}`);
  householdId = (hh as { id: number }).id;
  const { error: memErr } = await admin.from('household_members').insert([
    { household_id: householdId, person_id: adultId },
    { household_id: householdId, person_id: scoutPersonId }
  ]);
  if (memErr) throw new Error(`fixture: household_members insert failed: ${memErr.message}`);
  const { error: emErr } = await admin
    .from('person_emails')
    .insert({ person_id: adultId, email: 'zzrec.adult@example.com', is_primary: true });
  if (emErr) throw new Error(`fixture: person_emails insert failed: ${emErr.message}`);
});

afterAll(async () => {
  const ids = [adultId, scoutPersonId, mergedId].filter(Boolean);
  await admin
    .from('audit_log')
    .delete()
    .in('entity_id', [SCOUT_ID, ...ids.map(String)]);
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
  if (householdId) await admin.from('households').delete().eq('id', householdId);
  if (ids.length) {
    // The merged row points at the adult — delete it first so the FK never blocks.
    await admin.from('people').delete().eq('id', mergedId);
    await admin.from('people').delete().in('id', ids);
  }
});

describe('loadPersonRecord — one shape for scouts and adults', () => {
  it('Loader_ReturnsScoutRecord_WithScoutRowHouseholdAndTab', async () => {
    const res = await loadPersonRecord(scoutPersonId);
    expect(res.kind).toBe('found');
    if (res.kind !== 'found') return;
    const r = res.record;
    expect(r.kind).toBe('scout');
    expect(r.tab).toBe('active_scout');
    expect(r.displayName).toBe('ZZRec Scout');
    expect(r.scout?.id).toBe(SCOUT_ID);
    expect(r.scout?.patrol).toBe('ZZ Patrol');
    expect(r.scout?.active).toBe(true);
    expect(r.household?.label).toBe('ZZRec Household');
    expect(r.household?.members.map((m) => m.name).sort()).toEqual(['ZZRec Adult', 'ZZRec Scout']);
    expect(r.emails).toEqual([]);
  });

  it('Loader_ReturnsAdultRecord_WithEmailsRolesAndFields', async () => {
    const res = await loadPersonRecord(adultId);
    expect(res.kind).toBe('found');
    if (res.kind !== 'found') return;
    const r = res.record;
    expect(r.kind).toBe('adult');
    expect(r.tab).toBe('adult');
    expect(r.scout).toBeNull();
    expect(r.emails.map((e) => e.email)).toEqual(['zzrec.adult@example.com']);
    expect(r.detail.fields.primary_phone).toBe('(414) 555-0100');
    expect(r.detail.roles).toEqual([]);
    expect(r.household?.members.find((m) => m.personId === scoutPersonId)?.kind).toBe('scout');
  });

  it('Loader_RedirectsMergedPerson_ToSurvivor', async () => {
    const res = await loadPersonRecord(mergedId);
    expect(res).toEqual({ kind: 'merged', survivorId: adultId });
  });

  it('Loader_ReportsMissing_ForUnknownId', async () => {
    const res = await loadPersonRecord(999999999);
    expect(res).toEqual({ kind: 'missing' });
  });
});

describe('roster ?open= → record page', () => {
  it('Leader_OpensDeepLinkFromRoster_LandsOnRecordPage', async () => {
    // Scout tabs deep-link by scout code; people tabs by people.id.
    expect(await resolveRosterOpenParam(SCOUT_ID, 'active_scout')).toBe(scoutPersonId);
    expect(await resolveRosterOpenParam(String(adultId), 'adult')).toBe(adultId);
    // A dashboard link can carry a scout code with the wrong tab — still resolves.
    expect(await resolveRosterOpenParam(SCOUT_ID, 'adult')).toBe(scoutPersonId);
    expect(await resolveRosterOpenParam('no-such-id', 'adult')).toBeNull();
  });
});

describe('status actions — row + audit details', () => {
  it('SetScoutActive_WritesRowAndAuditDetails_StatusReasonFromTo', async () => {
    const res = await setScoutActive(SCOUT_ID, false, 'moved_away');
    expect(res).toEqual({ ok: true });
    const { data: row } = await admin.from('scouts').select('active, inactive_reason').eq('id', SCOUT_ID).single();
    expect(row).toEqual({ active: false, inactive_reason: 'moved_away' });
    const { data: audit } = await admin
      .from('audit_log')
      .select('area, action, entity_type, summary, details')
      .eq('entity_type', 'scout')
      .eq('entity_id', SCOUT_ID)
      .order('id', { ascending: false })
      .limit(1);
    expect(audit).toHaveLength(1);
    expect(audit![0].area).toBe('roster');
    expect(audit![0].details).toEqual([
      { field: 'Status', from: 'Active', to: 'Inactive' },
      { field: 'Reason', from: '—', to: 'Moved away' }
    ]);
    // D-257: values live in details, never in the summary line.
    expect(audit![0].summary).not.toContain('Moved away');

    const back = await setScoutActive(SCOUT_ID, true);
    expect(back).toEqual({ ok: true });
    const { data: row2 } = await admin.from('scouts').select('active, inactive_reason').eq('id', SCOUT_ID).single();
    expect(row2).toEqual({ active: true, inactive_reason: null });
    const { data: audit2 } = await admin
      .from('audit_log')
      .select('details')
      .eq('entity_type', 'scout')
      .eq('entity_id', SCOUT_ID)
      .order('id', { ascending: false })
      .limit(1);
    expect(audit2![0].details).toEqual([
      { field: 'Status', from: 'Inactive', to: 'Active' },
      { field: 'Reason', from: 'Moved away', to: '—' }
    ]);
  });

  it('SetScoutActive_RequiresAValidReason_WhenMarkingInactive', async () => {
    expect((await setScoutActive(SCOUT_ID, false)).ok).toBe(false);
    expect((await setScoutActive(SCOUT_ID, false, 'ran_off')).ok).toBe(false);
    const { data: row } = await admin.from('scouts').select('active').eq('id', SCOUT_ID).single();
    expect(row?.active).toBe(true);
  });

  it('SetPersonActive_WritesRowAndAuditDetails_StatusReasonFromTo', async () => {
    const res = await setPersonActive(adultId, false, 'Moved to Chicago');
    expect(res).toEqual({ ok: true });
    const { data: row } = await admin.from('people').select('active, inactive_reason').eq('id', adultId).single();
    expect(row).toEqual({ active: false, inactive_reason: 'Moved to Chicago' });
    const { data: audit } = await admin
      .from('audit_log')
      .select('summary, details')
      .eq('entity_type', 'person')
      .eq('entity_id', String(adultId))
      .order('id', { ascending: false })
      .limit(1);
    expect(audit).toHaveLength(1);
    expect(audit![0].details).toEqual([
      { field: 'Status', from: 'Active', to: 'Inactive' },
      { field: 'Reason', from: '—', to: 'Moved to Chicago' }
    ]);
    expect(audit![0].summary).not.toContain('Chicago');

    expect(await setPersonActive(adultId, true)).toEqual({ ok: true });
    const { data: row2 } = await admin.from('people').select('active, inactive_reason').eq('id', adultId).single();
    expect(row2).toEqual({ active: true, inactive_reason: null });
    const { data: audit2 } = await admin
      .from('audit_log')
      .select('details')
      .eq('entity_type', 'person')
      .eq('entity_id', String(adultId))
      .order('id', { ascending: false })
      .limit(1);
    expect(audit2![0].details).toEqual([
      { field: 'Status', from: 'Inactive', to: 'Active' },
      { field: 'Reason', from: 'Moved to Chicago', to: '—' }
    ]);
  });
});
