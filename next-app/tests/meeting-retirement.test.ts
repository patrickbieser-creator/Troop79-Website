import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting Planner II, P5c: the retirement (Plans/Meeting-Planner-II.md Decisions 1 and 10). Admin's This Sunday tab,
 * its stations and rotations, and the stored board mode are gone; the migration
 * 20261210100000_retire_stations_and_board_mode drops meeting_stations, meeting_rotation_placements and
 * meeting_boards.board_mode / board_mb_id / block_count, and re-creates what read them. Real local database; every
 * row here is test-owned (entries dated 2096, people prefixed) and deleted by id.
 */
const sb = adminClient();
const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261210100000_retire_stations_and_board_mode.sql');

const entries: number[] = [];
const people: number[] = [];

async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MRT ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}

/** Runs SQL in the local database; returns stdout, or the error text when psql fails. */
function psql(sql: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync('docker', ['exec', '-i', 'supabase_db_next-app', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, out: out.toString() };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer };
    return { ok: false, out: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}` };
  }
}

let meeting = 0;
let key = '';

beforeAll(async () => {
  meeting = await entry('2096-02-02');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(1);
  key = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`)[0];
});

afterAll(async () => {
  for (const e of entries) {
    // Rotations L3: a topic's classes first (their FK keeps a topic under a class).
    await sb.from('meeting_classes').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_boards').delete().eq('calendar_entry_id', e);
    await sb.from('event_attendance').delete().eq('calendar_entry_id', e);
  }
  await sb.from('calendar_entries').delete().in('id', entries);
  if (people.length) await sb.from('people').delete().in('id', people);
});

describe('the drop migration', () => {
  it('DropMigration_Refuses_WhenStationRowsExist', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // The guard is the first statement: nothing is dropped before it has looked.
    const guardAt = sql.search(/^do \$\$/m);
    const firstDrop = sql.search(/^(drop|alter|create)/im);
    const guard = sql.slice(guardAt, sql.indexOf('$$;', guardAt) + 3);
    // Against a database where a retired table still holds a row (stand-ins, rolled back), the guard raises.
    const run = psql(
      [
        'begin;',
        'create table if not exists public.meeting_stations (topic_id bigint);',
        'create table if not exists public.meeting_rotation_placements (person_id bigint);',
        'insert into public.meeting_stations (topic_id) values (1);',
        guard,
        'rollback;'
      ].join('\n')
    );
    expect([guardAt >= 0 && guardAt < firstDrop, run.ok, /still has rows/.test(run.out)]).toEqual([true, false, true]);
  });

  it('DropMigration_LeavesNoRetiredTableOrColumn', () => {
    const out = psql(
      "select to_regclass('public.meeting_stations') is null, to_regclass('public.meeting_rotation_placements') is null, " +
        "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'meeting_boards' and column_name in ('board_mode', 'board_mb_id', 'block_count')), " +
        "not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~ 'meeting_stations|meeting_rotation_placements|\\mboard_mode|board_mb_id|block_count');"
    );
    expect(out.out.trim()).toBe('t|t|t|t');
  });
});

describe('what read the retired tables still works', () => {
  it('MergePeople_StillMergesAttendanceAndPicks_AfterTablesDropped', async () => {
    const survivor = await person('Survivor');
    const loser = await person('Loser');
    const { data: topic, error: te } = await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: key });
    if (te) throw new Error(te.message);
    await sb.from('meeting_pick_lists').insert({ calendar_entry_id: meeting, person_id: loser });
    const { error: pe } = await sb.from('meeting_topic_picks').insert({ topic_id: topic, calendar_entry_id: meeting, person_id: loser, priority: 1, first_asked_on: '2096-01-26' });
    if (pe) throw new Error(pe.message);
    await sb.from('event_attendance').insert({ calendar_entry_id: meeting, person_id: loser, source: 'manual' });
    const merged = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    const picks = ((await sb.from('meeting_topic_picks').select('person_id').eq('calendar_entry_id', meeting)).data ?? []) as { person_id: number }[];
    const present = ((await sb.from('event_attendance').select('person_id').eq('calendar_entry_id', meeting)).data ?? []) as { person_id: number }[];
    expect([merged.error, picks.map((p) => p.person_id), present.map((p) => p.person_id)]).toEqual([null, [survivor], [survivor]]);
  });

  it('BoardStamp_StillChanges_WhenLiveVersionBumps', async () => {
    await sb.from('meeting_boards').upsert({ calendar_entry_id: meeting }, { onConflict: 'calendar_entry_id' });
    const before = await sb.rpc('meeting_board_stamp', { p_entry: meeting });
    await sb.from('meeting_boards').update({ live_version: 7 }).eq('calendar_entry_id', meeting);
    const after = await sb.rpc('meeting_board_stamp', { p_entry: meeting });
    expect([before.error, after.error, typeof before.data === 'string' && before.data !== after.data]).toEqual([null, null, true]);
  });

  it('BoardMode_IsDerivedFromTheCalendarAlone', async () => {
    await sb.from('meeting_boards').upsert({ calendar_entry_id: meeting }, { onConflict: 'calendar_entry_id' });
    const open = (await sb.rpc('meeting_board_mode', { p_entry: meeting })).data;
    await sb.from('calendar_entries').update({ title: `No Troop Meeting ${TEST_PREFIX}` }).eq('id', meeting);
    const closed = (await sb.rpc('meeting_board_mode', { p_entry: meeting })).data;
    await sb.from('calendar_entries').update({ title: `Troop Meeting ${TEST_PREFIX}` }).eq('id', meeting);
    expect([open, closed]).toEqual(['rank', 'closed']);
  });
});

describe('the source', () => {
  it('Source_NeverReferences_DroppedTablesOrModeColumns', () => {
    // \b keeps meeting_board_mode (the derived SQL helper, kept) out of it.
    const DROPPED = /meeting_stations|meeting_rotation_placements|\bboard_mode|board_mb_id|block_count|meeting_set_board|meeting_set_stations|meeting_save_rotations/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs|css)$/.test(name) && DROPPED.test(readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});
