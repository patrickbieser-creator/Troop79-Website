import { describe, it, expect } from 'vitest';
import { buildStationRotation, type StationInput } from '../src/lib/station-rotation';
import type { FocusProgress, FocusScout, ScoutRole } from '../src/lib/focus-plan';
import type { CatalogMeritBadgeRequirement } from '../src/lib/advancement-catalog';

/** Station rotations (Plans/Planner-Station-Rotations.md): a merit badge night's focus sets become stations, every
 *  scout without the badge lands in a traveling group seeded by the rank they work on, and the groups visit every
 *  station once. Real Climbing codes, tiny catalog. */

const RANKS = [
  ['scout', 'Scout'],
  ['tenderfoot', 'Tenderfoot'],
  ['second-class', 'Second Class'],
  ['first-class', 'First Class'],
  ['star', 'Star'],
  ['life', 'Life'],
  ['eagle', 'Eagle']
].map(([id, display_name], sort_order) => ({ id, display_name, sort_order }));

let nextId = 1;
function mbReq(code: string, parent: CatalogMeritBadgeRequirement | null = null): CatalogMeritBadgeRequirement {
  return { id: nextId++, mb_id: 'climbing', parent_id: parent?.id ?? null, code, label: `climbing ${code}`, complete_rule: 'all', complete_n: null, sort_order: nextId, class_codes: [] };
}
const c1 = mbReq('1');
const c1a = mbReq('1a', c1);
const c1b = mbReq('1b', c1);
const c2 = mbReq('2');
const c4 = mbReq('4');
const c4a = mbReq('4a', c4);
const c4b = mbReq('4b', c4);
const c6 = mbReq('6');
const c6a = mbReq('6a', c6);
const c7 = mbReq('7');
const c7a = mbReq('7a', c7);
const MB_REQS = [c1, c1a, c1b, c2, c4, c4a, c4b, c6, c6a, c7, c7a];

const SAFETY = { topicKey: 'fg:27', name: 'Climbing MB - I Safety', goalMinutes: 25, itemKeys: ['climbing-1', 'climbing-1a', 'climbing-1b', 'climbing-2'] };
const TERMS = { topicKey: 'fg:28', name: 'Climbing MB - II Terms', goalMinutes: 25, itemKeys: ['climbing-4', 'climbing-4a', 'climbing-4b'] };
const ROPES = { topicKey: 'fg:29', name: 'Climbing MB - III Ropes & Knots', goalMinutes: 30, itemKeys: ['climbing-6', 'climbing-7'] };
const THREE = [SAFETY, TERMS, ROPES];

let pid = 100;
function scout(currentRank: string | null): FocusScout {
  pid++;
  return { personId: pid, scoutId: `S${pid}`, name: `Scout ${pid}`, currentRank, intent: null };
}
const done = (mb: string[] = [], awarded: string[] = []): FocusProgress => ({ rankCodes: new Set(), mbCodes: new Set(mb), awardedMbs: new Set(awarded) });

function rotate(scouts: FocusScout[], extra: Partial<StationInput> & { done?: Record<string, FocusProgress> } = {}) {
  const progress = new Map(Object.entries(extra.done ?? {}));
  return buildStationRotation({ ranks: RANKS, mbReqs: MB_REQS, badgeId: 'climbing', stations: THREE, scouts, progress, ...extra });
}
const groupOf = (r: ReturnType<typeof rotate>, s: FocusScout) => r.groups.find((g) => g.members.includes(s.personId))?.key ?? null;

describe('who rotates', () => {
  it('Draft_PlacesEveryNonHolder_WhenStationsOn', () => {
    const scouts = [scout(null), scout('scout'), scout('tenderfoot'), scout('second-class'), scout('star')];
    const r = rotate(scouts);
    expect(scouts.every((s) => groupOf(r, s) !== null)).toBe(true);
  });

  it('Draft_ExcludesBadgeHolders_FromRotation', () => {
    const holder = scout('star');
    const r = rotate([holder, scout(null)], { done: { [holder.scoutId]: done([], ['climbing']) } });
    expect(r.holders).toEqual([holder.personId]);
  });

  it('Draft_HolderSitsInNoGroup', () => {
    const holder = scout('tenderfoot');
    const r = rotate([holder], { done: { [holder.scoutId]: done([], ['climbing']) } });
    expect(groupOf(r, holder)).toBeNull();
  });
});

describe('seeding by the rank worked on', () => {
  it('Draft_NewScout_SeedsScoutGroup', () => {
    const s = scout(null);
    expect(groupOf(rotate([s]), s)).toBe('scout');
  });

  it('Draft_ScoutRankHolder_SeedsTenderfootGroup', () => {
    const s = scout('scout');
    expect(groupOf(rotate([s]), s)).toBe('tenderfoot');
  });

  it('Draft_FirstClassAndUpWithoutBadge_FoldIntoFirstClassGroup', () => {
    const fc = scout('first-class');
    const star = scout('star');
    const life = scout('life');
    const r = rotate([fc, star, life]);
    expect([groupOf(r, fc), groupOf(r, star), groupOf(r, life)]).toEqual(['first-class', 'first-class', 'first-class']);
  });
});

describe('group count', () => {
  it('Draft_KeepsRankGroupsWhole_WhenGroupsFitStations', () => {
    const r = rotate([scout(null), scout('scout'), scout('tenderfoot')]);
    expect(r.groups.map((g) => g.ranks)).toEqual([['scout'], ['tenderfoot'], ['second-class']]);
  });

  it('Draft_MergesFromTheTop_WhenMoreGroupsThanStations', () => {
    // 4 seeds into 3 stations: Second + First combine, whatever the sizes (Patrick, 2026-11-08).
    const scouts = [scout(null), scout(null), scout(null), scout('scout'), scout('tenderfoot'), scout('tenderfoot'), scout('second-class')];
    const r = rotate(scouts);
    expect(r.groups.map((g) => g.ranks)).toEqual([['scout'], ['tenderfoot'], ['second-class', 'first-class']]);
  });

  it('Draft_NeverMoreGroupsThanStations_WithTwoStations', () => {
    const r = rotate([scout(null), scout('scout'), scout('tenderfoot'), scout('second-class')], { stations: [SAFETY, TERMS] });
    expect(r.groups.map((g) => g.ranks)).toEqual([['scout'], ['tenderfoot', 'second-class', 'first-class']]);
  });

  it('Draft_MergedGroup_IsNamedForItsRanks', () => {
    const r = rotate([scout(null), scout('scout'), scout('tenderfoot'), scout('second-class')]);
    expect(r.groups[2].name).toBe('Second Class + First Class');
  });

  it('Draft_DropsEmptyRankGroups', () => {
    const r = rotate([scout(null), scout('second-class')]);
    expect(r.groups.map((g) => g.key)).toEqual(['scout', 'first-class']);
  });
});

describe('rounds', () => {
  const visits = (r: ReturnType<typeof rotate>) => r.groups.map((_, g) => r.rounds.map((round) => round.stationOf[g]));

  it('Rotation_EveryGroupVisitsEveryStationOnce_ThreeStations', () => {
    const r = rotate([scout(null), scout('scout'), scout('tenderfoot')]);
    expect(visits(r).every((v) => new Set(v).size === 3)).toBe(true);
  });

  it('Rotation_NoTwoGroupsShareAStationInARound', () => {
    const r = rotate([scout(null), scout('scout'), scout('tenderfoot')]);
    expect(r.rounds.every((round) => new Set(round.stationOf).size === round.stationOf.length)).toBe(true);
  });

  it('Rotation_EveryGroupVisitsEveryStation_SixStations', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({ ...SAFETY, topicKey: `fg:${n}`, name: `S${n}` }));
    const r = rotate([scout(null), scout('scout'), scout('tenderfoot')], { stations: six });
    expect(visits(r).every((v) => new Set(v).size === 6)).toBe(true);
  });

  it('Rotation_FewerGroupsThanStations_StillRunsOneRoundPerStation', () => {
    const r = rotate([scout(null), scout('scout')]);
    expect(r.rounds.length).toBe(3);
  });

  it('Rotation_FirstGroupStartsAtFirstStation', () => {
    const r = rotate([scout(null), scout('scout'), scout('tenderfoot')]);
    expect(r.rounds[0].stationOf).toEqual([0, 1, 2]);
  });
});

describe('minutes', () => {
  it('Round_LengthIsLongestStationGoal', () => {
    expect(rotate([scout(null)]).roundMinutes).toBe(30);
  });

  it('Round_TotalIsRoundTimesStations', () => {
    expect(rotate([scout(null)]).totalMinutes).toBe(90);
  });

  it('Round_NoGoals_LeavesMinutesUnknown', () => {
    const r = rotate([scout(null)], { stations: THREE.map((s) => ({ ...s, goalMinutes: null })) });
    expect([r.roundMinutes, r.totalMinutes]).toEqual([null, null]);
  });
});

describe('checklist', () => {
  it('Checklist_StationCellsAreItsLeaves', () => {
    const r = rotate([scout(null)]);
    expect(r.stations[0].cells).toEqual(['climbing-1a', 'climbing-1b', 'climbing-2']);
  });

  it('Checklist_SignedOffLeafIsDone', () => {
    const s = scout(null);
    const r = rotate([s], { done: { [s.scoutId]: done(['climbing-1a']) } });
    expect(r.rows.find((x) => x.personId === s.personId)!.done).toEqual(['climbing-1a']);
  });

  it('Draft_KeepsScoutWithGroup_WhenStationAlreadyDone', () => {
    const s = scout(null);
    const r = rotate([s], { done: { [s.scoutId]: done(['climbing-4a', 'climbing-4b']) } });
    expect(groupOf(r, s)).toBe('scout');
  });

  it('Draft_FlagsHelper_WhenStationAlreadyDone', () => {
    const s = scout(null);
    const r = rotate([s], { done: { [s.scoutId]: done(['climbing-4a', 'climbing-4b']) } });
    expect(r.rows.find((x) => x.personId === s.personId)!.helperAt).toEqual(['fg:28']);
  });
});

describe('hand choices', () => {
  it('Draft_HonorsHandMove_OverPlacement', () => {
    const s = scout(null);
    const r = rotate([s, scout('scout')], { moves: new Map([[s.personId, 'tenderfoot']]) });
    expect(groupOf(r, s)).toBe('tenderfoot');
  });

  it('Draft_HandMoveFollowsMergedGroup', () => {
    // Moved into Second Class, which merges with First Class: the scout goes with the merged group.
    const s = scout(null);
    const r = rotate([s, scout(null), scout('scout'), scout('tenderfoot'), scout('second-class')], { moves: new Map([[s.personId, 'second-class']]) });
    expect(groupOf(r, s)).toBe('second-class');
  });

  it('Draft_HonorsUnassign', () => {
    const s = scout(null);
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'none' }]]);
    const r = rotate([s], { roles });
    expect([groupOf(r, s), r.unassigned]).toEqual([null, [s.personId]]);
  });

  it('Draft_TeacherScoutSitsInNoGroup', () => {
    const s = scout('star');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'teach' }]]);
    const r = rotate([s], { roles });
    expect([groupOf(r, s), r.teaching]).toEqual([null, [s.personId]]);
  });

  it('Draft_UnknownMoveRank_FallsBackToPlacement', () => {
    const s = scout(null);
    const r = rotate([s], { moves: new Map([[s.personId, 'eagle']]) });
    expect(groupOf(r, s)).toBe('scout');
  });
});
