import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Planner III Suggestions, the database half: the page is ONE engine read (every view and footer from it) plus one
 * plan read for the toolbar's meetings; Add goes through This week's own add (meeting_seed_many) and only for a seed
 * holder, on one of the planner's meetings. Real local database; the admin actor is mocked; the fixture meeting is
 * dated 2096 and every row is deleted by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  counter: null as null | { n: number },
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }
}));

function counting(target: SupabaseClient, counter: { n: number }): SupabaseClient {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if ((prop === 'from' || prop === 'rpc') && typeof v === 'function') {
        return (...args: unknown[]) => {
          counter.n++;
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return v;
    }
  });
}

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => (state.counter ? counting(make(), state.counter) : make()) };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
// The catalog read fresh on every call, so both measurements pay for it alike.
vi.mock('@/lib/advancement-catalog', async (orig) => {
  const real = await orig<typeof import('../src/lib/advancement-catalog')>();
  const { createAdminClient } = await import('@/lib/supabase/server');
  return { ...real, loadAdvancementCatalog: () => real.fetchAdvancementCatalog(createAdminClient()) };
});
// The planner's gate takes its meetings from "today": put today just before this file's 2096 meeting.
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2096-01-20' }));

const trips = async (fn: () => Promise<unknown>) => {
  state.counter = { n: 0 };
  try {
    await fn();
    return state.counter.n;
  } finally {
    state.counter = null;
  }
};
const actions = () => import('../src/app/(public)/planner/suggestions/actions');

const entries: number[] = [];
const people: number[] = [];
const sets: number[] = [];
let meeting = 0;
let seeder = 0;

beforeAll(async () => {
  const { data: e, error: ee } = await sb.from('calendar_entries').insert({ entry_date: '2096-02-02', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (ee) throw new Error(ee.message);
  meeting = e!.id as number;
  entries.push(meeting);
  const { data: p, error: pe } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} PSD Seeder`, first_name: `${TEST_PREFIX} PSD`, last_name: 'Seeder' }).select('id').single();
  if (pe) throw new Error(pe.message);
  seeder = p!.id as number;
  people.push(seeder);
});

afterEach(() => {
  state.actor = null;
});

afterAll(async () => {
  if (entries.length) await sb.from('meeting_topics').delete().in('calendar_entry_id', entries);
  if (sets.length) await sb.from('focus_sets').delete().in('id', sets);
  if (entries.length) await sb.from('calendar_entries').delete().in('id', entries);
  if (people.length) await sb.from('people').delete().in('id', people);
});

const seederActor = () => ({ personId: seeder, subjectKind: 'adult' as const, capabilities: new Set(['meeting_planner.seed', 'meeting_planner.edit']) });

describe('Suggestions reads', () => {
  it('Suggestions_LoadInOneEngineRead', async () => {
    const { loadSuggestionsData } = await import('../src/lib/planner-suggest-db');
    const { loadEngineInput } = await import('../src/lib/meeting-suggest/load-input');
    const engine = await trips(() => loadEngineInput('2096-02-02', 'Vitest'));
    const page = await trips(() => loadSuggestionsData('2096-02-02', 'Vitest'));
    // Every view and footer costs exactly one engine read: not one round trip more.
    expect(page - engine).toBe(0);
  });

  it('PlanStates_ReadTopicsAndFocus_InOneQuery_WithFocusItemsByTopRequirement', async () => {
    const { data: set, error } = await sb.rpc('focus_set_save', { p_actor: seeder, p_set: null, p_name: `${TEST_PREFIX} PSD set`, p_labels: ['vitest'], p_items: ['tenderfoot-4a.1', 'tenderfoot-4b'] });
    if (error) throw new Error(error.message);
    sets.push(Number(set));
    await sb.rpc('meeting_seed_focus_set', { p_entry: meeting, p_set: Number(set), p_actor: seeder });
    await sb.rpc('meeting_seed_many', { p_entry: meeting, p_keys: ['second-class-7a'], p_actor: seeder });
    const { loadPlanStates } = await import('../src/lib/planner-suggest-db');
    let plans: Awaited<ReturnType<typeof loadPlanStates>> = {};
    const n = await trips(async () => {
      plans = await loadPlanStates((await import('@/lib/supabase/server')).createAdminClient(), [meeting]);
    });
    const p = plans[meeting];
    expect([n, p.focus.sort(), p.onPlan.includes('second-class-7a'), p.focusNames]).toEqual([1, ['tenderfoot-4a', 'tenderfoot-4b'], true, [`${TEST_PREFIX} PSD set`]]);
  });
});

describe('Suggestions Add', () => {
  it('SeedHolder_AddsSeveral_ThroughThisWeeksAdd', async () => {
    state.actor = seederActor();
    const res = await (await actions()).suggestAddAction({ entryId: meeting, keys: ['scout-1a', 'scout-1b'] });
    const { data } = await sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', meeting).in('topic_key', ['scout-1a', 'scout-1b']);
    expect([res.ok, ((data ?? []) as { topic_key: string }[]).map((r) => r.topic_key).sort()]).toEqual([true, ['scout-1a', 'scout-1b']]);
  });

  it('EditWithoutSeed_CannotAdd', async () => {
    state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view', 'meeting_planner.edit']) };
    const res = await (await actions()).suggestAddAction({ entryId: meeting, keys: ['scout-1c'] });
    const { data } = await sb.from('meeting_topics').select('topic_key').eq('calendar_entry_id', meeting).eq('topic_key', 'scout-1c');
    expect([res.ok, (data ?? []).length]).toEqual([false, 0]);
  });

  it('ViewOnly_CannotAdd', async () => {
    state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.view']) };
    expect((await (await actions()).suggestAddAction({ entryId: meeting, keys: ['scout-1d'] })).ok).toBe(false);
  });

  it('Add_TakesExactlyTwenty', async () => {
    state.actor = seederActor();
    const { data } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).in('rank_id', ['tenderfoot', 'second-class']).order('sort_order').limit(20);
    const keys = ((data ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
    expect([keys.length, (await (await actions()).suggestAddAction({ entryId: meeting, keys })).ok]).toEqual([20, true]);
  });

  it('Add_RefusesMbAndFreeformTopicKeys', async () => {
    state.actor = seederActor();
    const a = await actions();
    expect([(await a.suggestAddAction({ entryId: meeting, keys: ['mb:first-aid'] })).ok, (await a.suggestAddAction({ entryId: meeting, keys: ['ff:anything'] })).ok]).toEqual([false, false]);
  });

  it('Add_RefusesAGroupKey_OrTooMany_BeforeTheDatabase', async () => {
    state.actor = seederActor();
    const a = await actions();
    const many = Array.from({ length: 21 }, (_, i) => `scout-${i}`);
    expect([(await a.suggestAddAction({ entryId: meeting, keys: ['fr:scout'] })).ok, (await a.suggestAddAction({ entryId: meeting, keys: many })).ok, (await a.suggestAddAction({ entryId: meeting, keys: [] })).ok]).toEqual([false, false, false]);
  });

  it('Add_OnAMeetingOutsideThePlanner_IsRefused', async () => {
    state.actor = seederActor();
    const res = await (await actions()).suggestAddAction({ entryId: 1, keys: ['scout-1a'] });
    expect(res.ok).toBe(false);
  });
});

/** The Teaching view and Save as a focus set reuse This week's and Focus sets' actions: their gates, as Suggestions
 *  relies on them (qa-lead 2026-10-29). */
describe('the writes Suggestions borrows', () => {
  const tw = () => import('../src/app/(public)/planner/this-week-actions');
  const focus = () => import('../src/app/(public)/planner/focus-actions');

  it('SeedWithoutEdit_CannotSetATeacher', async () => {
    state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.seed']) };
    expect((await (await tw()).twSetTeacherAction({ entryId: meeting, key: 'scout-1a', personId: seeder, on: true })).ok).toBe(false);
  });

  it('EditOnly_CannotTeachSomethingNotOnThePlan', async () => {
    state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) };
    const res = await (await tw()).twSetTeacherAction({ entryId: meeting, key: 'scout-5', personId: seeder, on: true });
    const { data } = await sb.from('meeting_topics').select('id').eq('calendar_entry_id', meeting).eq('topic_key', 'scout-5');
    expect([res.ok, (data ?? []).length]).toEqual([false, 0]);
  });

  it('EditOnly_CannotSaveAFocusSet', async () => {
    state.actor = { personId: seeder, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) };
    expect((await (await focus()).focusSaveSetAction({ id: null, name: `${TEST_PREFIX} PSD nope`, labels: [], items: ['scout-1a'] })).ok).toBe(false);
  });
});
