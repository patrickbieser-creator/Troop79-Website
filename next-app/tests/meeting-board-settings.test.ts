import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting board, Phase 3a: the leader's board settings (rank with 1-3 teaching blocks, merit badge with its badge,
 * closed). The server action needs meeting_plan.use; the RPC validates and upserts meeting_boards; picks are never
 * touched; the change bumps the stamp an open This Sunday tab polls. Real local database, the admin actor mocked.
 * Fixture entries are dated 2094 and deleted by id (their boards, topics and picks cascade); people by id.
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

const actions = () => import('../src/app/admin/(workspace)/advancement/meeting-plan/actions');

let meeting = 0; // 2094-04-05
let past = 0; // 2020-04-05
let campout = 0; // 2094-04-08, not a meeting
const people: number[] = [];
const scoutIds: string[] = [];
let scoutP = 0;
let pickKey = '';
let badgeWithReqs = '';
let badgeWithout = '';

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}

beforeAll(async () => {
  const { data: e, error } = await sb.from('calendar_entries').insert({ entry_date: '2094-04-05', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = e!.id as number;
  const { data: pe } = await sb.from('calendar_entries').insert({ entry_date: '2020-04-05', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  past = pe!.id as number;
  const { data: ce } = await sb.from('calendar_entries').insert({ entry_date: '2094-04-08', category: 'Campout / Overnight', title: `Campout ${TEST_PREFIX}` }).select('id').single();
  campout = ce!.id as number;
  const { data: p } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MBS Scout` }).select('id').single();
  scoutP = p!.id as number;
  people.push(scoutP);
  const sid = `vitest-mbs-${scoutP}`;
  const { error: sErr } = await sb.from('scouts').insert({ id: sid, first_name: TEST_PREFIX, last_name: 'Scout', display_name: `${TEST_PREFIX} MBS Scout`, person_id: scoutP, active: true, current_rank: 'scout' });
  if (sErr) throw new Error(sErr.message);
  scoutIds.push(sid);
  const { data: reqs } = await sb.from('rank_requirements').select('code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(1);
  pickKey = `tenderfoot-${(reqs as { code: string }[])[0].code}`;
  const { data: mbReqs } = await sb.from('merit_badge_requirements').select('mb_id').limit(1);
  badgeWithReqs = (mbReqs as { mb_id: string }[])[0].mb_id;
  badgeWithout = localSql('select id from merit_badges m where not exists (select 1 from merit_badge_requirements r where r.mb_id = m.id) order by id limit 1');
});

afterEach(async () => {
  await sb.from('meeting_boards').delete().in('calendar_entry_id', [meeting, past, campout]);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', meeting);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', [meeting, past, campout]);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asLeader = () => (state.actor = { personId: null, subjectKind: 'adult', capabilities: new Set(['meeting_plan.use']) });
const boardRow = async () => (await sb.from('meeting_boards').select('board_mode, board_mb_id, block_count').eq('calendar_entry_id', meeting).maybeSingle()).data;
const setBoard = (mode: string, blocks: number | null, mb: string | null = null) => sb.rpc('meeting_set_board', { p_entry: meeting, p_mode: mode, p_mb_id: mb, p_block_count: blocks });

describe('board settings: the action', () => {
  it('Leader_SetsBoardModeAndBlockCount', async () => {
    asLeader();
    const res = await (await actions()).setMeetingBoardAction({ entryId: meeting, mode: 'rank', mbId: null, blockCount: 3 });
    expect([res, await boardRow()]).toEqual([{ ok: true }, { board_mode: 'rank', board_mb_id: null, block_count: 3 }]);
  });

  it('Leader_SetsMeritBadgeNight_WithItsBadge', async () => {
    asLeader();
    const res = await (await actions()).setMeetingBoardAction({ entryId: meeting, mode: 'merit_badge', mbId: badgeWithReqs, blockCount: 2 });
    expect([res, (await boardRow())?.board_mb_id]).toEqual([{ ok: true }, badgeWithReqs]);
  });

  it('BoardSettings_RefusedWithoutMeetingPlanCapability', async () => {
    state.actor = { personId: null, subjectKind: 'adult', capabilities: new Set(['advancement.write']) };
    const res = await (await actions()).setMeetingBoardAction({ entryId: meeting, mode: 'closed', mbId: null, blockCount: 2 });
    expect([res, await boardRow()]).toEqual([{ ok: false, error: 'Not authenticated' }, null]);
  });

  it('BoardSettings_RefusedForAYouthLeader_WhoHoldsMeetingPlan', async () => {
    // meeting_plan.use is in the youth_leader bundle (SPL / PL): the board is an adult leader's call.
    state.actor = { personId: scoutP, subjectKind: 'scout', capabilities: new Set(['meeting_plan.use']) };
    const res = await (await actions()).setMeetingBoardAction({ entryId: meeting, mode: 'closed', mbId: null, blockCount: 2 });
    expect([res, await boardRow()]).toEqual([{ ok: false, error: 'Only an adult leader can change the board.' }, null]);
  });

  it('BoardSettings_SaysWhy_ForAPastMeeting', async () => {
    asLeader();
    expect(await (await actions()).setMeetingBoardAction({ entryId: past, mode: 'closed', mbId: null, blockCount: 2 })).toEqual({ ok: false, error: 'That meeting has passed.' });
  });

  it('BoardSettings_RefusedWithNoSession', async () => {
    const res = await (await actions()).setMeetingBoardAction({ entryId: meeting, mode: 'closed', mbId: null, blockCount: 2 });
    expect([res.ok, await boardRow()]).toEqual([false, null]);
  });

  it('BoardSettings_SaysWhy_WhenMeritBadgeHasNoBadge', async () => {
    asLeader();
    expect(await (await actions()).setMeetingBoardAction({ entryId: meeting, mode: 'merit_badge', mbId: null, blockCount: 2 })).toEqual({ ok: false, error: 'Choose the badge for this night.' });
  });

  it('BoardSettings_RefusesAMalformedRequest', async () => {
    asLeader();
    const a = await actions();
    expect((await a.setMeetingBoardAction({ entryId: Number.NaN, mode: 'rank', mbId: null, blockCount: 2 })).ok).toBe(false);
  });
});

describe('board settings: the RPC', () => {
  it('Board_RefusesBlockCountOutsideOneToThree', async () => {
    expect([(await setBoard('rank', 4)).error?.message, (await setBoard('rank', 0)).error?.message, await boardRow()]).toEqual([
      'Teaching blocks are 1, 2 or 3.',
      'Teaching blocks are 1, 2 or 3.',
      null
    ]);
  });

  it('Board_RefusesMeritBadgeNight_ForABadgeWithNoRequirements', async () => {
    expect(badgeWithout).not.toBe('');
    expect((await setBoard('merit_badge', null, badgeWithout)).error?.message).toBe('That badge has no requirements entered yet, so there is nothing to build stations from.');
  });

  it('Board_RefusesAnUnknownMode', async () => {
    expect((await setBoard('party', 2)).error?.message).toBe('Choose rank, merit badge or closed.');
  });

  it('Board_KeepsBlockCount_WhenClosed_AndClearsTheBadge_BackToRank', async () => {
    await setBoard('rank', 1);
    await setBoard('merit_badge', null, badgeWithReqs);
    const mb = await boardRow();
    await setBoard('closed', null);
    const closed = await boardRow();
    await setBoard('rank', 2);
    expect([mb, closed, await boardRow()]).toEqual([
      { board_mode: 'merit_badge', board_mb_id: badgeWithReqs, block_count: 1 },
      { board_mode: 'closed', board_mb_id: null, block_count: 1 },
      { board_mode: 'rank', board_mb_id: null, block_count: 2 }
    ]);
  });

  it('Board_ModeChange_KeepsPicks_ForTheNextRankBoard', async () => {
    const add = await sb.rpc('meeting_add_pick', { p_entry: meeting, p_person: scoutP, p_actor: scoutP, p_leader: false, p_topic_key: pickKey, p_later: false, p_mark_coming: false, p_carry: [] });
    expect(add.error).toBeNull();
    await setBoard('closed', null);
    await setBoard('rank', 2);
    const { data } = await sb.from('meeting_topic_picks').select('person_id').eq('calendar_entry_id', meeting);
    expect((data ?? []).length).toBe(1);
  });

  it('Board_ChangeBumpsTheStamp_ThatThisSundayPolls', async () => {
    const before = (await sb.rpc('meeting_board_stamp', { p_entry: meeting })).data;
    await setBoard('rank', 3);
    const after = (await sb.rpc('meeting_board_stamp', { p_entry: meeting })).data;
    expect(after).not.toBe(before);
  });

  it('Board_RefusesAMeetingWhoseDayHasPassed', async () => {
    const res = await sb.rpc('meeting_set_board', { p_entry: past, p_mode: 'closed', p_mb_id: null, p_block_count: null });
    const { data } = await sb.from('meeting_boards').select('board_mode').eq('calendar_entry_id', past).maybeSingle();
    expect([res.error?.message, data]).toEqual(['That meeting has passed.', null]);
  });

  it('Board_RefusesAnEntryThatIsNotATroopMeeting', async () => {
    const res = await sb.rpc('meeting_set_board', { p_entry: campout, p_mode: 'rank', p_mb_id: null, p_block_count: 2 });
    const { data } = await sb.from('meeting_boards').select('board_mode').eq('calendar_entry_id', campout).maybeSingle();
    expect([res.error?.message, data]).toEqual(['Only troop meetings have a board.', null]);
  });

  it('Board_RefusesAnEntryThatDoesNotExist', async () => {
    expect((await sb.rpc('meeting_set_board', { p_entry: -1, p_mode: 'rank', p_mb_id: null, p_block_count: 2 })).error?.message).toBe('That meeting isn’t on the calendar.');
  });

  it('BoardSettings_Posture_ServiceRoleOnly_InvokerAndPinnedSearchPath', () => {
    const fn = `'public.meeting_set_board(bigint,text,text,integer)'`;
    const grants = ['anon', 'authenticated', 'public'].map((r) => `has_function_privilege('${r}', ${fn}, 'execute')`);
    const row = localSql(
      `select bool_or(x)::text || '|' || (select (not p.prosecdef)::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = ${fn}::regprocedure) from (values ${grants.map((g) => `(${g})`).join(', ')}) v(x)`
    );
    expect(row).toBe('false|true|search_path=public, pg_temp');
  });
});
