import { describe, it, expect } from 'vitest';
import { buildReqTree } from '../src/lib/mb-helpers';
import { rankTopPlannable } from '../src/lib/rank-calculus';
import { isPickOutOfReach } from '../src/lib/meeting-board-picklist';
import type { CatalogRank, CatalogRankRequirement } from '../src/lib/advancement-catalog';

/**
 * Every rank's Scoutmaster conference waits for 95% of the rank (Patrick, 2026-10-21: Anjali was offered Star's before
 * she was close). The codes are the catalog's: scout 7, tenderfoot 10, second-class 11, first-class 12, star 7,
 * life 7, eagle 6.
 */
let rid = 0;
const req = (rank_id: string, code: string, label: string): CatalogRankRequirement => ({
  id: ++rid,
  rank_id,
  parent_id: null,
  code,
  label,
  complete_rule: 'all',
  complete_n: null,
  sort_order: rid,
  venue: 'either',
  skill_id: null
});

const SMC: [string, string][] = [
  ['scout', '7'],
  ['tenderfoot', '10'],
  ['second-class', '11'],
  ['first-class', '12'],
  ['star', '7'],
  ['life', '7'],
  ['eagle', '6']
];
// Twenty other requirements per rank, so 19 of 20 done is exactly 95%.
const others = (rankId: string) => Array.from({ length: 20 }, (_, i) => req(rankId, `x${i + 1}`, `Other ${i + 1}`));
const treeOf = (rankId: string, code: string) => buildReqTree([...others(rankId), req(rankId, code, 'Scoutmaster conference')]);
const smcOf = (rankId: string, code: string) => treeOf(rankId, code).find((n) => n.code === code)!;
const done = (rankId: string, n: number) => new Set(Array.from({ length: n }, (_, i) => `${rankId}-x${i + 1}`));

describe('Scoutmaster conference gate', () => {
  it.each(SMC)('SmConference_%s_%s_WaitsUntil95Percent', (rankId, code) => {
    expect(rankTopPlannable(treeOf(rankId, code), rankId, smcOf(rankId, code), done(rankId, 18))).toBe(false);
  });

  it.each(SMC)('SmConference_%s_%s_IsPlannableAt95Percent', (rankId, code) => {
    expect(rankTopPlannable(treeOf(rankId, code), rankId, smcOf(rankId, code), done(rankId, 19))).toBe(true);
  });
});

describe('likely fits leave out what a scout can’t take up yet', () => {
  const RANKS: CatalogRank[] = [
    { id: 'first-class', display_name: 'First Class', sort_order: 3 },
    { id: 'star', display_name: 'Star', sort_order: 4 }
  ];
  const ctx = (n: number) => ({ currentRank: 'first-class', ranks: RANKS, trees: new Map([['star', treeOf('star', '7')]]), rankCodes: done('star', n), awardedMbs: new Set<string>() });

  it('StarConference_IsOutOfReach_ForAScoutFarFromStar', () => {
    expect(isPickOutOfReach('star-7', ctx(2))).toBe(true);
  });

  it('StarConference_IsInReach_ForAScoutAt95Percent', () => {
    expect(isPickOutOfReach('star-7', ctx(19))).toBe(false);
  });

  it('AFinishedRequirement_IsOutOfReach', () => {
    expect(isPickOutOfReach('star-x1', ctx(2))).toBe(true);
  });
});
