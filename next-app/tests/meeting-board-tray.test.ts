import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting board, Phase 3a: the live match reaches the meeting editor's candidate tray pre-filled (title, teacher,
 * audience), promotes through the existing promotePlanSession into meeting_sessions, and nothing is written or
 * published until a leader adds it. The member page reads the same match. Real local database, the admin actor mocked.
 *
 * Isolation: the fixture topic is a freeform offer with a test-only title, so nobody's carried picks can land on it.
 * Fixture entry 2094-05-03, deleted by id (topics, picks, teachers cascade); the agenda layer and people by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({ actor: null as null | { personId: number | null; subjectKind: 'adult' | 'scout'; capabilities: Set<string> } }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => state.actor,
  actorHas: (a: { capabilities: Set<string> } | null, c: string) => a?.capabilities.has(c) ?? false
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const tray = () => import('../src/app/admin/(workspace)/advancement/meetings/load-agenda');
const meetingActions = () => import('../src/app/admin/(workspace)/advancement/meetings/actions');

let entry = 0;
let meetingId = 0;
const people: number[] = [];
const scoutIds: string[] = [];
let teacher = 0;
let alpha = 0;
let bravo = 0;
const TITLE = `${TEST_PREFIX} knot relay`;
const KEY = `ff:${TITLE.toLowerCase()}`;

async function person(label: string, o: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MBX ${label}`, first_name: TEST_PREFIX, last_name: label, ...o }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mbx-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} MBX ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}

beforeAll(async () => {
  const { data: e, error } = await sb.from('calendar_entries').insert({ entry_date: '2094-05-03', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  entry = e!.id as number;
  const { data: m, error: mErr } = await sb.from('meetings').insert({ calendar_entry_id: entry, title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (mErr) throw new Error(mErr.message);
  meetingId = m!.id as number;
  teacher = await person('Knotworth', { gender: 'M' });
  alpha = await scout('Alpha');
  bravo = await scout('Bravo');
});

async function boardUp() {
  const t = await sb.rpc('meeting_teach_topic', { p_entries: [entry], p_person: teacher, p_actor: teacher, p_leader: false, p_topic_key: null, p_title: TITLE, p_note: null });
  if (t.error) throw new Error(t.error.message);
  for (const s of [alpha, bravo]) {
    const p = await sb.rpc('meeting_add_pick', { p_entry: entry, p_person: s, p_actor: s, p_leader: false, p_topic_key: KEY, p_later: false, p_mark_coming: false, p_carry: [] });
    if (p.error) throw new Error(p.error.message);
  }
}

afterEach(async () => {
  await sb.from('meeting_sessions').delete().eq('meeting_id', meetingId);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', entry);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', entry);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', entry);
  await sb.from('meeting_boards').delete().eq('calendar_entry_id', entry);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('meetings').delete().eq('id', meetingId);
  await sb.from('calendar_entries').delete().eq('id', entry);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const mine = (b: Awaited<ReturnType<Awaited<ReturnType<typeof tray>>['loadBoardTray']>> | undefined) => b?.sessions.find((s) => s.title === TITLE);

describe('the candidate tray', () => {
  it('Tray_ShowsMatchedSession_PrefilledWithTitleTeacherAndAudience', async () => {
    await boardUp();
    const s = mine(await (await tray()).loadBoardTray(entry));
    expect(s && { teacher: s.teacher, scouts: s.scouts, codeLabel: s.codeLabel, track: s.promote.track }).toEqual({
      teacher: 'Mr. Knotworth',
      scouts: [`${TEST_PREFIX} A`, `${TEST_PREFIX} B`],
      codeLabel: 'Offered this week',
      track: 'Open Advancement'
    });
  });

  it('Leader_PromotesMatchedSession_IntoMeetingSessions', async () => {
    await boardUp();
    const s = mine(await (await tray()).loadBoardTray(entry))!;
    state.actor = { personId: null, subjectKind: 'adult', capabilities: new Set(['advancement.write']) };
    const res = await (await meetingActions()).promotePlanSession({ meetingId, ...s.promote });
    const { data } = await sb.from('meeting_sessions').select('section, title, leader_name, scouts, track').eq('meeting_id', meetingId);
    expect([res, data]).toEqual([
      { ok: true },
      [{ section: 'agenda', title: TITLE, leader_name: 'Mr. Knotworth', scouts: [`${TEST_PREFIX} A`, `${TEST_PREFIX} B`], track: 'Open Advancement' }]
    ]);
  });

  it('Tray_NothingIsWrittenOrPublished_UntilALeaderAddsIt', async () => {
    await boardUp();
    await (await tray()).loadBoardTray(entry);
    const [{ count }, { data: m }] = await Promise.all([
      sb.from('meeting_sessions').select('id', { count: 'exact', head: true }).eq('meeting_id', meetingId),
      sb.from('meetings').select('status').eq('id', meetingId).single()
    ]);
    expect([count, m?.status]).toEqual([0, 'draft']);
  });

  it('Promoting_LeavesTheBoardUnchanged', async () => {
    await boardUp();
    const stamp = async () => (await sb.rpc('meeting_board_stamp', { p_entry: entry })).data;
    const before = await stamp();
    const s = mine(await (await tray()).loadBoardTray(entry))!;
    state.actor = { personId: null, subjectKind: 'adult', capabilities: new Set(['advancement.write']) };
    await (await meetingActions()).promotePlanSession({ meetingId, ...s.promote });
    expect(await stamp()).toBe(before);
  });

  // P5a (Decision 10): the calendar alone closes a meeting ("No Troop Meeting"), never a stored board mode.
  it('Tray_SaysClosed_OnAClosedMeeting', async () => {
    await boardUp();
    await sb.from('calendar_entries').update({ title: `No Troop Meeting ${TEST_PREFIX}` }).eq('id', entry);
    const res = await (await tray()).loadBoardTray(entry);
    await sb.from('calendar_entries').update({ title: `Troop Meeting ${TEST_PREFIX}` }).eq('id', entry);
    expect(res).toEqual({ closed: true, sessions: [], wanted: 0 });
  });

  // Build a Plan B6 ("Planner out of Admin"): before Meeting Live starts, the tray is the meeting's plan, so an offering
  // the planner added with no scouts and no teacher yet is there (the matcher alone would leave it out).
  it('AgendaTray_ReflectsThePlan', async () => {
    const { data: req } = await sb.from('rank_requirements').select('code').eq('rank_id', 'tenderfoot').is('parent_id', null).neq('venue', 'outing').order('sort_order').limit(1).single();
    const key = `tenderfoot-${(req as { code: string }).code}`;
    const seeded = await sb.rpc('meeting_seed_many', { p_entry: entry, p_keys: [key], p_actor: teacher });
    if (seeded.error) throw new Error(seeded.error.message);
    const b = await (await tray()).loadBoardTray(entry);
    const s = b?.sessions.find((x) => x.codeLabel === `Tenderfoot ${(req as { code: string }).code}`);
    expect([b?.source, s?.teacher, s?.blockLabel]).toEqual(['plan', '', 'Needs a teacher']);
  });

  it('EngineTray_StillLoads_BesideTheBoardHalf', async () => {
    await boardUp();
    const data = await (await tray()).loadAgendaEditorData(meetingId, '2094-05-03', 'Troop Meeting', entry);
    expect([Array.isArray(data.candidates), mine(data.board) != null]).toEqual([true, true]);
  });
});

describe('the member page reads the same match', () => {
  it('Scout_SeesTheSessionTheyreIn_FromTheLiveMatch', async () => {
    await boardUp();
    const { loadAdvancementCatalog } = await import('../src/lib/advancement-catalog');
    const { loadBoardState, loadMeetingById } = await import('../src/lib/meeting-board');
    const { loadLiveMatch, loadTeachBoard } = await import('../src/lib/meeting-board-supply');
    const { seatLines, teachingLines } = await import('../src/lib/meeting-board-match');
    const catalog = await loadAdvancementCatalog();
    const meeting = (await loadMeetingById(sb, entry))!;
    const rows = await loadBoardState(sb, meeting, catalog);
    const teach = await loadTeachBoard(sb, meeting, catalog, rows, [alpha]);
    const match = await loadLiveMatch(sb, meeting, rows, teach);
    const src = { catalog, people: teach.people, freeformTitles: teach.freeformTitles, scoutNames: new Map(rows.map((r) => [r.personId, r.name])) };
    expect([seatLines(match, alpha, src).map((l) => [l.title, l.teacher]), teachingLines(match, teacher, src).map((l) => l.scouts.length)]).toEqual([[[TITLE, 'Mr. Knotworth']], [2]]);
  });
});
