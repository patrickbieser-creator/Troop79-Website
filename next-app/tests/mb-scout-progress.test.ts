import { describe, it, expect } from 'vitest';
import {
  foldLedger,
  startedScouts,
  mbStats,
  gridGroups,
  rankLabel,
  MB_GRID_MODES,
  DEFAULT_MB_GRID_MODE,
  isMbGridMode,
  mbGridCaption,
  earnedByBadge,
  type MbLedgerRow,
  type MbScoutLike
} from '../src/lib/mb-scout-progress';
import { buildReqTree, flattenLeaves } from '../src/lib/mb-helpers';
import type { MeritBadgeRequirement } from '../src/lib/supabase/types';

/**
 * The merit badge tracker's data fold, extracted so the Library can carry it
 * (Patrick, 2026-08-22: fold the tracker into /library/mb/[mbId] and retire
 * /merit-badges).
 *
 * This exact fold existed BYTE-FOR-BYTE in two places — the public tracker
 * page and the admin MB Progress drill-in. The public copy is being deleted
 * with its route; these tests are written against the extraction so the admin
 * side has a tested module to adopt in its follow-up (Plans/, admin ships
 * unchanged in this pass).
 *
 * The load-bearing detail is the COMPOSITE CODE convention: a merit badge
 * award is `MB:{mbId}` on kind `merit_badge_award`, and requirement progress
 * is `{mbId}-{code}`. Slicing the prefix off wrongly is the failure mode that
 * silently shows every scout as having done nothing.
 */

const MB = 'archery';

function req(id: number, code: string, label: string, parent_id: number | null = null): MeritBadgeRequirement {
  return { id, mb_id: MB, parent_id, code, label } as MeritBadgeRequirement;
}

const REQS: MeritBadgeRequirement[] = [
  req(1, '1', 'Safety'),
  req(2, '1a', 'Explain a projectile', 1),
  req(3, '1b', 'Range safety rules', 1),
  req(4, '2', 'Arrows'),
  req(5, '2a', 'Parts of an arrow', 4)
];

const SCOUTS: MbScoutLike[] = [
  { id: 's1', first_name: 'Ben', last_name: 'Kowalski', current_rank: 'first-class' },
  { id: 's2', first_name: 'Quinn', last_name: 'Barry', current_rank: 'second-class' },
  { id: 's3', first_name: 'Piper', last_name: 'Kingston', current_rank: null }
];

const LEDGER: MbLedgerRow[] = [
  { scout_id: 's1', kind: 'merit_badge_award', code: `MB:${MB}` },
  { scout_id: 's1', kind: 'mb_requirement', code: `${MB}-1a` },
  { scout_id: 's2', kind: 'mb_requirement', code: `${MB}-1a` },
  { scout_id: 's2', kind: 'mb_requirement', code: `${MB}-2a` }
];

describe('mb scout progress — folding the ledger (pure)', () => {
  it('FoldLedger_MarksAScoutAwarded_OnTheMbAwardCode', () => {
    expect(foldLedger(LEDGER, MB).get('s1')?.awarded).toBe(true);
    expect(foldLedger(LEDGER, MB).get('s2')?.awarded).toBe(false);
  });

  it('FoldLedger_StripsTheBadgePrefix_FromRequirementCodes', () => {
    // The failure mode this guards: an off-by-one slice turns "archery-1a"
    // into "-1a" and every cell reads as not-done while the data is perfect.
    expect([...(foldLedger(LEDGER, MB).get('s2')?.codes ?? [])].sort()).toEqual(['1a', '2a']);
  });

  it('FoldLedger_IgnoresAnotherBadgesCodes', () => {
    const mixed: MbLedgerRow[] = [
      ...LEDGER,
      { scout_id: 's3', kind: 'mb_requirement', code: 'cooking-1a' },
      { scout_id: 's3', kind: 'merit_badge_award', code: 'MB:cooking' }
    ];
    const folded = foldLedger(mixed, MB);
    // s3 appears (the row was handed to us) but carries nothing for THIS badge.
    expect(folded.get('s3')?.codes.size ?? 0).toBe(0);
    expect(folded.get('s3')?.awarded ?? false).toBe(false);
  });

  it('FoldLedger_DoesNotTreatAnAwardCodeAsARequirement', () => {
    expect(foldLedger(LEDGER, MB).get('s1')?.codes.has(`MB:${MB}`)).toBe(false);
  });

  it('FoldLedger_ReturnsAnEmptyMap_ForNoRows', () => {
    expect(foldLedger([], MB).size).toBe(0);
  });

  it('FoldLedger_HandlesABadgeIdContainingAHyphen', () => {
    // "citizenship-in-society-1a" must slice to "1a", not "in-society-1a".
    const rows: MbLedgerRow[] = [
      { scout_id: 's1', kind: 'mb_requirement', code: 'citizenship-in-society-1a' }
    ];
    expect([...foldLedger(rows, 'citizenship-in-society').get('s1')!.codes]).toEqual(['1a']);
  });
});

describe('mb scout progress — who appears (pure)', () => {
  it('StartedScouts_KeepsOnlyScoutsWithProgress_InTheOrderGiven', () => {
    const folded = foldLedger(LEDGER, MB);
    expect(startedScouts(SCOUTS, folded).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('StartedScouts_ReturnsEmpty_WhenNobodyHasStarted', () => {
    expect(startedScouts(SCOUTS, foldLedger([], MB))).toEqual([]);
  });
});

describe('mb scout progress — the stat strip (pure)', () => {
  it('MbStats_CountsEarnedInProgressAndNotStarted', () => {
    const folded = foldLedger(LEDGER, MB);
    expect(mbStats(startedScouts(SCOUTS, folded), folded, 28)).toEqual({
      earned: 1,
      inProgress: 1,
      notStarted: 26,
      totalActive: 28
    });
  });

  it('MbStats_NeverReportsNegativeNotStarted', () => {
    // An inactive scout with history can make started > active. Reporting
    // "-3 not started" is worse than clamping.
    const folded = foldLedger(LEDGER, MB);
    expect(mbStats(startedScouts(SCOUTS, folded), folded, 1).notStarted).toBe(0);
  });

  it('MbStats_ReportsAllNotStarted_WhenNobodyHasTouchedTheBadge', () => {
    expect(mbStats([], new Map(), 28)).toEqual({
      earned: 0,
      inProgress: 0,
      notStarted: 28,
      totalActive: 28
    });
  });
});

describe('mb scout progress — the grid header (pure)', () => {
  const tree = buildReqTree(REQS);
  const leaves = flattenLeaves(tree);

  it('GridGroups_MakesOneColumnGroupPerTopLevelRequirement', () => {
    const { groups } = gridGroups(tree, leaves);
    expect(groups.map((g) => [g.topCode, g.spans])).toEqual([
      ['1', 2],
      ['2', 1]
    ]);
  });

  it('GridGroups_MarksTheFirstLeafOfEachGroup_ForTheSeparatorRule', () => {
    const { groupStartCodes } = gridGroups(tree, leaves);
    expect([...groupStartCodes].sort()).toEqual(['1a', '2a']);
  });

  it('GridGroups_SkipsATopLevelRequirementWithNoLeaves', () => {
    const withEmpty = buildReqTree([...REQS, req(9, '3', 'Nothing under here')]);
    const { groups } = gridGroups(withEmpty, flattenLeaves(withEmpty));
    // A childless top-level req IS its own leaf, so it earns a group — what
    // must not happen is a group claiming zero columns and breaking colSpan.
    for (const g of groups) expect(g.spans).toBeGreaterThan(0);
  });

  it('GridGroups_ReturnsNothing_ForABadgeWithNoRequirements', () => {
    expect(gridGroups([], []).groups).toEqual([]);
  });
});

describe('mb scout progress — rank label (pure)', () => {
  it('RankLabel_RendersTheDisplayName_NotTheSlug', () => {
    expect(rankLabel('second-class')).toBe('Second Class');
    expect(rankLabel('first-class')).toBe('First Class');
    expect(rankLabel('eagle')).toBe('Eagle');
  });

  it('RankLabel_FallsBackToTheRawValue_ForAnUnknownRank', () => {
    expect(rankLabel('brand-new-rank')).toBe('brand-new-rank');
  });

  it('RankLabel_ReturnsNull_WhenTheScoutHasNoRank', () => {
    expect(rankLabel(null)).toBe(null);
  });
});

describe('mb grid mode — the library catalog toggle (pure)', () => {
  it('MbGridModes_AreResourcesAndProgress_WithResourcesDefault', () => {
    // Patrick, 2026-08-22: one number on the tile, switchable meaning —
    // rather than the retired catalog's Earned/In-progress/Not-started triple
    // across 69 tiles, where In-progress is zero on 56 of them.
    expect(MB_GRID_MODES).toEqual(['resources', 'progress']);
    expect(DEFAULT_MB_GRID_MODE).toBe('resources');
  });

  it('IsMbGridMode_RejectsAnythingUnknown_SoAUrlCannotInventAMode', () => {
    expect(isMbGridMode('progress')).toBe(true);
    expect(isMbGridMode('earned')).toBe(false);
    expect(isMbGridMode(null)).toBe(false);
    expect(isMbGridMode('')).toBe(false);
  });

  it('MbGridCaption_SaysWhatTheNumberCounts_InBothModes', () => {
    // A bare integer on a tile is ambiguous once it can mean two things.
    expect(mbGridCaption('resources')).toMatch(/resource/i);
    expect(mbGridCaption('progress')).toMatch(/earned/i);
  });
});

describe('mb grid — earned counts must agree with the badge page (pure)', () => {
  it('EarnedByBadge_CountsActiveScoutsOnly_NotEveryAwardEverRecorded', () => {
    // Found in dev 2026-08-22: the grid said Archery 12 while the badge page
    // one click away said 6 earned. Both numbers were "right" — the grid
    // counted every award in mb_progress, the badge page counts ACTIVE scouts.
    // Two different nouns one click apart. The badge page's is the honest one:
    // "how many scouts in the troop have earned this".
    const awarded = [
      { mb_id: 'archery', scout_id: 'active-1' },
      { mb_id: 'archery', scout_id: 'active-2' },
      { mb_id: 'archery', scout_id: 'aged-out-1' },
      { mb_id: 'cooking', scout_id: 'active-1' }
    ];
    const active = new Set(['active-1', 'active-2']);
    const counts = earnedByBadge(awarded, active);
    expect(counts.get('archery')).toBe(2);
    expect(counts.get('cooking')).toBe(1);
  });

  it('EarnedByBadge_OmitsABadgeOnlyAgedOutScoutsEverEarned', () => {
    const counts = earnedByBadge([{ mb_id: 'basketry', scout_id: 'gone' }], new Set(['here']));
    expect(counts.get('basketry')).toBeUndefined();
  });

  it('EarnedByBadge_ReturnsAnEmptyMap_ForNoRows', () => {
    expect(earnedByBadge([], new Set(['a'])).size).toBe(0);
  });
});
