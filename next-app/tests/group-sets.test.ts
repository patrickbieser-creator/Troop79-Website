import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
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
 * Event Logistics Phase 0, group sets (Plans/Event-Logistics.md §B): each
 * grouping column of the campout sheet is a set, each value a group, each row
 * a membership. Cars are a set with a leg and a driver, owned by a trigger.
 */
const admin = adminClient();

let event: TestEvent;
const scouts: TestScout[] = [];
let driverPersonId: number;

async function insertAdult(label: string): Promise<number> {
  const { data, error } = await admin
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} Adult ${label}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
  return data.id as number;
}

async function addEntry(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin
    .from('signup_entries')
    .insert({ event_signup_id: event.eventSignupId, status: 'yes', ...row })
    .select('id')
    .single();
  if (error || !data) throw new Error(`entry insert failed: ${error?.message}`);
  return data.id as number;
}

async function addSet(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin
    .from('signup_group_sets')
    .insert({ event_signup_id: event.eventSignupId, ...row })
    .select('id')
    .single();
  if (error || !data) throw new Error(`set insert failed: ${error?.message}`);
  return data.id as number;
}

async function addGroup(setId: number, name: string, capacity: number | null): Promise<number> {
  const { data, error } = await admin
    .from('signup_groups')
    .insert({ set_id: setId, name, capacity })
    .select('id')
    .single();
  if (error || !data) throw new Error(`group insert failed: ${error?.message}`);
  return data.id as number;
}

async function place(groupId: number, entryId: number): Promise<string> {
  const { data, error } = await admin.rpc('place_in_group', {
    p_group_id: groupId,
    p_entry_id: entryId,
    p_actor: 'vitest'
  });
  if (error) throw new Error(`place_in_group failed: ${error.message}`);
  return data as string;
}

async function carGroupFor(entryId: number, leg: 'out' | 'back') {
  const { data } = await admin
    .from('signup_groups')
    .select('id, capacity, set_id, signup_group_sets!inner(kind, leg)')
    .eq('driver_entry_id', entryId)
    .eq('signup_group_sets.leg', leg)
    .maybeSingle();
  return data as { id: number; capacity: number; set_id: number } | null;
}

beforeAll(async () => {
  event = await createTestEvent(admin);
  for (const label of ['A', 'B', 'C', 'D', 'E']) scouts.push(await createTestScout(admin, `Grp${label}`));
  driverPersonId = await insertAdult('GrpDriver');
});

afterAll(async () => {
  await deleteTestEvent(admin, event);
  for (const s of scouts) await deleteTestScout(admin, s);
  await admin.from('people').delete().eq('id', driverPersonId);
});

// Every test starts with no entries/sets on the fixture event.
afterEach(async () => {
  await admin.from('signup_entries').delete().eq('event_signup_id', event.eventSignupId);
  await admin.from('signup_group_sets').delete().eq('event_signup_id', event.eventSignupId);
  await admin.from('event_signups').update({ drivers_needed: false }).eq('id', event.eventSignupId);
});

describe('RLS posture', () => {
  it('AnonKey_CannotReadSignupGroupTables', async () => {
    const setId = await addSet({ kind: 'tent', label: 'Tents' });
    const groupId = await addGroup(setId, 'Tent 1', 2);
    const entryId = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    expect(await place(groupId, entryId)).toBe('placed');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const table of ['signup_group_sets', 'signup_groups', 'signup_group_members']) {
      const { data } = await anon.from(table).select('*');
      expect(data ?? []).toHaveLength(0);
    }
  });
});

describe('sets and groups', () => {
  it('GroupSet_RequiresLegForCars_AndForbidsLegOtherwise', async () => {
    const { error: noLeg } = await admin
      .from('signup_group_sets')
      .insert({ event_signup_id: event.eventSignupId, kind: 'car', label: 'Cars' });
    expect(noLeg).not.toBeNull();
    const { error: tentLeg } = await admin
      .from('signup_group_sets')
      .insert({ event_signup_id: event.eventSignupId, kind: 'tent', label: 'Tents', leg: 'out' });
    expect(tentLeg).not.toBeNull();
  });

  it('MemberRow_FillsSetIdFromGroup_AndRejectsSecondGroupInSameSet', async () => {
    const setId = await addSet({ kind: 'patrol', label: 'Patrols' });
    const kraken = await addGroup(setId, 'Kraken', null);
    const eagles = await addGroup(setId, 'Screaming Eagles', null);
    const entryId = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });

    const { data, error } = await admin
      .from('signup_group_members')
      .insert({ group_id: kraken, entry_id: entryId })
      .select('set_id')
      .single();
    expect(error).toBeNull();
    expect(data?.set_id).toBe(setId);

    const { error: second } = await admin
      .from('signup_group_members')
      .insert({ group_id: eagles, entry_id: entryId });
    expect(second).not.toBeNull();
  });

  it('MemberRow_RejectsEntryFromAnotherEvent', async () => {
    const other = await createTestEvent(admin);
    try {
      const setId = await addSet({ kind: 'tent', label: 'Tents' });
      const groupId = await addGroup(setId, 'Tent 1', null);
      const { data: foreign } = await admin
        .from('signup_entries')
        .insert({
          event_signup_id: other.eventSignupId,
          status: 'yes',
          person_kind: 'scout',
          person_id: scouts[1].personId
        })
        .select('id')
        .single();
      const { error } = await admin
        .from('signup_group_members')
        .insert({ group_id: groupId, entry_id: foreign!.id });
      expect(error).not.toBeNull();
    } finally {
      await deleteTestEvent(admin, other);
    }
  });

  it('CancelledEntry_LosesAllPlacements', async () => {
    const setId = await addSet({ kind: 'tent', label: 'Tents' });
    const groupId = await addGroup(setId, 'Tent 1', null);
    const entryId = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    expect(await place(groupId, entryId)).toBe('placed');
    await admin.from('signup_entries').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', entryId);
    const { data } = await admin.from('signup_group_members').select('group_id').eq('entry_id', entryId);
    expect(data).toHaveLength(0);
  });
});

describe('place_in_group RPC', () => {
  let setId: number;
  let tentA: number;
  let tentB: number;
  beforeEach(async () => {
    setId = await addSet({ kind: 'tent', label: 'Tents' });
    tentA = await addGroup(setId, 'Tent A', 3);
    tentB = await addGroup(setId, 'Tent B', 1);
  });

  it('PlaceInGroup_Places_ThenReportsAlready', async () => {
    const e = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    expect(await place(tentA, e)).toBe('placed');
    expect(await place(tentA, e)).toBe('already');
  });

  it('PlaceInGroup_RejectsFullGroup', async () => {
    const e1 = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    const e2 = await addEntry({ person_kind: 'scout', person_id: scouts[1].personId });
    expect(await place(tentB, e1)).toBe('placed');
    expect(await place(tentB, e2)).toBe('full');
  });

  it('PlaceInGroup_RejectsNthPlusOne_UnderConcurrentCalls', async () => {
    const ids: number[] = [];
    for (const s of scouts) ids.push(await addEntry({ person_kind: 'scout', person_id: s.personId }));
    const results = await Promise.all(ids.map((id) => place(tentA, id))); // capacity 3, 5 callers
    expect(results.filter((r) => r === 'placed')).toHaveLength(3);
    expect(results.filter((r) => r === 'full')).toHaveLength(2);
    const { count } = await admin
      .from('signup_group_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', tentA);
    expect(count).toBe(3);
  });

  it('PlaceInGroup_MovesMember_WhenAlreadyInAnotherGroupOfSameSet', async () => {
    const e = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    expect(await place(tentA, e)).toBe('placed');
    expect(await place(tentB, e)).toBe('moved');
    const { data } = await admin.from('signup_group_members').select('group_id').eq('entry_id', e);
    expect(data?.map((r) => r.group_id)).toEqual([tentB]);
  });

  it('PlaceInGroup_ReturnsGone_WhenGroupNoLongerExists', async () => {
    const e = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    await admin.from('signup_groups').delete().eq('id', tentB);
    expect(await place(tentB, e)).toBe('gone');
  });

  it('PlaceInGroup_RejectsCancelledEntry', async () => {
    const e = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId, status: 'cancelled' });
    const { error } = await admin.rpc('place_in_group', { p_group_id: tentA, p_entry_id: e, p_actor: 'vitest' });
    expect(error).not.toBeNull();
  });

  it('UnplaceFromGroup_RemovesMembership', async () => {
    const e = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    expect(await place(tentA, e)).toBe('placed');
    const { error } = await admin.rpc('unplace_from_group', { p_group_id: tentA, p_entry_id: e });
    expect(error).toBeNull();
    const { data } = await admin.from('signup_group_members').select('group_id').eq('entry_id', e);
    expect(data).toHaveLength(0);
  });
});

describe('cars are trigger-owned groups', () => {
  it('CarSets_AreCreated_WhenDriversNeededTurnsOn', async () => {
    await admin.from('event_signups').update({ drivers_needed: true }).eq('id', event.eventSignupId);
    const { data } = await admin
      .from('signup_group_sets')
      .select('kind, leg')
      .eq('event_signup_id', event.eventSignupId)
      .eq('kind', 'car')
      .order('leg');
    expect(data?.map((r) => r.leg)).toEqual(['back', 'out']);
  });

  it('CarGroup_IsCreatedSizedAndDriverSeated_WhenEntryDrivesLeg', async () => {
    await admin.from('event_signups').update({ drivers_needed: true }).eq('id', event.eventSignupId);
    const driver = await addEntry({
      person_kind: 'adult',
      person_id: driverPersonId,
      drives_out: true,
      vehicle_seats_out: 4
    });
    const car = await carGroupFor(driver, 'out');
    expect(car).not.toBeNull();
    expect(car!.capacity).toBe(4);
    expect(await carGroupFor(driver, 'back')).toBeNull();
    const { data: members } = await admin
      .from('signup_group_members')
      .select('entry_id, role')
      .eq('group_id', car!.id);
    expect(members).toEqual([{ entry_id: driver, role: 'driver' }]);
  });

  it('CarGroup_ResizesAndFollowsLegs_WhenDriverChangesTheirOffer', async () => {
    await admin.from('event_signups').update({ drivers_needed: true }).eq('id', event.eventSignupId);
    const driver = await addEntry({
      person_kind: 'adult',
      person_id: driverPersonId,
      drives_out: true,
      vehicle_seats_out: 4
    });
    await admin
      .from('signup_entries')
      .update({ vehicle_seats_out: 6, drives_back: true, vehicle_seats_back: 3 })
      .eq('id', driver);
    expect((await carGroupFor(driver, 'out'))!.capacity).toBe(6);
    expect((await carGroupFor(driver, 'back'))!.capacity).toBe(3);
    await admin.from('signup_entries').update({ drives_out: false, vehicle_seats_out: null }).eq('id', driver);
    expect(await carGroupFor(driver, 'out')).toBeNull();
  });

  it('CarGroup_CountsTheDriverAgainstCapacity', async () => {
    await admin.from('event_signups').update({ drivers_needed: true }).eq('id', event.eventSignupId);
    const driver = await addEntry({
      person_kind: 'adult',
      person_id: driverPersonId,
      drives_out: true,
      vehicle_seats_out: 2 // driver + one rider
    });
    const car = await carGroupFor(driver, 'out');
    const r1 = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    const r2 = await addEntry({ person_kind: 'scout', person_id: scouts[1].personId });
    expect(await place(car!.id, r1)).toBe('placed');
    expect(await place(car!.id, r2)).toBe('full');
  });

  it('CarGroup_IsRetiredAndRidersReleased_WhenDriverCancels', async () => {
    await admin.from('event_signups').update({ drivers_needed: true }).eq('id', event.eventSignupId);
    const driver = await addEntry({
      person_kind: 'adult',
      person_id: driverPersonId,
      drives_out: true,
      vehicle_seats_out: 4
    });
    const car = await carGroupFor(driver, 'out');
    const rider = await addEntry({ person_kind: 'scout', person_id: scouts[0].personId });
    expect(await place(car!.id, rider)).toBe('placed');
    await admin
      .from('signup_entries')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', driver);
    expect(await carGroupFor(driver, 'out')).toBeNull();
    const { data } = await admin.from('signup_group_members').select('group_id').eq('entry_id', rider);
    expect(data).toHaveLength(0);
    const { data: riderRow } = await admin.from('signup_entries').select('ride_out').eq('id', rider).single();
    expect(riderRow?.ride_out).toBe('needs_ride'); // still needs one — placement was what satisfied it
  });

  it('CarGroup_CannotBeCreatedByDirectInsert_OnlyByTheTrigger', async () => {
    await admin.from('event_signups').update({ drivers_needed: true }).eq('id', event.eventSignupId);
    const { data: set } = await admin
      .from('signup_group_sets')
      .select('id')
      .eq('event_signup_id', event.eventSignupId)
      .eq('kind', 'car')
      .eq('leg', 'out')
      .single();
    const { error } = await admin.from('signup_groups').insert({ set_id: set!.id, name: 'Phantom car', capacity: 4 });
    expect(error).not.toBeNull();
  });

  it('UnplaceFromGroup_RefusesToRemoveTheDriverFromTheirOwnCar', async () => {
    await admin.from('event_signups').update({ drivers_needed: true }).eq('id', event.eventSignupId);
    const driver = await addEntry({
      person_kind: 'adult',
      person_id: driverPersonId,
      drives_out: true,
      vehicle_seats_out: 4
    });
    const car = await carGroupFor(driver, 'out');
    const { error } = await admin.rpc('unplace_from_group', { p_group_id: car!.id, p_entry_id: driver });
    expect(error).not.toBeNull();
  });
});
