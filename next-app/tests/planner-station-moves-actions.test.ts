import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Station rotations step 4 (Plans/Planner-Station-Rotations.md): a planner moves a scout into rotation Group N, back
 * to the draft, or into an ordinary group; and adds an "also" assignment (decision 14: allowed, flagged, never
 * enforced). Editors (the edit right) may; a viewer may not. Real local database; the actor is mocked. Dated 2098.
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
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2098-01-20' }));

const tw = () => import('../src/app/(public)/planner/this-week-actions');

const people: number[] = [];
const scoutIds: string[] = [];
let meeting = 0;
let editor = 0;
let young = 0;
let other = 0;

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} PSM ${label}`, first_name: `${TEST_PREFIX} PSM`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string | null): Promise<number> {
  const pid = await person(label);
  const id = `vitest-psm-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} PSM`, last_name: label, display_name: `${TEST_PREFIX} PSM ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2098-02-02', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  editor = await person('Editor');
  young = await scout('Young', null);
  other = await scout('Other', 'scout');
  // A Scoutmaster conference on the plan (a class must be on this meeting to be an "also").
  const { error: te } = await sb.from('meeting_topics').insert({ calendar_entry_id: meeting, topic_key: 'star-5', kind: 'rank_req', rank_id: 'star', req_code: '5' });
  if (te) throw new Error(te.message);
});

const asEditor = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });
const moveOf = async (pid: number) => (await sb.from('meeting_rotation_moves').select('group_number').eq('calendar_entry_id', meeting).eq('person_id', pid).maybeSingle()).data?.group_number ?? null;
const roleOf = async (pid: number) => (await sb.from('meeting_scout_roles').select('role, ref_key').eq('calendar_entry_id', meeting).eq('person_id', pid).maybeSingle()).data ?? null;
const alsoOf = async (pid: number) =>
  ((await sb.from('meeting_scout_also').select('topic_key').eq('calendar_entry_id', meeting).eq('person_id', pid).order('topic_key')).data ?? []).map((r) => r.topic_key as string);

afterEach(async () => {
  for (const t of ['meeting_rotation_moves', 'meeting_scout_also', 'meeting_scout_roles', 'meeting_scout_helpers']) await sb.from(t).delete().eq('calendar_entry_id', meeting);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('moves between rotation groups', () => {
  it('Editor_MovesAScoutToGroupTwo', async () => {
    asEditor();
    await (await tw()).twRotationMoveAction({ entryId: meeting, personId: young, group: 2 });
    expect(await moveOf(young)).toBe(2);
  });

  it('MovingIntoTheRotation_ClearsAHandPlacement', async () => {
    asEditor();
    const a = await tw();
    await a.twSetRoleAction({ entryId: meeting, personId: young, role: 'group', key: 'fr:mb:citizenship-community' });
    await a.twRotationMoveAction({ entryId: meeting, personId: young, group: 1 });
    expect([await moveOf(young), await roleOf(young)]).toEqual([1, null]);
  });

  it('BackToTheDraft_ClearsTheMoveAndTheHandPlacement', async () => {
    asEditor();
    const a = await tw();
    await a.twRotationMoveAction({ entryId: meeting, personId: young, group: 3 });
    await a.twRotationMoveAction({ entryId: meeting, personId: young, group: null });
    expect([await moveOf(young), await roleOf(young)]).toEqual([null, null]);
  });

  it('MovingToAnOrdinaryGroup_ClearsTheRotationMove', async () => {
    asEditor();
    const a = await tw();
    await a.twRotationMoveAction({ entryId: meeting, personId: young, group: 2 });
    await a.twSetRoleAction({ entryId: meeting, personId: young, role: 'group', key: 'fr:mb:citizenship-community' });
    expect(await moveOf(young)).toBeNull();
  });

  it('Move_RefusesGroupZero', async () => {
    asEditor();
    expect(await (await tw()).twRotationMoveAction({ entryId: meeting, personId: young, group: 0 })).toEqual({ ok: false, error: 'Malformed request' });
  });

  it('Move_RefusesSomeoneWhoIsntAnActiveScout', async () => {
    asEditor();
    const res = await (await tw()).twRotationMoveAction({ entryId: meeting, personId: editor, group: 1 });
    expect(res).toEqual({ ok: false, error: 'That isn’t an active scout.' });
  });

  it('Viewer_IsRefused_WhenMoving', async () => {
    asViewer();
    const res = await (await tw()).twRotationMoveAction({ entryId: meeting, personId: young, group: 1 });
    expect([res.ok, await moveOf(young)]).toEqual([false, null]);
  });
});

describe('also assignments', () => {
  it('Editor_AddsAnAlso_KeepingThePrimary', async () => {
    asEditor();
    const a = await tw();
    await a.twRotationMoveAction({ entryId: meeting, personId: other, group: 2 });
    await a.twSetAlsoAction({ entryId: meeting, personId: other, key: 'star-5', on: true });
    expect([await moveOf(other), await alsoOf(other)]).toEqual([2, ['star-5']]);
  });

  it('Also_TwoAtOnce', async () => {
    asEditor();
    const a = await tw();
    await a.twSetAlsoAction({ entryId: meeting, personId: other, key: 'star-5', on: true });
    await a.twSetAlsoAction({ entryId: meeting, personId: other, key: 'fr:mb:citizenship-community', on: true });
    expect(await alsoOf(other)).toEqual(['fr:mb:citizenship-community', 'star-5']);
  });

  it('Also_Off_RemovesIt', async () => {
    asEditor();
    const a = await tw();
    await a.twSetAlsoAction({ entryId: meeting, personId: other, key: 'star-5', on: true });
    await a.twSetAlsoAction({ entryId: meeting, personId: other, key: 'star-5', on: false });
    expect(await alsoOf(other)).toEqual([]);
  });

  it('Also_AddingTwice_ChangesNothing', async () => {
    asEditor();
    const a = await tw();
    await a.twSetAlsoAction({ entryId: meeting, personId: other, key: 'star-5', on: true });
    const res = await a.twSetAlsoAction({ entryId: meeting, personId: other, key: 'star-5', on: true });
    expect([res.ok, await alsoOf(other)]).toEqual([true, ['star-5']]);
  });

  it('Also_RefusesAMalformedKey', async () => {
    asEditor();
    expect(await (await tw()).twSetAlsoAction({ entryId: meeting, personId: other, key: 'fg:12', on: true })).toEqual({ ok: false, error: 'Malformed request' });
  });

  it('Also_RefusesAClassNotOnThisMeeting', async () => {
    asEditor();
    const res = await (await tw()).twSetAlsoAction({ entryId: meeting, personId: other, key: 'first-aid-3', on: true });
    expect([res.ok ? 'ok' : res.error, await alsoOf(other)]).toEqual(['That isn’t on this meeting’s plan.', []]);
  });

  it('Viewer_IsRefused_WhenAddingAnAlso', async () => {
    asViewer();
    const res = await (await tw()).twSetAlsoAction({ entryId: meeting, personId: other, key: 'star-5', on: true });
    expect([res.ok, await alsoOf(other)]).toEqual([false, []]);
  });
});

describe('the board stamp and merges', () => {
  it('AMove_ChangesTheStamp', async () => {
    asEditor();
    const { loadBoardStamp } = await import('../src/lib/meeting-board');
    const before = await loadBoardStamp(sb, meeting);
    await (await tw()).twRotationMoveAction({ entryId: meeting, personId: young, group: 2 });
    expect(await loadBoardStamp(sb, meeting)).not.toBe(before);
  });

  it('AnAlso_ChangesTheStamp', async () => {
    asEditor();
    const { loadBoardStamp } = await import('../src/lib/meeting-board');
    const before = await loadBoardStamp(sb, meeting);
    await (await tw()).twSetAlsoAction({ entryId: meeting, personId: other, key: 'star-5', on: true });
    expect(await loadBoardStamp(sb, meeting)).not.toBe(before);
  });

  it('MergingPeople_CarriesTheMoveAndTheAlso', async () => {
    const loser = await person('Loser');
    const survivor = await person('Survivor');
    await sb.from('meeting_rotation_moves').insert({ calendar_entry_id: meeting, person_id: loser, group_number: 3 });
    await sb.from('meeting_scout_also').insert({ calendar_entry_id: meeting, person_id: loser, topic_key: 'star-5' });
    const { error } = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (error) throw new Error(error.message);
    expect([await moveOf(survivor), await alsoOf(survivor)]).toEqual([3, ['star-5']]);
  });
});
