import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
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
 * Event Logistics Phase 2 — a patrol set seeds from the roster
 * (Plans/Event-Logistics.md §B): group per roster patrol, each signed-up
 * scout placed in theirs, late sign-ups auto-placed, leader moves respected,
 * and nothing EVER written back to scouts.patrol.
 */
const admin = adminClient();

let event: TestEvent;
let kraken: TestScout;
let eagle: TestScout;
let unassigned: TestScout;
let jl: TestScout;
let adultPersonId: number;

async function setPatrol(s: TestScout, patrol: string | null) {
  const { error } = await admin.from('scouts').update({ patrol }).eq('id', s.scoutId);
  if (error) throw new Error(error.message);
}
async function addEntry(personId: number, kind: 'scout' | 'adult', status = 'yes'): Promise<number> {
  const { data, error } = await admin
    .from('signup_entries')
    .insert({ event_signup_id: event.eventSignupId, status, person_kind: kind, person_id: personId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`entry insert failed: ${error?.message}`);
  return data.id as number;
}
async function addPatrolSet(): Promise<number> {
  const { data, error } = await admin
    .from('signup_group_sets')
    .insert({ event_signup_id: event.eventSignupId, kind: 'patrol', label: 'Patrols', seed_from_roster: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`set insert failed: ${error?.message}`);
  return data.id as number;
}
async function groupsOf(setId: number) {
  const { data } = await admin.from('signup_groups').select('id, name').eq('set_id', setId).order('name');
  return (data ?? []) as { id: number; name: string }[];
}
async function groupNameOf(setId: number, entryId: number): Promise<string | null> {
  const { data } = await admin
    .from('signup_group_members')
    .select('group_id, signup_groups!inner(name)')
    .eq('set_id', setId)
    .eq('entry_id', entryId)
    .maybeSingle();
  return (data as unknown as { signup_groups: { name: string } } | null)?.signup_groups.name ?? null;
}

beforeAll(async () => {
  event = await createTestEvent(admin);
  kraken = await createTestScout(admin, 'SeedKraken');
  eagle = await createTestScout(admin, 'SeedEagle');
  unassigned = await createTestScout(admin, 'SeedNone');
  jl = await createTestScout(admin, 'SeedJL');
  await setPatrol(kraken, ' Kraken ');
  await setPatrol(eagle, 'Screaming  Eagles');
  await setPatrol(jl, 'Junior Leader');
  const { data } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} Adult Seed` }).select('id').single();
  adultPersonId = data!.id;
});

afterEach(async () => {
  await admin.from('signup_entries').delete().eq('event_signup_id', event.eventSignupId);
  await admin.from('signup_group_sets').delete().eq('event_signup_id', event.eventSignupId);
});

afterAll(async () => {
  await deleteTestEvent(admin, event);
  for (const s of [kraken, eagle, unassigned, jl]) await deleteTestScout(admin, s);
  await admin.from('people').delete().eq('id', adultPersonId);
});

describe('patrol seeding', () => {
  it('PatrolSet_SeedsFromRoster_ForSignedUpScoutsOnly', async () => {
    const eK = await addEntry(kraken.personId, 'scout');
    const eE = await addEntry(eagle.personId, 'scout');
    const eN = await addEntry(unassigned.personId, 'scout');
    const eA = await addEntry(adultPersonId, 'adult');
    const eDeclined = await addEntry(jl.personId, 'scout', 'no');
    const setId = await addPatrolSet();
    expect((await groupsOf(setId)).map((g) => g.name)).toEqual(['Kraken', 'Screaming Eagles']); // normalized
    expect(await groupNameOf(setId, eK)).toBe('Kraken');
    expect(await groupNameOf(setId, eE)).toBe('Screaming Eagles');
    expect(await groupNameOf(setId, eN)).toBeNull();
    expect(await groupNameOf(setId, eA)).toBeNull();
    expect(await groupNameOf(setId, eDeclined)).toBeNull();
  });

  it('PatrolSet_AutoPlacesLateSignup_WhenScoutHasRosterPatrol', async () => {
    const setId = await addPatrolSet();
    expect(await groupsOf(setId)).toEqual([]);
    const late = await addEntry(kraken.personId, 'scout');
    expect(await groupNameOf(setId, late)).toBe('Kraken');
  });

  it('PatrolSeed_SkipsValuesThatAreNotPatrols', async () => {
    await addEntry(jl.personId, 'scout');
    const setId = await addPatrolSet();
    expect(await groupsOf(setId)).toEqual([]);
  });

  it('PatrolSeed_NeverMovesSomeoneAlreadyPlacedInTheSet', async () => {
    const eK = await addEntry(kraken.personId, 'scout');
    const setId = await addPatrolSet();
    const eagles = (await groupsOf(setId)).find((g) => g.name === 'Screaming Eagles')
      ?? (await admin.from('signup_groups').insert({ set_id: setId, name: 'Screaming Eagles' }).select('id, name').single()).data!;
    const { data: moved } = await admin.rpc('place_in_group', { p_group_id: eagles.id, p_entry_id: eK, p_actor: 'leader' });
    expect(moved).toBe('moved');
    await admin.rpc('seed_patrol_set', { p_set_id: setId });
    expect(await groupNameOf(setId, eK)).toBe('Screaming Eagles');
  });

  it('Placement_NeverWritesScoutsPatrol', async () => {
    const eN = await addEntry(unassigned.personId, 'scout');
    const setId = await addPatrolSet();
    const { data: g } = await admin.from('signup_groups').insert({ set_id: setId, name: 'Kraken' }).select('id').single();
    await admin.rpc('place_in_group', { p_group_id: g!.id, p_entry_id: eN, p_actor: 'leader' });
    const { data: scout } = await admin.from('scouts').select('patrol').eq('id', unassigned.scoutId).single();
    expect(scout?.patrol).toBeNull();
  });

  it('PatrolSeed_IsIdempotent_OnRerun', async () => {
    const eK = await addEntry(kraken.personId, 'scout');
    const setId = await addPatrolSet();
    await admin.rpc('seed_patrol_set', { p_set_id: setId });
    await admin.rpc('seed_patrol_set', { p_set_id: setId });
    expect((await groupsOf(setId)).filter((g) => g.name === 'Kraken')).toHaveLength(1);
    const { count } = await admin.from('signup_group_members').select('*', { count: 'exact', head: true }).eq('entry_id', eK);
    expect(count).toBe(1);
  });
});
