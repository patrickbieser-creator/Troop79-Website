import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { fetchPeopleLists } from '../src/lib/people-lists';
import { loadThisWeekData } from '../src/lib/this-week-db';
import { buildThisWeek } from '../src/lib/this-week';

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

async function view(entryId: number, date: string) {
  const [catalog, lists] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb)]);
  return buildThisWeek((await loadThisWeekData(sb, { entryId, date }, lists, catalog)).input);
}
async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} SP` }).select('id').single();
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
  for (const e of [from, to]) {
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
