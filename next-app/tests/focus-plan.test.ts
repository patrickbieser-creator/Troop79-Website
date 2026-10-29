import { describe, it, expect } from 'vitest';
import { badgeGroupKey, buildFocusPlan, rankGroupKey, type FocusInput, type FocusProgress, type FocusScout, type ScoutRole } from '../src/lib/focus-plan';
import type { CatalogMeritBadgeRequirement, CatalogRankRequirement } from '../src/lib/advancement-catalog';

/** Meeting Planner III placement (Plans/Meeting-Planner-III.md): groups by the rank worked on, the Merit badge group,
 *  working ahead, the checklist's columns and ✓ cells, coverage and gaps. Real requirement codes, tiny catalog. */

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
function rankReq(rank_id: string, code: string, parent: CatalogRankRequirement | null = null, rule: 'all' | 'any' | 'n-of' = 'all', n: number | null = null): CatalogRankRequirement {
  return { id: nextId++, rank_id, parent_id: parent?.id ?? null, code, label: `${rank_id} ${code}`, complete_rule: rule, complete_n: n, sort_order: nextId, class_codes: [], skill_id: null };
}
function mbReq(mb_id: string, code: string, parent: CatalogMeritBadgeRequirement | null = null): CatalogMeritBadgeRequirement {
  return { id: nextId++, mb_id, parent_id: parent?.id ?? null, code, label: `${mb_id} ${code}`, complete_rule: 'all', complete_n: null, sort_order: nextId, class_codes: [] };
}

const s1a = rankReq('scout', '1a');
const s1b = rankReq('scout', '1b');
const t4 = rankReq('tenderfoot', '4', null, 'n-of', 1);
const t4a = rankReq('tenderfoot', '4a', t4);
const t4b = rankReq('tenderfoot', '4b', t4);
const t5 = rankReq('tenderfoot', '5');
const sc6a = rankReq('second-class', '6a');
const sc6b = rankReq('second-class', '6b');
const fc7a = rankReq('first-class', '7a');
const fc7a1 = rankReq('first-class', '7a.1', fc7a);
const fc7a2 = rankReq('first-class', '7a.2', fc7a);
const fc7b = rankReq('first-class', '7b');
const star6 = rankReq('star', '6');
const RANK_REQS = [s1a, s1b, t4, t4a, t4b, t5, sc6a, sc6b, fc7a, fc7a1, fc7a2, fc7b, star6];

const fa1 = mbReq('first-aid', '1');
const fa2 = mbReq('first-aid', '2');
const fa2a = mbReq('first-aid', '2a', fa2);
const ca1 = mbReq('camping', '1');
const ca2 = mbReq('camping', '2');
const ca3 = mbReq('camping', '3');
const ca3a = mbReq('camping', '3a', ca3);
const ca3b = mbReq('camping', '3b', ca3);
const MB_REQS = [fa1, fa2, fa2a, ca1, ca2, ca3, ca3a, ca3b];
const MBS = [
  { id: 'first-aid', name: 'First Aid', eagle: true },
  { id: 'camping', name: 'Camping', eagle: true }
];

let pid = 100;
function scout(currentRank: string | null, name = `Scout ${pid}`): FocusScout {
  pid++;
  return { personId: pid, scoutId: `S${pid}`, name, currentRank, intent: null };
}
const done = (rank: string[] = [], mb: string[] = [], awarded: string[] = []): FocusProgress => ({ rankCodes: new Set(rank), mbCodes: new Set(mb), awardedMbs: new Set(awarded) });

function plan(scouts: FocusScout[], focusKeys: string[], extra: Partial<FocusInput> & { done?: Record<string, FocusProgress> } = {}) {
  const progress = new Map(Object.entries(extra.done ?? {}));
  return buildFocusPlan({ ranks: RANKS, rankReqs: RANK_REQS, meritBadges: MBS, mbReqs: MB_REQS, scouts, progress, focusKeys, ...extra });
}
const ALL_RANK_FOCUS = ['scout-1a', 'tenderfoot-4', 'tenderfoot-4a', 'tenderfoot-4b', 'second-class-6a', 'first-class-7a', 'first-class-7a.1'];
const rowOf = (p: ReturnType<typeof plan>, s: FocusScout) => p.rows.find((r) => r.personId === s.personId)!;

describe('placement', () => {
  it('Placement_NoRankScout_GoesToScoutGroup', () => {
    const s = scout(null);
    expect(rowOf(plan([s], ALL_RANK_FOCUS), s).groupKey).toBe(rankGroupKey('scout'));
  });

  it('Placement_SecondClassScout_GoesToFirstClassGroup', () => {
    const s = scout('second-class');
    expect(rowOf(plan([s], ALL_RANK_FOCUS), s).groupKey).toBe(rankGroupKey('first-class'));
  });

  it('Placement_FirstClassThroughEagle_GoToMeritBadgeGroup', () => {
    const older = ['first-class', 'star', 'life', 'eagle'].map((r) => scout(r));
    const p = plan(older, ['first-aid-1', 'tenderfoot-5']);
    expect(older.map((s) => rowOf(p, s)).map((r) => [r.counted, r.groupKey, r.status])).toEqual(older.map(() => [false, badgeGroupKey('first-aid'), 'badge']));
  });

  it('Placement_ScoutDoneWithOwnFocus_MovesToNextGroup_WhenItHasOpenWork', () => {
    const s = scout('scout');
    const p = plan([s], ['tenderfoot-5', 'second-class-6a'], { done: { [s.scoutId]: done(['tenderfoot-5']) } });
    expect([rowOf(p, s).groupKey, rowOf(p, s).status]).toEqual([rankGroupKey('second-class'), 'rank-work']);
  });

  it('Placement_ScoutDoneWithOwnFocus_StaysAndShowsNothingAssigned_WhenNextGroupHasNone', () => {
    const s = scout('scout');
    const p = plan([s], ['tenderfoot-5'], { done: { [s.scoutId]: done(['tenderfoot-5']) } });
    expect([rowOf(p, s).groupKey, rowOf(p, s).status, rowOf(p, s).allDone]).toEqual([null, 'nothing', true]);
  });

  it('Placement_FocusWithNothingForOwnRank_UsesNextGroup', () => {
    const s = scout(null);
    expect(rowOf(plan([s], ['tenderfoot-5']), s).groupKey).toBe(rankGroupKey('tenderfoot'));
  });

  it('Placement_WorkingAhead_GoesOneStepOnly', () => {
    const s = scout(null);
    expect(rowOf(plan([s], ['second-class-6a']), s).status).toBe('nothing');
  });

  it('Placement_NeverMovesYoungerScoutIntoBadgeGroupAutomatically', () => {
    const s = scout('second-class');
    const p = plan([s], ['first-aid-1']);
    expect([rowOf(p, s).groupKey, rowOf(p, s).status, rowOf(p, s).allDone]).toEqual([null, 'nothing', false]);
  });
});

describe('groups', () => {
  it('Groups_OnlyRanksTheFocusCovers_AppearAsGroups', () => {
    expect(plan([], ['tenderfoot-5', 'first-class-7b']).groups.map((g) => g.key)).toEqual([rankGroupKey('tenderfoot'), rankGroupKey('first-class')]);
  });

  it('Groups_TwoBadgesInFocus_MakeTwoBadgeGroups', () => {
    expect(plan([], ['camping-1', 'first-aid-1']).groups.map((g) => g.key)).toEqual([badgeGroupKey('camping'), badgeGroupKey('first-aid')]);
  });

  it('Groups_BadgeAddedDirectly_OffersItsTopLevelRequirements', () => {
    expect(plan([], [], { badgeIds: ['first-aid'] }).groups[0].columns.map((c) => c.key)).toEqual(['first-aid-1', 'first-aid-2']);
  });

  it('Groups_BadgeOnlyNight_HasNoRankGroups_AndEveryCountedScoutIsAGap', () => {
    const young = [scout(null), scout('tenderfoot')];
    const p = plan(young, ['first-aid-1']);
    expect([p.groups.every((g) => g.kind === 'badge'), p.coverage]).toEqual([true, { counted: 2, rankWork: 0, nothing: 2 }]);
  });

  it('Groups_StarRankRequirements_AreUnplaced', () => {
    expect(plan([], ['star-6', 'tenderfoot-9z']).unplaced).toEqual(['star-6', 'tenderfoot-9z']);
  });

  it('Groups_MembersListEachPlacedScoutOnce', () => {
    const a = scout(null);
    const b = scout(null);
    expect(plan([a, b], ['scout-1a']).groups[0].members).toEqual([a.personId, b.personId]);
  });
});

describe('older scouts', () => {
  it('OlderScout_DefaultsToFirstBadge', () => {
    const s = scout('star');
    expect(rowOf(plan([s], ['camping-1', 'first-aid-1']), s).groupKey).toBe(badgeGroupKey('camping'));
  });

  it('OlderScout_WhoEarnedTheBadge_IsNotPutInItsGroup', () => {
    const s = scout('star');
    const p = plan([s], ['first-aid-1', 'camping-1'], { done: { [s.scoutId]: done([], [], ['first-aid']) } });
    expect(rowOf(p, s).groupKey).toBe(badgeGroupKey('camping'));
  });

  it('OlderScout_WhoEarnedEveryBadgeTonight_Teaches', () => {
    const s = scout('star');
    const p = plan([s], ['first-aid-1'], { done: { [s.scoutId]: done([], [], ['first-aid']) } });
    expect([rowOf(p, s).status, rowOf(p, s).groupKey]).toEqual(['teach', null]);
  });

  it('EarnedBadge_ShowsEveryColumnDone_EvenWithoutItsRequirementsOnTheLedger', () => {
    const s = scout('star');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'group', key: badgeGroupKey('first-aid') }]]);
    const p = plan([s], ['first-aid-1', 'first-aid-2'], { roles, done: { [s.scoutId]: done([], [], ['first-aid']) } });
    expect(rowOf(p, s).open).toEqual([]);
  });

  it('OlderScout_Teaches_WhenTheNightHasNoBadge', () => {
    const s = scout('life');
    expect(rowOf(plan([s], ['tenderfoot-5']), s).status).toBe('teach');
  });

  it('OlderScout_CanBeSetToTeach', () => {
    const s = scout('star');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'teach' }]]);
    expect([rowOf(plan([s], ['first-aid-1'], { roles }), s).status, rowOf(plan([s], ['first-aid-1'], { roles }), s).groupKey]).toEqual(['teach', null]);
  });

  it('OlderScout_CanTakeTheSecondBadge', () => {
    const s = scout('star');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'group', key: badgeGroupKey('first-aid') }]]);
    expect(rowOf(plan([s], ['camping-1', 'first-aid-1'], { roles }), s).groupKey).toBe(badgeGroupKey('first-aid'));
  });
});

describe('columns and checks', () => {
  it('Columns_ParentAndChildrenPicked_ShowAsTheParent', () => {
    expect(plan([], ['first-class-7a', 'first-class-7a.1', 'first-class-7a.2', 'first-class-7b']).groups[0].columns.map((c) => c.code)).toEqual(['7a', '7b']);
  });

  it('Columns_OnlyAChildPicked_ShowsTheChild', () => {
    expect(plan([], ['first-class-7a.2']).groups[0].columns.map((c) => c.code)).toEqual(['7a.2']);
  });

  it('Columns_FollowCatalogOrder_NotFocusOrder', () => {
    expect(plan([], ['tenderfoot-5', 'tenderfoot-4']).groups[0].columns.map((c) => c.code)).toEqual(['4', '5']);
  });

  it('Columns_UnionAcrossSeveralFocusSets_WithoutDuplicates', () => {
    expect(plan([], ['scout-1b', 'scout-1a', 'scout-1b']).groups[0].columns.map((c) => c.code)).toEqual(['1a', '1b']);
  });

  it('Check_IsOpen_WhenLeafNotSignedOff', () => {
    const s = scout('scout');
    expect(rowOf(plan([s], ['tenderfoot-4', 'tenderfoot-5'], { done: { [s.scoutId]: done(['tenderfoot-5']) } }), s).open).toEqual(['tenderfoot-4']);
  });

  it('Check_IsBlank_WhenParentSatisfiedByNOf', () => {
    const s = scout('scout');
    expect(rowOf(plan([s], ['tenderfoot-4', 'tenderfoot-5'], { done: { [s.scoutId]: done(['tenderfoot-4b']) } }), s).open).toEqual(['tenderfoot-5']);
  });

  it('Check_BadgeColumn_ReadsMeritBadgeLedgerCodes', () => {
    const s = scout('star');
    expect(rowOf(plan([s], ['first-aid-1', 'first-aid-2'], { done: { [s.scoutId]: done([], ['first-aid-2a']) } }), s).open).toEqual(['first-aid-1']);
  });
});

describe('checklist cells: rank sub-requirements, part-done badge requirements', () => {
  const FC7A = ['first-class-7a', 'first-class-7a.1', 'first-class-7a.2', 'first-class-7b'];

  it('Grid_RankColumnWithSubRequirements_ListsEachSub', () => {
    expect(plan([], FC7A).groups[0].columns[0].subs.map((c) => c.code)).toEqual(['7a.1', '7a.2']);
  });

  it('Grid_RankLeafColumn_HasNoSubs', () => {
    expect(plan([], FC7A).groups[0].columns[1].subs).toEqual([]);
  });

  it('Grid_BadgeColumn_HasNoSubs_EvenWithSubRequirements', () => {
    expect(plan([], ['camping-3']).groups[0].columns[0].subs).toEqual([]);
  });

  it('Marks_RankSub_OpenOnlyWhereNotSignedOff', () => {
    const s = scout('second-class');
    expect(rowOf(plan([s], FC7A, { done: { [s.scoutId]: done(['first-class-7a.1', 'first-class-7b']) } }), s).marks).toEqual({ 'first-class-7a.2': 'open' });
  });

  it('Marks_RankSub_DoneWhenParentSatisfiedByNOf', () => {
    const s = scout('scout');
    const p = plan([s], ['tenderfoot-4', 'tenderfoot-5'], { done: { [s.scoutId]: done(['tenderfoot-4b']) } });
    expect(rowOf(p, s).marks).toEqual({ 'tenderfoot-5': 'open' });
  });

  it('Marks_BadgeRequirementPartlyDone_IsPart', () => {
    const s = scout('star');
    expect(rowOf(plan([s], ['camping-3'], { done: { [s.scoutId]: done([], ['camping-3a']) } }), s).marks).toEqual({ 'camping-3': 'part' });
  });

  it('Marks_BadgeRequirementUntouched_IsOpen', () => {
    const s = scout('star');
    expect(rowOf(plan([s], ['camping-3']), s).marks).toEqual({ 'camping-3': 'open' });
  });

  it('Marks_EarnedBadge_HasNothingOpen', () => {
    const s = scout('star');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'group', key: badgeGroupKey('camping') }]]);
    expect(rowOf(plan([s], ['camping-3'], { roles, done: { [s.scoutId]: done([], [], ['camping']) } }), s).marks).toEqual({});
  });

  it('Marks_ScoutInNoGroup_ReadsTheHomeGroup', () => {
    const s = scout('second-class');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'teach' }]]);
    expect(rowOf(plan([s], FC7A, { roles, done: { [s.scoutId]: done(['first-class-7a.2']) } }), s).homeMarks).toEqual({ 'first-class-7a.1': 'open', 'first-class-7b': 'open' });
  });
});

describe('coverage and gaps', () => {
  it('Coverage_CountsWholeActiveRoster_NotJustComing', () => {
    const a = { ...scout(null), intent: 'coming' as const };
    const b = { ...scout(null), intent: 'not_coming' as const };
    expect(plan([a, b], ['scout-1a']).coverage).toEqual({ counted: 2, rankWork: 2, nothing: 0 });
  });

  it('Coverage_ExcludesMeritBadgeGroup', () => {
    expect(plan([scout('star'), scout(null)], ['scout-1a', 'first-aid-1']).coverage.counted).toBe(1);
  });

  it('GapFill_ClearsNothingAssigned_ButNotRankWorkCount', () => {
    const s = scout('second-class');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'group', key: badgeGroupKey('first-aid') }]]);
    expect(plan([s], ['first-aid-1'], { roles }).coverage).toEqual({ counted: 1, rankWork: 0, nothing: 0 });
  });

  it('GapFill_RequestKeepsTheTopic', () => {
    const s = scout(null);
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'request', key: 'tenderfoot-5' }]]);
    expect([rowOf(plan([s], ['first-aid-1'], { roles }), s).status, rowOf(plan([s], ['first-aid-1'], { roles }), s).requestKey]).toEqual(['request', 'tenderfoot-5']);
  });

  it('GapFill_MovedIntoRankGroupWithNothingOpen_IsPlacedNotRankWork', () => {
    const s = scout('scout');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'group', key: rankGroupKey('tenderfoot') }]]);
    const p = plan([s], ['tenderfoot-5'], { roles, done: { [s.scoutId]: done(['tenderfoot-5']) } });
    expect([rowOf(p, s).status, p.coverage.nothing]).toEqual(['placed', 0]);
  });

  it('GapFill_IntoAGroupThatLeftTheFocus_FallsBackToPlacement', () => {
    const s = scout(null);
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'group', key: badgeGroupKey('camping') }]]);
    expect(rowOf(plan([s], ['scout-1a'], { roles }), s).groupKey).toBe(rankGroupKey('scout'));
  });

  it('NothingAssigned_IsPlain_WhenTheFocusHasNothingForTheirRank', () => {
    const s = scout('tenderfoot');
    expect(rowOf(plan([s], ['scout-1a']), s).allDone).toBe(false);
  });

  it('Pick_OfAGroup_PlacesTheScoutThere', () => {
    const s = scout('star');
    const picks = new Map([[s.personId, ['tenderfoot-5', badgeGroupKey('first-aid')]]]);
    expect(rowOf(plan([s], ['camping-1', 'first-aid-1'], { picks }), s).groupKey).toBe(badgeGroupKey('first-aid'));
  });

  it('Role_OutranksAPick', () => {
    const s = scout('star');
    const picks = new Map([[s.personId, [badgeGroupKey('first-aid')]]]);
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'teach' }]]);
    expect(rowOf(plan([s], ['first-aid-1'], { picks, roles }), s).status).toBe('teach');
  });

  it('Home_OfAGap_IsTheGroupOfTheirRank', () => {
    const s = scout('scout');
    const p = plan([s], ['tenderfoot-5'], { done: { [s.scoutId]: done(['tenderfoot-5']) } });
    expect(rowOf(p, s).homeKey).toBe(rankGroupKey('tenderfoot'));
  });

  it('HomeOpen_ListsWhatIsStillOpen_InTheHomeGroup_ForAScoutPlacedElsewhere', () => {
    const s = scout('scout');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'teach' }]]);
    const p = plan([s], ['tenderfoot-4', 'tenderfoot-5'], { roles, done: { [s.scoutId]: done(['tenderfoot-5']) } });
    expect([rowOf(p, s).homeKey, rowOf(p, s).homeOpen]).toEqual([rankGroupKey('tenderfoot'), ['tenderfoot-4']]);
  });

  it('Suggestions_ForScout_AreTheirPlacedGroup', () => {
    const s = scout('tenderfoot');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'teach' }]]);
    expect(rowOf(plan([s], ['second-class-6a'], { roles }), s).suggested).toEqual([rankGroupKey('second-class')]);
  });
});

describe('family answers (Emails E2)', () => {
  const SC_FOCUS = ['second-class-6a', 'second-class-6b', 'first-class-7a', 'first-class-7b', 'tenderfoot-5'];

  it('Family_UntickRemovesRequirement_FromThePlan', () => {
    const s = scout('tenderfoot');
    const r = rowOf(plan([s], SC_FOCUS, { exclusions: new Map([[s.personId, new Set(['second-class-6a'])]]) }), s);
    expect([r.groupKey, r.open]).toEqual([rankGroupKey('second-class'), ['second-class-6b']]);
  });

  it('Family_UntickingEverything_LeavesNothingAssigned', () => {
    const s = scout('tenderfoot');
    const r = rowOf(plan([s], SC_FOCUS, { exclusions: new Map([[s.personId, new Set(['second-class-6a', 'second-class-6b'])]]) }), s);
    expect([r.groupKey, r.status, r.open]).toEqual([null, 'nothing', []]);
  });

  it('Family_UntickOutsideThePlan_IsIgnored', () => {
    const s = scout('tenderfoot');
    const r = rowOf(plan([s], SC_FOCUS, { exclusions: new Map([[s.personId, new Set(['first-class-7a'])]]) }), s);
    expect(r.open).toEqual(['second-class-6a', 'second-class-6b']);
  });

  it('Family_UntickARankColumn_DropsItsSubCells', () => {
    const s = scout('second-class');
    const r = rowOf(plan([s], SC_FOCUS, { exclusions: new Map([[s.personId, new Set(['first-class-7a'])]]) }), s);
    expect(Object.keys(r.marks)).toEqual(['first-class-7b']);
  });

  it('Family_UntickCountsAgainstCoverage_OnlyWhenNothingIsLeft', () => {
    const a = scout('tenderfoot');
    const b = scout('tenderfoot');
    const p = plan([a, b], SC_FOCUS, { exclusions: new Map([[a.personId, new Set(['second-class-6a', 'second-class-6b'])], [b.personId, new Set(['second-class-6a'])]]) });
    expect([p.coverage.rankWork, p.coverage.nothing]).toEqual([1, 1]);
  });

  it('MeritBadgeScout_HelpTeach_ListsAsHelperNotTeacher', () => {
    const s = scout('star');
    const r = rowOf(plan([s], [...SC_FOCUS, 'first-aid-1'], { helpers: new Map([[s.personId, rankGroupKey('second-class')]]) }), s);
    expect([r.groupKey, r.status]).toEqual([rankGroupKey('second-class'), 'teach']);
  });

  it('PlannerChoice_OutranksAFamilysHelpAnswer', () => {
    const s = scout('star');
    const roles = new Map<number, ScoutRole>([[s.personId, { role: 'group', key: badgeGroupKey('first-aid') }]]);
    const r = rowOf(plan([s], [...SC_FOCUS, 'first-aid-1'], { roles, helpers: new Map([[s.personId, rankGroupKey('second-class')]]) }), s);
    expect(r.groupKey).toBe(badgeGroupKey('first-aid'));
  });
});
