import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, type TestScout } from './helpers/signup-fixtures';
import { memoryHealthStorage } from '../src/lib/health-files';
import { healthOpensFor, healthPageOwner, listHealthPages, openHealthPage, removeHealthPage, saveHealthGoodUntil, saveHealthPage, setImmunizationInBsaForm, unlinkedHouseholdScouts, type HealthDeps, type HealthViewer } from '../src/lib/health-store';
import { resolveFamilyScope } from '../src/lib/household-scope';
import { addMonths, goodUntilSeed } from '../src/lib/health-records';

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
const save = (personId: number, kind: string, page: number, bytes: Uint8Array, dates: { goodUntil?: string } = {}) =>
  saveHealthPage({ personId, kind, page, bytes, ...dates }, parent, deps);

async function wipe(personId: number) {
  await admin.from('health_documents').delete().eq('person_id', personId);
  await admin.from('health_access_log').delete().eq('person_id', personId);
  await admin.from('health_immunization_in_bsa_form').delete().eq('person_id', personId);
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

  it('GoodUntil_DefaultsToOneYearFromEntry_PerDocument', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, PDF);
    const [row] = await rows(scout.personId);
    expect([row.expires_on, row.content_type]).toEqual([addMonths(TODAY, 12), 'application/pdf']);
  });

  it('GoodUntil_Given_IsKept', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'insurance', 1, JPEG('front'), { goodUntil: '2027-01-31' });
    expect((await rows(scout.personId)).map((r) => r.expires_on)).toEqual(['2027-01-31']);
  });

  it('GoodUntil_PartsAandBShareOneDate_PartCAndInsuranceHaveTheirOwn', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('ab1'), { goodUntil: '2027-03-01' });
    await save(scout.personId, 'bsa_ab', 2, JPEG('ab2'));
    await save(scout.personId, 'bsa_c', 1, JPEG('c1'), { goodUntil: '2027-08-15' });
    await save(scout.personId, 'insurance', 1, JPEG('front'), { goodUntil: '2027-12-31' });
    expect((await rows(scout.personId)).map((r) => `${r.kind}:${r.expires_on}`)).toEqual(['bsa_ab:2027-03-01', 'bsa_ab:2027-03-01', 'bsa_c:2027-08-15', 'insurance:2027-12-31']);
  });

  it('GoodUntil_OnALaterPage_DatesEveryPageOfThatDocument', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_ab', 1, JPEG('one'));
    await save(scout.personId, 'bsa_ab', 2, JPEG('two'), { goodUntil: '2027-05-10' });
    expect((await rows(scout.personId)).map((r) => r.expires_on)).toEqual(['2027-05-10', '2027-05-10']);
  });

  it('GoodUntilSeed_IsTheCurrentDate_OrAYearOnForARunOutForm', () => {
    expect([goodUntilSeed('2027-01-01', TODAY), goodUntilSeed('2020-01-01', TODAY), goodUntilSeed(null, TODAY)]).toEqual(['2027-01-01', addMonths(TODAY, 12), addMonths(TODAY, 12)]);
  });

  it('Immunization_HasNoGoodUntil', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'immunization', 1, JPEG('imm'), { goodUntil: '2027-05-10' });
    expect((await rows(scout.personId)).map((r) => r.expires_on)).toEqual([null]);
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

  it('Save_RefusesAGoodUntilMoreThanThreeYearsOut', async () => {
    expect((await save(scout.personId, 'bsa_ab', 1, JPEG('x'), { goodUntil: '2031-01-01' })).ok).toBe(false);
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

describe('saveHealthGoodUntil', () => {
  it('GoodUntil_CanBeEdited_ForEveryPage', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_c', 1, JPEG('c1'));
    await save(scout.personId, 'bsa_c', 2, JPEG('c2'));
    const res = await saveHealthGoodUntil({ personId: scout.personId, kind: 'bsa_c', goodUntil: '2027-06-01' }, parent, deps);
    expect([res.ok, (await rows(scout.personId)).map((r) => r.expires_on)]).toEqual([true, ['2027-06-01', '2027-06-01']]);
  });

  it('GoodUntil_Edit_IsLogged_AndClearsTheReview', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_c', 1, JPEG('c1'));
    await admin.from('health_reviews').upsert({ person_id: scout.personId, reviewed_by_name: 'Leader' }, { onConflict: 'person_id' });
    await saveHealthGoodUntil({ personId: scout.personId, kind: 'bsa_c', goodUntil: '2027-06-01' }, parent, deps);
    const reviews = (await admin.from('health_reviews').select('person_id').eq('person_id', scout.personId)).data ?? [];
    expect([(await logRows(scout.personId)).map((l) => `${l.action}:${l.kind}`), reviews.length]).toEqual([['upload:bsa_c', 'edit:bsa_c'], 0]);
    await admin.from('health_reviews').delete().eq('person_id', scout.personId);
  });

  it('GoodUntil_Edit_ChangesNothing_WhenTheLogLineCannotBeWritten', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_c', 1, JPEG('c1'), { goodUntil: '2027-01-01' });
    await expect(saveHealthGoodUntil({ personId: scout.personId, kind: 'bsa_c', goodUntil: '2027-06-01' }, { ...parent, personId: 2147483000 }, deps)).rejects.toThrow();
    expect((await rows(scout.personId)).map((r) => r.expires_on)).toEqual(['2027-01-01']);
  });

  it('GoodUntil_Blank_IsRefused', async () => {
    expect((await saveHealthGoodUntil({ personId: scout.personId, kind: 'bsa_c', goodUntil: null }, parent, deps)).ok).toBe(false);
  });

  it('GoodUntil_OnImmunization_IsRefused', async () => {
    expect((await saveHealthGoodUntil({ personId: scout.personId, kind: 'immunization', goodUntil: '2027-06-01' }, parent, deps)).ok).toBe(false);
  });
});

describe('immunizations on Part C', () => {
  const flag = async (personId: number) => ((await admin.from('health_immunization_in_bsa_form').select('person_id').eq('person_id', personId)).data ?? []).length;

  it('OnPartC_ClearsWhenPartCChanges', async () => {
    await wipe(scout.personId);
    await setImmunizationInBsaForm(deps, scout.personId, true, { personId: parentId, name: 'Leader', via: 'named' });
    const before = await flag(scout.personId);
    await save(scout.personId, 'bsa_c', 1, JPEG('c'));
    expect([before, await flag(scout.personId)]).toEqual([1, 0]);
  });

  it('OnPartC_ClearsWhenAPartCPageIsRemoved', async () => {
    await wipe(scout.personId);
    await save(scout.personId, 'bsa_c', 1, JPEG('c'));
    await setImmunizationInBsaForm(deps, scout.personId, true, { personId: parentId, name: 'Leader', via: 'named' });
    const [row] = await rows(scout.personId);
    await removeHealthPage(row.id, [scout.personId], parent, deps);
    expect(await flag(scout.personId)).toBe(0);
  });

  it('InBsaForm_IsLogged_BothWays', async () => {
    await wipe(scout.personId);
    await setImmunizationInBsaForm(deps, scout.personId, true, { personId: parentId, name: 'Leader', via: 'named' });
    await setImmunizationInBsaForm(deps, scout.personId, false, { personId: parentId, name: 'Leader', via: 'named' });
    expect((await logRows(scout.personId)).map((l) => `${l.action}:${l.kind}`)).toEqual(['edit:immunization', 'edit:immunization']);
  });

  it('OnPartC_StaysWhenAnotherFormChanges', async () => {
    await wipe(scout.personId);
    await setImmunizationInBsaForm(deps, scout.personId, true, { personId: parentId, name: 'Leader', via: 'named' });
    await save(scout.personId, 'insurance', 1, JPEG('front'));
    await save(scout.personId, 'bsa_ab', 1, JPEG('ab'));
    expect(await flag(scout.personId)).toBe(1);
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

/**
 * A shared household grants nothing; a parent with no parent_of link to a scout in their own household can't add
 * that scout's forms, and used to see no sign the scout existed (Kevin Greene, 2026-11-14). The page names them.
 * Since the household rule (Plans/Person-Record-One-Save.md, 2026-11-15) a parent of ONE scout in a household is
 * linked to every scout in it, so only an adult with no parent link there (a grandparent) is left unlinked.
 */
describe('scouts in my household I am not linked to', () => {
  let householdId: number;
  let grandparentId: number;
  beforeAll(async () => {
    const { data: g, error: gError } = await admin.from('people').insert({ display_name: 'ZZVITEST Health Grandparent' }).select('id').single();
    if (gError) throw new Error(gError.message);
    grandparentId = g!.id;
    const { data, error } = await admin.from('households').insert({ label: 'ZZVITEST Health Household' }).select('id').single();
    if (error) throw new Error(error.message);
    householdId = data!.id;
    const { error: memberError } = await admin.from('household_members').insert([
      { household_id: householdId, person_id: parentId },
      { household_id: householdId, person_id: scout.personId },
      { household_id: householdId, person_id: other.personId },
      { household_id: householdId, person_id: grandparentId }
    ]);
    if (memberError) throw new Error(memberError.message);
  });
  afterAll(async () => {
    // The household rule added links (parent -> HealthB, the two scouts as siblings); keep only the fixture's own.
    const ids = [parentId, scout.personId, other.personId];
    await admin.from('relationships').delete().in('person_id', ids).in('related_person_id', ids).neq('id', relationshipId);
    await admin.from('household_members').delete().eq('household_id', householdId);
    await admin.from('households').delete().eq('id', householdId);
    await admin.from('audit_log').delete().in('entity_id', ids.map(String)).like('summary', 'Linked automatically%');
    await admin.from('people').delete().eq('id', grandparentId);
  });

  it('Adult_InAHouseholdWithScoutsTheyAreNotLinkedTo_IsToldTheirNames', async () => {
    const scope = await resolveFamilyScope(admin, grandparentId, 'adult');
    expect(await unlinkedHouseholdScouts(admin, grandparentId, scope)).toEqual(['ZZVITEST Scout HealthA', 'ZZVITEST Scout HealthB']);
  });

  it('Parent_OfOneScoutInTheHousehold_IsLinkedToEveryScout', async () => {
    const scope = await resolveFamilyScope(admin, parentId, 'adult');
    expect(await unlinkedHouseholdScouts(admin, parentId, scope)).toEqual([]);
  });

  it('Parent_LinkedToEveryScoutInTheHousehold_IsToldNothing', async () => {
    expect(await unlinkedHouseholdScouts(admin, parentId, [parentId, scout.personId, other.personId])).toEqual([]);
  });
});
