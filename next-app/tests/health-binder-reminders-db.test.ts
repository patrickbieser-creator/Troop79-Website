import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, createTestScout, deleteTestEvent, deleteTestScout, type TestEvent, type TestScout } from './helpers/signup-fixtures';
import { memoryHealthStorage } from '../src/lib/health-files';
import { addDays } from '../src/lib/health-records';
import { buildHealthReminders, loadUpcomingTrip, openHealthPagesForPrint, saveHealthPage, type HealthDeps, type HealthTrip } from '../src/lib/health-store';
import { centralToday } from '../src/lib/dates';

/**
 * The binder route and Remind families against the real local database (Plans/Health-Forms.md, release 3). The
 * session is faked at lib/health-access; storage is in memory; no email leaves (the sender is a spy).
 */
const admin = adminClient();
const storage = memoryHealthStorage();
const TODAY = centralToday();
const deps: HealthDeps = { supabase: admin, storage, today: () => TODAY };
const state = vi.hoisted(() => ({ full: null as unknown }));
const sent = vi.hoisted(() => ({ mails: [] as { to: string[]; subject: string; text: string; confirm: boolean }[] }));

vi.mock('../src/lib/health-access', () => ({ healthAccess: async () => state.full, healthFamilyAccess: async () => null, healthDeps: () => deps }));
vi.mock('../src/lib/supabase/server', async () => {
  const { adminClient: client } = await import('./helpers/admin-client');
  return { createAdminClient: () => client() };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../src/lib/email', async (orig) => ({
  ...(await orig<typeof import('../src/lib/email')>()),
  sendEmail: async (m: { to: string[]; subject: string; text: string; confirm: boolean }) => {
    sent.mails.push(m);
    return { status: m.confirm ? 'sent' : 'dry-run', to: m.to };
  }
}));

import { GET } from '../src/app/api/health-binder/[personId]/route';
import { remindFamiliesAction } from '../src/app/(public)/health/actions';
import { healthReminderEmail } from '../src/lib/health-reminders';

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);
let ready: TestScout;
let missing: TestScout;
let outsider: TestScout;
let adultId: number;
let event: TestEvent;
let trip: HealthTrip;

const me = () => ({ personId: adultId, name: 'ZZVITEST Health Officer' });
const signIn = (over: Record<string, unknown>) => (state.full = { me: me(), family: [], named: false, trips: [], ...over });
const get = (personId: number, signupId = event.eventSignupId) =>
  GET(new Request(`https://troop.test/api/health-binder/${personId}?event=${signupId}`), { params: Promise.resolve({ personId: String(personId) }) });
const prints = async (personId: number) => (await admin.from('health_access_log').select('id', { count: 'exact', head: true }).eq('person_id', personId).eq('action', 'print')).count;

beforeAll(async () => {
  ready = await createTestScout(admin, 'BinderReady');
  missing = await createTestScout(admin, 'BinderMissing');
  outsider = await createTestScout(admin, 'BinderOutsider');
  const { data } = await admin.from('people').insert({ display_name: 'ZZVITEST Health Officer', primary_email: 'zzvitest-officer@example.test' }).select('id').single();
  adultId = data!.id;
  event = await createTestEvent(admin);
  const start = addDays(TODAY, 5);
  await admin.from('calendar_entries').update({ entry_date: start, end_date: addDays(start, 1), title: 'ZZVITEST Binder Camp' }).eq('id', event.calendarEntryId);
  await admin.from('event_signups').update({ deadline: '2099-01-01T00:00:00Z' }).eq('id', event.eventSignupId);
  const { error } = await admin.rpc('submit_household_signup', {
    p_event_signup_id: event.eventSignupId,
    p_entries: [
      { key: 's1', person_kind: 'scout', person_id: ready.personId, status: 'yes', answers: [] },
      { key: 's2', person_kind: 'scout', person_id: missing.personId, status: 'yes', answers: [] },
      { key: 'a', person_kind: 'adult', person_id: adultId, status: 'yes', participation: 'full', answers: [] }
    ],
    p_actor: 'vitest',
    p_allowed_person_ids: [ready.personId, missing.personId, adultId]
  });
  if (error) throw new Error(error.message);
  const parent = { personId: adultId, name: 'P', via: 'family' as const };
  for (const [kind, page] of [['bsa_ab', 1], ['insurance', 1], ['insurance', 2]] as const) await saveHealthPage({ personId: ready.personId, kind, page, bytes: JPEG }, parent, deps);
  trip = (await loadUpcomingTrip(admin, event.eventSignupId, TODAY))!;
});
afterAll(async () => {
  for (const id of [ready.personId, missing.personId, outsider.personId, adultId]) {
    await admin.from('health_documents').delete().eq('person_id', id);
    await admin.from('health_access_log').delete().eq('person_id', id);
  }
  await admin.from('health_access_log').delete().eq('viewer_person_id', adultId);
  await deleteTestEvent(admin, event);
  await admin.from('people').delete().eq('id', adultId);
  for (const s of [ready, missing, outsider]) await deleteTestScout(admin, s);
});

describe('GET /api/health-binder/[personId]', () => {
  it('NamedLeader_GetsThePersonsSection_HeaderPlusEveryPage', async () => {
    signIn({ named: true });
    const res = await get(ready.personId);
    const pdf = await PDFDocument.load(await res.arrayBuffer());
    expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control'), pdf.getPageCount()]).toEqual([200, 'application/pdf', 'no-store, private', 4]);
  });

  it('APersonWithNothingOnFile_GetsAStubSection', async () => {
    signIn({ named: true });
    const res = await get(missing.personId);
    expect([res.status, (await PDFDocument.load(await res.arrayBuffer())).getPageCount()]).toEqual([200, 1]);
  });

  it('Print_WritesOneLogLinePerPerson_NamingTheTrip', async () => {
    signIn({ named: true });
    const before = (await prints(ready.personId)) ?? 0;
    await get(ready.personId);
    const { data } = await admin.from('health_access_log').select('via, event_id, kind').eq('person_id', ready.personId).eq('action', 'print').order('id', { ascending: false }).limit(1).single();
    expect([(await prints(ready.personId))! - before, data]).toEqual([1, { via: 'named', event_id: event.calendarEntryId, kind: 'record' }]);
  });

  it('AnAdultWhoIsOnlyOnTheTrip_CannotPrint', async () => {
    signIn({ trips: [trip] });
    const before = await prints(ready.personId);
    expect([(await get(ready.personId)).status, await prints(ready.personId)]).toEqual([404, before]);
  });

  it('SomeoneNotGoing_IsNotInTheBinder', async () => {
    signIn({ named: true });
    expect((await get(outsider.personId)).status).toBe(404);
  });

  it('AnUnknownTrip_Is404', async () => {
    signIn({ named: true });
    expect((await get(ready.personId, 2147483000)).status).toBe(404);
  });

  it('NobodySignedIn_Is404', async () => {
    state.full = null;
    expect((await get(ready.personId)).status).toBe(404);
  });
});

describe('openHealthPagesForPrint', () => {
  it('AFileGoneFromStorage_ComesBackWithNoBytes_NotAnError', async () => {
    const lonely = memoryHealthStorage();
    const pages = await openHealthPagesForPrint(ready.personId, { ...me(), via: 'named' }, { ...deps, storage: lonely });
    expect([pages.length, pages.every((p) => p.bytes === null)]).toEqual([3, true]);
  });
});

describe('buildHealthReminders', () => {
  const emails = async (id: number) => (id === missing.personId ? ['Mom@Example.test ', 'dad@example.test'] : id === adultId ? ['dad@example.test', 'mom@example.test'] : []);

  it('OnlyPeopleWithSomethingMissing_AreReminded', async () => {
    const { groups } = await buildHealthReminders(admin, trip, TODAY, emails, (d) => d);
    expect(groups.flatMap((g) => g.people.map((p) => p.name)).sort()).toEqual(['ZZVITEST Health Officer', 'ZZVITEST Scout BinderMissing']);
  });

  it('PeopleWhoShareTheSameAddresses_GetOneEmail', async () => {
    const { groups } = await buildHealthReminders(admin, trip, TODAY, emails, (d) => d);
    expect(groups.map((g) => [g.to, g.people.length])).toEqual([[['dad@example.test', 'mom@example.test'], 2]]);
  });

  it('SomeoneWithNoAddress_IsListedToAskInPerson', async () => {
    const { groups, noEmail } = await buildHealthReminders(admin, trip, TODAY, async () => [], (d) => d);
    expect([groups, noEmail.sort()]).toEqual([[], ['ZZVITEST Health Officer', 'ZZVITEST Scout BinderMissing']]);
  });
});

describe('the reminder email', () => {
  it('NamesTheDocuments_AndLinksToTheUploadPage_NothingMedical', () => {
    const mail = healthReminderEmail(trip, { to: ['a@example.test'], people: [{ name: 'Ben Example', needs: ['Insurance card: missing'] }] }, 'https://troop.test');
    expect([mail.subject, mail.text.includes('Ben Example: Insurance card: missing'), mail.text.includes('https://troop.test/member/health-forms')]).toEqual([
      'Troop 79: health forms needed for ZZVITEST Binder Camp',
      true,
      true
    ]);
  });
});

describe('remindFamiliesAction', () => {
  it('Preview_SendsNothing_AndSaysWhoWouldBeWritten', async () => {
    signIn({ named: true });
    sent.mails.length = 0;
    const res = await remindFamiliesAction(event.eventSignupId, false);
    expect([res.ok && res.outcome.sent, res.ok && res.outcome.to, sent.mails.length]).toEqual([false, ['zzvitest-officer@example.test'], 0]);
  });

  it('Send_EmailsEachFamilyOnce', async () => {
    signIn({ named: true });
    sent.mails.length = 0;
    const res = await remindFamiliesAction(event.eventSignupId, true);
    expect([res.ok && res.outcome.sent, res.ok && res.outcome.failed, sent.mails.map((m) => [m.to, m.confirm])]).toEqual([true, 0, [[['zzvitest-officer@example.test'], true]]]);
  });

  it('AScoutWithNoParentOnFile_IsListedToAskInPerson', async () => {
    signIn({ named: true });
    const res = await remindFamiliesAction(event.eventSignupId, false);
    expect(res.ok && res.outcome.noEmail).toEqual(['ZZVITEST Scout BinderMissing']);
  });

  it('AnAdultWhoIsOnlyOnTheTrip_CannotSendReminders', async () => {
    signIn({ trips: [trip] });
    sent.mails.length = 0;
    expect([(await remindFamiliesAction(event.eventSignupId, true)).ok, sent.mails.length]).toEqual([false, 0]);
  });
});
