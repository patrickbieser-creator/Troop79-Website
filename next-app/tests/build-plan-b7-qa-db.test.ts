import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { NOT_A_TEACHER } from '../src/lib/can-offer-to-teach';

/**
 * B7 qa follow-ups (Plans/Build-A-Plan.md, the Teaching lens chips): the chip's half-done path (the add succeeds, the
 * teacher write fails: the row is added and the chip says why) and the teacher rule checked on the server before
 * anything is added (meeting_teach_topic's backstop admits any active scout). Real local database; the admin actor,
 * "today" (2082-02-20) and, for the half-done path only, teachTopic are mocked. Test-owned rows only, deleted by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> },
  teachFails: false
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2082-02-20' }));
vi.mock('@/lib/meeting-board-supply', async (orig) => {
  const real = await orig<typeof import('../src/lib/meeting-board-supply')>();
  return {
    ...real,
    teachTopic: (...args: Parameters<typeof real.teachTopic>) => (state.teachFails ? Promise.resolve({ ok: false as const, error: 'The sign-up didn’t save.' }) : real.teachTopic(...args))
  };
});

const actions = () => import('../src/app/(public)/planner/build-actions');

const people: number[] = [];
const scoutIds: string[] = [];
let meeting = 0;
let editor = 0;
let teacher = 0;
let youngScout = 0;
let key = '';

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} B7Q ${label}`, first_name: `${TEST_PREFIX} B7Q`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
const topics = async () => (await sb.from('meeting_topics').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting)).count;
async function clearTopics() {
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', meeting);
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
}

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2082-03-01', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  editor = await person('Editor');
  teacher = await person('Teacher');
  youngScout = await person('Young');
  const sid = `vitest-b7q-${youngScout}`;
  const s = await sb.from('scouts').insert({ id: sid, first_name: `${TEST_PREFIX} B7Q`, last_name: 'Young', display_name: `${TEST_PREFIX} B7Q Young`, person_id: youngScout, active: true, current_rank: 'scout' });
  if (s.error) throw new Error(s.error.message);
  scoutIds.push(sid);
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(1);
  key = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`)[0];
  state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed', 'meeting_planner.edit']) };
});

afterEach(async () => {
  state.teachFails = false;
  await clearTopics();
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('B7 qa follow-ups: the Teaching chip', () => {
  it('TeachingChip_SeedSucceeds_TeachFails_ReturnsAddedWithAProblem', async () => {
    state.teachFails = true;
    const res = await (await actions()).plannerTeachingChipAction({ entryId: meeting, key, personId: teacher });
    expect(res).toMatchObject({ ok: true, added: true, problem: 'Added to the plan, but the teacher wasn’t set: The sign-up didn’t save.' });
  });

  it('TeachingChip_SomeoneWhoCantTeach_IsRefused_BeforeAnyAdd', async () => {
    const res = await (await actions()).plannerTeachingChipAction({ entryId: meeting, key, personId: youngScout });
    expect({ res, topics: await topics() }).toEqual({ res: { ok: false, error: NOT_A_TEACHER }, topics: 0 });
  });
});
