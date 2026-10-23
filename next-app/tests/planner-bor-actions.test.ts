import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * A board of review on the Meeting Planner (Patrick, 2026-10-21; migration 20261205100000): a scout who has done every
 * other Tenderfoot requirement can pick 'tenderfoot-BoR', an editor can Assign someone to run it, and the words are
 * "Tenderfoot board of review", never the key. Real local database; the admin actor is mocked; the meeting is dated
 * 2095-03 so it never meets the real calendar or another file's fixtures.
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

const actions = () => import('../src/app/(public)/planner/actions');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
let meeting = 0;
let editorAdult = 0;
let teacher = 0;
let ready = 0; // every Tenderfoot requirement done
let notYet = 0; // nothing done
let readyScoutId = '';
const BOR = 'tenderfoot-BoR';

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} BOR ${label}`, first_name: `${TEST_PREFIX} BOR`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<{ pid: number; id: string }> {
  const pid = await person(label);
  const id = `vitest-bor-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} BOR`, last_name: label, display_name: `${TEST_PREFIX} BOR ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return { pid, id };
}

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2095-03-05', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  entries.push(meeting);
  editorAdult = await person('Editor');
  teacher = await person('Teacher');
  const r = await scout('Ready');
  ready = r.pid;
  readyScoutId = r.id;
  notYet = (await scout('NotYet')).pid;
  // Every Tenderfoot leaf on the ledger: a requirement with sub-requirements is done when they are.
  const { data: reqs } = await sb.from('rank_requirements').select('id, parent_id, code').eq('rank_id', 'tenderfoot');
  const rows = (reqs ?? []) as { id: number; parent_id: number | null; code: string }[];
  const leaves = rows.filter((q) => q.code.toLowerCase() !== 'bor' && !rows.some((c) => c.parent_id === q.id));
  const { error: lErr } = await sb.from('ledger_entries').insert(leaves.map((q) => ({ scout_id: readyScoutId, date: '2026-10-01', kind: 'rank_requirement', code: `tenderfoot-${q.code}`, qty: 1, unit: 'complete', entered_by: 'vitest' })));
  if (lErr) throw new Error(lErr.message);
});

afterEach(async () => {
  // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', meeting);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('ledger_entries').delete().in('scout_id', scoutIds);
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asEditor = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });

describe('a board of review on the planner', () => {
  it('BoR_PickAndAssign_RoundTrip', async () => {
    asEditor();
    const act = await actions();
    const picked = await act.plannerTogglePickAction({ entryId: meeting, personId: ready, key: BOR, on: true });
    const assigned = await act.plannerAssignAction({ entryId: meeting, personId: teacher, key: BOR });
    const drawer = await act.plannerOpenPersonAction({ entryId: meeting, personId: ready });
    const { data: topic } = await sb.from('meeting_topics').select('kind, rank_id, req_code, meeting_topic_teachers(person_id)').eq('calendar_entry_id', meeting).eq('topic_key', BOR).single();
    const opt = drawer.ok ? drawer.drawer.options.find((o) => o.key === BOR) : undefined;
    expect([picked.ok, opt?.title, opt?.meta.startsWith('Tenderfoot board of review'), assigned.ok, topic]).toEqual([
      true,
      'Board of review',
      true,
      true,
      { kind: 'rank_req', rank_id: 'tenderfoot', req_code: 'BoR', meeting_topic_teachers: [{ person_id: teacher }] }
    ]);
  });

  it('BoR_IsRefused_ForAScoutWithRequirementsLeft', async () => {
    asEditor();
    expect(await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: notYet, key: BOR, on: true })).toEqual({ ok: false, error: 'That isn’t on their pick list.' });
  });

  it('OfferChoices_IncludeEachRanksBoardOfReview', async () => {
    asEditor();
    const res = await (await actions()).plannerOfferChoicesAction();
    const bor = res.ok ? res.choices.filter((c) => c.key.endsWith('-BoR')) : [];
    expect([bor.some((c) => c.key === BOR && c.codeLabel === 'Tenderfoot board of review'), bor.some((c) => c.key === 'scout-BoR')]).toEqual([true, false]);
  });

  it('TopicId_ResolvesABoR_ButNotForScoutRank', async () => {
    const [{ data: tf }, { data: sc }] = [await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: BOR }), await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: 'scout-BoR' })];
    expect([tf != null, sc]).toEqual([true, null]);
  });
});
