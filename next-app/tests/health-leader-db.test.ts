import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, createTestScout, deleteTestEvent, deleteTestScout, type TestEvent, type TestScout } from './helpers/signup-fixtures';
import { memoryHealthStorage } from '../src/lib/health-files';
import { addDays } from '../src/lib/health-records';
import {
  grantHealthViewer,
  healthViewerFor,
  isHealthViewer,
  isYouthOnRoster,
  listHealthReviews,
  listHealthViewers,
  loadTripsForAdult,
  loadUpcomingTrips,
  logHealthRecordOpen,
  removeHealthPage,
  revokeHealthViewer,
  saveHealthPage,
  setHealthReviewed,
  type HealthAccess,
  type HealthDeps
} from '../src/lib/health-store';

/**
 * The leader side of health records against the real local database (Plans/Health-Forms.md, release 2): the trip
 * window computed from a sign-up, the named list, and the review tick.
 */
const admin = adminClient();
const TODAY = '2026-11-13';
const deps: HealthDeps = { supabase: admin, storage: memoryHealthStorage(), today: () => TODAY };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('p')]);
let scout: TestScout;
let adultId: number;
let bystanderId: number;
const events: TestEvent[] = [];

async function person(name: string): Promise<number> {
  const { data, error } = await admin.from('people').insert({ display_name: `ZZVITEST ${name}` }).select('id').single();
  if (error) throw new Error(error.message);
  return data!.id;
}

/** An event starting `startsIn` days from TODAY with the scout and the adult both going. */
async function trip(startsIn: number, opts: { days?: number; adultStatus?: string; partC?: boolean } = {}): Promise<TestEvent> {
  const event = await createTestEvent(admin);
  events.push(event);
  const start = addDays(TODAY, startsIn);
  await admin.from('calendar_entries').update({ entry_date: start, end_date: addDays(start, (opts.days ?? 1) - 1) }).eq('id', event.calendarEntryId);
  await admin.from('event_signups').update({ deadline: '2099-01-01T00:00:00Z', needs_ahmr_c: opts.partC === true }).eq('id', event.eventSignupId);
  const { error } = await admin.rpc('submit_household_signup', {
    p_event_signup_id: event.eventSignupId,
    p_entries: [
      { key: 's', person_kind: 'scout', person_id: scout.personId, status: 'yes', answers: [] },
      { key: 'a', person_kind: 'adult', person_id: adultId, status: opts.adultStatus ?? 'yes', participation: 'full', answers: [] }
    ],
    p_actor: 'vitest',
    p_allowed_person_ids: [scout.personId, adultId]
  });
  if (error) throw new Error(error.message);
  return event;
}

async function clearTrips() {
  while (events.length) await deleteTestEvent(admin, events.pop()!);
}

beforeAll(async () => {
  scout = await createTestScout(admin, 'TripScout');
  adultId = await person('Trip Adult');
  bystanderId = await person('Bystander');
});
afterAll(async () => {
  await clearTrips();
  await admin.from('health_viewers').delete().in('person_id', [adultId, bystanderId]);
  for (const id of [scout.personId, adultId, bystanderId]) {
    await admin.from('health_documents').delete().eq('person_id', id);
    await admin.from('health_access_log').delete().eq('person_id', id);
    await admin.from('health_access_log').delete().eq('viewer_person_id', id);
  }
  await admin.from('people').delete().in('id', [adultId, bystanderId]);
  await deleteTestScout(admin, scout);
});

describe('loadTripsForAdult', () => {
  it('TripLeader_CanView_AttendeesFromSevenDaysBefore', async () => {
    await clearTrips();
    const event = await trip(7);
    const trips = await loadTripsForAdult(admin, adultId, TODAY);
    expect(trips.map((t) => [t.eventId, t.attendeeIds.includes(scout.personId), t.attendeeIds.includes(adultId)])).toEqual([[event.calendarEntryId, true, true]]);
  });

  it('TripLeader_IsRefused_EightDaysBefore', async () => {
    await clearTrips();
    await trip(8);
    expect(await loadTripsForAdult(admin, adultId, TODAY)).toEqual([]);
  });

  it('TripLeader_CanView_UntilTwoDaysAfterItEnds', async () => {
    await clearTrips();
    await trip(-4, { days: 3 });
    expect((await loadTripsForAdult(admin, adultId, TODAY)).length).toBe(1);
  });

  it('TripLeader_IsRefused_ThreeDaysAfterItEnds', async () => {
    await clearTrips();
    await trip(-5, { days: 3 });
    expect(await loadTripsForAdult(admin, adultId, TODAY)).toEqual([]);
  });

  it('AnAdultWhoSaidNo_HasNoTrip', async () => {
    await clearTrips();
    await trip(2, { adultStatus: 'no' });
    expect(await loadTripsForAdult(admin, adultId, TODAY)).toEqual([]);
  });

  it('AnAdultWhoIsOnlyDriving_HasNoTrip', async () => {
    await clearTrips();
    const event = await trip(2);
    const { error } = await admin.from('signup_entries').update({ participation: 'driver_only', drives_out: true, vehicle_seats_out: 4 }).eq('event_signup_id', event.eventSignupId).eq('person_id', adultId);
    expect([error, await loadTripsForAdult(admin, adultId, TODAY)]).toEqual([null, []]);
  });

  it('AScoutEnteredAsAnAdult_HasNoTrip', async () => {
    await clearTrips();
    const event = await trip(2);
    await admin.from('signup_entries').update({ person_kind: 'adult' }).eq('event_signup_id', event.eventSignupId).eq('person_id', scout.personId);
    expect([await isYouthOnRoster(admin, scout.personId), await loadTripsForAdult(admin, scout.personId, TODAY)]).toEqual([true, []]);
  });

  it('AScoutOnTheTrip_HasNoTrip', async () => {
    await clearTrips();
    await trip(2);
    expect(await loadTripsForAdult(admin, scout.personId, TODAY)).toEqual([]);
  });

  it('AnAdultNotSignedUp_HasNoTrip', async () => {
    await clearTrips();
    await trip(2);
    expect(await loadTripsForAdult(admin, bystanderId, TODAY)).toEqual([]);
  });

  it('Trip_CarriesWhetherPartCIsNeeded', async () => {
    await clearTrips();
    await trip(2, { partC: true });
    expect((await loadTripsForAdult(admin, adultId, TODAY))[0].needsPartC).toBe(true);
  });
});

describe('loadUpcomingTrips', () => {
  it('NamedLeader_SeesAnEventWeeksAway_ThatATripAdultCannotYet', async () => {
    await clearTrips();
    const event = await trip(30);
    const upcoming = (await loadUpcomingTrips(admin, TODAY)).map((t) => t.eventId);
    expect([upcoming.includes(event.calendarEntryId), (await loadTripsForAdult(admin, adultId, TODAY)).length]).toEqual([true, 0]);
  });

  it('AnEventThatEndedLastWeek_IsNotListed', async () => {
    await clearTrips();
    const event = await trip(-10);
    expect((await loadUpcomingTrips(admin, TODAY)).map((t) => t.eventId)).not.toContain(event.calendarEntryId);
  });
});

describe('healthViewerFor', () => {
  const access = (over: Partial<HealthAccess>): HealthAccess => ({ me: { personId: 1, name: 'Dana' }, family: [], named: false, trips: [], ...over });
  const fallCamp = { signupId: 3, eventId: 9, title: 'Fall Camp', entryDate: '2026-11-14', endDate: null, needsPartC: false, attendeeIds: [5] };

  it('Family_ComesFirst_EvenForANamedLeader', () => {
    expect(healthViewerFor(access({ family: [5], named: true }), 5)?.via).toBe('family');
  });

  it('Named_OpensAnyone', () => {
    expect(healthViewerFor(access({ named: true }), 99)?.via).toBe('named');
  });

  it('Trip_OpensAnAttendee_AndNamesTheEvent', () => {
    expect(healthViewerFor(access({ trips: [fallCamp] }), 5)).toMatchObject({ via: 'trip', eventId: 9 });
  });

  it('Trip_DoesNotOpenSomeoneNotGoing', () => {
    expect(healthViewerFor(access({ trips: [fallCamp] }), 6)).toBeNull();
  });

  it('NoWayIn_IsNull', () => {
    expect(healthViewerFor(access({}), 5)).toBeNull();
  });
});

describe('the named list', () => {
  it('Grant_AddsAnAdult', async () => {
    await admin.from('health_viewers').delete().eq('person_id', adultId);
    const res = await grantHealthViewer(admin, adultId, bystanderId);
    expect([res.ok, await isHealthViewer(admin, adultId), (await listHealthViewers(admin)).some((v) => v.personId === adultId)]).toEqual([true, true, true]);
  });

  it('Grant_RefusesAScout', async () => {
    const res = await grantHealthViewer(admin, scout.personId, adultId);
    expect([res.ok, await isHealthViewer(admin, scout.personId)]).toEqual([false, false]);
  });

  it('Grant_RefusesSomeoneNotOnTheRoster', async () => {
    expect((await grantHealthViewer(admin, 2147483001, adultId)).ok).toBe(false);
  });

  it('Grant_RefusesAWebelos', async () => {
    const { error } = await admin.from('scouts').update({ active: false, is_webelos: true }).eq('id', scout.scoutId);
    const res = await grantHealthViewer(admin, scout.personId, adultId);
    await admin.from('scouts').update({ active: true, is_webelos: false }).eq('id', scout.scoutId);
    expect([error, res.ok]).toEqual([null, false]);
  });

  it('Grant_AllowsAnAgedOutScout_NowAnAdult', async () => {
    const { error } = await admin.from('scouts').update({ active: false, inactive_reason: 'aged_out' }).eq('id', scout.scoutId);
    const res = await grantHealthViewer(admin, scout.personId, adultId);
    await admin.from('health_viewers').delete().eq('person_id', scout.personId);
    await admin.from('scouts').update({ active: true, inactive_reason: null }).eq('id', scout.scoutId);
    expect([error, res.ok]).toEqual([null, true]);
  });

  it('Revoke_OfSomeoneNotOnTheList_SaysSo', async () => {
    await admin.from('health_viewers').delete().eq('person_id', bystanderId);
    expect(await revokeHealthViewer(admin, bystanderId)).toEqual({ ok: false, error: 'That person is already off the list.' });
  });

  it('Revoke_TakesAnAdultOff', async () => {
    await grantHealthViewer(admin, bystanderId, adultId);
    const res = await revokeHealthViewer(admin, bystanderId);
    expect([res.ok, await isHealthViewer(admin, bystanderId)]).toEqual([true, false]);
  });
});

describe('the review tick', () => {
  const by = () => ({ personId: adultId, name: 'ZZVITEST Trip Adult' });
  const reviewed = async () => (await listHealthReviews(admin, [scout.personId])).has(scout.personId);

  it('Review_IsRecorded_WithWhoAndWhen', async () => {
    await setHealthReviewed(admin, scout.personId, true, by());
    expect((await listHealthReviews(admin, [scout.personId])).get(scout.personId)?.byName).toBe('ZZVITEST Trip Adult');
  });

  it('Review_CanBeTakenBack', async () => {
    await setHealthReviewed(admin, scout.personId, true, by());
    await setHealthReviewed(admin, scout.personId, false, by());
    expect(await reviewed()).toBe(false);
  });

  it('ReplacingADocument_ClearsTheReview', async () => {
    const parent = { personId: adultId, name: 'P', via: 'family' as const };
    await saveHealthPage({ personId: scout.personId, kind: 'bsa_ab', page: 1, bytes: JPEG }, parent, deps);
    await setHealthReviewed(admin, scout.personId, true, by());
    await saveHealthPage({ personId: scout.personId, kind: 'bsa_ab', page: 1, bytes: JPEG }, parent, deps);
    expect(await reviewed()).toBe(false);
  });

  it('RemovingADocument_ClearsTheReview', async () => {
    const parent = { personId: adultId, name: 'P', via: 'family' as const };
    await saveHealthPage({ personId: scout.personId, kind: 'insurance', page: 1, bytes: JPEG }, parent, deps);
    await setHealthReviewed(admin, scout.personId, true, by());
    const { data } = await admin.from('health_documents').select('id').eq('person_id', scout.personId).eq('kind', 'insurance').single();
    await removeHealthPage(String(data!.id), [scout.personId], parent, deps);
    expect(await reviewed()).toBe(false);
  });
});

describe('opening a record page', () => {
  it('ALeaderOpeningAPersonsPage_IsLogged_WithTheTrip', async () => {
    await logHealthRecordOpen(scout.personId, { personId: adultId, name: 'ZZVITEST Trip Adult', via: 'trip', eventId: null }, deps);
    const { data } = await admin.from('health_access_log').select('action, via, kind').eq('person_id', scout.personId).order('id', { ascending: false }).limit(1).single();
    expect(data).toEqual({ action: 'view', via: 'trip', kind: 'record' });
  });
});
