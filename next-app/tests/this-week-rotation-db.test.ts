import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { fetchPeopleLists, fetchMeetingLabels } from '../src/lib/people-lists';
import { loadUpcomingMeetings } from '../src/lib/meeting-board';
import { loadThisWeekData } from '../src/lib/this-week-db';
import { buildThisWeek, type ThisWeekInput } from '../src/lib/this-week';

/**
 * Station rotations step 3 (Plans/Planner-Station-Rotations.md): This week's model with Stations on. The station focus
 * sets leave the ordinary groups, every scout without the badge is in exactly one rotation group, holders keep
 * today's placement, and nobody is lost or doubled. Real local mirror for the roster and progress; the stations are
 * injected (topic keys no meeting uses).
 */
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const SAFETY = { key: 'fg:990001', title: 'Climbing MB - Safety', setId: null, members: ['climbing-1', 'climbing-1a', 'climbing-1b', 'climbing-1c', 'climbing-2', 'climbing-3'] };
const TERMS = { key: 'fg:990002', title: 'Climbing MB - Terms', setId: null, members: ['climbing-4', 'climbing-4a', 'climbing-4b', 'climbing-4c', 'climbing-4d'] };
const FIRST_AID = { key: 'fg:990003', title: 'First aid', setId: null, members: ['first-aid-1'] };

let base: ThisWeekInput;
let scoutIds: number[];
let holders: Set<number>;

beforeAll(async () => {
  const [catalog, lists, labels] = await Promise.all([fetchAdvancementCatalog(sb as never), fetchPeopleLists(sb), fetchMeetingLabels(sb)]);
  const [meeting] = await loadUpcomingMeetings(sb, 1, '2026-01-01', labels);
  base = (await loadThisWeekData(sb, meeting, lists, catalog)).input;
  scoutIds = lists.pool.scouts.map((s) => s.person_id);
  holders = new Set(base.scouts.filter((s) => base.progress.get(s.scoutId)?.awardedMbs?.has('climbing')).map((s) => s.personId));
});

/** The base input with the two Climbing stations on (and no hand roles, so placement alone decides). */
function withStations(extra: Partial<ThisWeekInput> = {}, stations = [SAFETY, TERMS], on = true): ThisWeekInput {
  return {
    ...base,
    roles: new Map(),
    focus: [...base.focus, ...stations],
    rotation: { on, stations: stations.map((s, i) => ({ key: s.key, title: s.title, setId: null, goalMinutes: [25, 20][i] ?? null })) },
    ...extra
  };
}
const sectionIds = (tw: ReturnType<typeof buildThisWeek>) => tw.sections.flatMap((s) => s.rows.map((r) => r.personId));
const rotationIds = (tw: ReturnType<typeof buildThisWeek>) => (tw.rotation?.groups ?? []).flatMap((g) => g.members.map((m) => m.personId));

describe('Stations off', () => {
  it('Rotation_Off_PlacesEveryScoutInSections', () => {
    const tw = buildThisWeek(withStations({}, [SAFETY, TERMS], false));
    expect([sectionIds(tw).length, rotationIds(tw).length]).toEqual([scoutIds.length, 0]);
  });

  it('Rotation_Off_StillListsTheStationsForTheSwitch', () => {
    const tw = buildThisWeek(withStations({}, [SAFETY, TERMS], false));
    expect([tw.rotation?.on, tw.rotation?.stations.map((s) => s.key)]).toEqual([false, [SAFETY.key, TERMS.key]]);
  });
});

describe('Stations on', () => {
  it('Rotation_On_EveryActiveScoutLandsExactlyOnce', () => {
    const ids = [...sectionIds(buildThisWeek(withStations())), ...rotationIds(buildThisWeek(withStations()))];
    expect([ids.length, new Set(ids).size]).toEqual([scoutIds.length, scoutIds.length]);
  });

  it('Rotation_On_EveryNonHolderRotates', () => {
    const rotating = new Set(rotationIds(buildThisWeek(withStations())));
    expect(scoutIds.filter((id) => !holders.has(id)).every((id) => rotating.has(id))).toBe(true);
  });

  it('Rotation_On_HoldersStayOnTodaysPlacement', () => {
    const rotating = new Set(rotationIds(buildThisWeek(withStations())));
    expect([...holders].some((id) => rotating.has(id))).toBe(false);
  });

  it('Rotation_On_StationItemsLeaveTheOrdinaryGroups', () => {
    const tw = buildThisWeek(withStations());
    expect(tw.groups.flatMap((g) => g.columns.map((c) => c.key)).filter((k) => k.startsWith('climbing-'))).toEqual([]);
  });

  it('Rotation_On_NeverMoreGroupsThanStations', () => {
    expect(buildThisWeek(withStations()).rotation!.groups.length).toBeLessThanOrEqual(2);
  });

  it('Rotation_On_GroupsAreNumbered', () => {
    expect(buildThisWeek(withStations()).rotation!.groups.map((g) => g.name)).toEqual(['Group 1', 'Group 2']);
  });

  it('Rotation_On_StationsCarryTheirCells', () => {
    expect(buildThisWeek(withStations()).rotation!.stations[1].cells.map((c) => c.key)).toEqual(['climbing-4a', 'climbing-4b', 'climbing-4c', 'climbing-4d']);
  });

  it('Rotation_On_RoundIsTheLongestGoal_TotalTimesStations', () => {
    const r = buildThisWeek(withStations()).rotation!;
    expect([r.roundMinutes, r.totalMinutes]).toEqual([25, 50]);
  });

  it('Rotation_On_NamesTheBadge', () => {
    expect(buildThisWeek(withStations()).rotation!.badgeName).toBe('Climbing');
  });

  it('Rotation_On_NamesAStationsTeacher', () => {
    const t = base.teachers[0];
    const tw = buildThisWeek(withStations({ topicTeachers: [...base.topicTeachers, { key: SAFETY.key, personId: t.personId }] }));
    expect(tw.rotation!.stations[0].teachers.map((x) => x.personId)).toEqual([t.personId]);
  });

  it('Rotation_On_MemberRowsCarryTheirRank', () => {
    const m = buildThisWeek(withStations()).rotation!.groups[0].members[0];
    expect(typeof m.rankName).toBe('string');
  });
});

describe('a station list that can’t rotate', () => {
  it('Rotation_StationsFromTwoBadges_ReportAProblem', () => {
    expect(buildThisWeek(withStations({}, [SAFETY, FIRST_AID])).rotation!.problem).toBe('mixed');
  });

  it('Rotation_StationsFromTwoBadges_LeaveEveryoneInSections', () => {
    expect(sectionIds(buildThisWeek(withStations({}, [SAFETY, FIRST_AID]))).length).toBe(scoutIds.length);
  });

  it('Rotation_OnWithNoStations_ReportsIt', () => {
    expect(buildThisWeek({ ...base, rotation: { on: true, stations: [] } }).rotation!.problem).toBe('empty');
  });

  it('Rotation_NoRow_IsNull', () => {
    expect(buildThisWeek({ ...base, rotation: undefined }).rotation).toBeNull();
  });
});

describe('moves and also (step 4)', () => {
  const firstRotating = () => buildThisWeek(withStations()).rotation!.groups[0].members[0].personId;

  it('Move_PutsAScoutInTheGroupItNames', () => {
    const pid = firstRotating();
    const tw = buildThisWeek(withStations({ rotationMoves: new Map([[pid, 2]]) }));
    expect(tw.rotation!.groups[1].members.find((m) => m.personId === pid)?.hand).toBe(true);
  });

  it('PlacedInAnOrdinaryGroup_LeavesTheRotation_AndShowsInSections', () => {
    const pid = firstRotating();
    const tw = buildThisWeek(withStations({ roles: new Map([[pid, { role: 'none' as const }]]) }));
    expect([rotationIds(tw).includes(pid), sectionIds(tw).includes(pid)]).toEqual([false, true]);
  });

  it('Also_ShowsOnTheRotationMember', () => {
    const pid = firstRotating();
    const tw = buildThisWeek(withStations({ also: new Map([[pid, ['fr:mb:citizenship-community']]]) }));
    expect(tw.rotation!.groups[0].members.find((m) => m.personId === pid)?.also?.join()).toMatch(/^Citizenship in The Community/);
  });

  it('Also_IsListedAsDoubleAssigned', () => {
    const pid = firstRotating();
    const tw = buildThisWeek(withStations({ also: new Map([[pid, ['fr:mb:citizenship-community']]]) }));
    expect(tw.doubles.map((d) => [d.personId, d.primary, d.also.length])).toEqual([[pid, 'Group 1', 1]]);
  });

  it('Also_OnASectionScout_ShowsOnTheirRow', () => {
    const holder = buildThisWeek(withStations()).sections.flatMap((x) => x.rows)[0];
    const tw = buildThisWeek(withStations({ also: new Map([[holder.personId, ['star-5']]]) }));
    expect(tw.sections.flatMap((x) => x.rows).find((r) => r.personId === holder.personId)?.also?.length).toBe(1);
  });

  it('Also_ListsTheScoutOnThatCard', () => {
    const pid = firstRotating();
    const tw = buildThisWeek(withStations({ nightBadges: [...base.nightBadges, 'citizenship-community'], also: new Map([[pid, ['fr:mb:citizenship-community']]]) }));
    expect(tw.groups.find((g) => g.key === 'fr:mb:citizenship-community')?.alsoMembers?.map((m) => m.personId)).toEqual([pid]);
  });

  it('NoAlso_NoDoubles', () => {
    expect(buildThisWeek(withStations()).doubles).toEqual([]);
  });
});
