import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';

/**
 * Person Editor Rethink, Phase 5 (Plans/Person-Editor-Rethink.md) — the
 * loader's half of the pending-update banners: `PersonRecord.pending` is
 * the family's open change request for this person (an 'adult' row keyed
 * on people.id, or a 'scout' row keyed on scouts.id), `familyNotice` is an
 * unacknowledged 'adult_added' notice, and both are null when there is
 * nothing waiting. The rows are inserted the way /profile writes them
 * (lib/change-requests: proposed_changes keyed by the entity's field set,
 * status 'pending', submitted_by_person_id for the submitter's name).
 *
 * Request-scoped glue mocked as in person-record-load.test.ts; the database
 * itself is never mocked.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import { loadPersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/load-person-record';

const admin = adminClient();
const SCOUT_ID = 'ZZPND1';
let adultId = 0;
let quietId = 0;
let submitterId = 0;
let scoutPersonId = 0;
const requestIds: number[] = [];

async function insertPerson(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin.from('people').insert(row).select('id').single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  return (data as { id: number }).id;
}

async function insertRequest(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin.from('change_requests').insert(row).select('id').single();
  if (error || !data) throw new Error(`fixture: change_requests insert failed: ${error?.message}`);
  const id = (data as { id: number }).id;
  requestIds.push(id);
  return id;
}

beforeAll(async () => {
  submitterId = await insertPerson({
    first_name: 'ZZPnd',
    last_name: 'Submitter',
    display_name: 'ZZPnd Submitter',
    active: true
  });
  adultId = await insertPerson({
    first_name: 'ZZPnd',
    last_name: 'Adult',
    display_name: 'ZZPnd Adult',
    primary_phone: '(414) 555-0100',
    active: true
  });
  quietId = await insertPerson({
    first_name: 'ZZPnd',
    last_name: 'Quiet',
    display_name: 'ZZPnd Quiet',
    active: true
  });
  scoutPersonId = await insertPerson({
    first_name: 'ZZPnd',
    last_name: 'Scout',
    display_name: 'ZZPnd Scout',
    active: true
  });
  const { error: scoutErr } = await admin.from('scouts').insert({
    id: SCOUT_ID,
    first_name: 'ZZPnd',
    last_name: 'Scout',
    display_name: 'ZZPnd Scout',
    active: true,
    person_id: scoutPersonId
  });
  if (scoutErr) throw new Error(`fixture: scouts insert failed: ${scoutErr.message}`);

  await insertRequest({
    entity_type: 'adult',
    entity_id: String(adultId),
    submitted_by_person_id: submitterId,
    proposed_changes: { primary_phone: '(414) 555-0199', birthdate: '1981-03-15' },
    status: 'pending'
  });
  await insertRequest({
    entity_type: 'adult_added',
    entity_id: String(adultId),
    submitted_by_person_id: submitterId,
    proposed_changes: { name: 'ZZPnd Adult', relationship: 'Grandmother', primary_email: null, primary_phone: '(414) 555-0131' },
    status: 'pending'
  });
  // An already-reviewed request must not surface.
  await insertRequest({
    entity_type: 'adult',
    entity_id: String(quietId),
    submitted_by_person_id: submitterId,
    proposed_changes: { city: 'Wauwatosa' },
    status: 'rejected',
    reviewed_by: 'ZZ Vitest Leader',
    reviewed_at: new Date().toISOString()
  });
  await insertRequest({
    entity_type: 'scout',
    entity_id: SCOUT_ID,
    submitted_by_person_id: submitterId,
    proposed_changes: { phone: '(414) 555-0191', swim_class: 'swimmer' },
    status: 'pending'
  });
});

afterAll(async () => {
  if (requestIds.length) await admin.from('change_requests').delete().in('id', requestIds);
  await admin.from('scouts').delete().eq('id', SCOUT_ID);
  const ids = [adultId, quietId, scoutPersonId, submitterId].filter(Boolean);
  if (ids.length) await admin.from('people').delete().in('id', ids);
});

describe('loadPersonRecord — the family’s pending request and notice ride on the record', () => {
  it('Loader_ReturnsPendingAdultRequest_WithProposedFieldsAndSubmitter', async () => {
    const res = await loadPersonRecord(adultId);
    expect(res.kind).toBe('found');
    if (res.kind !== 'found') return;
    const p = res.record.pending;
    expect(p).not.toBeNull();
    expect(p?.entityType).toBe('adult');
    expect(p?.proposed).toEqual({ primary_phone: '(414) 555-0199', birthdate: '1981-03-15' });
    expect(p?.submittedByName).toBe('ZZPnd Submitter');
    expect(typeof p?.submittedAt).toBe('string');
    expect(res.record.pendingUpdate).toBe(true);
  });

  it('Loader_ReturnsFamilyNotice_ForUnacknowledgedAddedMember', async () => {
    const res = await loadPersonRecord(adultId);
    if (res.kind !== 'found') throw new Error('expected found');
    const n = res.record.familyNotice;
    expect(n).not.toBeNull();
    expect(n?.fields.relationship).toBe('Grandmother');
    expect(n?.fields.primary_phone).toBe('(414) 555-0131');
    expect(n?.submittedByName).toBe('ZZPnd Submitter');
  });

  it('Loader_ReturnsScoutRequest_KeyedOnScoutId', async () => {
    const res = await loadPersonRecord(scoutPersonId);
    if (res.kind !== 'found') throw new Error('expected found');
    expect(res.record.kind).toBe('scout');
    expect(res.record.pending?.entityType).toBe('scout');
    expect(res.record.pending?.proposed).toEqual({ phone: '(414) 555-0191', swim_class: 'swimmer' });
    expect(res.record.familyNotice).toBeNull();
  });

  it('Loader_ReturnsNoPending_WhenNothingIsWaiting', async () => {
    const res = await loadPersonRecord(quietId);
    if (res.kind !== 'found') throw new Error('expected found');
    expect(res.record.pending).toBeNull();
    expect(res.record.familyNotice).toBeNull();
    expect(res.record.pendingUpdate).toBe(false);
  });
});
