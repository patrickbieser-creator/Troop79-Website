import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * /member/meeting (Phase 1): the server actions act only for the verified session (self, household scouts, or a leader
 * on behalf), only on a pickable row, and only on a meeting that hasn't passed; carry-forward and the demand counts
 * read the same loader. Real local database; the session and the admin actor are mocked. Fixture meetings are dated
 * 2091 so they never collide with the real calendar; every row is deleted by its own id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  session: null as null | { personId: number; subjectKind: 'adult' | 'scout'; displayName: string },
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> }
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => state.session }));
vi.mock('@/lib/identity-session', () => ({ isEpochCurrent: async () => true }));
vi.mock('@/lib/admin-actor', () => ({
  resolveAdminActor: async () => state.actor,
  actorHas: (a: { capabilities: Set<string> } | null, c: string) => a?.capabilities.has(c) ?? false
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const actions = () => import('../src/app/(public)/member/meeting/actions');
const board = () => import('../src/lib/meeting-board');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
const households: number[] = [];
let meetingA = 0; // 2091-01-07
let meetingB = 0; // 2091-01-14, the week after
let past = 0;
let scoutA = 0;
let scoutB = 0;
let parent = 0;
let key = '';
let key2 = '';

async function entry(date: string, title = 'Troop Meeting'): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `${title} ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MMA ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function scout(label: string): Promise<number> {
  const pid = await person(label);
  const id = `vitest-mma-${pid}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: TEST_PREFIX, last_name: label, display_name: `${TEST_PREFIX} MMA ${label}`, person_id: pid, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
  return pid;
}

beforeAll(async () => {
  meetingA = await entry('2091-01-07');
  meetingB = await entry('2091-01-14');
  past = await entry('2020-01-05');
  scoutA = await scout('A');
  scoutB = await scout('B');
  parent = await person('Parent');
  const { data: hh } = await sb.from('households').insert({ label: `${TEST_PREFIX} MMA family` }).select('id').single();
  households.push(hh!.id);
  await sb.from('household_members').insert([
    { household_id: hh!.id, person_id: parent },
    { household_id: hh!.id, person_id: scoutA }
  ]);
  const { data: reqs } = await sb.from('rank_requirements').select('code').is('parent_id', null).eq('rank_id', 'tenderfoot').neq('venue', 'outing').order('sort_order');
  const codes = ((reqs ?? []) as { code: string }[]).map((r) => r.code).filter((c) => c !== '9' && c !== '10');
  [key, key2] = codes.slice(0, 2).map((c) => `tenderfoot-${c}`);
});

afterEach(async () => {
  for (const e of entries) {
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
  }
  await sb.from('scouts').update({ current_rank: 'scout' }).in('id', scoutIds);
  state.session = null;
  state.actor = null;
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('households').delete().in('id', households);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

const asScout = (pid: number) => (state.session = { personId: pid, subjectKind: 'scout', displayName: 'Scout' });
const asAdult = (pid: number) => (state.session = { personId: pid, subjectKind: 'adult', displayName: 'Adult' });
const keysOf = (r: { ok: boolean; view?: { picks: { key: string }[] } }) => (r.ok ? r.view!.picks.map((p) => p.key) : []);

describe('who may pick', () => {
  it('Scout_CanPickForSelf', async () => {
    asScout(scoutA);
    const r = await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutA, key });
    expect([r.ok, keysOf(r as never)]).toEqual([true, [key]]);
  });

  it('Parent_CanPickForHouseholdScout', async () => {
    asAdult(parent);
    const r = await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutA, key });
    const { data } = await sb.from('meeting_topic_picks').select('entered_by_person_id').eq('calendar_entry_id', meetingA).eq('person_id', scoutA);
    expect([r.ok, (data ?? []).map((d) => d.entered_by_person_id)]).toEqual([true, [parent]]);
  });

  it('Parent_CannotPickForOtherFamilysScout', async () => {
    asAdult(parent);
    const r = await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutB, key });
    expect(r).toEqual({ ok: false, error: 'You can only pick for yourself or the scouts in your household.' });
  });

  it('Scout_CannotPickForAnotherScout', async () => {
    asScout(scoutB);
    expect((await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutA, key })).ok).toBe(false);
  });

  it('Leader_OnBehalf_NeedsTheMeetingPlanCapability', async () => {
    asAdult(parent);
    state.actor = { personId: parent, subjectKind: 'adult', capabilities: new Set() };
    const refused = await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutB, key, onBehalf: true });
    state.actor = { personId: parent, subjectKind: 'adult', capabilities: new Set(['meeting_plan.use']) };
    const allowed = await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutB, key, onBehalf: true });
    expect([refused.ok, allowed.ok]).toEqual([false, true]);
  });

  it('Leader_OnBehalf_IsRefused_ForAScoutSession', async () => {
    asScout(scoutA);
    state.actor = { personId: scoutA, subjectKind: 'scout', capabilities: new Set(['meeting_plan.use']) };
    expect((await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutB, key, onBehalf: true })).ok).toBe(false);
  });

  it('NoSession_IsRefused', async () => {
    expect((await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutA, key })).ok).toBe(false);
  });
});

describe('what may be picked', () => {
  it('Scout_IsRefusedOutingOnlyRequirement', async () => {
    asScout(scoutA);
    const { data } = await sb.from('rank_requirements').select('code').is('parent_id', null).eq('rank_id', 'tenderfoot').eq('venue', 'outing').limit(1);
    const outing = `tenderfoot-${(data ?? [])[0].code}`;
    expect((await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutA, key: outing })).ok).toBe(false);
  });

  it('PastMeeting_TakesNoPicks', async () => {
    asScout(scoutA);
    expect(await (await actions()).meetingAddPickAction({ entryId: past, personId: scoutA, key })).toEqual({
      ok: false,
      error: 'That meeting has passed. Reload the page for the next one.'
    });
  });

  it('Scout_CanSavePicks_WithoutRanking', async () => {
    asScout(scoutA);
    const a = await actions();
    await a.meetingAddPickAction({ entryId: meetingA, personId: scoutA, key });
    const r = await a.meetingAddPickAction({ entryId: meetingA, personId: scoutA, key: key2 });
    expect(r.ok ? r.view.picks.map((p) => p.priority) : 'refused').toEqual([null, null]);
  });

  it('Scout_CanRankPicks_AndClearTheOrder', async () => {
    asScout(scoutA);
    const a = await actions();
    await a.meetingAddPickAction({ entryId: meetingA, personId: scoutA, key });
    await a.meetingAddPickAction({ entryId: meetingA, personId: scoutA, key: key2 });
    const ranked = await a.meetingSetOrderAction({ entryId: meetingA, personId: scoutA, keys: [key2, key] });
    const cleared = await a.meetingSetOrderAction({ entryId: meetingA, personId: scoutA, keys: null });
    expect([keysOf(ranked as never), cleared.ok ? cleared.view.picks.every((p) => p.priority == null) : false]).toEqual([[key2, key], true]);
  });
});

describe('carry-forward and counts', () => {
  it('Scout_PicksCarryForward_WhenPriorMeetingDidNotTeachThem', async () => {
    asScout(scoutA);
    const a = await actions();
    await a.meetingAddPickAction({ entryId: meetingA, personId: scoutA, key, later: true });
    const { data: first } = await sb.from('meeting_topic_picks').select('first_asked_on').eq('calendar_entry_id', meetingA).eq('person_id', scoutA).single();
    const b = await board();
    const catalog = await (await import('../src/lib/advancement-catalog')).loadAdvancementCatalog();
    const scoutRow = (await b.loadBoardScouts(sb, [scoutA]))[0];
    const shown = await b.loadScoutBoard(sb, { entryId: meetingB, date: '2091-01-14' }, scoutRow, catalog, { viewerPersonId: scoutA });
    // The first write on the new board copies the carried pick in, first-asked date kept.
    await a.meetingAddPickAction({ entryId: meetingB, personId: scoutA, key: key2 });
    const { data: saved } = await sb.from('meeting_topic_picks').select('first_asked_on, later, meeting_topics(topic_key)').eq('calendar_entry_id', meetingB).eq('person_id', scoutA);
    const carried = ((saved ?? []) as unknown as { first_asked_on: string; later: boolean; meeting_topics: { topic_key: string } }[]).find((s) => s.meeting_topics.topic_key === key);
    expect([shown.hasOwnList, shown.view.picks.map((p) => [p.key, p.later, p.carriedFrom]), carried?.first_asked_on, carried?.later]).toEqual([
      false,
      [[key, false, '2091-01-07']],
      first!.first_asked_on,
      false
    ]);
  });

  it('Scout_FinishedPickDropsOff_WhenLedgerSatisfiesIt', async () => {
    asScout(scoutA);
    await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutA, key });
    // Earning Tenderfoot finishes every Tenderfoot requirement (rank first, as the specialist review set it).
    await sb.from('scouts').update({ current_rank: 'tenderfoot' }).eq('person_id', scoutA);
    const b = await board();
    const catalog = await (await import('../src/lib/advancement-catalog')).loadAdvancementCatalog();
    const scoutRow = (await b.loadBoardScouts(sb, [scoutA]))[0];
    const shown = await b.loadScoutBoard(sb, { entryId: meetingB, date: '2091-01-14' }, scoutRow, catalog, { viewerPersonId: scoutA });
    expect(shown.view.picks).toEqual([]);
  });

  it('Scout_NotComing_HidesPicksFromThisMeetingCounts_ButKeepsThemForNext', async () => {
    asScout(scoutA);
    const a = await actions();
    await a.meetingAddPickAction({ entryId: meetingA, personId: scoutA, key });
    await a.meetingSetIntentAction({ entryId: meetingA, personId: scoutA, intent: 'not_coming' });
    const b = await board();
    const { summarizeBoard } = await import('../src/lib/meeting-board-shared');
    const catalog = await (await import('../src/lib/advancement-catalog')).loadAdvancementCatalog();
    const thisWeek = await b.loadBoardState(sb, { entryId: meetingA, date: '2091-01-07' }, catalog);
    const nextWeek = await b.loadBoardState(sb, { entryId: meetingB, date: '2091-01-14' }, catalog);
    expect([
      summarizeBoard(thisWeek).demand.get(key)?.includes(scoutA) ?? false,
      nextWeek.find((s) => s.personId === scoutA)!.picks.map((p) => p.key)
    ]).toEqual([false, [key]]);
  });

  it('Scout_PickImpliesComing_WhenNoIntentSet', async () => {
    asScout(scoutA);
    await (await actions()).meetingAddPickAction({ entryId: meetingA, personId: scoutA, key });
    const b = await board();
    const { effectiveIntent } = await import('../src/lib/meeting-board-shared');
    const catalog = await (await import('../src/lib/advancement-catalog')).loadAdvancementCatalog();
    const me = (await b.loadBoardState(sb, { entryId: meetingA, date: '2091-01-07' }, catalog)).find((s) => s.personId === scoutA)!;
    const { count } = await sb.from('meeting_intents').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meetingA).eq('person_id', scoutA);
    expect([effectiveIntent(me.intent, me.picks), count]).toEqual(['coming', 0]);
  });

  it('Board_NextMeeting_IsTheNextMeetingEntryOnOrAfterToday', async () => {
    const next = await (await board()).loadNextMeeting(sb, '2091-01-08');
    expect([next?.entryId, next?.closed]).toEqual([meetingB, false]);
  });
});

describe('the engine', () => {
  it('Engine_Unchanged_WhenBoardEdited', async () => {
    const { loadEngineInput } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/load-input');
    const { buildMeetingPlan } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/engine');
    const plan = async () => {
      const res = await loadEngineInput('2091-01-07', 'Vitest');
      if (!res.ok) throw new Error(res.error);
      const p = buildMeetingPlan(res.input);
      return JSON.stringify({ ...p, generatedAt: '' });
    };
    const before = await plan();
    asScout(scoutA);
    const a = await actions();
    await a.meetingAddPickAction({ entryId: meetingA, personId: scoutA, key });
    await a.meetingSetIntentAction({ entryId: meetingA, personId: scoutA, intent: 'undecided' });
    expect(await plan()).toBe(before);
  });
});
