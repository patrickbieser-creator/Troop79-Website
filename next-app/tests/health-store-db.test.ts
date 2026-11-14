import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, type TestScout } from './helpers/signup-fixtures';
import { memoryHealthStorage } from '../src/lib/health-files';
import { healthOpensFor, healthPageOwner, listHealthPages, openHealthPage, removeHealthPage, saveHealthDates, saveHealthPage, type HealthDeps, type HealthViewer } from '../src/lib/health-store';
import { resolveFamilyScope } from '../src/lib/household-scope';

/**
 * Health records against the real local database, storage in memory (Plans/Health-Forms.md). The family rule is
 * exercised through resolveFamilyScope, the same call lib/health-access makes for the signed-in adult.
 */
const admin = adminClient();
const TODAY = '2026-11-13';
let scout: TestScout;
let other: TestScout;
let parentId: number;
let relationshipId: number;
const storage = memoryHealthStorage();
const deps: HealthDeps = { supabase: admin, storage, today: () => TODAY };
let parent: HealthViewer;

const JPEG = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`page ${tag}`)]);
const PDF = Buffer.from('%PDF-1.7 a filled BSA form');

const rows = async (personId: number) =>
  ((await admin.from('health_documents').select('id, kind, page, object_path, content_type, effective_on, expires_on').eq('person_id', personId).order('kind').order('page')).data ?? []) as {
    id: string; kind: string; page: number; object_path: string; content_type: string; effective_on: string | null; expires_on: string | null;
  }[];
const logRows = async (personId: number) =>
  ((await admin.from('health_access_log').select('action, via, viewer_person_id, kind, page').eq('person_id', personId).order('id')).data ?? []) as { action: string; via: string; viewer_person_id: number; kind: string; page: number }[];
const save = (personId: number, kind: string, page: number, bytes: Uint8Array, dates: { parentSigned?: string; doctorSigned?: string } = {}) =>
  saveHealthPage({ personId, kind, page, bytes, ...dates }, parent, deps);

async function wipe(personId: number) {
  await admin.from('health_documents').delete().eq('person_id', personId);
  await admin.from('health_access_log').delete().eq('person_id', personId);
}

beforeAll(async () => {
  scout = await createTestScout(admin, 'HealthA');
  other = await createTestScout(admin, 'HealthB');
  const { data: p, error } = await admin.from('people').insert({ display_name: 'ZZVITEST Health Parent' }).select('id').single();
  if (error) throw new Error(error.message);
  parentId = p!.id;
  const { data: rel, error: relError } = await admin.from('relationships').insert({ person_id: parentId, related_person_id: scout.personId, type: 'parent_of', role_label: 'Parent' }).select('id').single();
  if (relError) throw new Error(relError.message);
  relationshipId = rel!.id;
  parent = { personId: parentId, name: 'ZZVITEST Health Parent', via: 'family' };
});
afterAll(async () => {
  for (const id of [scout.personId, other.personId, parentId, 2147483000]) await wipe(id);
  await admin.from('relationships').delete().eq('id', relationshipId);
  await admin.from('people').delete().eq('id', parentId);
  await deleteTestScout(admin, scout);
  await deleteTestScout(admin, other);
});

describe('who a parent may act for', () => {
  it('Parent_CanUploadHealthDocument_ForOwnHouseholdMember', async () => {
    const scope = await resolveFamilyScope(admin, parentId, 'adult');
    expect([scope.includes(scout.personId), scope.includes(parentId)]).toEqual([true, true]);
  });

  it('Parent_CannotUploadOrView_ForAnotherHousehold', async () => {
    expect((await resolveFamilyScope(admin, parentId, 'adult')).includes(other.personId)).toBe(false);
  });

  it('Scout_CannotView_OwnRecords_ThroughAParentsScope', async () => {
    expect(await resolveFamilyScope(admin, scout.personId, 'scout')).toEqual([scout.personId]);
  });
});

describe('saveHealthPage', () => {
  it('Save_StoresCiphertext_AndARowThatPointsAtIt', async () => {
    await wipe(scout.personId);
    const res = await save(scout.personId, 'bsa_ab', 1, JPEG('one'));
    const [row] = await rows(scout.personId);
    const blob = storage.store.get(row.object_path)!;
    expect([res.ok, row.content_type, blob.includes(Buffer.from('page one'))]).toEqual([true, 'image/jpeg', false]);
  });

  it('Save_WithBothSignatureDates_ExpiresTwelveMonthsAfterTheLater', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, PDF, { parentSigned: '2026-03-01', doctorSigned: '2026-03-04' });
    const [row] = await rows(scout.personId);
    expect([row.effective_on, row.expires_on, row.content_type]).toEqual(['2026-03-04', '2027-03-04', 'application/pdf']);
  });

  it('Save_OfALaterPageWithDates_DatesEveryPageOfThatDocument', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('one'));
    await save(scout.personId, 'bsa_ab', 2, JPEG('two'), { doctorSigned: '2026-05-10' });
    expect((await rows(scout.personId)).map((r) => r.expires_on)).toEqual(['2027-05-10', '2027-05-10']);
  });

  it('Parent_CanReplaceDocument_AndOldCiphertextIsDeleted', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'insurance', 1, JPEG('old'));
    const [before] = await rows(scout.personId);
    await save(scout.personId, 'insurance', 1, JPEG('new'));
    const after = await rows(scout.personId);
    expect([after.length, after[0].id === before.id, storage.store.has(before.object_path), storage.store.has(after[0].object_path)]).toEqual([1, true, false, true]);
  });

  it('Save_RefusesAFileThatIsNotAPhotoOrPdf_AndStoresNothing', async () => {
    await wipe(scout.personId);
    const size = storage.store.size;
    const res = await save(scout.personId, 'bsa_ab', 1, Buffer.from('<script>'));
    expect([res.ok, (await rows(scout.personId)).length, storage.store.size]).toEqual([false, 0, size]);
  });

  it('Save_RefusesAPageOutsideTheDocument', async () => {
    expect((await save(scout.personId, 'insurance', 3, JPEG('x'))).ok).toBe(false);
  });

  it('Save_RefusesAnUnknownDocument', async () => {
    expect((await save(scout.personId, 'dental', 1, JPEG('x'))).ok).toBe(false);
  });

  it('Save_RefusesASignatureDateInTheFuture', async () => {
    expect((await save(scout.personId, 'bsa_ab', 1, JPEG('x'), { doctorSigned: '2026-12-25' })).ok).toBe(false);
  });

  it('Upload_DeletesTheObject_WhenTheRowInsertFails', async () => {
    const size = storage.store.size;
    // No such person: the row is refused by its foreign key after the object was stored.
    await expect(save(2147483000, 'bsa_ab', 1, JPEG('x'))).rejects.toThrow();
    expect(storage.store.size).toBe(size);
  });

  it('Save_LogsAnUpload_ThenAReplace', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'immunization', 1, JPEG('a'));
    await save(scout.personId, 'immunization', 1, JPEG('b'));
    expect((await logRows(scout.personId)).map((l) => `${l.action}:${l.via}:${l.viewer_person_id === parentId}`)).toEqual(['upload:family:true', 'replace:family:true']);
  });
});

describe('saveHealthDates', () => {
  it('Dates_SetLater_ApplyToEveryPage', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_c', 1, JPEG('c1'));
    await save(scout.personId, 'bsa_c', 2, JPEG('c2'));
    const res = await saveHealthDates({ personId: scout.personId, kind: 'bsa_c', parentSigned: null, doctorSigned: '2026-06-01' }, deps);
    expect([res.ok, (await rows(scout.personId)).map((r) => r.expires_on)]).toEqual([true, ['2027-06-01', '2027-06-01']]);
  });

  it('Dates_WithNothingPicked_AreRefused', async () => {
    expect((await saveHealthDates({ personId: scout.personId, kind: 'bsa_c', parentSigned: null, doctorSigned: null }, deps)).ok).toBe(false);
  });
});

describe('openHealthPage', () => {
  it('Open_ReturnsTheUploadedBytes', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('opened'));
    const [row] = await rows(scout.personId);
    const res = await openHealthPage(row.id, parent, 'view', deps);
    expect(res.ok && res.bytes.equals(JPEG('opened'))).toBe(true);
  });

  it('EveryRead_WritesAccessLogRow', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('x'));
    const [row] = await rows(scout.personId);
    await openHealthPage(row.id, parent, 'view', deps);
    await openHealthPage(row.id, parent, 'download', deps);
    expect((await logRows(scout.personId)).map((l) => l.action)).toEqual(['upload', 'view', 'download']);
  });

  it('Read_IsRefused_WhenTheAccessLogInsertFails', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('x'));
    const [row] = await rows(scout.personId);
    let read = false;
    const watching: HealthDeps = { ...deps, storage: { ...storage, get: async (p) => ((read = true), storage.get(p)) } };
    // 'peek' is not an action the log accepts: the insert fails before anything is fetched.
    await expect(openHealthPage(row.id, parent, 'peek' as 'view', watching)).rejects.toThrow(/access log/);
    expect(read).toBe(false);
  });

  it('Open_OfTamperedCiphertext_ReturnsNoBytes', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('x'));
    const [row] = await rows(scout.personId);
    const blob = storage.store.get(row.object_path)!;
    blob[blob.length - 1] ^= 1;
    expect(await openHealthPage(row.id, parent, 'view', deps)).toEqual({ ok: false, status: 500 });
  });

  it('Open_WhenTheObjectIsGone_Is404', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('x'));
    const [row] = await rows(scout.personId);
    storage.store.delete(row.object_path);
    expect(await openHealthPage(row.id, parent, 'view', deps)).toEqual({ ok: false, status: 404 });
  });

  it('Open_OfAnIdThatIsNotADocument_Is404', async () => {
    expect([await openHealthPage('not-a-uuid', parent, 'view', deps), await healthPageOwner(admin, '00000000-0000-4000-8000-000000000000')]).toEqual([{ ok: false, status: 404 }, null]);
  });

  it('Owner_NamesWhoseFileItIs_SoAccessIsDecidedFirst', async () => {
    await wipe(other.personId);
    await save(other.personId, 'bsa_ab', 1, JPEG('theirs'));
    const [row] = await rows(other.personId);
    expect((await healthPageOwner(admin, row.id))?.personId).toBe(other.personId);
  });
});

describe('removeHealthPage', () => {
  it('Parent_CanDeleteDocument_AndItIsGoneFromStorage', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'insurance', 2, JPEG('back'));
    const [row] = await rows(scout.personId);
    const res = await removeHealthPage(row.id, [parentId, scout.personId], parent, deps);
    expect([res.ok, (await rows(scout.personId)).length, storage.store.has(row.object_path)]).toEqual([true, 0, false]);
  });

  it('Remove_OfAnotherFamilysPage_IsRefused_AndNothingChanges', async () => {
    await wipe(other.personId);
    await save(other.personId, 'bsa_ab', 1, JPEG('theirs'));
    const [row] = await rows(other.personId);
    const res = await removeHealthPage(row.id, [parentId, scout.personId], parent, deps);
    expect([res.ok, (await rows(other.personId)).length, storage.store.has(row.object_path)]).toEqual([false, 1, true]);
  });
});

describe('what the family sees', () => {
  it('List_ReturnsOnlyTheAskedPeople', async () => {
    await wipe(scout.personId);
    await wipe(other.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('mine'));
    await save(other.personId, 'bsa_ab', 1, JPEG('theirs'));
    expect((await listHealthPages(admin, [scout.personId])).map((p) => p.personId)).toEqual([scout.personId]);
  });

  it('Family_SeesWhoOpenedTheirRecords', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('x'));
    const [row] = await rows(scout.personId);
    await openHealthPage(row.id, { personId: parentId, name: 'A Named Leader', via: 'family' }, 'view', deps);
    const opens = await healthOpensFor(admin, [scout.personId]);
    expect(opens.map((o) => `${o.viewerName}:${o.action}`)).toEqual(['A Named Leader:view']);
  });
});
