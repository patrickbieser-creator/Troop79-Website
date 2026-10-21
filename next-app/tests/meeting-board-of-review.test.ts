import { describe, it, expect } from 'vitest';
import { buildPickList, isPickFinished, isPickOutOfReach, pickableKeys, rankTrees, topicWords } from '../src/lib/meeting-board-picklist';
import { rankBorPickable, rankLeafCompletion, rankTopPlannable } from '../src/lib/rank-calculus';
import { assessTeacher } from '../src/lib/meeting-board-teach';
import { sessionWords } from '../src/lib/meeting-board-match';
import { buildReqTree } from '../src/lib/mb-helpers';
import type { CatalogRank, CatalogRankRequirement } from '../src/lib/advancement-catalog';

/**
 * A board of review on the meeting board (Patrick, 2026-10-21): "The board of review can't be offered unless all other
 * requirements are completed for a rank" and "board of review should be pickable when allowed". The key is
 * '<rankId>-BoR' (the ledger's code); there is no catalog row. One rule, rankBorPickable, feeds the pick list,
 * pickableKeys, likely fits (isPickOutOfReach) and the nudge list.
 */
const RANKS: CatalogRank[] = [
  { id: 'scout', display_name: 'Scout', sort_order: 0 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 1 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 2 }
];
let rid = 0;
const req = (rank_id: string, code: string, label: string, o: Partial<CatalogRankRequirement> = {}): CatalogRankRequirement => ({
  id: ++rid,
  rank_id,
  parent_id: null,
  code,
  label,
  complete_rule: 'all',
  complete_n: null,
  sort_order: rid,
  venue: 'either',
  skill_id: null,
  ...o
});
const TF4 = req('tenderfoot', '4a', 'First aid');
// Tenderfoot: a group with two parts, a knot, Scout spirit (never planned) and the Scoutmaster conference.
const REQS: CatalogRankRequirement[] = [
  TF4,
  req('tenderfoot', '4a.1', 'Cuts', { parent_id: TF4.id }),
  req('tenderfoot', '4a.2', 'Blisters', { parent_id: TF4.id }),
  req('tenderfoot', '3a', 'Knots'),
  req('tenderfoot', '9', 'Scout spirit'),
  req('tenderfoot', '10', 'Scoutmaster conference'),
  req('second-class', '2a', 'Map and compass')
];
const ALL_TF = ['tenderfoot-4a.1', 'tenderfoot-4a.2', 'tenderfoot-3a', 'tenderfoot-9', 'tenderfoot-10'];
const view = (codes: string[]) => buildPickList({ currentRank: 'scout', ranks: RANKS, rankReqs: REQS, mbs: [], mbProgress: [], rankCodes: new Set(codes) });
const ctx = (codes: string[]) => ({ currentRank: 'scout', ranks: RANKS, trees: rankTrees(REQS), rankCodes: new Set(codes), awardedMbs: new Set<string>() });

describe('when a board of review can be picked', () => {
  it('BoR_IsNotPickable_UntilEveryOtherRequirementIsDone', () => {
    // Everything but Scout spirit: the conference is done, Scout spirit (not plannable) isn't.
    const codes = ALL_TF.filter((c) => c !== 'tenderfoot-9');
    expect([pickableKeys(view(codes)).has('tenderfoot-BoR'), isPickOutOfReach('tenderfoot-BoR', ctx(codes)), rankBorPickable(rankTrees(REQS).get('tenderfoot')!, 'tenderfoot', new Set(codes))]).toEqual([false, true, false]);
  });

  it('BoR_IsPickable_WhenAllOtherRequirementsAreDone', () => {
    const v = view(ALL_TF);
    const row = v.groups.find((g) => g.rankId === 'tenderfoot')?.rows.find((r) => r.key === 'tenderfoot-BoR');
    expect([row?.label, row?.codeLabel, pickableKeys(v).has('tenderfoot-BoR'), isPickOutOfReach('tenderfoot-BoR', ctx(ALL_TF))]).toEqual(['Board of review', 'Tenderfoot board of review', true, false]);
  });

  it('BoR_IsPickable_WhenOnlyTheSmConferenceIsLeft', () => {
    // Patrick, 2026-10-21: the conference and the board are often the same evening, so the board doesn't wait for it.
    const codes = ALL_TF.filter((c) => c !== 'tenderfoot-10');
    expect([pickableKeys(view(codes)).has('tenderfoot-BoR'), isPickOutOfReach('tenderfoot-BoR', ctx(codes))]).toEqual([true, false]);
  });

  it('BoR_IsGone_OnceOnTheLedger', () => {
    const codes = [...ALL_TF, 'tenderfoot-BoR'];
    expect([pickableKeys(view(codes)).has('tenderfoot-BoR'), isPickFinished('tenderfoot-BoR', ctx(codes))]).toEqual([false, true]);
  });

  it('BoR_IsGone_OnceTheScoutHoldsTheRank', () => {
    expect(isPickFinished('tenderfoot-BoR', { ...ctx([]), currentRank: 'tenderfoot' })).toBe(true);
  });

  it('ScoutRank_HasNoBoardOfReview', () => {
    expect(rankBorPickable([], 'scout', new Set())).toBe(false);
  });
});

describe('the Scoutmaster conference 95%', () => {
  it('BoR_DoesNotCountTowardTheSmConference95', () => {
    // A catalog that (wrongly) still had a BoR leaf: it must not hold the conference back.
    const withBor = buildReqTree([...REQS.filter((r) => r.rank_id === 'tenderfoot'), req('tenderfoot', 'BoR', 'Board of review')]);
    const codes = new Set(['tenderfoot-4a.1', 'tenderfoot-4a.2', 'tenderfoot-3a', 'tenderfoot-9']);
    const sm = withBor.find((n) => n.code === '10')!;
    expect([rankLeafCompletion(withBor, 'tenderfoot', codes, '10'), rankTopPlannable(withBor, 'tenderfoot', sm, codes)]).toEqual([1, true]);
  });
});

describe('words and teachers', () => {
  it('BoR_Words_AreTheRanksBoardOfReview', () => {
    const w = topicWords('second-class-BoR', RANKS, REQS, []);
    expect([w?.label, w?.codeLabel, w?.kind]).toEqual(['Board of review', 'Second Class board of review', 'rank']);
  });

  it('BoR_InAMatchedSession_ReadsTenderfootBoardOfReview', () => {
    const w = sessionWords(['tenderfoot-BoR'], { ranks: RANKS, rankRequirements: REQS, meritBadges: [] }, new Map());
    expect([w.title, w.codeLabel]).toEqual(['Board of review', 'Tenderfoot board of review']);
  });

  it('AnyoneMayRunABoR_WithNoFlags', () => {
    const junior = { personId: 1, kind: 'junior' as const, displayName: 'Maya S', firstName: 'Maya', lastName: 'S', gender: null, skills: new Set<string>(), counselorFor: new Set<string>(), currentRank: 'scout', rankCodes: new Set<string>() };
    expect(assessTeacher(junior, 'tenderfoot-BoR', { ranks: RANKS, rankReqs: REQS, trees: rankTrees(REQS), youthTeachable: new Map() })).toEqual({ qualified: true, flags: [], refused: false });
  });
});
