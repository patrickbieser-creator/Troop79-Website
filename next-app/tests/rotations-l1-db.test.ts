import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { addMeetingPick, loadMeetingById, removeMeetingPick, setMeetingIntent } from '../src/lib/meeting-board';

/**
 * Rotations L1 (Plans/Build-A-Plan.md, "Rotations", Decisions 2 and 3), against the real local database. Once a meeting
 * has an arrangement, reconcile keeps it in step with the plan: late picks land in their class marked New, unpinned
 * scouts leave when they say Can't or drop the pick, and a planner's hand is never overruled (pinned scouts are
 * flagged, a scout taken out of a topic by hand stays out). Fixture meetings are dated 2096; cleanup by test-owned ids.
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

const live = () => import('../src/app/(public)/planner/live-actions');
const lib = () => import('../src/lib/meeting-live');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
let meeting = 0;
let editor = 0;
let ann = 0;
let ben = 0;
let cal = 0;
let key = '';
let key2 = '';
let key3 = '';

async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} RL1 ${label}`, first_name: `${TEST_PREFIX} RL1`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-rl1-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} RL1`, last_name: label, display_name: `${TEST_PREFIX} RL1 ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}
const writer = (personId: number) => ({ entryId: meeting, personId, actorPersonId: editor, leader: true, carry: null });
const pick = async (personId: number, k: string) => {
  const res = await addMeetingPick(sb, writer(personId), k, { later: false, markComing: false });
  if (!res.ok) throw new Error(res.error);
};
const unpick = async (personId: number, k: string) => {
  const res = await removeMeetingPick(sb, writer(personId), k);
  if (!res.ok) throw new Error(res.error);
};
const answer = async (personId: number, intent: 'coming' | 'undecided' | 'not_coming') => {
  const res = await setMeetingIntent(sb, { entryId: meeting, personId, actorPersonId: editor, leader: true }, intent);
  if (!res.ok) throw new Error(res.error);
};
/** Start the arrangement straight from a snapshot: class ids back, in the order given. */
async function started(classes: { topic_key: string; rotation: number | null; members?: number[] }[]): Promise<number[]> {
  for (const c of classes) await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: c.topic_key });
  const { error } = await sb.rpc('meeting_live_start', {
    p_entry: meeting,
    p_actor: editor,
    p_snapshot: { rotations: [], classes: classes.map((c, i) => ({ source_key: `t:${i}`, title: null, teacher_person_id: null, position: i, members: [], ...c })) }
  });
  if (error) throw new Error(error.message);
  const { data } = await sb.from('meeting_classes').select('id, source_key').eq('calendar_entry_id', meeting);
  const rows = (data ?? []) as { id: number; source_key: string }[];
  return classes.map((_, i) => rows.find((r) => r.source_key === `t:${i}`)!.id);
}
async function clearMeeting(entryId: number) {
  await sb.from('meeting_live_holds').delete().eq('calendar_entry_id', entryId);
  const { data: cls } = await sb.from('meeting_classes').select('id').eq('calendar_entry_id', entryId);
  const ids = ((cls ?? []) as { id: number }[]).map((c) => c.id);
  if (ids.length) await sb.from('meeting_classes').delete().in('id', ids);
  await sb.from('meeting_rotations').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_boards').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_live_presence').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', entryId);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', entryId);
}
type Member = { person_id: number; pinned: boolean; is_new: boolean };
const rowsOf = async (classId: number) =>
  (((await sb.from('meeting_class_members').select('person_id, pinned, is_new').eq('class_id', classId)).data ?? []) as Member[]).sort((a, b) => a.person_id - b.person_id);
const membersOf = async (classId: number) => (await rowsOf(classId)).map((m) => m.person_id);
const view = async () => (await lib()).loadLiveView(sb, (await loadMeetingById(sb, meeting))!);
const asEditor = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: editor, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });
const move = async (personId: number, from: number | null, to: number | null) => {
  asEditor();
  const res = await (await live()).plannerLiveMoveScoutAction({ entryId: meeting, personId, from: from === null ? null : `c:${from}`, to: to === null ? null : `c:${to}` });
  if (!res.ok) throw new Error(res.error);
};

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2096-05-03', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  entries.push(meeting);
  editor = await person('Editor');
  ann = await scout('Ann');
  ben = await scout('Ben');
  cal = await scout('Cal');
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order').limit(3);
  [key, key2, key3] = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
});

afterEach(async () => {
  await clearMeeting(meeting);
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('Rotations L1: late picks land', () => {
  it('LatePick_LandsInItsClass_MarkedNewAndUnpinned', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    expect(await rowsOf(c)).toEqual([{ person_id: ann, pinned: false, is_new: true }]);
  });

  it('LatePick_NoClass_WaitsInNotInAClassYet', async () => {
    await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key2);
    expect((await view()).pool.some((p) => p.personId === ann)).toBe(true);
  });

  it('LatePick_NotStarted_NothingIsArranged', async () => {
    await pick(ann, key);
    expect((await sb.from('meeting_classes').select('id').eq('calendar_entry_id', meeting)).data).toEqual([]);
  });

  it('LatePick_NotSureYet_DoesNotLand', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await answer(ann, 'undecided');
    await pick(ann, key);
    expect(await membersOf(c)).toEqual([]);
  });

  it('LatePick_RepeatInAFreeRotation_IsChosen', async () => {
    const [k1, k2r1, k2r2] = await started([
      { topic_key: key, rotation: 1 },
      { topic_key: key2, rotation: 1 },
      { topic_key: key2, rotation: 2 }
    ]);
    await pick(ann, key);
    await pick(ann, key2);
    expect([await membersOf(k1), await membersOf(k2r1), await membersOf(k2r2)]).toEqual([[ann], [], [ann]]);
  });

  it('LatePick_TwoClassesAlready_Waits', async () => {
    const [, , c3] = await started([
      { topic_key: key, rotation: 1 },
      { topic_key: key2, rotation: 2 },
      { topic_key: key3, rotation: null }
    ]);
    await pick(ann, key);
    await pick(ann, key2);
    await pick(ann, key3);
    expect(await membersOf(c3)).toEqual([]);
  });

  it('LatePick_FullClass_Waits', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    const fill: number[] = [];
    for (let i = 0; i < 8; i++) fill.push(await scout(`Fill${i}`));
    await sb.from('meeting_class_members').insert(fill.map((person_id) => ({ class_id: c, person_id, pinned: true })));
    await pick(ann, key);
    expect((await membersOf(c)).includes(ann)).toBe(false);
  });

  it('MakeClass_PickersLand', async () => {
    await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key2);
    asEditor();
    const res = await (await live()).plannerLiveAddClassAction({ entryId: meeting, key: key2, title: null, teacherId: null, rotation: null, expectStarted: true });
    const { data } = await sb.from('meeting_classes').select('id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('meeting_topics.topic_key', key2);
    const made = ((data ?? []) as { id: number }[])[0];
    expect([res.ok, made ? await membersOf(made.id) : null]).toEqual([true, [ann]]);
  });
});

describe('Rotations L1: unpinned scouts leave on their own', () => {
  it('Unpinned_SaysCant_Leaves', async () => {
    await pick(ann, key);
    const [c] = await started([{ topic_key: key, rotation: 1, members: [ann] }]);
    await answer(ann, 'not_coming');
    expect(await membersOf(c)).toEqual([]);
  });

  it('Unpinned_DropsThePick_Leaves', async () => {
    await pick(ann, key);
    await pick(ann, key2);
    const [c] = await started([{ topic_key: key, rotation: 1, members: [ann] }]);
    await unpick(ann, key);
    expect(await membersOf(c)).toEqual([]);
  });

  it('Unpinned_NotSureYetWithNoPicks_Stays', async () => {
    await answer(ann, 'undecided');
    const [c] = await started([{ topic_key: key, rotation: 1, members: [ann] }]);
    await answer(ben, 'coming');
    expect(await membersOf(c)).toEqual([ann]);
  });

  it('Unpinned_MergedSiblingClass_Stays', async () => {
    await pick(ann, key2);
    await pick(ann, key3);
    await sb.rpc('_meeting_topic_id', { p_entry: meeting, p_key: key });
    const { error } = await sb.rpc('meeting_live_start', {
      p_entry: meeting,
      p_actor: editor,
      p_snapshot: { rotations: [], classes: [{ source_key: 't:0', topic_key: key, title: 'First Aid', rotation: 1, teacher_person_id: null, position: 0, members: [ann] }] }
    });
    if (error) throw new Error(error.message);
    await unpick(ann, key3);
    const { data } = await sb.from('meeting_classes').select('id').eq('calendar_entry_id', meeting);
    expect(await membersOf(((data ?? []) as { id: number }[])[0].id)).toEqual([ann]);
  });
});

describe('Rotations L1: a hand is never overruled', () => {
  it('MoveByHand_Pins_AndClearsNew', async () => {
    const [c1, c2] = await started([
      { topic_key: key, rotation: 1 },
      { topic_key: key2, rotation: 2 }
    ]);
    await pick(ann, key);
    await move(ann, c1, c2);
    expect(await rowsOf(c2)).toEqual([{ person_id: ann, pinned: true, is_new: false }]);
  });

  it('Pinned_SaysCant_Stays', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await move(ann, null, c);
    await answer(ann, 'not_coming');
    expect(await membersOf(c)).toEqual([ann]);
  });

  it('Pinned_SaysCant_IsFlagged', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await move(ann, null, c);
    await answer(ann, 'not_coming');
    expect((await view()).drift.filter((d) => d.kind === 'cant' && d.personId === ann).length).toBe(1);
  });

  it('Pinned_DropsThePick_Stays', async () => {
    await pick(ann, key);
    await pick(ann, key2);
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await move(ann, null, c);
    await unpick(ann, key);
    expect(await membersOf(c)).toEqual([ann]);
  });

  it('TakenOutByHand_IsNotPutBack', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    await move(ann, c, null);
    await pick(ann, key2);
    expect(await membersOf(c)).toEqual([]);
  });

  it('PlacedBackByHand_ClearsTheHold', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    await move(ann, c, null);
    await move(ann, null, c);
    const { data } = await sb.from('meeting_live_holds').select('person_id').eq('calendar_entry_id', meeting);
    expect(data).toEqual([]);
  });

  it('RemoveClass_UnpinnedScoutsGoToTheOtherRepeat', async () => {
    const [r1, r2] = await started([
      { topic_key: key, rotation: 1 },
      { topic_key: key, rotation: 2 }
    ]);
    await pick(ann, key);
    const first = (await membersOf(r1)).includes(ann) ? r1 : r2;
    const other = first === r1 ? r2 : r1;
    asEditor();
    await (await live()).plannerLiveRemoveClassAction({ entryId: meeting, classId: `c:${first}`, version: 1 });
    expect(await membersOf(other)).toEqual([ann]);
  });

  it('Discard_ClearsTheHolds', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    await move(ann, c, null);
    asEditor();
    await (await live()).plannerLiveDiscardAction({ entryId: meeting });
    const { data } = await sb.from('meeting_live_holds').select('person_id').eq('calendar_entry_id', meeting);
    expect(data).toEqual([]);
  });
});

describe('Rotations L1: New', () => {
  it('LiveView_Chip_SaysNew', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    const card = (await view()).cards.find((x) => x.id === `c:${c}`);
    expect(card?.members.map((m) => [m.personId, m.isNew])).toEqual([[ann, true]]);
  });

  it('DismissNew_OneChip', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    await pick(ben, key);
    asEditor();
    const res = await (await live()).plannerLiveDismissNewAction({ entryId: meeting, classId: `c:${c}`, personId: ann });
    expect([res.ok, (await rowsOf(c)).map((m) => m.is_new)]).toEqual([true, [false, true]]);
  });

  it('DismissNew_All', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    await pick(ben, key);
    asEditor();
    await (await live()).plannerLiveDismissNewAction({ entryId: meeting, classId: null, personId: null });
    expect((await rowsOf(c)).map((m) => m.is_new)).toEqual([false, false]);
  });

  it('DismissNew_Viewer_IsRefused', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    asViewer();
    const res = await (await live()).plannerLiveDismissNewAction({ entryId: meeting, classId: null, personId: null });
    expect([res.ok, (await rowsOf(c)).map((m) => m.is_new)]).toEqual([false, [true]]);
  });

  it('DismissNew_DoesNotPin', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await pick(ann, key);
    asEditor();
    await (await live()).plannerLiveDismissNewAction({ entryId: meeting, classId: `c:${c}`, personId: ann });
    expect((await rowsOf(c)).map((m) => m.pinned)).toEqual([false]);
  });
});

describe('Rotations L1: start reconciles', () => {
  it('Start_FromTheServer_LandsPicksTheMatcherLeftOut', async () => {
    // A topic with a class but no teacher: the matcher places nobody there; reconcile does, once the arrangement exists.
    await pick(ann, key);
    await pick(ben, key);
    asEditor();
    const res = await (await live()).plannerLiveStartAction({ entryId: meeting });
    await (await live()).plannerLiveAddClassAction({ entryId: meeting, key, title: null, teacherId: null, rotation: 1, expectStarted: true });
    const { data } = await sb.from('meeting_classes').select('id, meeting_topics!inner(topic_key)').eq('calendar_entry_id', meeting).eq('meeting_topics.topic_key', key);
    const all = (await Promise.all(((data ?? []) as { id: number }[]).map((c) => membersOf(c.id)))).flat().sort((a, b) => a - b);
    expect([res.ok, all]).toEqual([true, [ann, ben].sort((a, b) => a - b)]);
  });
});

describe('Rotations L1: merge_people', () => {
  it('Merge_CarriesPinnedAndHolds', async () => {
    const [c1, c2] = await started([
      { topic_key: key, rotation: 1 },
      { topic_key: key2, rotation: 2 }
    ]);
    const dup = await person('CalDup');
    await move(dup, null, c1);
    await sb.from('meeting_live_holds').insert({ calendar_entry_id: meeting, person_id: dup, topic_id: (await sb.from('meeting_classes').select('topic_id').eq('id', c2).single()).data!.topic_id });
    const { error } = await sb.rpc('merge_people', { p_survivor: cal, p_loser: dup, p_decided_by: 'vitest' });
    const holds = ((await sb.from('meeting_live_holds').select('person_id').eq('calendar_entry_id', meeting)).data ?? []) as { person_id: number }[];
    expect([error, await rowsOf(c1), holds.map((h) => h.person_id)]).toEqual([null, [{ person_id: cal, pinned: true, is_new: false }], [cal]]);
  });
});

describe('Rotations L1: the attendance checklist', () => {
  it('Review_PinnedScoutWhoSaidCant_StartsUnticked', async () => {
    const [c] = await started([{ topic_key: key, rotation: 1 }]);
    await move(ann, null, c);
    await answer(ann, 'not_coming');
    const review = await (await lib()).loadAttendanceReview(sb, meeting, '2096-05-03');
    const row = review.groups.flatMap((g) => g.people).find((p) => p.personId === ann);
    expect(row?.ticked).toBe(false);
  });
});
