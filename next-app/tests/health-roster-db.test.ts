import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, TEST_PREFIX, type TestScout } from './helpers/signup-fixtures';
import { memoryHealthStorage } from '../src/lib/health-files';
import { loadHealthRoster, openHealthRecord, saveHealthPage, setHealthReviewed, type HealthDeps, type HealthViewer } from '../src/lib/health-store';

/**
 * Who the admin Health Forms list shows (Plans/Admin-Health-Forms.md, decision 6 and R3/R4): active scouts and active
 * leaders always; anyone else once they have a document or a review. Type is Scout / Adult / Other; "Updated" is the
 * newest upload. Real local database, storage in memory, test-owned rows only.
 */
const admin = adminClient();
const TODAY = '2026-11-15';
const deps: HealthDeps = { supabase: admin, storage: memoryHealthStorage(), today: () => TODAY };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('p')]);

let scout: TestScout;
let webelos: TestScout;
let inactive: TestScout;
let leaderId = 0;
let parentWithFile = 0;
let reviewedOnly = 0;
let bareParent = 0;
let officer: HealthViewer;
const people: number[] = [];

async function person(label: string, first?: string, last?: string): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} HR ${label}`, first_name: first ?? null, last_name: last ?? null })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}

async function upload(personId: number, kind: string, page = 1) {
  const r = await saveHealthPage({ personId, kind, page, bytes: JPEG }, officer, deps);
  if (!r.ok) throw new Error(r.error);
}

beforeAll(async () => {
  const officerId = await person('Officer');
  officer = { personId: officerId, name: 'HR Officer', via: 'named' };

  scout = await createTestScout(admin, 'HRScout');
  webelos = await createTestScout(admin, 'HRWebelos');
  await admin.from('scouts').update({ active: false, is_webelos: true }).eq('id', webelos.scoutId);
  inactive = await createTestScout(admin, 'HRInactive');
  {
    const { error: ie } = await admin.from('scouts').update({ active: false, inactive_reason: 'moved_away' }).eq('id', inactive.scoutId);
    if (ie) throw new Error(ie.message);
  }

  leaderId = await person('Leader', 'Lee', 'Leader');
  const { error } = await admin.from('person_roles').insert({ person_id: leaderId, role: 'adult_leader' });
  if (error) throw new Error(error.message);

  parentWithFile = await person('Parent', 'Pat', 'Parentson');
  reviewedOnly = await person('Reviewed');
  bareParent = await person('Bare');

  await upload(webelos.personId, 'bsa_ab');
  await upload(inactive.personId, 'insurance');
  await upload(parentWithFile, 'bsa_ab');
  await setHealthReviewed(admin, reviewedOnly, true, { personId: officerId, name: 'HR Officer' });
});

afterAll(async () => {
  const ids = [...people, scout.personId, webelos.personId, inactive.personId];
  await admin.from('health_documents').delete().in('person_id', ids);
  await admin.from('health_reviews').delete().in('person_id', ids);
  await admin.from('health_access_log').delete().in('person_id', ids);
  await admin.from('health_access_log').delete().in('viewer_person_id', ids);
  await admin.from('person_roles').delete().eq('person_id', leaderId);
  for (const s of [scout, webelos, inactive]) await deleteTestScout(admin, s);
  await admin.from('people').delete().in('id', people);
});

const byId = async () => new Map((await loadHealthRoster(admin)).map((r) => [r.personId, r]));

describe('loadHealthRoster — who is listed', () => {
  it('HealthRoster_ListsActiveScoutsLeadersAndAnyoneWithRecords_NotBareParents', async () => {
    const m = await byId();
    expect([scout.personId, leaderId, parentWithFile, reviewedOnly, bareParent].map((id) => m.has(id))).toEqual([true, true, true, true, false]);
  });

  it('HealthRoster_TypesWebelosAndInactiveAsOther_RosterAdultsAsAdult', async () => {
    const m = await byId();
    expect([scout.personId, leaderId, webelos.personId, inactive.personId, parentWithFile].map((id) => m.get(id)?.type)).toEqual([
      'scout',
      'adult',
      'other',
      'other',
      'adult'
    ]);
  });

  it('HealthRoster_UpdatedIsLatestUploadedAt_BlankWhenNothingOnFile', async () => {
    const m = await byId();
    const withFile = m.get(parentWithFile)!;
    expect([withFile.lastUpload === withFile.pages[0].uploadedAt, m.get(scout.personId)!.lastUpload]).toEqual([true, null]);
  });

  it('HealthRoster_CarriesLegalFirstAndLastNames', async () => {
    const r = (await byId()).get(parentWithFile)!;
    expect([r.firstName, r.lastName]).toEqual(['Pat', 'Parentson']);
  });

  it('HealthRoster_CarriesTheReview', async () => {
    expect((await byId()).get(reviewedOnly)?.review?.byName).toBe('HR Officer');
  });
});

/**
 * The admin sheet logs before it shows (Plans/Admin-Health-Forms.md, Record sheet). New behaviour: if the log line
 * can't be written, nothing about the person comes back.
 */
describe('openHealthRecord', () => {
  it('SheetOpen_WritesLogFirst', async () => {
    const before = await admin.from('health_access_log').select('id', { count: 'exact', head: true }).eq('person_id', parentWithFile).eq('kind', 'record');
    await openHealthRecord(parentWithFile, officer, deps);
    const after = await admin.from('health_access_log').select('id', { count: 'exact', head: true }).eq('person_id', parentWithFile).eq('kind', 'record');
    expect((after.count ?? 0) - (before.count ?? 0)).toBe(1);
  });

  it('SheetOpen_ReturnsThePersonsPagesAndName', async () => {
    const r = await openHealthRecord(parentWithFile, officer, deps);
    expect([r?.name, r?.pages.map((p) => p.kind)]).toEqual(['Pat Parentson', ['bsa_ab']]);
  });

  it('SheetOpen_ShowsNothingWhenLogFails', async () => {
    const failingLog = new Proxy(admin, {
      get(target, prop, recv) {
        if (prop === 'from') {
          return (t: string) => (t === 'health_access_log' ? { insert: async () => ({ error: { message: 'log down' } }) } : target.from(t));
        }
        return Reflect.get(target, prop, recv);
      }
    }) as typeof admin;
    expect(await openHealthRecord(parentWithFile, officer, { ...deps, supabase: failingLog })).toBeNull();
  });
});
