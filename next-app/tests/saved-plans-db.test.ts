import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { fetchPeopleLists } from '../src/lib/people-lists';
import { loadThisWeekData } from '../src/lib/this-week-db';
import { buildThisWeek, PLANNER_WEEKS } from '../src/lib/this-week';

/**
 * Saved meeting plans (Patrick, 2026-10-29): a seed holder saves a meeting's criteria (focus sets, planner-added
 * requirements, night badges; never people) under a name and a date, loads one onto another meeting (it REPLACES that
 * meeting's focus, added requirements and badges), renames or re-dates it, and deletes it. Everyone else is refused
 * before anything is read or written. Real local database (migration 20261231500000_saved_meeting_plans); the actor is
 * mocked. Test-owned rows only: two 2086 meetings, a focus set and the saved plans this file made, deleted by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({ actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }, today: '2086-02-20' }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => state.today }));

const actions = () => import('../src/app/(public)/planner/saved-plan-actions');
const tw = () => import('../src/app/(public)/planner/this-week-actions');

let from = 0;
let to = 0;
let setId = 0;
let planner = 0;
let single = '';
const plans: number[] = [];
const sets: number[] = [];
const asSeeder = () => (state.actor = { personId: planner, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed', 'meeting_planner.edit']) });
const asEditor = () => (state.actor = { personId: planner, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });
const asViewer = () => (state.actor = { personId: planner, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) });
const extraEntries: number[] = [];

async function view(entryId: number, date: string) {
  const [catalog, lists] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb)]);
  return buildThisWeek((await loadThisWeekData(sb, { entryId, date }, lists, catalog)).input);
}
async function entry(date: string, title = `Troop Meeting ${TEST_PREFIX} SP`): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title }).select('id').single();
  if (error) throw new Error(error.message);
  return data!.id as number;
}
async function save(name: string) {
  const r = await (await actions()).twSavePlanAction({ entryId: from, name, planDate: '2086-03-04' });
  if (r.ok) plans.push(r.id);
  return r;
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX} SP%`).gte('entry_date', '2086-01-01').lte('entry_date', '2086-12-31');
  from = await entry('2086-03-04');
  to = await entry('2086-03-11');
  const { data: leaders } = await sb.from('person_directory').select('person_id').eq('tab', 'leader').eq('in_picker', true).order('person_id').limit(1);
  planner = ((leaders ?? []) as { person_id: number }[])[0].person_id;
  const { data: set, error } = await sb.from('focus_sets').insert({ name: `${TEST_PREFIX} SP set` }).select('id').single();
  if (error) throw new Error(error.message);
  setId = set!.id as number;
  sets.push(setId);
  await sb.from('focus_set_items').insert([
    { set_id: setId, topic_key: 'tenderfoot-4a', position: 0 },
    { set_id: setId, topic_key: 'second-class-6a', position: 1 }
  ]);
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'first-class').order('sort_order').limit(1);
  single = `first-class-${((reqs ?? []) as { code: string }[])[0].code}`;
  asSeeder();
  const t = await tw();
  await t.twAddFocusSetAction({ entryId: from, setId });
  await t.twSetNightBadgeAction({ entryId: from, mbId: 'first-aid', on: true });
  await t.twAddRequirementAction({ entryId: from, key: single });
  await t.twSetNightBadgeAction({ entryId: to, mbId: 'cooking', on: true });
});

afterAll(async () => {
  if (plans.length) await sb.from('meeting_saved_plans').delete().in('id', plans);
  for (const e of [from, to, ...extraEntries]) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('calendar_entries').delete().eq('id', e);
  }
  if (sets.length) await sb.from('focus_sets').delete().in('id', sets);
});

describe('saving a plan', () => {
  it('Seeder_SavesTheCriteria_AndNoPeople', async () => {
    asSeeder();
    const r = await save(`${TEST_PREFIX} SP first`);
    const { data } = await sb.from('meeting_saved_plans').select('name, plan_date, criteria').eq('id', r.ok ? r.id : 0).single();
    expect(data).toEqual({
      name: `${TEST_PREFIX} SP first`,
      plan_date: '2086-03-04',
      criteria: { focus: [{ setId, title: `${TEST_PREFIX} SP set`, items: ['tenderfoot-4a', 'second-class-6a'] }], singles: [single], badges: ['first-aid'] }
    });
  });

  it('BlankName_IsRefused', async () => {
    asSeeder();
    expect((await save('   ')).ok).toBe(false);
  });

  it('Editor_WithoutTheSeedRight_IsRefusedEverywhere', async () => {
    asEditor();
    const a = await actions();
    const r = await Promise.all([
      a.twSavePlanAction({ entryId: from, name: 'x', planDate: '2086-03-04' }),
      a.twLoadPlanAction({ entryId: to, planId: plans[0] ?? 0 }),
      a.twUpdatePlanAction({ entryId: from, planId: plans[0] ?? 0, name: 'y', planDate: '2086-03-04' }),
      a.twDeletePlanAction({ entryId: from, planId: plans[0] ?? 0 })
    ]);
    expect(r.map((x) => x.ok)).toEqual([false, false, false, false]);
  });
});

describe('loading a plan', () => {
  it('Load_ReplacesTheOtherMeetingsFocusBadgesAndAddedRequirements', async () => {
    asSeeder();
    expect((await (await actions()).twLoadPlanAction({ entryId: to, planId: plans[0] })).ok).toBe(true);
    const v = await view(to, '2086-03-11');
    expect([v.focus.map((f) => f.setId), v.badges.filter((b) => b.direct).map((b) => b.mbId), v.extras.filter((x) => x.origin === 'planner').map((x) => x.key)]).toEqual([[setId], ['first-aid'], [single]]);
  });

  it('AFocusWhoseSetIsGone_ComesBackAsANewSet_AndThePlanPointsAtIt', async () => {
    asSeeder();
    const { data: gone } = await sb.from('focus_sets').insert({ name: `${TEST_PREFIX} SP gone` }).select('id').single();
    const goneId = (gone as { id: number }).id;
    const { data: p } = await sb
      .from('meeting_saved_plans')
      .insert({ name: `${TEST_PREFIX} SP orphan`, plan_date: '2086-03-04', criteria: { focus: [{ setId: goneId, title: `${TEST_PREFIX} SP gone`, items: ['tenderfoot-4b'] }], singles: [], badges: [] } })
      .select('id')
      .single();
    const planId = (p as { id: number }).id;
    plans.push(planId);
    await sb.from('focus_sets').delete().eq('id', goneId);
    expect((await (await actions()).twLoadPlanAction({ entryId: to, planId })).ok).toBe(true);
    const { data: after } = await sb.from('meeting_saved_plans').select('criteria').eq('id', planId).single();
    const newSet = (after as { criteria: { focus: { setId: number }[] } }).criteria.focus[0].setId;
    sets.push(newSet);
    const v = await view(to, '2086-03-11');
    expect([newSet !== goneId, v.focus.map((f) => f.setId)]).toEqual([true, [newSet]]);
  });
});

describe('refusals (qa-lead)', () => {
  it('Viewer_IsRefused', async () => {
    asViewer();
    const a = await actions();
    const r = await Promise.all([a.twSavePlanAction({ entryId: from, name: 'x', planDate: '2086-03-04' }), a.twLoadPlanAction({ entryId: to, planId: 1 })]);
    expect(r.map((x) => x.ok)).toEqual([false, false]);
  });

  it('AMeetingOutsideTheOfferedWindow_IsRefused', async () => {
    // Enough later meetings that the far one falls past the planner's window.
    for (let i = 0; i < PLANNER_WEEKS; i++) extraEntries.push(await entry(`2086-04-${String(1 + i * 2).padStart(2, '0')}`));
    const far = await entry('2086-06-03');
    extraEntries.push(far);
    asSeeder();
    const r = await (await actions()).twSavePlanAction({ entryId: far, name: 'x', planDate: '2086-06-03' });
    expect(r.ok ? 'saved' : r.error).toMatch(/next \d+ meetings only/);
  });

  it('APastMeeting_IsRefused', async () => {
    const past = await entry('2086-01-07');
    extraEntries.push(past);
    asSeeder();
    const r = await (await actions()).twLoadPlanAction({ entryId: past, planId: plans[0] });
    expect(r.ok ? 'loaded' : r.error).toBe('That meeting has passed.');
  });

  it('AClosedMeeting_IsRefused', async () => {
    const closed = await entry('2086-03-12', `No Troop Meeting ${TEST_PREFIX} SP`);
    extraEntries.push(closed);
    asSeeder();
    const r = await (await actions()).twLoadPlanAction({ entryId: closed, planId: plans[0] });
    expect(r.ok ? 'loaded' : r.error).toBe('That meeting isn’t taking sign-ups.');
  });

  it('LoadingAMissingPlan_SaysItIsGone', async () => {
    asSeeder();
    const r = await (await actions()).twLoadPlanAction({ entryId: to, planId: 2_000_000_000 });
    expect(r.ok ? 'loaded' : r.error).toBe('That plan is gone.');
  });

  it('RenamingOrDeletingAMissingPlan_SaysItIsGone', async () => {
    asSeeder();
    const a = await actions();
    const r = await Promise.all([a.twUpdatePlanAction({ entryId: from, planId: 2_000_000_000, name: 'y', planDate: '2086-03-04' }), a.twDeletePlanAction({ entryId: from, planId: 2_000_000_000 })]);
    expect(r.map((x) => (x.ok ? 'ok' : x.error))).toEqual(['That plan is gone.', 'That plan is gone.']);
  });
});

describe('a stale or big plan still loads (qa-lead)', () => {
  it('BadKeyMissingBadgeAndMoreThan20Singles_LoadTheRest_AndNameWhatWasSkipped', async () => {
    asSeeder();
    const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).in('rank_id', ['tenderfoot', 'second-class', 'first-class']).neq('code', 'BoR').order('rank_id').order('sort_order').limit(24);
    const keys = ((reqs ?? []) as { rank_id: string; code: string }[]).filter((r) => r.code.toLowerCase() !== 'bor').map((r) => `${r.rank_id}-${r.code}`);
    const { data: p } = await sb
      .from('meeting_saved_plans')
      .insert({ name: `${TEST_PREFIX} SP stale`, plan_date: '2086-03-04', criteria: { focus: [{ setId: 'not-a-number', title: `${TEST_PREFIX} SP odd`, items: ['tenderfoot-4a', 'tenderfoot-99z'] }], singles: [...keys, 'tenderfoot-99z'], badges: ['no-such-badge-zz'] } })
      .select('id')
      .single();
    const planId = (p as { id: number }).id;
    plans.push(planId);
    const r = await (await actions()).twLoadPlanAction({ entryId: to, planId });
    const { data: after } = await sb.from('meeting_saved_plans').select('criteria').eq('id', planId).single();
    const made = (after as { criteria: { focus: { setId: unknown }[] } }).criteria.focus[0].setId;
    if (typeof made === 'number') sets.push(made);
    const v = await view(to, '2086-03-11');
    const loaded = v.extras.filter((x) => x.origin === 'planner').length;
    expect([r.ok, r.ok && r.skipped.includes('tenderfoot-99z'), r.ok && r.skipped.includes('merit badge no-such-badge-zz'), keys.length > 20, loaded >= 21, typeof made]).toEqual([true, true, true, true, true, 'number']);
  });
});

describe('what a load leaves alone (qa-lead)', () => {
  it('LoadingOntoOneMeeting_LeavesAnotherUntouched', async () => {
    asSeeder();
    const before = await view(from, '2086-03-04');
    await (await actions()).twLoadPlanAction({ entryId: to, planId: plans[0] });
    const after = await view(from, '2086-03-04');
    expect([after.focus, after.badges, after.extras.map((x) => x.key)]).toEqual([before.focus, before.badges, before.extras.map((x) => x.key)]);
  });

  it('PicksAndTeachers_SurviveALoadThatRemovesTheirClass', async () => {
    asSeeder();
    // A plan with only a badge: loading it takes `from`'s focus set and added requirement off.
    const { data: p } = await sb.from('meeting_saved_plans').insert({ name: `${TEST_PREFIX} SP badge only`, plan_date: '2086-03-04', criteria: { focus: [], singles: [], badges: ['first-aid'] } }).select('id').single();
    const planId = (p as { id: number }).id;
    plans.push(planId);
    const { data: topics } = await sb.from('meeting_topics').select('id, topic_key').eq('calendar_entry_id', from).in('topic_key', [`fg:${setId}`, single]);
    const byKey = new Map(((topics ?? []) as { id: number; topic_key: string }[]).map((t) => [t.topic_key, t.id]));
    const { data: sc } = await sb.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null).order('person_id').limit(1).single();
    const scoutPerson = (sc as { person_id: number }).person_id;
    await sb.from('meeting_topic_picks').insert({ topic_id: byKey.get(`fg:${setId}`), calendar_entry_id: from, person_id: scoutPerson, priority: 1, first_asked_on: '2086-03-04' });
    await sb.from('meeting_topic_teachers').insert({ topic_id: byKey.get(single), calendar_entry_id: from, person_id: planner, entered_by_person_id: planner });
    expect((await (await actions()).twLoadPlanAction({ entryId: from, planId })).ok).toBe(true);
    const [{ count: picks }, { count: teachers }] = await Promise.all([
      sb.from('meeting_topic_picks').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', from).eq('person_id', scoutPerson),
      sb.from('meeting_topic_teachers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', from).eq('person_id', planner)
    ]);
    await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', from);
    await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', from);
    expect([picks, teachers]).toEqual([1, 1]);
  });
});

describe('editing and deleting a plan', () => {
  it('Seeder_RenamesAndRedates', async () => {
    asSeeder();
    await (await actions()).twUpdatePlanAction({ entryId: from, planId: plans[0], name: `${TEST_PREFIX} SP renamed`, planDate: '2086-04-01' });
    const { data } = await sb.from('meeting_saved_plans').select('name, plan_date').eq('id', plans[0]).single();
    expect(data).toEqual({ name: `${TEST_PREFIX} SP renamed`, plan_date: '2086-04-01' });
  });

  it('Seeder_Deletes', async () => {
    asSeeder();
    const id = plans[0];
    expect((await (await actions()).twDeletePlanAction({ entryId: from, planId: id })).ok).toBe(true);
    const { count } = await sb.from('meeting_saved_plans').select('id', { count: 'exact', head: true }).eq('id', id);
    expect(count).toBe(0);
  });
});
