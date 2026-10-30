import { describe, it, expect } from 'vitest';
import { checkReviewers, defaultReviewers, reviewCandidates, reviewerOptions, reviewRule, type Reviewer } from '../src/lib/planner-reviews';

/**
 * Suggestions' lead list (Patrick, 2026-10-29): scouts who have only the Scoutmaster conference and/or the board of
 * review left for their next rank, and who may sit each one. Pure.
 */
const RANKS = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 },
  { id: 'star', display_name: 'Star', sort_order: 5 },
  { id: 'life', display_name: 'Life', sort_order: 6 },
  { id: 'eagle', display_name: 'Eagle', sort_order: 7 }
];
const leaf = (code: string) => ({ code, complete_rule: 'all', complete_n: null, children: [] });
const group = (code: string, rule: string, kids: string[]) => ({ code, complete_rule: rule, complete_n: null, children: kids.map(leaf) });
// Tenderfoot: 1 (all of a, b), 2 (any of a, b), 10 the conference, BoR.
const TREES: Record<string, unknown[]> = {
  scout: [leaf('1'), leaf('7')],
  tenderfoot: [group('1', 'all', ['1a', '1b']), group('2', 'any', ['2a', '2b']), leaf('10'), leaf('BoR')]
};
const treeOf = (rankId: string) => (TREES[rankId] ?? []) as never;
const scout = (personId: number, currentRank: string | null, codes: string[]) => ({ personId, name: `Scout ${personId}`, currentRank, codes: new Set(codes) });

describe('reviewCandidates', () => {
  it('OnlyConferenceAndBoardLeft_NeedsBoth', () => {
    const [c] = reviewCandidates([scout(1, 'scout', ['tenderfoot-1a', 'tenderfoot-1b', 'tenderfoot-2b'])], RANKS, treeOf);
    expect([c.rankId, c.needs.map((n) => n.key)]).toEqual(['tenderfoot', ['tenderfoot-10', 'tenderfoot-BoR']]);
  });

  it('ConferenceDone_NeedsOnlyTheBoard', () => {
    const [c] = reviewCandidates([scout(1, 'scout', ['tenderfoot-1a', 'tenderfoot-1b', 'tenderfoot-2a', 'tenderfoot-10'])], RANKS, treeOf);
    expect(c.needs.map((n) => n.kind)).toEqual(['bor']);
  });

  it('SomethingElseLeft_IsNotACandidate', () => {
    expect(reviewCandidates([scout(1, 'scout', ['tenderfoot-1a', 'tenderfoot-2a'])], RANKS, treeOf)).toEqual([]);
  });

  it('ScoutRank_HasAConferenceButNoBoard', () => {
    const [c] = reviewCandidates([scout(1, null, ['scout-1'])], RANKS, treeOf);
    expect(c.needs.map((n) => n.key)).toEqual(['scout-7']);
  });
});

describe('who may review', () => {
  const pool: Reviewer[] = [
    { personId: 10, name: 'Mindy S', kind: 'adult', scoutmaster: true },
    { personId: 11, name: 'Pat B', kind: 'adult' },
    { personId: 12, name: 'Jason P', kind: 'adult' },
    { personId: 20, name: 'Tess T', kind: 'scout', rankOrder: 2 },
    { personId: 21, name: 'Sam S', kind: 'scout', rankOrder: 3 },
    { personId: 22, name: 'Fran F', kind: 'scout', rankOrder: 4 },
    { personId: 23, name: 'Lee L', kind: 'scout', rankOrder: 6 }
  ];
  const ids = (rankId: string, kind: 'smc' | 'bor', self = 0) => {
    const o = reviewerOptions(reviewRule(kind, rankId, RANKS)!, pool, self);
    return { adults: o.adults.map((r) => r.personId), scouts: o.scouts.map((r) => r.personId) };
  };

  it('Conference_IsTheScoutmaster', () => {
    expect(ids('tenderfoot', 'smc')).toEqual({ adults: [10], scouts: [] });
  });

  it('TenderfootBoard_TwoScoutsSecondClassOrAbove', () => {
    expect([reviewRule('bor', 'tenderfoot', RANKS), ids('tenderfoot', 'bor')]).toEqual([{ adults: 0, scouts: 2, scoutMinOrder: 3 }, { adults: [], scouts: [21, 22, 23] }]);
  });

  it('SecondClassBoard_TwoScoutsFirstClassOrAbove', () => {
    expect(ids('second-class', 'bor').scouts).toEqual([22, 23]);
  });

  it('FirstClassBoard_AnAdultAndAFirstClassScout', () => {
    expect([reviewRule('bor', 'first-class', RANKS), ids('first-class', 'bor')]).toEqual([{ adults: 1, scouts: 1, scoutMinOrder: 4 }, { adults: [10, 11, 12], scouts: [22, 23] }]);
  });

  it('StarAndLifeBoards_TwoAdults', () => {
    expect([reviewRule('bor', 'star', RANKS), reviewRule('bor', 'life', RANKS)]).toEqual([
      { adults: 2, scouts: 0, scoutMinOrder: null },
      { adults: 2, scouts: 0, scoutMinOrder: null }
    ]);
  });

  it('EagleBoard_IsNotPlannedHere', () => {
    expect(reviewRule('bor', 'eagle', RANKS)).toBeNull();
  });

  it('TheScoutBeingReviewed_NeverSitsTheirOwnBoard', () => {
    expect(ids('tenderfoot', 'bor', 22).scouts).toEqual([21, 23]);
  });

  it('Defaults_FillTheRule', () => {
    const rule = reviewRule('bor', 'first-class', RANKS)!;
    expect(defaultReviewers(rule, reviewerOptions(rule, pool, 0))).toEqual([10, 22]);
  });

  it('Check_RefusesTheWrongMix', () => {
    const rule = reviewRule('bor', 'second-class', RANKS)!;
    expect([checkReviewers(rule, [22, 23], pool, 1), checkReviewers(rule, [21, 22], pool, 1), checkReviewers(rule, [22], pool, 1)]).toEqual([null, expect.any(String), expect.any(String)]);
  });
});
