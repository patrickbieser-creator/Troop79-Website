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
type Full = { me: { personId: number; name: string }; family: number[]; named: boolean; trips: { signupId: number; eventId: number; title: string; entryDate: string; endDate: string | null; needsPartC: boolean; attendeeIds: number[] }[] };
const state = vi.hoisted(() => ({ full: null as unknown }));
const access = {
  /** The family view of the same sign-in, as lib/health-access derives it. */
  get current() {
    const f = state.full as Full | null;
    return f ? { viewer: { personId: f.me.personId, name: f.me.name, via: 'family' as const }, personIds: f.family } : null;
  },
  set current(v: unknown) {
    state.full = v;
  }
};

vi.mock('../src/lib/health-access', () => ({
  healthFamilyAccess: async () => access.current,
  healthAccess: async () => state.full,
  healthDeps: () => deps
}));
vi.mock('../src/lib/supabase/server', async () => {
  const { adminClient: client } = await import('./helpers/admin-client');
  return { createAdminClient: () => client() };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { GET } from '../src/app/api/health-files/[id]/route';
import { removeHealthPageAction, saveHealthDatesAction, uploadHealthPageAction } from '../src/app/(public)/member/health-forms/actions';
import { grantHealthViewerAction, revokeHealthViewerAction, setHealthReviewedAction } from '../src/app/(public)/health/actions';
import { isHealthViewer } from '../src/lib/health-store';

let mine: TestScout;
let theirs: TestScout;
let viewer: HealthViewer;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a page')]);
const PDF = Buffer.from('%PDF-1.7 form');

const get = (id: string, query = '') => GET(new Request(`https://troop.test/api/health-files/${id}${query}`), { params: Promise.resolve({ id }) });
const idOf = async (personId: number, kind = 'bsa_ab') => String((await admin.from('health_documents').select('id').eq('person_id', personId).eq('kind', kind).order('page').limit(1).single()).data!.id);
const me = () => ({ personId: viewer.personId, name: viewer.name });
const signIn = (over: Partial<Full>) => (state.full = { me: me(), family: [], named: false, trips: [], ...over } satisfies Full);
const asFamily = () => signIn({ family: [mine.personId] });
const trip = (attendeeIds: number[]) => ({ signupId: 1, eventId: 77, title: 'Fall Camp', entryDate: '2026-11-14', endDate: '2026-11-15', needsPartC: false, attendeeIds });
const lastLog = async (personId: number) =>
  (await admin.from('health_access_log').select('action, via, event_id, kind').eq('person_id', personId).order('id', { ascending: false }).limit(1).single()).data as { action: string; via: string; event_id: number | null; kind: string };
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
    await admin.from('health_access_log').delete().eq('viewer_person_id', s.personId);
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

describe('GET /api/health-files/[id] — the leader side', () => {
  it('Leader_CanViewRecords_WhenOnTheNamedList', async () => {
    signIn({ named: true });
    const res = await get(await idOf(theirs.personId));
    expect([res.status, (await lastLog(theirs.personId)).via]).toEqual([200, 'named']);
  });

  it('TripLeader_CanView_AnAttendee_AndTheLogNamesTheTrip', async () => {
    signIn({ trips: [trip([theirs.personId])] });
    const res = await get(await idOf(theirs.personId));
    const log = await lastLog(theirs.personId);
    expect([res.status, log.via, log.event_id]).toEqual([200, 'trip', 77]);
  });

  it('TripLeader_IsRefused_ForSomeoneNotOnTheirEvent', async () => {
    signIn({ trips: [trip([mine.personId])] });
    expect((await get(await idOf(theirs.personId))).status).toBe(404);
  });

  it('Leader_CannotViewRecords_WithNoWayIn', async () => {
    signIn({});
    expect((await get(await idOf(theirs.personId))).status).toBe(404);
  });

  it('AParentOnTheNamedList_OpeningTheirOwnChild_IsLoggedAsFamily', async () => {
    signIn({ family: [mine.personId], named: true });
    await get(await idOf(mine.personId));
    expect((await lastLog(mine.personId)).via).toBe('family');
  });
});

describe('leader actions', () => {
  it('Review_ByAnAdultWhoIsOnlyOnTheTrip_IsRefused', async () => {
    signIn({ trips: [trip([theirs.personId])] });
    const res = await setHealthReviewedAction(theirs.personId, true);
    const { count: reviews } = await admin.from('health_reviews').select('person_id', { count: 'exact', head: true }).eq('person_id', theirs.personId);
    expect([res.ok, reviews]).toEqual([false, 0]);
  });

  it('Review_ByANamedLeader_IsRecordedWithTheirName', async () => {
    signIn({ named: true });
    const res = await setHealthReviewedAction(theirs.personId, true);
    const { data } = await admin.from('health_reviews').select('reviewed_by_name').eq('person_id', theirs.personId).single();
    expect([res.ok, data?.reviewed_by_name]).toEqual([true, 'ZZVITEST Parent']);
  });

  it('Grant_ByAnyoneNotOnTheNamedList_IsRefused', async () => {
    signIn({ family: [mine.personId] });
    const res = await grantHealthViewerAction(viewer.personId);
    expect([res.ok, await isHealthViewer(admin, viewer.personId)]).toEqual([false, false]);
  });

  it('Revoke_ByAnyoneNotOnTheNamedList_IsRefused', async () => {
    signIn({});
    expect((await revokeHealthViewerAction(82)).ok).toBe(false);
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
