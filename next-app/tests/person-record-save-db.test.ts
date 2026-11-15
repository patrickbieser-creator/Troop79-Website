import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, type TestScout } from './helpers/signup-fixtures';

/**
 * One form, one Save (Plans/Person-Record-One-Save.md, step 3): savePersonRecord diffs the
 * posted draft against the saved record and save_person_record applies it in ONE
 * transaction. Same request-glue mocks as person-record-writes; the DB is real and every
 * row here is test-owned.
 */
const actor = { kind: 'identity', label: 'ZZ Vitest Leader', personId: null, capabilities: new Set(['roster.manage']) };
vi.mock('@/lib/require-capability', () => ({ requireCapability: async () => actor }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import { loadPersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/load-person-record';
import { draftFromRecord, type RecordDraft } from '../src/app/admin/(workspace)/advancement/roster/[personId]/record-draft';
import {
  previewPersonRecordSave,
  savePersonRecord
} from '../src/app/admin/(workspace)/advancement/roster/[personId]/save-record-actions';
import type { PersonRecord } from '../src/app/admin/(workspace)/advancement/roster/[personId]/record-types';

const admin = adminClient();

let households: number[] = [];
let adults: number[] = [];
let scouts: TestScout[] = [];
let leaderCodes: string[] = [];

async function household(label: string): Promise<number> {
  const { data, error } = await admin.from('households').insert({ label: `ZZVITEST Save ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  households.push(data!.id as number);
  return data!.id as number;
}

async function adult(last: string): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ first_name: 'ZZVITEST', last_name: last, display_name: `ZZVITEST ${last}`, active: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  adults.push(data!.id as number);
  return data!.id as number;
}

async function scout(label: string): Promise<number> {
  const s = await createTestScout(admin, label);
  scouts.push(s);
  return s.personId;
}

async function join(householdId: number, personId: number) {
  const { error } = await admin.from('household_members').insert({ household_id: householdId, person_id: personId });
  if (error) throw new Error(error.message);
}

async function record(personId: number): Promise<PersonRecord> {
  const res = await loadPersonRecord(personId);
  if (res.kind !== 'found') throw new Error(`no record for ${personId}`);
  return res.record;
}

async function draftOf(personId: number): Promise<{ rec: PersonRecord; draft: RecordDraft }> {
  const rec = await record(personId);
  return { rec, draft: structuredClone(draftFromRecord(rec)) };
}

async function linkTypes(a: number, b: number): Promise<string[]> {
  const { data } = await admin.from('relationships').select('type').eq('person_id', a).eq('related_person_id', b);
  return ((data ?? []) as { type: string }[]).map((r) => r.type).sort();
}

beforeEach(() => {
  households = [];
  adults = [];
  scouts = [];
  leaderCodes = [];
});

afterEach(async () => {
  const ids = [...adults, ...scouts.map((s) => s.personId)];
  if (ids.length) {
    await admin.from('relationships').delete().in('person_id', ids);
    await admin.from('relationships').delete().in('related_person_id', ids);
    await admin.from('household_members').delete().in('person_id', ids);
    await admin.from('person_roles').delete().in('person_id', ids);
    await admin.from('person_emails').delete().in('person_id', ids);
    await admin.from('audit_log').delete().in('entity_id', ids.map(String));
  }
  if (leaderCodes.length) await admin.from('leaders').delete().in('code', leaderCodes);
  await admin.from('leaders').delete().in('person_id', ids);
  if (households.length) await admin.from('households').delete().in('id', households);
  for (const s of scouts) await deleteTestScout(admin, s);
  if (adults.length) await admin.from('people').delete().in('id', adults);
});

describe('savePersonRecord', () => {
  it('Leader_SavesEveryChangeAtOnce_WhenFieldsAcrossSectionsEdited', async () => {
    const hhA = await household('A');
    const hhB = await household('B');
    const id = await adult('Everything');
    await join(hhA, id);
    const { draft } = await draftOf(id);
    draft.f.last_name = 'Everything Renamed';
    draft.emails.push({ email: 'zzvitest-everything@example.com', label: 'home' });
    draft.primary = 'zzvitest-everything@example.com';
    draft.roles = ['committee_member'];
    draft.householdId = String(hhB);

    const res = await savePersonRecord(id, draft);
    const after = await record(id);
    expect([
      res.ok,
      after.detail.fields.last_name,
      after.emails.map((e) => e.email),
      after.detail.roles.filter((r) => !r.end_date).map((r) => r.role),
      after.household?.id
    ]).toEqual([true, 'Everything Renamed', ['zzvitest-everything@example.com'], ['committee_member'], hhB]);
  });

  it('Leader_LosesNothing_WhenSaveFailsMidway', async () => {
    const id = await adult('Rollback');
    const other = await adult('RollbackOther');
    const taken = `ZZ${String(other).slice(-3)}`;
    leaderCodes.push(taken);
    const { error } = await admin.from('leaders').insert({ code: taken, name: 'ZZVITEST RollbackOther', person_id: other, can_login: false });
    if (error) throw new Error(error.message);

    const { draft } = await draftOf(id);
    draft.f.last_name = 'Rollback Renamed';
    draft.roles = ['adult_leader'];
    draft.initials = taken; // refused by add_leader_initials: someone else has it

    const res = await savePersonRecord(id, draft);
    const after = await record(id);
    expect([res.ok, after.detail.fields.last_name, after.detail.roles.length]).toEqual([false, 'Rollback', 0]);
  });

  it('Leader_MustPickReason_WhenMarkingScoutInactive', async () => {
    const id = await scout('SaveReason');
    const { draft } = await draftOf(id);
    draft.active = false;
    draft.reason = '';
    const res = await savePersonRecord(id, draft);
    expect(res.ok ? [] : res.problems?.map((p) => p.fieldId)).toEqual(['pr-reason']);
  });

  it('Leader_UpdatesScoutRecord_WhenEditingRelationshipFromAdult', async () => {
    const hh = await household('FromAdult');
    const mom = await adult('FromAdultMom');
    const kid = await scout('FromAdultKid');
    await join(hh, mom);
    await join(hh, kid);
    const { draft } = await draftOf(mom);
    draft.family[String(kid)] = 'parent_of>';
    await savePersonRecord(mom, draft);
    const kidRecord = await record(kid);
    expect(draftFromRecord(kidRecord).family[String(mom)]).toBe('parent_of<');
  });

  it('Leader_UpdatesAdultRecord_WhenEditingRelationshipFromScout', async () => {
    const hh = await household('FromScout');
    const mom = await adult('FromScoutMom');
    const kid = await scout('FromScoutKid');
    await join(hh, mom);
    await join(hh, kid);
    await admin.from('relationships').insert({ person_id: mom, related_person_id: kid, type: 'parent_of', is_guardian: false });
    const { draft } = await draftOf(kid);
    draft.family[String(mom)] = '';
    await savePersonRecord(kid, draft);
    const momRecord = await record(mom);
    expect(draftFromRecord(momRecord).family[String(kid)]).toBe('');
  });

  it('Leader_EndsSiblingLinks_WhenRemovingScoutFromHousehold', async () => {
    const hh = await household('Sibs');
    const a = await scout('SibA');
    const b = await scout('SibB');
    await join(hh, a);
    await join(hh, b);
    const { draft } = await draftOf(a);
    draft.householdId = '';
    draft.endLinks = true;
    await savePersonRecord(a, draft);
    expect([...(await linkTypes(a, b)), ...(await linkTypes(b, a))]).toEqual([]);
  });

  it('Leader_IsAskedAboutLinks_WhenRemovingPersonFromHousehold', async () => {
    const hh = await household('Ask');
    const dad = await adult('AskDad');
    const kid = await scout('AskKid');
    await join(hh, dad);
    await join(hh, kid);
    await admin.from('relationships').insert({ person_id: dad, related_person_id: kid, type: 'parent_of', is_guardian: false });
    const { draft } = await draftOf(dad);
    draft.householdId = '';
    draft.endLinks = true;
    const preview = await previewPersonRecordSave(dad, draft);
    expect(preview.also.map((l) => [l.person_id, l.type, l.related_person_id, l.change])).toEqual([[dad, 'parent_of', kid, 'removed']]);
  });

  it('Preview_ChangesNothing_WhenItRuns', async () => {
    const hh = await household('PreviewOnly');
    const dad = await adult('PreviewDad');
    const kid = await scout('PreviewKid');
    await join(hh, dad);
    await join(hh, kid);
    await admin.from('relationships').insert({ person_id: dad, related_person_id: kid, type: 'parent_of', is_guardian: false });
    const { draft } = await draftOf(dad);
    draft.householdId = '';
    draft.endLinks = true;
    await previewPersonRecordSave(dad, draft);
    expect(await linkTypes(dad, kid)).toEqual(['parent_of']);
  });

  it('History_HasOneRowPerPersonTouched_WhenLinksCascade', async () => {
    const hh = await household('History');
    const mom = await adult('HistoryMom');
    const a = await scout('HistoryA');
    const b = await scout('HistoryB');
    for (const p of [mom, a, b]) await join(hh, p);
    await admin.from('audit_log').delete().in('entity_id', [mom, a, b].map(String));
    const { draft } = await draftOf(mom);
    draft.family[String(a)] = 'parent_of>';
    draft.f.nickname = 'Mo';
    await savePersonRecord(mom, draft);
    const { data } = await admin.from('audit_log').select('entity_id').in('entity_id', [mom, a, b].map(String));
    const perPerson = ((data ?? []) as { entity_id: string }[]).map((r) => Number(r.entity_id)).sort((x, y) => x - y);
    expect(perPerson).toEqual([mom, a, b].sort((x, y) => x - y));
  });

  it('Leader_SeesAlsoLinked_WhenPreviewingAParentLink', async () => {
    const hh = await household('Also');
    const mom = await adult('AlsoMom');
    const a = await scout('AlsoA');
    const b = await scout('AlsoB');
    for (const p of [mom, a, b]) await join(hh, p);
    const { draft } = await draftOf(mom);
    draft.family[String(a)] = 'parent_of>';
    const preview = await previewPersonRecordSave(mom, draft);
    expect(preview.also.map((l) => [l.person_id, l.type, l.related_person_id])).toEqual([[mom, 'parent_of', b]]);
  });
});
