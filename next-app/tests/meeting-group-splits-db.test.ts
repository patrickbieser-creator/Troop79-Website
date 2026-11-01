import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { fetchPeopleLists } from '../src/lib/people-lists';
import { loadThisWeekData } from '../src/lib/this-week-db';
import { buildThisWeek } from '../src/lib/this-week';
import { loadBoardStamp } from '../src/lib/meeting-board';
import { loadGroupSplits } from '../src/lib/group-splits-db';

/**
 * Split groups, S2 (Plans/Meeting-Planner-III-Split-Groups.md): a seed holder splits a rank group into 2-3 groups,
 * merges it (soft) and splits it again as it was; section keys resolve to topics; everyone without the seed right is
 * refused before anything is written. Real local database (migration 20261231900000_meeting_group_splits); the actor
 * is mocked. Test-owned rows only: one 2087 meeting and its focus set, deleted by id (splits, roles and topics go with
 * the meeting).
 */
const sb = adminClient();
const state = vi.hoisted(() => ({ actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }, today: '2087-02-20' }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => state.today }));

const tw = () => import('../src/app/(public)/planner/this-week-actions');

const TF = 'fr:tenderfoot';
let entry = 0;
let setId = 0;
let planner = 0;
const asSeeder = () => (state.actor = { personId: planner, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed', 'meeting_planner.edit']) });
const asEditor = () => (state.actor = { personId: planner, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });

async function view() {
  const [catalog, lists] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb)]);
  return buildThisWeek((await loadThisWeekData(sb, { entryId: entry, date: '2087-03-02' }, lists, catalog)).input);
}
const rowsOf = (v: Awaited<ReturnType<typeof view>>) => v.sections.flatMap((x) => x.rows);
const groupKeys = async () => (await view()).groups.map((g) => g.key).filter((k) => k.startsWith(TF));
const rows = async () => {
  const { data } = await sb.from('meeting_group_splits').select('section, item_keys, merged_at').eq('calendar_entry_id', entry).eq('group_key', TF).order('section');
  return (data ?? []) as { section: number; item_keys: string[]; merged_at: string | null }[];
};

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX} GS%`).gte('entry_date', '2087-01-01').lte('entry_date', '2087-12-31');
  const { data: e, error } = await sb.from('calendar_entries').insert({ entry_date: '2087-03-02', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} GS` }).select('id').single();
  if (error) throw new Error(error.message);
  entry = e!.id as number;
  const { data: leaders } = await sb.from('person_directory').select('person_id').eq('tab', 'leader').eq('in_picker', true).order('person_id').limit(1);
  planner = ((leaders ?? []) as { person_id: number }[])[0].person_id;
  const { data: set, error: setErr } = await sb.from('focus_sets').insert({ name: `${TEST_PREFIX} GS set` }).select('id').single();
  if (setErr) throw new Error(setErr.message);
  setId = set!.id as number;
  await sb.from('focus_set_items').insert([
    { set_id: setId, topic_key: 'tenderfoot-4a', position: 0 },
    { set_id: setId, topic_key: 'tenderfoot-4b', position: 1 }
  ]);
  asSeeder();
  const r = await (await tw()).twAddFocusSetAction({ entryId: entry, setId });
  if (!r.ok) throw new Error(r.error);
});

afterAll(async () => {
  if (entry) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', entry);
    await sb.from('calendar_entries').delete().eq('id', entry);
  }
  if (setId) await sb.from('focus_sets').delete().eq('id', setId);
});

describe('section keys', () => {
  it('TopicId_ResolvesRankAndBadgeSectionKeys', async () => {
    const ids = await Promise.all(['fr:tenderfoot~2', 'fr:tenderfoot~3', 'fr:mb:first-aid~2'].map((k) => sb.rpc('_meeting_topic_id', { p_entry: entry, p_key: k })));
    expect(ids.map((r) => [r.error, typeof r.data])).toEqual([[null, 'number'], [null, 'number'], [null, 'number']]);
  });

  it('TopicId_RefusesGroup1And4AndUnknownRanks', async () => {
    const ids = await Promise.all(['fr:tenderfoot~4', 'fr:tenderfoot~1', 'fr:star~2', 'fr:mb:no-such-badge~2'].map((k) => sb.rpc('_meeting_topic_id', { p_entry: entry, p_key: k })));
    expect(ids.map((r) => r.data)).toEqual([null, null, null, null]);
  });

  it('TopicConstraint_RejectsASectionKeyThatDoesntMatchItsRank', async () => {
    const { error } = await sb.from('meeting_topics').insert({ calendar_entry_id: entry, topic_key: 'fr:scout~2', kind: 'focus_group_part', rank_id: 'tenderfoot' });
    expect(error?.message).toMatch(/meeting_topics_one_reference/);
  });
});

describe('split, merge, split again', () => {
  it('Editor_WithoutTheSeedRight_IsRefused', async () => {
    asEditor();
    const t = await tw();
    const r = await Promise.all([
      t.twSplitGroupAction({ entryId: entry, group: TF, sections: [['tenderfoot-4a'], ['tenderfoot-4b']] }),
      t.twMergeGroupAction({ entryId: entry, group: TF }),
      t.twUnmergeGroupAction({ entryId: entry, group: TF })
    ]);
    expect([r.map((x) => x.ok), await rows()]).toEqual([[false, false, false], []]);
  });

  it('MalformedOrBadgeGroup_IsRefused', async () => {
    asSeeder();
    const t = await tw();
    const r = await Promise.all([
      t.twSplitGroupAction({ entryId: entry, group: TF, sections: [['tenderfoot-4a']] }),
      t.twSplitGroupAction({ entryId: entry, group: TF, sections: [[], [], [], []] }),
      t.twSplitGroupAction({ entryId: entry, group: 'fr:mb:first-aid', sections: [[], []] })
    ]);
    expect(r.map((x) => x.ok)).toEqual([false, false, false]);
  });

  it('ARequirementOfAnotherRank_IsRefusedAndNamed', async () => {
    asSeeder();
    const r = await (await tw()).twSplitGroupAction({ entryId: entry, group: TF, sections: [['tenderfoot-4a'], ['second-class-6a']] });
    expect(r).toEqual({ ok: false, error: 'Not a requirement of this group: second-class-6a' });
  });

  it('Seeder_SplitsTenderfoot_IntoTwoGroups', async () => {
    asSeeder();
    const r = await (await tw()).twSplitGroupAction({ entryId: entry, group: TF, sections: [['tenderfoot-4a'], ['tenderfoot-4b']] });
    expect([r.ok, await groupKeys()]).toEqual([true, [TF, 'fr:tenderfoot~2']]);
  });

  it('HandMove_IntoGroup2_IsAccepted', async () => {
    asSeeder();
    const scout = rowsOf(await view()).find((x) => x.groupKey?.startsWith(TF));
    if (!scout) throw new Error('The local mirror has no scout in the Tenderfoot group to move');
    const r = await (await tw()).twSetRoleAction({ entryId: entry, personId: scout.personId, role: 'group', key: 'fr:tenderfoot~2' });
    expect([r.ok, rowsOf(await view()).find((x) => x.personId === scout.personId)?.groupKey]).toEqual([true, 'fr:tenderfoot~2']);
  });

  it('Merge_LeavesOneGroup_KeepsTheSections_AndChangesTheStamp', async () => {
    asSeeder();
    const before = await loadBoardStamp(sb, entry);
    const r = await (await tw()).twMergeGroupAction({ entryId: entry, group: TF });
    const after = await rows();
    expect([r.ok, await groupKeys(), after.length, after.every((x) => x.merged_at != null), (await loadBoardStamp(sb, entry)) !== before]).toEqual([true, [TF], 2, true, true]);
  });

  it('HandMove_ToGroup2_CountsForTheMergedGroup', async () => {
    const moved = rowsOf(await view()).filter((x) => x.groupKey === 'fr:tenderfoot~2');
    expect(moved).toEqual([]);
  });

  it('Unmerge_BringsTheSplitBackAsItWas', async () => {
    asSeeder();
    const r = await (await tw()).twUnmergeGroupAction({ entryId: entry, group: TF });
    expect([r.ok, await groupKeys(), (await rows()).map((x) => [x.section, x.item_keys, x.merged_at])]).toEqual([
      true,
      [TF, 'fr:tenderfoot~2'],
      [
        [1, ['tenderfoot-4a'], null],
        [2, ['tenderfoot-4b'], null]
      ]
    ]);
  });

  it('SplitAgain_WithThreeGroups_ReplacesTheSplit', async () => {
    asSeeder();
    const r = await (await tw()).twSplitGroupAction({ entryId: entry, group: TF, sections: [['tenderfoot-4a'], ['tenderfoot-4b'], ['tenderfoot-4a']] });
    expect([r.ok, (await rows()).map((x) => x.section), await groupKeys()]).toEqual([true, [1, 2, 3], [TF, 'fr:tenderfoot~2', 'fr:tenderfoot~3']]);
  });

  it('Levels_AreSavedAndRead', async () => {
    asSeeder();
    const r = await (await tw()).twSplitGroupAction({ entryId: entry, group: TF, sections: [['tenderfoot-4a'], ['tenderfoot-4b']], levels: [0, 3] });
    const { data } = await sb.from('meeting_group_splits').select('from_done').eq('calendar_entry_id', entry).eq('group_key', TF).order('section');
    expect([r.ok, (data ?? []).map((x) => x.from_done), (await loadGroupSplits(sb, entry)).splitLevels.get(TF)]).toEqual([true, [0, 3], [0, 3]]);
  });

  it('Levels_ThatFall_OrDontStartAtZero_AreRefused', async () => {
    asSeeder();
    const t = await tw();
    const r = await Promise.all([
      t.twSplitGroupAction({ entryId: entry, group: TF, sections: [['tenderfoot-4a'], ['tenderfoot-4b'], []], levels: [0, 3, 2] }),
      t.twSplitGroupAction({ entryId: entry, group: TF, sections: [['tenderfoot-4a'], ['tenderfoot-4b']], levels: [1, 3] })
    ]);
    expect(r.map((x) => x.ok)).toEqual([false, false]);
  });

  it('Unmerge_OfAGroupNeverSplit_IsRefusedInWords', async () => {
    asSeeder();
    expect(await (await tw()).twUnmergeGroupAction({ entryId: entry, group: 'fr:scout' })).toEqual({ ok: false, error: 'That group has no split to bring back.' });
  });
});

describe('older scouts who teach (Patrick, 2026-10-31: Oliver V)', () => {
  it('AnOlderScoutTeachingACard_IsNotNotAssignedAndAvailable_AndSaysWhatTheyTeach', async () => {
    asSeeder();
    const t = await tw();
    // The meeting's own Tenderfoot card; any older scout (First Class and up) set to Teach, then signed up to teach it.
    await t.twMergeGroupAction({ entryId: entry, group: TF });
    const before = await view();
    const older = rowsOf(before).find((r) => !r.counted);
    if (!older) throw new Error('The local mirror has no First Class-and-up scout');
    expect((await t.twSetRoleAction({ entryId: entry, personId: older.personId, role: 'teach' })).ok).toBe(true);
    expect((await t.twSetTeacherAction({ entryId: entry, key: TF, personId: older.personId, on: true })).ok).toBe(true);
    const v = await view();
    const where = v.sections.find((sec) => sec.rows.some((r) => r.personId === older.personId))!;
    const row = where.rows.find((r) => r.personId === older.personId)!;
    expect([where.key, row.note]).toEqual(['teaching', 'Teaching the Tenderfoot group']);
    await t.twSetTeacherAction({ entryId: entry, key: TF, personId: older.personId, on: false });
    await t.twSetRoleAction({ entryId: entry, personId: older.personId, role: null });
  });
});
