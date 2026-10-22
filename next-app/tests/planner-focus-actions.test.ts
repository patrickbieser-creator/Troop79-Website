import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Meeting Planner P3 (Plans/Meeting-Planner-II.md, Decisions 2 and 10; the tech-lead's P3 spec): focus sets, seeding a
 * meeting with a set (one focus group = one pick) or with one requirement, unseeding, and the server search. Since
 * Build a Plan B4 every seed goes through Build's actions (seedSet / seedTopic / unseed below). Only a
 * meeting_planner.seed holder may seed or keep sets: everyone else is refused before the database is touched. Real
 * local database; the admin actor is mocked. Fixture meetings are dated 2095 so they never collide with the real
 * calendar or another file's fixtures.
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

// Build a Plan's gate takes the next 4 meetings from "today": put today just before this file's 2095 meeting.
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2095-01-20' }));

const actions = () => import('../src/app/(public)/planner/actions');
const focus = () => import('../src/app/(public)/planner/focus-actions');
// Build a Plan B4 (one add path): seeding is Build's own add, remove and focus-set add; the board's seed actions retired.
const build = () => import('../src/app/(public)/planner/build-actions');
const seedSet = async (input: { entryId: number; setId: number }) => (await build()).plannerAddFocusSetAction(input);
const seedTopic = async (input: { entryId: number; key: string }) => (await build()).plannerAddOfferingAction({ entryId: input.entryId, keys: [input.key] });
const unseed = async (input: { entryId: number; key: string }) => (await build()).plannerRemoveOfferingAction(input);

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
const sets: number[] = [];
let meeting = 0; // 2095-02-05
let seeder = 0;
let editorAdult = 0;
let spl = 0;
let young = 0;
let teacher = 0;
let rankKeys: string[] = [];
let mbKey = ''; // a top-level merit badge requirement, 'first-aid-1'
let mbSubKey = ''; // one of its sub-requirements

async function entry(date: string, o: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}`, ...o }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string, o: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} PFA ${label}`, first_name: `${TEST_PREFIX} PFA`, last_name: label, ...o }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string, rank: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-pfa-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} PFA`, last_name: label, display_name: `${TEST_PREFIX} PFA ${label}`, person_id: pid, active: true, current_rank: rank });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
/** A set made straight in the database (test-owned id, cleaned up by id). */
async function makeSet(name: string, items: string[]): Promise<number> {
  const { data, error } = await sb.rpc('focus_set_save', { p_actor: seeder, p_set: null, p_name: `${TEST_PREFIX} ${name}`, p_labels: ['vitest'], p_items: items });
  if (error) throw new Error(error.message);
  sets.push(Number(data));
  return Number(data);
}

function localSql(sql: string): string {
  const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1] ?? 'next-app';
  const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}

beforeAll(async () => {
  meeting = await entry('2095-02-05');
  seeder = await person('Seeder');
  editorAdult = await person('Editor');
  teacher = await person('Teacher');
  spl = await scout('Spl', 'star');
  young = await scout('Young', 'scout');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(3);
  rankKeys = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
  const { data: top } = await sb.from('merit_badge_requirements').select('id, code').eq('mb_id', 'first-aid').is('parent_id', null).order('sort_order').limit(1).single();
  mbKey = `first-aid-${(top as { code: string }).code}`;
  const { data: sub } = await sb.from('merit_badge_requirements').select('code').eq('parent_id', (top as { id: number }).id).order('sort_order').limit(1).single();
  mbSubKey = `first-aid-${(sub as { code: string }).code}`;
});

afterEach(async () => {
  for (const e of entries) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
  }
  if (sets.length) await sb.from('focus_sets').delete().in('id', sets);
  sets.length = 0;
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asSeeder = () => (state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed']) });
const asEditor = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editorAdult, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });
const asSpl = () => (state.actor = { personId: spl, subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) });
const topicsOn = async () =>
  ((await sb.from('meeting_topics').select('topic_key, kind, title, seeded_by_person_id, seeded_at, focus_set_id').eq('calendar_entry_id', meeting).order('topic_key')).data ?? []) as {
    topic_key: string;
    kind: string;
    title: string | null;
    seeded_by_person_id: number | null;
    seeded_at: string | null;
    focus_set_id: number | null;
  }[];
const membersOf = async (key: string) => {
  const { data } = await sb.from('meeting_topics').select('meeting_topic_members(item_key, position)').eq('calendar_entry_id', meeting).eq('topic_key', key).maybeSingle();
  return (((data as { meeting_topic_members: { item_key: string; position: number }[] } | null)?.meeting_topic_members ?? []) as { item_key: string; position: number }[])
    .sort((a, b) => a.position - b.position)
    .map((m) => m.item_key);
};
const setCount = async () => (await sb.from('focus_sets').select('id', { count: 'exact', head: true }).like('name', `${TEST_PREFIX}%`)).count ?? 0;

describe('only the planning team seeds and keeps focus sets', () => {
  for (const [who, as] of [
    ['an editor', asEditor],
    ['a viewer', asViewer],
    ['the SPL (a scout editor)', asSpl]
  ] as const) {
    it(`NonSeeder_IsRefused_WhenSeedingOrEditingFocusSets (${who})`, async () => {
      const set = await makeSet('Refused', [rankKeys[0]]);
      const before = await setCount();
      as();
      const fa = await focus();
      const results = [
        await seedSet({ entryId: meeting, setId: set }),
        await seedTopic({ entryId: meeting, key: rankKeys[1] }),
        await unseed({ entryId: meeting, key: rankKeys[1] }),
        await fa.focusSaveSetAction({ id: null, name: `${TEST_PREFIX} Sneaky`, labels: [], items: [rankKeys[0]] }),
        await fa.focusSaveSetAction({ id: set, name: `${TEST_PREFIX} Renamed`, labels: [], items: [] }),
        await fa.focusDeleteSetAction({ id: set })
      ];
      const { data: still } = await sb.from('focus_sets').select('name').eq('id', set).single();
      expect([results.every((r) => !r.ok), await topicsOn(), await setCount(), (still as { name: string }).name]).toEqual([true, [], before, `${TEST_PREFIX} Refused`]);
    });
  }

  it('SignedOut_IsRefused_WhenSearching', async () => {
    expect((await (await focus()).focusSearchAction({ q: 'first aid', kind: 'all', source: null, offset: 0 })).ok).toBe(false);
  });

  it('Viewer_CanSearchAndListSets', async () => {
    await makeSet('Visible', [rankKeys[0]]);
    asViewer();
    const fa = await focus();
    const [found, listed] = [await fa.focusSearchAction({ q: 'tenderfoot', kind: 'rank', source: null, offset: 0 }), await fa.focusSetsAction()];
    expect([found.ok && found.rows.length > 0, listed.ok && listed.sets.some((s) => s.name === `${TEST_PREFIX} Visible`)]).toEqual([true, true]);
  });
});

describe('focus sets', () => {
  it('Seeder_SavesASet_WithLabelsAndItemsInOrder', async () => {
    asSeeder();
    const res = await (await focus()).focusSaveSetAction({ id: null, name: `  ${TEST_PREFIX}   Knots  `, labels: [' Outdoor Skills ', 'outdoor skills', 'Fall'], items: [rankKeys[1], mbSubKey, rankKeys[0]] });
    if (res.ok) sets.push(res.id);
    const listed = await (await focus()).focusSetsAction();
    const mine = listed.ok ? listed.sets.find((s) => res.ok && s.id === res.id) : null;
    expect([mine?.name, mine?.labels, mine?.items.map((i) => i.key), mine?.createdBy]).toEqual([`${TEST_PREFIX} Knots`, ['fall', 'outdoor skills'], [rankKeys[1], mbSubKey, rankKeys[0]], seeder]);
  });

  it('SaveSet_RefusesAKeyThatIsntARequirement', async () => {
    asSeeder();
    const res = await (await focus()).focusSaveSetAction({ id: null, name: `${TEST_PREFIX} Bad`, labels: [], items: ['tenderfoot-nope'] });
    if (res.ok) sets.push(res.id);
    expect([res.ok, await setCount()]).toEqual([false, 0]);
  });

  it('SaveSet_RefusesAnEmptyName', async () => {
    asSeeder();
    expect(await (await focus()).focusSaveSetAction({ id: null, name: '   ', labels: [], items: [] })).toEqual({ ok: false, error: 'Give the set a name.' });
  });

  it('SaveSet_RefusesALongLabel', async () => {
    asSeeder();
    const res = await (await focus()).focusSaveSetAction({ id: null, name: `${TEST_PREFIX} Long`, labels: ['x'.repeat(31)], items: [] });
    if (res.ok) sets.push(res.id);
    expect(res.ok).toBe(false);
  });
});

describe('seeding', () => {
  it('FocusSet_Seed_MakesOneFocusGroup_WithTheSetsItemsSnapshot', async () => {
    const set = await makeSet('First aid night', [mbKey, mbSubKey, rankKeys[0]]);
    asSeeder();
    const res = await seedSet({ entryId: meeting, setId: set });
    const topics = await topicsOn();
    expect([res.ok && res.count, topics.map((t) => [t.topic_key, t.kind, t.title, t.seeded_by_person_id, t.focus_set_id]), await membersOf(`fg:${set}`)]).toEqual([
      3,
      [[`fg:${set}`, 'focus_group', `${TEST_PREFIX} First aid night`, seeder, set]],
      [mbKey, mbSubKey, rankKeys[0]]
    ]);
  });

  it('FocusSet_Seed_KeepsExistingFocusTopics', async () => {
    const a = await makeSet('A', [rankKeys[0]]);
    const b = await makeSet('B', [rankKeys[1]]);
    asSeeder();
    await seedTopic({ entryId: meeting, key: rankKeys[2] });
    await seedSet({ entryId: meeting, setId: a });
    await seedSet({ entryId: meeting, setId: b });
    expect((await topicsOn()).filter((t) => t.seeded_at).map((t) => t.topic_key).sort()).toEqual([`fg:${a}`, `fg:${b}`, rankKeys[2]].sort());
  });

  it('FocusSet_SeedTwice_IsIdempotent_AndKeepsTheFirstSnapshot', async () => {
    const set = await makeSet('Twice', [rankKeys[0]]);
    asSeeder();
    await seedSet({ entryId: meeting, setId: set });
    await sb.rpc('focus_set_save', { p_actor: seeder, p_set: set, p_name: `${TEST_PREFIX} Twice renamed`, p_labels: [], p_items: [rankKeys[1], rankKeys[2]] });
    const again = await seedSet({ entryId: meeting, setId: set });
    const topics = await topicsOn();
    expect([again.ok, topics.length, topics[0].title, await membersOf(`fg:${set}`)]).toEqual([true, 1, `${TEST_PREFIX} Twice`, [rankKeys[0]]]);
  });

  it('SeedTopic_AcceptsATopLevelMeritBadgeRequirement', async () => {
    asSeeder();
    await seedTopic({ entryId: meeting, key: mbKey });
    expect((await topicsOn()).map((t) => [t.topic_key, t.kind, !!t.seeded_at])).toEqual([[mbKey, 'mb_req', true]]);
  });

  it('SeedTopic_RefusesASubRequirement', async () => {
    asSeeder();
    const res = await seedTopic({ entryId: meeting, key: mbSubKey });
    expect([res.ok, await topicsOn()]).toEqual([false, []]);
  });

  it('SeedTopic_RefusesAWholeBadge', async () => {
    asSeeder();
    expect((await seedTopic({ entryId: meeting, key: 'mb:first-aid' })).ok).toBe(false);
  });

  it('Seeding_ChangesTheBoardStamp', async () => {
    asSeeder();
    const before = String((await sb.rpc('meeting_board_stamp', { p_entry: meeting })).data);
    const res = await seedTopic({ entryId: meeting, key: rankKeys[0] });
    expect(res.ok && res.stamp !== before).toBe(true);
  });

  it('Unseeding_ChangesTheBoardStamp', async () => {
    asSeeder();
    const seeded = await seedTopic({ entryId: meeting, key: rankKeys[0] });
    const res = await unseed({ entryId: meeting, key: rankKeys[0] });
    expect(seeded.ok && res.ok && res.stamp !== seeded.stamp).toBe(true);
  });
});

describe('unseeding and deleting', () => {
  it('Unseed_WithNoPicks_RemovesTheTopic', async () => {
    const set = await makeSet('Gone', [rankKeys[0]]);
    asSeeder();
    await seedSet({ entryId: meeting, setId: set });
    await unseed({ entryId: meeting, key: `fg:${set}` });
    expect(await topicsOn()).toEqual([]);
  });

  it('Unseed_WithPicks_KeepsTheRow', async () => {
    asSeeder();
    await seedTopic({ entryId: meeting, key: mbKey });
    asEditor();
    const picked = await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: mbKey, on: true });
    asSeeder();
    await unseed({ entryId: meeting, key: mbKey });
    const topics = await topicsOn();
    expect([picked.ok, topics.map((t) => [t.topic_key, t.seeded_at, t.seeded_by_person_id])]).toEqual([true, [[mbKey, null, null]]]);
  });

  it('UnseededGroupWithAPick_KeepsItsTitle_InTheDrawerAndTheTray', async () => {
    const set = await makeSet('Kept title', [rankKeys[0], mbSubKey]);
    asSeeder();
    await seedSet({ entryId: meeting, setId: set });
    asEditor();
    await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: `fg:${set}`, on: true });
    asSeeder();
    await unseed({ entryId: meeting, key: `fg:${set}` });
    asEditor();
    const res = await (await actions()).plannerOpenPersonAction({ entryId: meeting, personId: young });
    const opt = res.ok ? res.drawer.options.find((o) => o.key === `fg:${set}`) : undefined;
    const { loadScoutBoard, loadBoardScouts, loadMeetingById } = await import('../src/lib/meeting-board');
    const { fetchAdvancementCatalog } = await import('../src/lib/advancement-catalog');
    const board = await loadScoutBoard(sb, (await loadMeetingById(sb, meeting))!, (await loadBoardScouts(sb, [young]))[0], await fetchAdvancementCatalog(sb), { viewerPersonId: editorAdult });
    expect([opt?.title, board.view.picks.find((p) => p.key === `fg:${set}`)?.label]).toEqual([`${TEST_PREFIX} Kept title`, `${TEST_PREFIX} Kept title`]);
  });

  it('DeletingASet_LeavesTheSeededGroupIntact', async () => {
    const set = await makeSet('Deleted later', [rankKeys[0], rankKeys[1]]);
    asSeeder();
    await seedSet({ entryId: meeting, setId: set });
    const del = await (await focus()).focusDeleteSetAction({ id: set });
    const topics = await topicsOn();
    expect([del.ok, topics.map((t) => [t.topic_key, t.title, t.focus_set_id, !!t.seeded_at]), await membersOf(`fg:${set}`)]).toEqual([
      true,
      [[`fg:${set}`, `${TEST_PREFIX} Deleted later`, null, true]],
      [rankKeys[0], rankKeys[1]]
    ]);
  });
});

describe('scouts pick seeded topics', () => {
  it('SeededMbReq_AppearsInScoutPickList_AndIsPickable', async () => {
    asSeeder();
    await seedTopic({ entryId: meeting, key: mbKey });
    asEditor();
    const tick = await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: mbKey, on: true });
    const res = await (await actions()).plannerOpenPersonAction({ entryId: meeting, personId: young });
    const opt = tick.ok && res.ok ? res.drawer.options.find((o) => o.key === mbKey) : undefined;
    expect([tick.ok, opt?.on, opt?.meta.startsWith('First Aid')]).toEqual([true, true, true]);
  });

  it('UnseededMbReq_IsNotPickable', async () => {
    asEditor();
    expect(await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: mbKey, on: true })).toEqual({ ok: false, error: 'That isn’t on their pick list.' });
  });

  it('FocusGroup_IsOnePick_ForTheScout', async () => {
    const set = await makeSet('Group pick', [rankKeys[0], rankKeys[1], mbSubKey]);
    asSeeder();
    await seedSet({ entryId: meeting, setId: set });
    asEditor();
    const res = await (await actions()).plannerTogglePickAction({ entryId: meeting, personId: young, key: `fg:${set}`, on: true });
    const { count } = await sb.from('meeting_topic_picks').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting).eq('person_id', young);
    expect([res.ok && res.tick.count, count]).toEqual([1, 1]);
  });

  it('AnFgKey_IsNeverCreatedByAPick', async () => {
    const { data } = await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: 'fg:999999' });
    expect([data, await topicsOn()]).toEqual([null, []]);
  });
});

describe('Add an offer without a teacher', () => {
  it('Seeder_AddsAnOfferWithNoTeacher_AsASeed', async () => {
    asSeeder();
    await seedTopic({ entryId: meeting, key: rankKeys[0] });
    const { count } = await sb.from('meeting_topic_teachers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting);
    expect([(await topicsOn()).map((t) => [t.topic_key, !!t.seeded_at]), count]).toEqual([[[rankKeys[0], true]], 0]);
  });

  it('Editor_StillNamesATeacher_ForAnOffer', async () => {
    asEditor();
    const res = await (await actions()).plannerAddOfferAction({ entryId: meeting, personId: teacher, what: { key: rankKeys[0] } });
    expect([res.ok, (await topicsOn()).map((t) => t.seeded_at)]).toEqual([true, [null]]);
  });
});

describe('the server search', () => {
  it('FocusSearch_MatchesTokensAcrossSourceCodeLabel (Tenderfoot 4a)', async () => {
    asViewer();
    const res = await (await focus()).focusSearchAction({ q: 'Tenderfoot 4a', kind: 'all', source: null, offset: 0 });
    expect(res.ok && [res.rows[0].key, res.rows[0].sourceName, res.rows[0].code]).toEqual(['tenderfoot-4a', 'Tenderfoot', '4a']);
  });

  it('FocusSearch_MatchesTokensAcrossSourceCodeLabel (First Aid 9)', async () => {
    asViewer();
    const res = await (await focus()).focusSearchAction({ q: 'First Aid 9', kind: 'all', source: null, offset: 0 });
    expect(res.ok && [res.rows[0].key, res.rows[0].kind]).toEqual(['first-aid-9', 'mb']);
  });

  it('FocusSearch_TreatsPercentAndUnderscoreLiterally', async () => {
    asViewer();
    const res = await (await focus()).focusSearchAction({ q: '%', kind: 'all', source: null, offset: 0 });
    expect(res.ok && res.rows.length).toBe(0);
  });

  it('FocusSearch_LeavesOutBoardsOfReview', async () => {
    asViewer();
    const res = await (await focus()).focusSearchAction({ q: 'board review', kind: 'rank', source: null, offset: 0 });
    expect(res.ok && res.rows.some((r) => r.code.toLowerCase() === 'bor')).toBe(false);
  });

  it('FocusSearch_PagesBy50_AndSaysThereIsMore', async () => {
    asViewer();
    const fa = await focus();
    const first = await fa.focusSearchAction({ q: '', kind: 'mb', source: null, offset: 0 });
    const second = await fa.focusSearchAction({ q: '', kind: 'mb', source: null, offset: 50 });
    expect([first.ok && first.rows.length, first.ok && first.hasMore, second.ok && second.rows[0].key !== (first.ok && first.rows[0].key)]).toEqual([50, true, true]);
  });

  it('FocusCounts_CountMatchesPerSource', async () => {
    asViewer();
    const res = await (await focus()).focusCountsAction({ q: 'first aid', kind: 'rank' });
    expect(res.ok && res.sources.every((s) => s.kind === 'rank' && s.n > 0) && res.sources.some((s) => s.id === 'tenderfoot')).toBe(true);
  });

  it('FocusSearch_NarrowsToOneSource', async () => {
    asViewer();
    const res = await (await focus()).focusSearchAction({ q: '', kind: 'all', source: 'first-aid', offset: 0 });
    expect(res.ok && res.rows.length > 0 && res.rows.every((r) => r.sourceId === 'first-aid')).toBe(true);
  });
});

describe('the database', () => {
  it('MeetingTopics_Check_AcceptsAllFiveKinds_AndRejectsMismatchedKeys', () => {
    const e = meeting;
    const ok = (sql: string) => {
      try {
        localSql(`begin; ${sql}; rollback;`);
        return true;
      } catch {
        return false;
      }
    };
    const ins = (cols: string, vals: string) => `insert into meeting_topics (calendar_entry_id, ${cols}) values (${e}, ${vals})`;
    expect([
      ok(ins('topic_key, kind, rank_id, req_code', `'tenderfoot-4a', 'rank_req', 'tenderfoot', '4a'`)),
      ok(ins('topic_key, kind, mb_id', `'mb:first-aid', 'merit_badge', 'first-aid'`)),
      ok(ins('topic_key, kind, mb_id, req_code', `'first-aid-9', 'mb_req', 'first-aid', '9'`)),
      ok(ins('topic_key, kind, title', `'ff:knots', 'freeform', 'Knots'`)),
      ok(ins('topic_key, kind, title', `'fg:1', 'focus_group', 'Knots night'`)),
      ok(ins('topic_key, kind, title', `'ff:1', 'focus_group', 'Knots night'`)),
      ok(ins('topic_key, kind, title', `'fg:1', 'focus_group', '  '`)),
      ok(ins('topic_key, kind, mb_id, req_code', `'first-aid-8', 'mb_req', 'first-aid', '9'`)),
      ok(ins('topic_key, kind, title, focus_set_id', `'ff:x', 'freeform', 'X', null`))
    ]).toEqual([true, true, true, true, true, false, false, false, true]);
  });

  it('NoMeritBadgeId_StartsWithARankIdAndADash', () => {
    expect(localSql(`select count(*) from merit_badges m join ranks r on m.id like r.id || '-%'`)).toBe('0');
  });

  it('FocusTables_AndFunctions_AreClosedToAnonAndAuthenticated', () => {
    const fns = [
      'focus_set_save(bigint,bigint,text,text[],text[])',
      'focus_set_delete(bigint)',
      'meeting_seed_focus_set(bigint,bigint,bigint)',
      'meeting_seed_topic(bigint,text,bigint)',
      'meeting_unseed_topic(bigint,text)',
      'focus_requirement_search(text,text,text,integer,integer)',
      'focus_requirement_counts(text,text)',
      '_meeting_topic_id(bigint,text)',
      'meeting_board_stamp(bigint)'
    ];
    const tables = ['focus_sets', 'focus_set_labels', 'focus_set_items', 'meeting_topic_members'];
    const checks = ['anon', 'authenticated'].flatMap((role) => [
      ...fns.map((f) => `has_function_privilege('${role}', 'public.${f}', 'execute')`),
      ...tables.map((t) => `has_table_privilege('${role}', 'public.${t}', 'select')`)
    ]);
    expect(localSql(`select bool_or(x) from (values ${checks.map((c) => `(${c})`).join(', ')}) v(x)`)).toBe('f');
  });

  it('MergePeople_MovesSeededByAndSetCreator_AndKeepsForPicks', async () => {
    const survivor = await person('Survivor');
    const loser = await person('Loser');
    const set = (await sb.rpc('focus_set_save', { p_actor: loser, p_set: null, p_name: `${TEST_PREFIX} Merge`, p_labels: [], p_items: [rankKeys[0]] })).data as number;
    sets.push(Number(set));
    await sb.rpc('meeting_seed_topic', { p_entry: meeting, p_key: rankKeys[0], p_actor: loser });
    const { data: topic } = await sb.from('meeting_topics').select('id').eq('calendar_entry_id', meeting).eq('topic_key', rankKeys[0]).single();
    const { error: tErr } = await sb.from('meeting_topic_teachers').insert({ topic_id: (topic as { id: number }).id, calendar_entry_id: meeting, person_id: loser, for_picks: true });
    if (tErr) throw new Error(tErr.message);
    const { error } = await sb.rpc('merge_people', { p_survivor: survivor, p_loser: loser, p_decided_by: 'vitest' });
    if (error) throw new Error(error.message);
    const [{ data: s }, { data: t }, { data: tt }] = await Promise.all([
      sb.from('focus_sets').select('created_by_person_id').eq('id', set).single(),
      sb.from('meeting_topics').select('seeded_by_person_id').eq('calendar_entry_id', meeting).eq('topic_key', rankKeys[0]).single(),
      sb.from('meeting_topic_teachers').select('person_id, for_picks').eq('calendar_entry_id', meeting)
    ]);
    expect([(s as { created_by_person_id: number }).created_by_person_id, (t as { seeded_by_person_id: number }).seeded_by_person_id, tt]).toEqual([survivor, survivor, [{ person_id: survivor, for_picks: true }]]);
  });
});
