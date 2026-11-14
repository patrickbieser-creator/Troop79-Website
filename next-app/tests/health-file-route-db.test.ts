import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestScout, deleteTestScout, type TestScout } from './helpers/signup-fixtures';
import { memoryHealthStorage } from '../src/lib/health-files';
import { saveHealthPage, type HealthDeps, type HealthViewer } from '../src/lib/health-store';

/**
 * The one route a health file leaves through, and the family's write actions, with the session faked at
 * lib/health-access (who is signed in and who they may act for). Real local database, storage in memory.
 */
const admin = adminClient();
const storage = memoryHealthStorage();
const deps: HealthDeps = { supabase: admin, storage, today: () => '2026-11-13' };
const access = vi.hoisted(() => ({ current: null as null | { viewer: { personId: number; name: string; via: 'family' }; personIds: number[] } }));

vi.mock('../src/lib/health-access', () => ({
  healthFamilyAccess: async () => access.current,
  healthDeps: () => deps
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { GET } from '../src/app/api/health-files/[id]/route';
import { removeHealthPageAction, saveHealthDatesAction, uploadHealthPageAction } from '../src/app/(public)/member/health-forms/actions';

let mine: TestScout;
let theirs: TestScout;
let viewer: HealthViewer;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a page')]);
const PDF = Buffer.from('%PDF-1.7 form');

const get = (id: string, query = '') => GET(new Request(`https://troop.test/api/health-files/${id}${query}`), { params: Promise.resolve({ id }) });
const idOf = async (personId: number, kind = 'bsa_ab') => String((await admin.from('health_documents').select('id').eq('person_id', personId).eq('kind', kind).order('page').limit(1).single()).data!.id);
const asFamily = () => (access.current = { viewer: { personId: viewer.personId, name: viewer.name, via: 'family' }, personIds: [mine.personId] });
const count = async (personId: number) => (await admin.from('health_documents').select('id', { count: 'exact', head: true }).eq('person_id', personId)).count;

beforeAll(async () => {
  mine = await createTestScout(admin, 'RouteMine');
  theirs = await createTestScout(admin, 'RouteTheirs');
  viewer = { personId: mine.personId, name: 'ZZVITEST Parent', via: 'family' };
  await saveHealthPage({ personId: mine.personId, kind: 'bsa_ab', page: 1, bytes: JPEG }, viewer, deps);
  await saveHealthPage({ personId: mine.personId, kind: 'bsa_c', page: 1, bytes: PDF }, viewer, deps);
  await saveHealthPage({ personId: theirs.personId, kind: 'bsa_ab', page: 1, bytes: JPEG }, viewer, deps);
});
afterAll(async () => {
  for (const s of [mine, theirs]) {
    await admin.from('health_documents').delete().eq('person_id', s.personId);
    await admin.from('health_access_log').delete().eq('person_id', s.personId);
    await deleteTestScout(admin, s);
  }
});

describe('GET /api/health-files/[id]', () => {
  it('Parent_OpensTheirChildsPage', async () => {
    asFamily();
    const res = await get(await idOf(mine.personId));
    expect([res.status, Buffer.from(await res.arrayBuffer()).equals(JPEG)]).toEqual([200, true]);
  });

  it('HealthFileResponse_IsNoStore_AndInline_ForAPhoto', async () => {
    asFamily();
    const res = await get(await idOf(mine.personId));
    expect([res.headers.get('cache-control'), res.headers.get('x-content-type-options'), res.headers.get('content-type'), res.headers.get('content-disposition')]).toEqual([
      'no-store, private',
      'nosniff',
      'image/jpeg',
      'inline; filename="bsa_ab-page-1.jpg"'
    ]);
  });

  it('APdf_IsAlwaysADownload', async () => {
    asFamily();
    const res = await get(await idOf(mine.personId, 'bsa_c'));
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="bsa_c-page-1.pdf"');
  });

  it('NobodySignedIn_Gets404', async () => {
    access.current = null;
    expect((await get(await idOf(mine.personId))).status).toBe(404);
  });

  it('AnotherFamilysPage_AndAMissingPage_AnswerTheSame', async () => {
    asFamily();
    const a = await get(await idOf(theirs.personId));
    const b = await get('00000000-0000-4000-8000-000000000000');
    expect([a.status, await a.text(), a.headers.get('cache-control')]).toEqual([b.status, await b.text(), b.headers.get('cache-control')]);
  });

  it('AnotherFamilysPage_IsNotLoggedAsOpened', async () => {
    asFamily();
    await get(await idOf(theirs.personId));
    const { count: views } = await admin.from('health_access_log').select('id', { count: 'exact', head: true }).eq('person_id', theirs.personId).eq('action', 'view');
    expect(views).toBe(0);
  });
});

describe('family actions', () => {
  const form = (personId: number) => {
    const fd = new FormData();
    fd.set('personId', String(personId));
    fd.set('kind', 'insurance');
    fd.set('page', '1');
    fd.set('file', new File([JPEG], 'card.jpg', { type: 'image/jpeg' }));
    return fd;
  };

  it('Upload_ForSomeoneOutsideTheFamily_IsRefused_AndStoresNothing', async () => {
    asFamily();
    const before = await count(theirs.personId);
    const res = await uploadHealthPageAction(form(theirs.personId));
    expect([res.ok, await count(theirs.personId)]).toEqual([false, before]);
  });

  it('Upload_WithNobodySignedIn_IsRefused', async () => {
    access.current = null;
    expect((await uploadHealthPageAction(form(mine.personId))).ok).toBe(false);
  });

  it('Upload_ForTheirOwnChild_Saves', async () => {
    asFamily();
    const res = await uploadHealthPageAction(form(mine.personId));
    expect([res.ok, (await idOf(mine.personId, 'insurance')).length]).toEqual([true, 36]);
  });

  it('Dates_ForSomeoneOutsideTheFamily_AreRefused', async () => {
    asFamily();
    const res = await saveHealthDatesAction({ personId: theirs.personId, kind: 'bsa_ab', parentSigned: '2026-03-01', doctorSigned: null });
    const { data } = await admin.from('health_documents').select('expires_on').eq('person_id', theirs.personId);
    expect([res.ok, data?.[0]?.expires_on]).toEqual([false, null]);
  });

  it('Dates_WithACraftedPersonId_AreRefused', async () => {
    asFamily();
    const res = await saveHealthDatesAction({ personId: [mine.personId] as unknown as number, kind: 'bsa_ab', parentSigned: '2026-03-01', doctorSigned: null });
    expect(res.ok).toBe(false);
  });

  it('Remove_OfAnotherFamilysPage_IsRefused', async () => {
    asFamily();
    const res = await removeHealthPageAction(await idOf(theirs.personId));
    expect([res.ok, await count(theirs.personId)]).toEqual([false, 1]);
  });
});
