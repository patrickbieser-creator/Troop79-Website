import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Station rotations step 3 (Plans/Planner-Station-Rotations.md): a meeting's Stations switch and station order. Only
 * the planning team (seed) changes them. Turning on makes every focus set on the night a station, in the order they
 * were added; turning off keeps the stations so on-again brings them back (decision 10); a focus set taken off the
 * night stops being a station. Real local database; the admin actor is mocked. Fixture meetings are dated 2097.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2097-01-20' }));

const tw = () => import('../src/app/(public)/planner/this-week-actions');
const db = () => import('../src/lib/station-rotation-db');

const entries: number[] = [];
const people: number[] = [];
const sets: number[] = [];
let meeting = 0;
let seeder = 0;
let editorAdult = 0;
let safety = 0;
let terms = 0;
let ropes = 0;

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} PSA ${label}`, first_name: `${TEST_PREFIX} PSA`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function makeSet(name: string, items: string[]): Promise<number> {
  const { data, error } = await sb.rpc('focus_set_save', { p_actor: seeder, p_set: null, p_name: `${TEST_PREFIX} ${name}`, p_labels: ['vitest'], p_items: items });
  if (error) throw new Error(error.message);
  sets.push(Number(data));
  return Number(data);
}

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2097-02-03', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  entries.push(meeting);
  seeder = await person('Seeder');
  editorAdult = await person('Editor');
  safety = await makeSet('Climbing Safety', ['climbing-1', 'climbing-2']);
  terms = await makeSet('Climbing Terms', ['climbing-4']);
  ropes = await makeSet('Climbing Ropes', ['climbing-6', 'climbing-7']);
  await sb.from('focus_sets').update({ goal_minutes: 25 }).eq('id', safety);
});

const asSeeder = () => (state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed']) });
const asEditor = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });

/** The night's focus: the three Climbing sets, added in order. */
async function seedThree() {
  asSeeder();
  for (const setId of [safety, terms, ropes]) {
    const res = await (await tw()).twAddFocusSetAction({ entryId: meeting, setId });
    if (!res.ok) throw new Error(res.error);
  }
}
const stationKeys = async () => (await (await db()).loadRotation(sb, meeting)).stations.map((s) => s.key);

afterEach(async () => {
  await sb.from('meeting_rotation_stations').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_rotations').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  state.actor = null;
});

afterAll(async () => {
  if (sets.length) await sb.from('focus_sets').delete().in('id', sets);
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('people').delete().in('id', people);
});

describe('the Stations switch', () => {
  it('Seeder_TurnsStationsOn_AndEveryFocusSetBecomesAStationInOrder', async () => {
    await seedThree();
    await (await tw()).twSetStationsAction({ entryId: meeting, on: true });
    expect(await stationKeys()).toEqual([`fg:${safety}`, `fg:${terms}`, `fg:${ropes}`]);
  });

  it('StationsOn_IsReadBack', async () => {
    await seedThree();
    await (await tw()).twSetStationsAction({ entryId: meeting, on: true });
    expect((await (await db()).loadRotation(sb, meeting)).on).toBe(true);
  });

  it('NoRow_ReadsAsOff', async () => {
    expect(await (await db()).loadRotation(sb, meeting)).toEqual({ on: false, stations: [] });
  });

  it('TurningOff_KeepsTheStations', async () => {
    await seedThree();
    await (await tw()).twSetStationsAction({ entryId: meeting, on: true });
    await (await tw()).twSetStationsAction({ entryId: meeting, on: false });
    const r = await (await db()).loadRotation(sb, meeting);
    expect([r.on, r.stations.length]).toEqual([false, 3]);
  });

  it('TurningOnAgain_KeepsTheOrder', async () => {
    await seedThree();
    const a = await tw();
    await a.twSetStationsAction({ entryId: meeting, on: true });
    await a.twOrderStationsAction({ entryId: meeting, keys: [`fg:${ropes}`, `fg:${safety}`] });
    await a.twSetStationsAction({ entryId: meeting, on: false });
    await a.twSetStationsAction({ entryId: meeting, on: true });
    expect(await stationKeys()).toEqual([`fg:${ropes}`, `fg:${safety}`]);
  });

  it('Editor_IsRefused_WhenTurningStationsOn', async () => {
    await seedThree();
    asEditor();
    const res = await (await tw()).twSetStationsAction({ entryId: meeting, on: true });
    expect([res.ok, (await (await db()).loadRotation(sb, meeting)).on]).toEqual([false, false]);
  });

  it('SetStations_RefusesAMalformedRequest', async () => {
    asSeeder();
    expect(await (await tw()).twSetStationsAction({ entryId: meeting, on: 'yes' as unknown as boolean })).toEqual({ ok: false, error: 'Malformed request' });
  });
});

describe('station order', () => {
  it('Seeder_ReordersStations', async () => {
    await seedThree();
    await (await tw()).twOrderStationsAction({ entryId: meeting, keys: [`fg:${terms}`, `fg:${ropes}`, `fg:${safety}`] });
    expect(await stationKeys()).toEqual([`fg:${terms}`, `fg:${ropes}`, `fg:${safety}`]);
  });

  it('Order_RefusesAFocusSetNotOnTheMeeting', async () => {
    await seedThree();
    const other = await makeSet('Not tonight', ['climbing-13']);
    const res = await (await tw()).twOrderStationsAction({ entryId: meeting, keys: [`fg:${other}`] });
    expect(res).toEqual({ ok: false, error: 'Only a focus set on this meeting can be a station.' });
  });

  it('Order_RefusesADuplicate', async () => {
    await seedThree();
    const res = await (await tw()).twOrderStationsAction({ entryId: meeting, keys: [`fg:${safety}`, `fg:${safety}`] });
    expect(res).toEqual({ ok: false, error: 'A station is listed twice.' });
  });

  it('Order_RefusesAKeyThatIsntAFocusSet', async () => {
    asSeeder();
    expect(await (await tw()).twOrderStationsAction({ entryId: meeting, keys: ['fr:tenderfoot'] })).toEqual({ ok: false, error: 'Malformed request' });
  });

  it('RemovingAFocusSet_RemovesItsStation', async () => {
    await seedThree();
    await (await tw()).twSetStationsAction({ entryId: meeting, on: true });
    await (await tw()).twRemoveFocusAction({ entryId: meeting, key: `fg:${terms}` });
    expect(await stationKeys()).toEqual([`fg:${safety}`, `fg:${ropes}`]);
  });

  it('Stations_CarryTheirFocusSetsGoalAndTitle', async () => {
    await seedThree();
    await (await tw()).twSetStationsAction({ entryId: meeting, on: true });
    const first = (await (await db()).loadRotation(sb, meeting)).stations[0];
    expect([first.goalMinutes, first.title]).toEqual([25, `${TEST_PREFIX} Climbing Safety`]);
  });
});

describe('the board stamp', () => {
  it('TurningStationsOn_ChangesTheStamp', async () => {
    await seedThree();
    const { loadBoardStamp } = await import('../src/lib/meeting-board');
    const before = await loadBoardStamp(sb, meeting);
    await (await tw()).twSetStationsAction({ entryId: meeting, on: true });
    expect(await loadBoardStamp(sb, meeting)).not.toBe(before);
  });

  it('Reordering_ChangesTheStamp', async () => {
    await seedThree();
    const a = await tw();
    await a.twSetStationsAction({ entryId: meeting, on: true });
    const { loadBoardStamp } = await import('../src/lib/meeting-board');
    const before = await loadBoardStamp(sb, meeting);
    await new Promise((r) => setTimeout(r, 5));
    await a.twOrderStationsAction({ entryId: meeting, keys: [`fg:${ropes}`, `fg:${terms}`, `fg:${safety}`] });
    expect(await loadBoardStamp(sb, meeting)).not.toBe(before);
  });
});
