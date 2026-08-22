import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import {
  createTestEvent,
  deleteTestEvent,
  createTestScout,
  deleteTestScout,
  TEST_PREFIX,
  type TestEvent,
  type TestScout
} from './helpers/signup-fixtures';

/**
 * Event Logistics Phase 0, transportation schema (Plans/Event-Logistics.md §A,
 * Patrick 2026-08-22): seats are counted INCLUDING the driver, a driver's
 * usual capacity is remembered on their person record, and every attending
 * non-driver carries a ride status per leg that defaults to "needs a ride".
 *
 * seats_offered_* (seats BESIDES the driver) stays for one more release so
 * deployed clients keep working; a trigger keeps the two in step both ways.
 */
const admin = adminClient();

let event: TestEvent;
let scout: TestScout;
let adultPersonId: number;

async function insertAdult(label: string): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} Adult ${label}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  return data.id as number;
}

async function entry(
  db: SupabaseClient,
  row: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from('signup_entries')
    .insert({ event_signup_id: event.eventSignupId, status: 'yes', ...row })
    .select(
      'id, drives_out, drives_back, seats_offered_out, seats_offered_back, vehicle_seats_out, vehicle_seats_back, ride_out, ride_back'
    )
    .single();
  if (error || !data) throw new Error(`entry insert failed: ${error?.message}`);
  return data as Record<string, unknown>;
}

beforeAll(async () => {
  event = await createTestEvent(admin);
  scout = await createTestScout(admin, 'Rider');
  adultPersonId = await insertAdult('Driver');
});

afterAll(async () => {
  await deleteTestEvent(admin, event);
  await deleteTestScout(admin, scout);
  await admin.from('people').delete().eq('id', adultPersonId);
});

describe('ride status defaults (trigger + CHECK)', () => {
  it('NonDriverEntry_DefaultsToNeedsRide_OnBothLegs', async () => {
    const row = await entry(admin, { person_kind: 'scout', person_id: scout.personId });
    expect(row.ride_out).toBe('needs_ride');
    expect(row.ride_back).toBe('needs_ride');
    await admin.from('signup_entries').delete().eq('id', row.id as number);
  });

  it('DriverOnlyEntry_DefaultsNotTraveling_OnLegItDoesNotDrive', async () => {
    const row = await entry(admin, {
      person_kind: 'adult',
      person_id: adultPersonId,
      participation: 'driver_only',
      drives_out: true,
      vehicle_seats_out: 4
    });
    expect(row.ride_out).toBeNull(); // drives that leg — no ride status
    expect(row.ride_back).toBe('not_traveling'); // goes home after dropping off
    await admin.from('signup_entries').delete().eq('id', row.id as number);
  });

  it('DriverEntry_RideStatusIsNulled_WhenTheyStartDrivingThatLeg', async () => {
    const row = await entry(admin, { person_kind: 'adult', person_id: adultPersonId });
    expect(row.ride_out).toBe('needs_ride');
    const { data, error } = await admin
      .from('signup_entries')
      .update({ drives_out: true, vehicle_seats_out: 3 })
      .eq('id', row.id as number)
      .select('ride_out, ride_back')
      .single();
    expect(error).toBeNull();
    expect(data?.ride_out).toBeNull();
    expect(data?.ride_back).toBe('needs_ride');
    await admin.from('signup_entries').delete().eq('id', row.id as number);
  });

  it('NonDriverEntry_RejectsUnknownRideStatus', async () => {
    const { error } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      status: 'yes',
      person_kind: 'scout',
      person_id: scout.personId,
      ride_out: 'teleport'
    });
    expect(error).not.toBeNull();
  });
});

describe('seats including the driver', () => {
  it('VehicleSeats_SyncWithLegacySeatsOffered_BothDirections', async () => {
    // Old client: writes seats_offered (besides the driver) only.
    const legacy = await entry(admin, {
      person_kind: 'adult',
      person_id: adultPersonId,
      drives_out: true,
      seats_offered_out: 3
    });
    expect(legacy.vehicle_seats_out).toBe(4);
    await admin.from('signup_entries').delete().eq('id', legacy.id as number);

    // New client: writes vehicle seats (including the driver) only.
    const modern = await entry(admin, {
      person_kind: 'adult',
      person_id: adultPersonId,
      drives_back: true,
      vehicle_seats_back: 5
    });
    expect(modern.seats_offered_back).toBe(4);
    expect(modern.vehicle_seats_back).toBe(5);
    await admin.from('signup_entries').delete().eq('id', modern.id as number);
  });

  it('VehicleSeats_RejectsZero_ADriverIsAlwaysOneSeat', async () => {
    const { error } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      status: 'yes',
      person_kind: 'adult',
      person_id: adultPersonId,
      drives_out: true,
      vehicle_seats_out: 0
    });
    expect(error).not.toBeNull();
  });

  it('DriverDefaultVehicleSeats_IsRememberedOnPerson_WhenTheyOfferSeats', async () => {
    const row = await entry(admin, {
      person_kind: 'adult',
      person_id: adultPersonId,
      drives_out: true,
      vehicle_seats_out: 6
    });
    const { data } = await admin.from('people').select('default_vehicle_seats').eq('id', adultPersonId).single();
    expect(data?.default_vehicle_seats).toBe(6);
    await admin.from('signup_entries').delete().eq('id', row.id as number);
  });
});

describe('submit_household_signup carries the new columns', () => {
  it('SubmitHouseholdSignup_WritesVehicleSeatsAndRideStatus_WhenProvided', async () => {
    const { data, error } = await admin.rpc('submit_household_signup', {
      p_event_signup_id: event.eventSignupId,
      p_entries: [
        {
          key: 'a',
          person_kind: 'adult',
          person_id: adultPersonId,
          status: 'yes',
          drives_out: true,
          vehicle_seats_out: 4,
          ride_back: 'self'
        }
      ],
      p_actor: 'vitest',
      p_allowed_person_ids: [adultPersonId]
    });
    expect(error).toBeNull();
    const entryId = (data as { entry_id: number }[])[0].entry_id;
    const { data: row } = await admin
      .from('signup_entries')
      .select('vehicle_seats_out, seats_offered_out, ride_out, ride_back')
      .eq('id', entryId)
      .single();
    expect(row?.vehicle_seats_out).toBe(4);
    expect(row?.seats_offered_out).toBe(3);
    expect(row?.ride_out).toBeNull();
    expect(row?.ride_back).toBe('self');
    await admin.from('signup_entries').delete().eq('id', entryId);
  });
});
