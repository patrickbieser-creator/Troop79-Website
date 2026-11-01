import { describe, it, expect } from 'vitest';
import {
  badgeGroupKey,
  buildFocusPlan,
  canonicalGroupKey,
  parseGroupKey,
  rankGroupKey,
  sectionGroupKey,
  type FocusInput,
  type FocusProgress,
  type FocusScout
} from '../src/lib/focus-plan';
import { topicWords } from '../src/lib/meeting-board-picklist';
import type { CatalogMeritBadgeRequirement, CatalogRankRequirement } from '../src/lib/advancement-catalog';

/** Split groups, S1 (Plans/Meeting-Planner-III-Split-Groups.md): a rank (or, groundwork, a badge) group divided into
 *  Group 1-3, each with its own columns; placement by open minutes; the soft merge's alias. Tiny real-shaped catalog. */

const RANKS = [
  ['scout', 'Scout'],
  ['tenderfoot', 'Tenderfoot'],
  ['second-class', 'Second Class'],
  ['first-class', 'First Class'],
  ['star', 'Star']
].map(([id, display_name], sort_order) => ({ id, display_name, sort_order }));

let nextId = 1;
function rankReq(rank_id: string, code: string, parent: CatalogRankRequirement | null = null, teach_minutes?: number): CatalogRankRequirement {
  return { id: nextId++, rank_id, parent_id: parent?.id ?? null, code, label: `${rank_id} ${code}`, complete_rule: 'all', complete_n: null, sort_order: nextId, class_codes: [], skill_id: null, teach_minutes };
}
function mbReq(mb_id: string, code: string): CatalogMeritBadgeRequirement {
  return { id: nextId++, mb_id, parent_id: null, code, label: `${mb_id} ${code}`, complete_rule: 'all', complete_n: null, sort_order: nextId, class_codes: [] };
}

const s1 = rankReq('scout', '1');
const t1 = rankReq('tenderfoot', '1');
const t2 = rankReq('tenderfoot', '2');
const t3 = rankReq('tenderfoot', '3', null, 60);
const t4 = rankReq('tenderfoot', '4');
const t4a = rankReq('tenderfoot', '4a', t4);
const t4b = rankReq('tenderfoot', '4b', t4);
const RANK_REQS = [s1, t1, t2, t3, t4, t4a, t4b];
const MB_REQS = [mbReq('first-aid', '1'), mbReq('first-aid', '2')];
const MBS = [{ id: 'first-aid', name: 'First Aid', eagle: true }];

const TF = rankGroupKey('tenderfoot');
const TF2 = sectionGroupKey(TF, 2);
const TF3 = sectionGroupKey(TF, 3);

let pid = 100;
function scout(currentRank: string | null): FocusScout {
  pid++;
  return { personId: pid, scoutId: `S${pid}`, name: `Scout ${pid}`, currentRank, intent: null };
}
const done = (rank: string[] = [], mb: string[] = []): FocusProgress => ({ rankCodes: new Set(rank), mbCodes: new Set(mb), awardedMbs: new Set() });

type Extra = Partial<FocusInput> & { done?: Record<string, FocusProgress> };
function plan(scouts: FocusScout[], focusKeys: string[], extra: Extra = {}) {
  const progress = new Map(Object.entries(extra.done ?? {}));
  return buildFocusPlan({ ranks: RANKS, rankReqs: RANK_REQS, meritBadges: MBS, mbReqs: MB_REQS, scouts, progress, focusKeys, ...extra });
}
const split = (base: string, ...sections: string[][]) => new Map([[base, sections]]);
const rowOf = (p: ReturnType<typeof plan>, s: FocusScout) => p.rows.find((r) => r.personId === s.personId)!;
const colsOf = (p: ReturnType<typeof plan>, key: string) => p.groups.find((g) => g.key === key)?.columns.map((c) => c.key);
const TF_FOCUS = ['tenderfoot-1', 'tenderfoot-2', 'tenderfoot-3'];

describe('group keys', () => {
  it('SectionKey_Group1IsTheBaseKey', () => {
    expect([sectionGroupKey(TF, 1), TF2]).toEqual(['fr:tenderfoot', 'fr:tenderfoot~2']);
  });

  it('ParseGroupKey_ReadsRankAndBadgeSections', () => {
    expect([parseGroupKey('fr:tenderfoot~2'), parseGroupKey('fr:mb:first-aid~3'), parseGroupKey('fr:scout')]).toEqual([
      { base: 'fr:tenderfoot', section: 2, kind: 'rank', refId: 'tenderfoot' },
      { base: 'fr:mb:first-aid', section: 3, kind: 'badge', refId: 'first-aid' },
      { base: 'fr:scout', section: 1, kind: 'rank', refId: 'scout' }
    ]);
  });

  it('ParseGroupKey_RejectsGroup4AndNonGroupKeys', () => {
    expect([parseGroupKey('fr:tenderfoot~4'), parseGroupKey('fr:tenderfoot~1'), parseGroupKey('tenderfoot-4a'), parseGroupKey('fg:12')]).toEqual([null, null, null, null]);
  });

  it('CanonicalGroupKey_ReadsASectionAsItsBase_OnlyWhileMerged', () => {
    const merged = new Set([TF]);
    expect([canonicalGroupKey(TF2, merged), canonicalGroupKey(TF2, new Set()), canonicalGroupKey('tenderfoot-4a', merged)]).toEqual([TF, TF2, 'tenderfoot-4a']);
  });

  it('TopicWords_WithTheMeetingsSplits_NamesGroup1AndMergedGroups', () => {
    const split = { groups: new Map([[TF, 2]]) };
    const merged = { groups: new Map<string, number>() };
    expect([
      topicWords(TF, RANKS, RANK_REQS, MBS, undefined, split)?.label,
      topicWords(TF2, RANKS, RANK_REQS, MBS, undefined, split)?.label,
      topicWords(TF2, RANKS, RANK_REQS, MBS, undefined, merged)?.label,
      topicWords(TF, RANKS, RANK_REQS, MBS, undefined, merged)?.label
    ]).toEqual(['Tenderfoot Group 1', 'Tenderfoot Group 2', 'Tenderfoot group', 'Tenderfoot group']);
  });

  it('TopicWords_NamesASectionTenderfootGroup2', () => {
    expect(topicWords(TF2, RANKS, RANK_REQS, MBS)?.label).toBe('Tenderfoot Group 2');
  });
});

describe('split groups', () => {
  it('Planner_SeesTwoTenderfootGroups_WhenTheRankIsSplit', () => {
    const p = plan([], TF_FOCUS, { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']) });
    expect(p.groups.map((g) => [g.key, g.name, g.label, g.base, g.section, g.sections])).toEqual([
      [TF, 'Tenderfoot', 'Tenderfoot Group 1', TF, 1, 2],
      [TF2, 'Tenderfoot', 'Tenderfoot Group 2', TF, 2, 2]
    ]);
  });

  it('UnsplitGroup_LabelIsTheRankName', () => {
    const g = plan([], TF_FOCUS).groups[0];
    expect([g.label, g.section, g.sections, g.base]).toEqual(['Tenderfoot', 1, 1, TF]);
  });

  it('Placement_PutsScoutInTheGroupTheyNeedMostOf_WhenSplit', () => {
    // Group 1 = 1 (15) + 3 (60); Group 2 = 2 (15). Fit = the share of a group's minutes the scout still needs.
    const fresh = scout('scout');
    const ahead = scout('scout');
    const p = plan([fresh, ahead], TF_FOCUS, {
      splits: split(TF, ['tenderfoot-1', 'tenderfoot-3'], ['tenderfoot-2']),
      done: { [ahead.scoutId]: done(['tenderfoot-1', 'tenderfoot-3']) }
    });
    expect([rowOf(p, fresh).groupKey, rowOf(p, ahead).groupKey]).toEqual([TF, TF2]);
  });

  it('Placement_PicksLowerGroup_WhenFitTies', () => {
    const s = scout('scout');
    const p = plan([s], ['tenderfoot-1', 'tenderfoot-2'], { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2']) });
    expect(rowOf(p, s).groupKey).toBe(TF);
  });

  it('Placement_LeavesUnclaimedFocusInGroup1_WhenGroup2ClaimsSome', () => {
    const p = plan([], TF_FOCUS, { splits: split(TF, [], ['tenderfoot-2']) });
    expect([colsOf(p, TF), colsOf(p, TF2)]).toEqual([['tenderfoot-1', 'tenderfoot-3'], ['tenderfoot-2']]);
  });

  it('NewFocusItem_LandsInGroup1_AfterSplit', () => {
    const p = plan([], [...TF_FOCUS, 'tenderfoot-4a'], { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']) });
    expect(colsOf(p, TF)).toEqual(['tenderfoot-1', 'tenderfoot-4a']);
  });

  it('SectionClaim_CoversAFocusKeyUnderAListedAncestor', () => {
    const p = plan([], ['tenderfoot-1', 'tenderfoot-4a'], { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-4']) });
    expect(colsOf(p, TF2)).toEqual(['tenderfoot-4a']);
  });

  it('NewScout_NeedingEverything_GoesToGroup1_NotTheBiggerGroup', () => {
    // Group 1 = 1 (15); Group 2 = 2 + 3 (75). Both fit 100%: the lower group, whatever the minutes.
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']) });
    expect(rowOf(p, s).groupKey).toBe(TF);
  });

  it('SharedColumn_CountsInBothGroups_ScoutPlacedByFit', () => {
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, {
      splits: split(TF, ['tenderfoot-1', 'tenderfoot-2'], ['tenderfoot-2', 'tenderfoot-3']),
      done: { [s.scoutId]: done(['tenderfoot-1']) }
    });
    expect([colsOf(p, TF), colsOf(p, TF2), rowOf(p, s).groupKey]).toEqual([['tenderfoot-1', 'tenderfoot-2'], ['tenderfoot-2', 'tenderfoot-3'], TF2]);
  });

  it('SplitGroup_DropsItemsNoLongerInTheFocus_AndStillShowsAnEmptyGroup', () => {
    const p = plan([], ['tenderfoot-1'], { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2']) });
    expect([colsOf(p, TF), colsOf(p, TF2)]).toEqual([['tenderfoot-1'], []]);
  });

  it('HandMove_ToGroup2_OutranksPlacement', () => {
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, { splits: split(TF, ['tenderfoot-1', 'tenderfoot-3'], ['tenderfoot-2']), roles: new Map([[s.personId, { role: 'group', key: TF2 }]]) });
    expect([rowOf(p, s).groupKey, rowOf(p, s).status]).toEqual([TF2, 'rank-work']);
  });

  it('HandMove_ToGroup1_StaysInGroup1', () => {
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, {
      splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']),
      roles: new Map([[s.personId, { role: 'group', key: TF }]])
    });
    expect(rowOf(p, s).groupKey).toBe(TF);
  });

  it('FamilyPick_OfTheBaseKey_RePlacesBySectionFit', () => {
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, {
      splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']),
      picks: new Map([[s.personId, [TF]]]),
      done: { [s.scoutId]: done(['tenderfoot-1']) }
    });
    expect(rowOf(p, s).groupKey).toBe(TF2);
  });

  it('HandMove_ToAGroupThatNoLongerExists_FallsToBestSectionOfTheRank', () => {
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']), roles: new Map([[s.personId, { role: 'group', key: TF3 }]]), done: { [s.scoutId]: done(['tenderfoot-1']) } });
    expect(rowOf(p, s).groupKey).toBe(TF2);
  });

  it('Merge_ReadsGroup2KeysAsTheMergedGroup', () => {
    const [a, b, c] = [scout('scout'), scout('scout'), scout('second-class')];
    const p = plan([a, b, c], TF_FOCUS, {
      splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2']),
      mergedBases: new Set([TF]),
      roles: new Map([[a.personId, { role: 'group', key: TF2 }]]),
      picks: new Map([[b.personId, [TF2]]]),
      helpers: new Map([[c.personId, TF2]])
    });
    expect([p.groups.map((g) => [g.key, g.label]), [a, b, c].map((s) => rowOf(p, s).groupKey)]).toEqual([[[TF, 'Tenderfoot']], [TF, TF, TF]]);
  });

  it('Split_RestoresGroup2Members_AfterMergeThenSplit', () => {
    const s = scout('scout');
    const roles = new Map([[s.personId, { role: 'group' as const, key: TF2 }]]);
    const splits = split(TF, ['tenderfoot-1'], ['tenderfoot-2']);
    const merged = plan([s], TF_FOCUS, { splits, roles, mergedBases: new Set([TF]) });
    const again = plan([s], TF_FOCUS, { splits, roles });
    expect([rowOf(merged, s).groupKey, rowOf(again, s).groupKey]).toEqual([TF, TF2]);
  });

  it('OwnRankDoneInGroup1_ButOpenInGroup2_IsRankWorkNotNothing', () => {
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']), done: { [s.scoutId]: done(['tenderfoot-2', 'tenderfoot-3']) } });
    expect([rowOf(p, s).groupKey, rowOf(p, s).status]).toEqual([TF, 'rank-work']);
  });

  it('EverythingDoneAcrossSections_IsNothing_WithHomeInTheRank', () => {
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']), done: { [s.scoutId]: done(['tenderfoot-1', 'tenderfoot-2', 'tenderfoot-3']) } });
    const r = rowOf(p, s);
    expect([r.status, r.allDone, r.homeKey && parseGroupKey(r.homeKey)?.base]).toEqual(['nothing', true, TF]);
  });

  it('WorkingAhead_StillStepsOneRank_WhenNextRankIsSplit', () => {
    const s = scout(null); // works on Scout; done with it → Tenderfoot, never Tenderfoot Group 2 as "the next group"
    const p = plan([s], ['scout-1', ...TF_FOCUS], {
      splits: split(TF, ['tenderfoot-1', 'tenderfoot-3'], ['tenderfoot-2']),
      done: { [s.scoutId]: done(['scout-1']) }
    });
    expect(rowOf(p, s).groupKey).toBe(TF);
  });

  it('NoSizeLimit_HandMoveIntoGroupOf20_Works', () => {
    const many = Array.from({ length: 20 }, () => scout('scout'));
    const p = plan(many, TF_FOCUS, { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2']), roles: new Map(many.map((s) => [s.personId, { role: 'group' as const, key: TF2 }])) });
    expect(p.groups.find((g) => g.key === TF2)!.members).toHaveLength(20);
  });

  it('Level_PutsAScoutWhoHasDoneMore_InGroup2_EvenWhenGroup1FitsToo', () => {
    // Group 2 is for scouts with 2+ Tenderfoot requirements done. Both groups' work is open for both scouts.
    const [fresh, ahead] = [scout('scout'), scout('scout')];
    const p = plan([fresh, ahead], ['tenderfoot-1', 'tenderfoot-2'], {
      splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2']),
      splitLevels: new Map([[TF, [0, 2]]]),
      done: { [ahead.scoutId]: done(['tenderfoot-4a', 'tenderfoot-4b']) }
    });
    expect([rowOf(p, fresh).groupKey, rowOf(p, ahead).groupKey, p.groups.map((g) => g.fromDone)]).toEqual([TF, TF2, [0, 2]]);
  });

  it('Level_FallsToBestFit_WhenNothingIsOpenAtTheScoutsLevel', () => {
    const s = scout('scout');
    const p = plan([s], ['tenderfoot-1', 'tenderfoot-2'], {
      splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2']),
      splitLevels: new Map([[TF, [0, 2]]]),
      done: { [s.scoutId]: done(['tenderfoot-2', 'tenderfoot-3']) }
    });
    expect(rowOf(p, s).groupKey).toBe(TF);
  });

  it('LevelsAllZero_UseFit', () => {
    const s = scout('scout');
    const p = plan([s], TF_FOCUS, { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2', 'tenderfoot-3']), splitLevels: new Map([[TF, [0, 0]]]), done: { [s.scoutId]: done(['tenderfoot-1']) } });
    expect(rowOf(p, s).groupKey).toBe(TF2);
  });

  it('ThreeSections_AllShow_InOrder', () => {
    const p = plan([], TF_FOCUS, { splits: split(TF, ['tenderfoot-1'], ['tenderfoot-2'], ['tenderfoot-3']) });
    expect(p.groups.map((g) => g.label)).toEqual(['Tenderfoot Group 1', 'Tenderfoot Group 2', 'Tenderfoot Group 3']);
  });

  it('BadgeGroupKey_WithSectionSuffix_ParsesAndPlaces', () => {
    const fa = badgeGroupKey('first-aid');
    const s = scout('first-class');
    const p = plan([s], ['first-aid-1', 'first-aid-2'], { splits: split(fa, ['first-aid-1'], ['first-aid-2']), done: { [s.scoutId]: done([], ['first-aid-1']) } });
    expect([p.groups.map((g) => g.label), rowOf(p, s).groupKey]).toEqual([['First Aid Group 1', 'First Aid Group 2'], sectionGroupKey(fa, 2)]);
  });
});
