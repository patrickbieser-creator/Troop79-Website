import { describe, it, expect } from 'vitest';
import {
  arrangementPlacements,
  badgeTops,
  boardIntent,
  defaultStations,
  draftRotations,
  mbScoutLines,
  stationTeachLines,
  groupCount,
  groupLabel,
  scoutRotation,
  stationFinished,
  stationProblems,
  stationVisitors,
  ROTATION_GROUP_CAP,
  type Placement,
  type RotationInput,
  type RotationScout,
  type Station
} from '../src/lib/meeting-board-rotations';
import type { CatalogMeritBadgeRequirement } from '../src/lib/advancement-catalog';

/**
 * Meeting board, Phase 3b (Plans/Meeting-Requests-And-Teaching-Offers.md, Decision 10, "Merit badge meeting mode"): the
 * rotation draft, pure. Fixture catalog and people only; nothing here touches the database.
 */

const MB = 'tst-cooking';
let rid = 0;
const mbReq = (code: string, label: string, o: Partial<CatalogMeritBadgeRequirement> = {}): CatalogMeritBadgeRequirement => ({
  id: ++rid,
  mb_id: MB,
  parent_id: null,
  code,
  label,
  complete_rule: 'all',
  complete_n: null,
  sort_order: rid,
  venue: 'either',
  ...o
});
const R1 = mbReq('1', 'Health and safety');
const R2 = mbReq('2', 'Nutrition');
const R3 = mbReq('3', 'Plan a menu');
const R4 = mbReq('4', 'Cook a meal', { complete_rule: 'any' });
const R4A = mbReq('4a', 'On a stove', { parent_id: R4.id });
const R4B = mbReq('4b', 'Over a fire', { parent_id: R4.id });
const R5 = mbReq('5', 'Cook on a campout', { venue: 'outing' });
const REQS = [R1, R2, R3, R4, R4A, R4B, R5];
const TOPS = badgeTops(MB, REQS);

const station = (index: number, codes: string[], topicId: number | null = 100 + index): Station => ({
  index,
  topicId,
  key: `${MB}-${codes[0]}`,
  title: `Station ${index + 1}`,
  location: null,
  codes
});
const FOUR = [station(0, ['1']), station(1, ['2']), station(2, ['3']), station(3, ['4'])];
const scout = (personId: number, o: Partial<RotationScout> = {}): RotationScout => ({
  personId,
  patrol: null,
  intent: 'coming',
  awarded: false,
  mbCodes: new Set(),
  ...o
});
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const input = (o: Partial<RotationInput> & { scouts: RotationScout[] }): RotationInput => ({
  mbId: MB,
  stations: FOUR,
  tops: TOPS,
  placements: new Map(),
  ...o
});
const sizes = (r: ReturnType<typeof draftRotations>) => r.groups.map((g) => g.members.length);
const groupOf = (r: ReturnType<typeof draftRotations>, id: number) => r.groups.find((g) => g.members.some((m) => m.personId === id))?.label ?? null;

describe('rotation draft (Decision 10)', () => {
  it('Matcher_BuildsRotationGroups_WhenMeritBadgeMode', () => {
    const r = draftRotations(input({ scouts: range(1, 12).map((id) => scout(id)) }));
    // Four stations: four groups, four rotations, and each group visits every station once, in turn.
    expect([r.rotations, r.groups.map((g) => g.label), r.groups.map((g) => g.schedule)]).toEqual([
      4,
      ['A', 'B', 'C', 'D'],
      [
        [0, 1, 2, 3],
        [1, 2, 3, 0],
        [2, 3, 0, 1],
        [3, 0, 1, 2]
      ]
    ]);
  });

  it('Matcher_AssignsEveryComingScout_WithoutBadge_InMeritBadgeMode', () => {
    const scouts = [...range(1, 9).map((id) => scout(id)), scout(20, { intent: 'undecided' })];
    const r = draftRotations(input({ scouts }));
    const placed = r.groups.flatMap((g) => g.members.map((m) => m.personId)).sort((a, b) => a - b);
    expect(placed).toEqual([...range(1, 9), 20]);
  });

  it('Matcher_PlacesNotSureYetScout_MarkedUndecided_InMeritBadgeMode', () => {
    const r = draftRotations(input({ scouts: [scout(1), scout(2, { intent: 'undecided' })] }));
    const m = r.groups.flatMap((g) => g.members).find((x) => x.personId === 2);
    expect(m?.undecided).toBe(true);
  });

  it('Matcher_ListsBadgeHolders_ForAdultPlacement_InMeritBadgeMode', () => {
    const r = draftRotations(input({ scouts: [scout(1), scout(2, { awarded: true }), scout(3, { awarded: true, intent: 'undecided' })] }));
    expect([groupOf(r, 2), groupOf(r, 3), r.badgeHolders]).toEqual([
      null,
      null,
      [
        { personId: 2, undecided: false, placement: null },
        { personId: 3, undecided: true, placement: null }
      ]
    ]);
  });

  it('Matcher_KeepsBadgeHolderPlacement_AsHelperOrOtherWork', () => {
    const placements = new Map<number, Placement>([
      [2, { kind: 'helper', topicId: 102 }],
      [3, { kind: 'other' }],
      [4, { kind: 'helper', topicId: 999 }]
    ]);
    const r = draftRotations(input({ scouts: [2, 3, 4].map((id) => scout(id, { awarded: true })), placements }));
    expect(r.badgeHolders.map((h) => h.placement)).toEqual([{ kind: 'helper', station: 2 }, { kind: 'other' }, null]);
  });

  it('Matcher_SkipsFinishedStation_ForScoutInRotation', () => {
    // Scout 1 did requirement 2 and cooked a meal on a stove (4 is "any of 4a, 4b").
    const r = draftRotations(input({ scouts: [scout(1, { mbCodes: new Set([`${MB}-2`, `${MB}-4a`]) }), scout(2)] }));
    const mine = scoutRotation(r, 1)!;
    expect([mine.group.members.find((m) => m.personId === 1)!.skips, mine.stops.filter((s) => s.free).map((s) => s.station).sort()]).toEqual([
      [1, 3],
      [1, 3]
    ]);
  });

  it('Matcher_DoesNotSkip_APartlyFinishedStation', () => {
    const r = draftRotations(input({ stations: [station(0, ['1', '2']), station(1, ['3'])], scouts: [scout(1, { mbCodes: new Set([`${MB}-1`]) })] }));
    expect(scoutRotation(r, 1)!.stops.every((s) => !s.free)).toBe(true);
  });

  it('Matcher_CapsRotationGroupsAtEight_AddingGroupsWhenNeeded', () => {
    const r = draftRotations(input({ scouts: range(1, 35).map((id) => scout(id)) }));
    // 35 scouts over 4 stations would be 9 a group: a fifth group, and two groups then share a station each rotation.
    expect([r.groups.length, Math.max(...sizes(r)) <= ROTATION_GROUP_CAP, sizes(r).reduce((a, b) => a + b, 0), r.groups[4].schedule]).toEqual([5, true, 35, [0, 1, 2, 3]]);
  });

  it('Matcher_BalancesGroupSizes_WithinOne', () => {
    const scouts = [
      ...range(1, 5).map((id) => scout(id, { patrol: 'Hawks' })),
      ...range(10, 5).map((id) => scout(id, { patrol: 'Owls' })),
      ...range(20, 3).map((id) => scout(id, { patrol: 'Bears' })),
      scout(30)
    ];
    const s = sizes(draftRotations(input({ stations: FOUR.slice(0, 3), scouts })));
    expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
  });

  it('Matcher_KeepsPatrolsTogether_WhereTheyFit', () => {
    const scouts = [
      ...range(1, 3).map((id) => scout(id, { patrol: 'Hawks' })),
      ...range(10, 3).map((id) => scout(id, { patrol: 'Owls' })),
      ...range(20, 3).map((id) => scout(id, { patrol: 'Bears' }))
    ];
    const r = draftRotations(input({ stations: FOUR.slice(0, 3), scouts }));
    const patrolGroups = (ids: number[]) => new Set(ids.map((id) => groupOf(r, id))).size;
    expect([patrolGroups(range(1, 3)), patrolGroups(range(10, 3)), patrolGroups(range(20, 3))]).toEqual([1, 1, 1]);
  });

  it('Matcher_RotationDraft_IsDeterministic_WhateverTheInputOrder', () => {
    const scouts = [...range(1, 7).map((id) => scout(id, { patrol: id % 2 ? 'Hawks' : 'Owls' })), ...range(40, 6).map((id) => scout(id))];
    const a = draftRotations(input({ scouts }));
    const b = draftRotations(input({ scouts: [...scouts].reverse(), stations: [...FOUR].reverse() }));
    expect(b).toEqual(a);
  });

  it('Matcher_KeepsLeaderPins_AndDraftsLateSignUpsAroundThem', () => {
    // The leader saved 1-4 in group A; scout 5 signed up afterwards, from scout 1's patrol.
    const placements = new Map<number, Placement>(range(1, 4).map((id) => [id, { kind: 'group', group: 0 }]));
    const scouts = [...range(1, 4).map((id) => scout(id, { patrol: id === 1 ? 'Hawks' : null })), scout(5, { patrol: 'Hawks' }), ...range(6, 3).map((id) => scout(id))];
    const r = draftRotations(input({ scouts, placements, stations: FOUR.slice(0, 2) }));
    const a = r.groups[0].members;
    const late = r.groups.flatMap((g) => g.members).find((m) => m.personId === 5)!;
    expect([a.filter((m) => m.pinned).map((m) => m.personId), late.isNew, late.pinned, r.arranged]).toEqual([[1, 2, 3, 4], true, false, true]);
  });

  it('Matcher_DropsAScoutWhoStoppedComing_FromASavedArrangement', () => {
    const placements = new Map<number, Placement>([
      [1, { kind: 'group', group: 1 }],
      [2, { kind: 'group', group: 1 }]
    ]);
    const r = draftRotations(input({ scouts: [scout(1)], placements }));
    expect([groupOf(r, 1), groupOf(r, 2)]).toEqual(['B', null]);
  });

  it('Matcher_RedraftsAPin_ToAGroupThatNoLongerExists', () => {
    const r = draftRotations(input({ scouts: [scout(1)], placements: new Map([[1, { kind: 'group', group: 9 }]]) }));
    expect([groupOf(r, 1), r.groups.flatMap((g) => g.members)[0].pinned]).toEqual(['A', false]);
  });

  it('Matcher_FlagsAGroupOverEight_TheLeaderChose', () => {
    const placements = new Map<number, Placement>(range(1, 9).map((id) => [id, { kind: 'group', group: 0 }]));
    const r = draftRotations(input({ scouts: range(1, 9).map((id) => scout(id)), placements, stations: FOUR.slice(0, 2) }));
    expect(r.overCap).toEqual([0]);
  });

  it('Matcher_HasNoGroups_UntilStationsAreSet', () => {
    const r = draftRotations(input({ stations: [], scouts: [scout(1), scout(2, { awarded: true })] }));
    expect([r.groups, r.badgeHolders.map((h) => h.personId)]).toEqual([[], [2]]);
  });
});

describe('rotation helpers', () => {
  it('Station_IsFinished_OnlyWhenEveryRequirementIsSatisfied', () => {
    const codes = new Set([`${MB}-1`, `${MB}-4b`]);
    expect([stationFinished({ codes: ['1'] }, MB, TOPS, codes), stationFinished({ codes: ['1', '4'] }, MB, TOPS, codes), stationFinished({ codes: ['1', '2'] }, MB, TOPS, codes)]).toEqual([true, true, false]);
  });

  it('DefaultStations_SplitTheMeetingDoableTopLevelRequirements_IntoAtMostFour', () => {
    expect(defaultStations(MB, REQS).map((s) => s.codes)).toEqual([['1'], ['2'], ['3'], ['4']]);
  });

  it('DefaultStations_GroupRequirementsIntoRuns_WhenThereAreMoreThanFour', () => {
    const many = Array.from({ length: 10 }, (_, i) => mbReq(String(i + 1), `Req ${i + 1}`, { mb_id: 'tst-many' }));
    const d = defaultStations('tst-many', many);
    expect([d.map((s) => s.codes.length), d[0].title]).toEqual([[3, 3, 2, 2], 'Requirements 1–3']);
  });

  it('StationProblems_MarkNoName_NoRequirement_AndASharedRequirement', () => {
    const p = stationProblems([
      { title: '', codes: ['1'] },
      { title: 'Two', codes: [] },
      { title: 'Three', codes: ['1', '3'] }
    ]);
    expect(p).toEqual({ count: null, each: [['title', 'shared'], ['codes'], ['shared']] });
  });

  it('StationProblems_NeedTwoToSix', () => {
    expect([stationProblems([{ title: 'a', codes: ['1'] }]).count, stationProblems(range(1, 7).map((i) => ({ title: 't', codes: [String(i)] }))).count]).toEqual(['few', 'many']);
  });

  it('StationVisitors_ListTheGroupsAtAStation_ByRotation', () => {
    const r = draftRotations(input({ stations: FOUR.slice(0, 2), scouts: [scout(1, { mbCodes: new Set([`${MB}-1`]) }), scout(2)] }));
    expect(stationVisitors(r, 0)).toEqual([
      { rotation: 1, groups: [{ label: 'A', working: 0, free: 1 }] },
      { rotation: 2, groups: [{ label: 'B', working: 1, free: 0 }] }
    ]);
  });

  it('ArrangementPlacements_PinEveryoneShown_AndPlacedHolders', () => {
    expect(
      arrangementPlacements(
        [{ members: [{ personId: 3 }] }, { members: [{ personId: 1 }] }],
        [
          { personId: 2, placement: { kind: 'other' } },
          { personId: 4, placement: null }
        ]
      )
    ).toEqual([
      { personId: 1, placement: { kind: 'group', group: 1 } },
      { personId: 2, placement: { kind: 'other' } },
      { personId: 3, placement: { kind: 'group', group: 0 } }
    ]);
  });

  it('BoardIntent_HeldPicks_DoNotMakeAScoutComing_OnAMeritBadgeNight', () => {
    const picks = [{ later: false }];
    expect([boardIntent('rank', null, picks), boardIntent('closed', null, picks), boardIntent('merit_badge', null, picks), boardIntent('merit_badge', 'coming', [])]).toEqual(['coming', 'coming', null, 'coming']);
  });

  it('GroupCount_AndLabels', () => {
    expect([groupCount(3, 0), groupCount(3, 25), groupLabel(0), groupLabel(25), groupLabel(26)]).toEqual([3, 4, 'A', 'Z', 'AA']);
  });
});

describe('the member page lines', () => {
  const src = (placements = new Map<number, Placement>()) => {
    const stations = [station(0, ['1']), { ...station(1, ['2']), location: 'Back room' }];
    const result = draftRotations(input({ stations, scouts: [scout(1, { mbCodes: new Set([`${MB}-2`]) }), scout(2, { awarded: true })], placements }));
    return { stations, result, teachersAt: new Map([[1, [40]]]), badgeHolderIds: [2, 3] };
  };
  const name = (id: number) => (id === 40 ? 'Mr. Vest' : '');

  it('Scout_SeesTheirGroup_AndANightWithFreeRotations', () => {
    expect(mbScoutLines(src(), 1, name)).toEqual({
      hasBadge: false,
      helping: null,
      otherWork: false,
      group: 'A',
      stops: [
        { rotation: 1, title: 'Station 1', place: null, teacher: '', free: false },
        { rotation: 2, title: 'Station 2', place: 'Back room', teacher: 'Mr. Vest', free: true }
      ]
    });
  });

  it('BadgeHolder_IsSaidToHaveIt_EvenWhenNotComing_AndWherePlaced', () => {
    const placed = mbScoutLines(src(new Map([[2, { kind: 'helper', topicId: 101 }]])), 2, name);
    expect([mbScoutLines(src(), 3, name).hasBadge, placed.helping, placed.group]).toEqual([true, 'Station 2 (Back room)', null]);
  });

  it('Teacher_SeesTheRotationOrder_OnlyAtTheirOwnStation', () => {
    const lines = stationTeachLines(src(), 40, 'Cooking', name);
    expect(lines.map((l) => [l.title, l.codes, l.mine, l.visits])).toEqual([
      ['Station 1', 'Cooking 1', false, []],
      ['Station 2', 'Cooking 2', true, ['Rotation 1: Group B, 0 scouts', 'Rotation 2: Group A, 0 scouts (1 already done: helping out)']]
    ]);
  });
});
