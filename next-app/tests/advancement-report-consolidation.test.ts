import { describe, it, expect } from 'vitest';
import {
  cmpCode,
  consolidateGroup,
  datesOutOfRange,
  isDateOutOfRange,
  entriesForScoutSlot,
  buildReport,
  buildScoutView,
  toMarkdown,
  tagKind,
  removeScoutFromReport,
  type AdvancementEntry,
  type AdvancementReport,
  type ScoutStanding
} from '../src/lib/advancement-report';

/**
 * Weekly Advancement Report — consolidation/grouping (Plans/Weekly-Advancement-Report.md).
 *
 * Pure functions, no DB — this is the codebase's Core Business Logic tier
 * (Tests/CLAUDE.md: 100% coverage), and the actual reason this feature is
 * worth building: turning a long flat list of sign-offs into something a
 * family can scan on a heavy week. Ported from
 * prototypes/advancement-report/assets/advancement-data.js, which was
 * built and validated against real heavy-week volume before this file
 * existed (tech-lead review, 2026-08-17) — these tests assert the SAME
 * rules that prototype was already proven against, not a fresh design.
 */

let seq = 0;
function entry(overrides: Partial<AdvancementEntry> & { scoutId: string; scoutName: string }): AdvancementEntry {
  seq++;
  return {
    id: seq,
    code: `c${seq}`,
    label: `Label ${seq}`,
    group: 'group',
    eagle: false,
    enteredAt: '2026-08-10',
    date: '2026-08-10',
    detail: null,
    ...overrides
  };
}

describe('cmpCode', () => {
  it('SortsNumericallyThenByLetterSuffix_MatchingTheSkillsRequirementOrder', () => {
    const codes = ['10', '2b', '2a', '1', '9', '2'];
    expect(codes.slice().sort(cmpCode)).toEqual(['1', '2', '2a', '2b', '9', '10']);
  });
});

describe('consolidateGroup', () => {
  it('RendersASharedRequirement_AsOneLineWithBothScouts_WhenTwoScoutsHoldTheSameCode', () => {
    const lines = consolidateGroup([
      entry({ scoutId: 'S1', scoutName: 'Anita Bendre', code: '1b', label: 'Tread Lightly' }),
      entry({ scoutId: 'S2', scoutName: 'Quinn Barry', code: '1b', label: 'Tread Lightly' })
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].codes).toEqual(['1b']);
    expect(lines[0].scoutNames.slice().sort()).toEqual(['Anita Bendre', 'Quinn Barry']);
  });

  it('RendersASingleSoloRequirement_Normally_WhenAScoutHasOnlyOneReqInTheGroup', () => {
    const lines = consolidateGroup([entry({ scoutId: 'S1', scoutName: 'Solo Scout', code: '3a', label: 'Alone' })]);
    expect(lines).toHaveLength(1);
    expect(lines[0].codes).toEqual(['3a']);
    expect(lines[0].scoutNames).toEqual(['Solo Scout']);
  });

  it('ConsolidatesTwoOrMoreSoloReqs_OntoOneLine_WhenTheSameScoutHoldsThemAlone', () => {
    // The skill's own worked example (SKILL.md): Anita Bendre completes 2a,
    // 2b, 2c solo and shares 1b with Quinn Barry.
    const lines = consolidateGroup([
      entry({ scoutId: 'S1', scoutName: 'Anita Bendre', code: '1b', label: 'Tread Lightly' }),
      entry({ scoutId: 'S2', scoutName: 'Quinn Barry', code: '1b', label: 'Tread Lightly' }),
      entry({ scoutId: 'S1', scoutName: 'Anita Bendre', code: '2a', label: 'Menu planning' }),
      entry({ scoutId: 'S1', scoutName: 'Anita Bendre', code: '2b', label: 'Food budget' }),
      entry({ scoutId: 'S1', scoutName: 'Anita Bendre', code: '2c', label: 'Cooking gear' })
    ]);
    expect(lines).toHaveLength(2);

    const shared = lines.find((l) => l.codes[0] === '1b')!;
    expect(shared.scoutNames.slice().sort()).toEqual(['Anita Bendre', 'Quinn Barry']);

    const consolidated = lines.find((l) => l.codes.length > 1)!;
    expect(consolidated.codes).toEqual(['2a', '2b', '2c']);
    expect(consolidated.labels).toEqual(['Menu planning', 'Food budget', 'Cooking gear']);
    expect(consolidated.scoutNames).toEqual(['Anita Bendre']);
  });

  it('NeverFoldsASharedReq_IntoAnyScoutsConsolidatedLine_EvenWhenThatScoutHasSoloReqsToo', () => {
    // The rule's own edge case: a scout who shares one req AND solos two
    // others must not have the shared one silently swallowed into their
    // consolidated line.
    const lines = consolidateGroup([
      entry({ scoutId: 'S1', scoutName: 'Anita Bendre', code: '1a', label: 'Shared A' }),
      entry({ scoutId: 'S2', scoutName: 'Quinn Barry', code: '1a', label: 'Shared A' }),
      entry({ scoutId: 'S1', scoutName: 'Anita Bendre', code: '2a', label: 'Solo A' }),
      entry({ scoutId: 'S1', scoutName: 'Anita Bendre', code: '2b', label: 'Solo B' })
    ]);
    const shared = lines.find((l) => l.codes[0] === '1a')!;
    expect(shared.scoutNames.slice().sort()).toEqual(['Anita Bendre', 'Quinn Barry']);
    const consolidated = lines.find((l) => l.codes.length > 1)!;
    expect(consolidated.codes).toEqual(['2a', '2b']);
    expect(consolidated.codes).not.toContain('1a');
  });

  it('DedupesTheSameScoutAndCode_WhenTheSameSignOffAppearsTwice', () => {
    const lines = consolidateGroup([
      entry({ scoutId: 'S1', scoutName: 'Dup Scout', code: '1a', label: 'X' }),
      entry({ scoutId: 'S1', scoutName: 'Dup Scout', code: '1a', label: 'X' })
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].scoutNames).toEqual(['Dup Scout']);
  });

  it('SortsRequirementCodesNumerically_NotAlphabetically_WithinAConsolidatedLine', () => {
    const lines = consolidateGroup([
      entry({ scoutId: 'S1', scoutName: 'Order Scout', code: '10', label: 'Ten' }),
      entry({ scoutId: 'S1', scoutName: 'Order Scout', code: '2', label: 'Two' }),
      entry({ scoutId: 'S1', scoutName: 'Order Scout', code: '9', label: 'Nine' })
    ]);
    expect(lines[0].codes).toEqual(['2', '9', '10']);
  });
});

describe('entriesForScoutSlot', () => {
  it('ReturnsOneEntry_ForASharedOrSingleSoloLine_WhereScoutsAndEntriesAre1to1', () => {
    const lines = consolidateGroup([
      entry({ scoutId: 'S1', scoutName: 'A', code: '1a', label: 'X' }),
      entry({ scoutId: 'S2', scoutName: 'B', code: '1a', label: 'X' })
    ]);
    expect(entriesForScoutSlot(lines[0], 0)).toHaveLength(1);
    expect(entriesForScoutSlot(lines[0], 1)).toHaveLength(1);
  });

  it('ReturnsAllJoinedEntries_ForAConsolidatedLine_RegardlessOfScoutIndex', () => {
    const lines = consolidateGroup([
      entry({ scoutId: 'S1', scoutName: 'Solo', code: '2a', label: 'A' }),
      entry({ scoutId: 'S1', scoutName: 'Solo', code: '2b', label: 'B' })
    ]);
    expect(entriesForScoutSlot(lines[0], 0)).toHaveLength(2);
  });
});

describe('datesOutOfRange (Decision 4, 2026-08-17)', () => {
  const range = { startDate: '2026-08-10', endDate: '2026-08-17' };

  it('ReturnsNothing_WhenTheEarnedDateFallsInsideTheReportRange', () => {
    const e = entry({ scoutId: 'S1', scoutName: 'A', date: '2026-08-14' });
    expect(datesOutOfRange([e], range)).toEqual([]);
  });

  it('ReturnsTheDate_WhenEarnedBeforeTheReportStarts_ThePatrickBackfillCase', () => {
    // Patrick's own motivating example: credit for something completed a
    // year ago, now correctly recorded.
    const e = entry({ scoutId: 'S1', scoutName: 'Marcus Whitfield', date: '2025-06-02' });
    expect(datesOutOfRange([e], range)).toEqual(['2025-06-02']);
  });

  it('ReturnsTheDate_WhenEarnedAfterTheReportEnds', () => {
    const e = entry({ scoutId: 'S1', scoutName: 'A', date: '2026-09-01' });
    expect(datesOutOfRange([e], range)).toEqual(['2026-09-01']);
  });

  it('TreatsTheRangeBoundariesAsInclusive_NotOutOfRange', () => {
    const start = entry({ scoutId: 'S1', scoutName: 'A', date: range.startDate });
    const end = entry({ scoutId: 'S1', scoutName: 'A', date: range.endDate });
    expect(datesOutOfRange([start, end], range)).toEqual([]);
  });

  it('DeduplicatesRepeatedOutOfRangeDates_AcrossMultipleEntries', () => {
    const a = entry({ scoutId: 'S1', scoutName: 'A', date: '2025-06-02' });
    const b = entry({ scoutId: 'S1', scoutName: 'A', date: '2025-06-02' });
    expect(datesOutOfRange([a, b], range)).toEqual(['2025-06-02']);
  });

  it('IsIndifferentToEnteredAt_OnlyComparesTheEarnedDateAgainstTheRange', () => {
    // Not "does date differ from enteredAt" — an entry entered TODAY but
    // earned inside the range must stay dateless even though enteredAt and
    // date differ.
    const e = entry({ scoutId: 'S1', scoutName: 'A', enteredAt: '2026-08-17', date: '2026-08-11' });
    expect(datesOutOfRange([e], range)).toEqual([]);
  });
});

describe('buildReport', () => {
  it('OmitsASection_WhenItHasNoRows', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'tenderfoot', group: 'tenderfoot' }), 'rank_award')
    ];
    const report = buildReport(rows);
    expect(report.ranksEarned).toHaveLength(1);
    expect(report.badgesEarned).toEqual([]);
    expect(report.rankReqs).toEqual([]);
    expect(report.badgeReqs).toEqual([]);
    expect(report.leadership).toEqual([]);
    expect(report.otherAwards).toEqual([]);
    expect(report.isEmpty).toBe(false);
  });

  it('IsEmpty_WhenGivenNoRows', () => {
    expect(buildReport([]).isEmpty).toBe(true);
  });

  it('OrdersRankRequirementGroups_ScoutToEagle_NotAlphabetically', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'eagle' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S2', scoutName: 'B', code: '1a', group: 'scout' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S3', scoutName: 'C', code: '1a', group: 'star' }), 'rank_requirement')
    ];
    const report = buildReport(rows);
    expect(report.rankReqs.map((g) => g.rank)).toEqual(['scout', 'star', 'eagle']);
  });

  it('TagsEagleRequiredBadges_OnBadgesEarnedAndBadgeReqGroups', () => {
    // Different scouts (S1 earned it, S2 is still working requirements) —
    // same scout in both would now be suppressed by the "noise reduction"
    // rule below, which isn't what this test is about.
    const rows = [
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'A', code: 'first-aid', group: 'First Aid', eagle: true }),
        'merit_badge_award'
      ),
      tagKind(
        entry({ scoutId: 'S2', scoutName: 'B', code: '1a', group: 'First Aid', eagle: true }),
        'merit_badge_requirement'
      )
    ];
    const report = buildReport(rows);
    expect(report.badgesEarned[0].eagle).toBe(true);
    expect(report.badgeReqs[0].eagle).toBe(true);
  });

  it('CountsEverySection_IndependentlyOfConsolidation', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'scout' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1b', group: 'scout' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S2', scoutName: 'B', code: 'star' }), 'rank_award')
    ];
    const report = buildReport(rows);
    expect(report.counts.rankReq).toBe(2);
    expect(report.counts.rankAward).toBe(1);
    expect(report.counts.total).toBe(3);
  });

  it('CarriesAPerEntryDetailString_ForLogisticsKinds_SeparatelyFromTheGroupName', () => {
    // Real-data deviation from the prototype (module header): two scouts
    // logged different qty for the SAME named event must still group
    // together, each showing their own qty.
    const rows = [
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'A', group: 'Summer Camp - Tesomas', detail: '6 nights' }),
        'camping_nights'
      ),
      tagKind(
        entry({ scoutId: 'S2', scoutName: 'B', group: 'Summer Camp - Tesomas', detail: '4 nights' }),
        'camping_nights'
      )
    ];
    const report = buildReport(rows);
    expect(report.otherAwards).toHaveLength(1);
    expect(report.otherAwards[0].name).toBe('Summer Camp - Tesomas');
    expect(report.otherAwards[0].entries.map((e) => e.detail)).toEqual(['6 nights', '4 nights']);
  });

  it('ShowsThePrettyRankLabel_NotTheRawId_ForARankEarned', () => {
    // Real-loader bug found 2026-08-17: rank_award rows must group on the
    // same id space as rank_requirement rows (RANK_ORDER's lowercase ids)
    // for the RANK_ORDER intersection in groupAward() to match anything at
    // all — group on the display name instead (the loader's old behavior)
    // and ranksEarned is silently empty for every real rank award. The
    // display text still needs to read "Second Class", not "second-class".
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'second-class', group: 'second-class' }), 'rank_award')
    ];
    const report = buildReport(rows);
    expect(report.ranksEarned).toHaveLength(1);
    expect(report.ranksEarned[0].name).toBe('Second Class');
  });

  it('ShowsThePrettyRankLabel_ForARankRequirementsHeading_EvenWhenNoAwardRowExistsThisPeriod', () => {
    // The sibling bug: rankLabel was sourced from the requirement row's own
    // `group` (the raw id) rather than a real label lookup — must resolve
    // correctly even when nobody in this period earned the rank outright.
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'second-class' }), 'rank_requirement')
    ];
    const report = buildReport(rows);
    expect(report.rankReqs[0].rankLabel).toBe('Second Class');
  });
});

describe('buildReport — suppresses requirements the scout also earned as a full award this period', () => {
  it('DropsRankRequirementLines_ForAScoutWhoAlsoEarnedThatRankThisSamePeriod', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'star', label: 'Req 1a' }), 'rank_requirement')
    ];
    const report = buildReport(rows);
    expect(report.ranksEarned).toHaveLength(1);
    expect(report.rankReqs).toEqual([]);
    expect(report.counts.rankReq).toBe(0);
  });

  it('DropsBadgeRequirementLines_ForAScoutWhoAlsoEarnedThatBadgeThisSamePeriod', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'MB:camping', group: 'Camping' }), 'merit_badge_award'),
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'Camping', label: 'Req 1a' }),
        'merit_badge_requirement'
      )
    ];
    const report = buildReport(rows);
    expect(report.badgesEarned).toHaveLength(1);
    expect(report.badgeReqs).toEqual([]);
    expect(report.counts.mbReq).toBe(0);
  });

  it('KeepsRankRequirementLines_WhenTheScoutDidNotEarnThatRankThisPeriod', () => {
    // No award row at all — normal "in progress toward a rank" case, the
    // vast majority of requirement lines in any given report.
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'star', label: 'Req 1a' }), 'rank_requirement')
    ];
    const report = buildReport(rows);
    expect(report.rankReqs).toHaveLength(1);
    expect(report.counts.rankReq).toBe(1);
  });

  it('KeepsRankRequirementLines_ForAnotherScoutInTheSameRankGroup_WhoDidNotEarnTheRank', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'star', label: 'Req 1a' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S2', scoutName: 'B', code: '1a', group: 'star', label: 'Req 1a' }), 'rank_requirement')
    ];
    const report = buildReport(rows);
    const line = report.rankReqs[0].lines.find((l) => l.codes.includes('1a'))!;
    expect(line.scoutIds).toEqual(['S2']);
  });

  it('KeepsRankRequirementLines_ForADifferentRank_TheSameScoutDidNotEarnThisPeriod', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'star', label: 'Star req' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '5a', group: 'life', label: 'Life req' }), 'rank_requirement')
    ];
    const report = buildReport(rows);
    expect(report.rankReqs.find((g) => g.rank === 'star')).toBeUndefined();
    const lifeGroup = report.rankReqs.find((g) => g.rank === 'life')!;
    expect(lifeGroup.lines[0].scoutIds).toEqual(['S1']);
  });

  it('KeepsBadgeRequirementLines_ForAnotherScoutInTheSameBadge_WhoDidNotEarnTheBadge', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'MB:camping', group: 'Camping' }), 'merit_badge_award'),
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'Camping', label: 'Req 1a' }),
        'merit_badge_requirement'
      ),
      tagKind(
        entry({ scoutId: 'S2', scoutName: 'B', code: '1a', group: 'Camping', label: 'Req 1a' }),
        'merit_badge_requirement'
      )
    ];
    const report = buildReport(rows);
    const line = report.badgeReqs[0].lines.find((l) => l.codes.includes('1a'))!;
    expect(line.scoutIds).toEqual(['S2']);
  });
});

describe('buildReport — suppresses requirements via standing, not just this-period awards (Patrick, 2026-08-17)', () => {
  // The gap Patrick reported: a leader backfills a requirement signoff for
  // a rank/badge the scout completed long before this report's window —
  // there's no award row in THIS period to match against, so only a
  // standing check (current_rank / everEarnedBadges, both un-scoped by
  // report window) catches it.

  it('DropsRankRequirementLines_WhenTheScoutsCurrentRankIsAtOrAboveIt_EvenWithNoAwardRowThisPeriod', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'tenderfoot', label: 'Old req' }), 'rank_requirement')
    ];
    const standing: ScoutStanding = { currentRank: new Map([['S1', 'star']]), everEarnedBadges: new Set() };
    const report = buildReport(rows, standing);
    expect(report.rankReqs).toEqual([]);
    expect(report.counts.rankReq).toBe(0);
  });

  it('DropsRankRequirementLines_ForEveryRankAtOrBelowCurrentRank_NotJustTheMostRecentOne', () => {
    // Sequential progression: currently Star proves Scout, Tenderfoot,
    // Second Class, First Class, AND Star are all already done.
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'scout', label: 'Scout req' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'tenderfoot', label: 'TF req' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'star', label: 'Star req' }), 'rank_requirement')
    ];
    const standing: ScoutStanding = { currentRank: new Map([['S1', 'star']]), everEarnedBadges: new Set() };
    const report = buildReport(rows, standing);
    expect(report.rankReqs).toEqual([]);
  });

  it('KeepsRankRequirementLines_ForARankAboveTheScoutsCurrentRank', () => {
    // Currently Star — Life and Eagle requirements are still genuinely open.
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'life', label: 'Life req' }), 'rank_requirement')
    ];
    const standing: ScoutStanding = { currentRank: new Map([['S1', 'star']]), everEarnedBadges: new Set() };
    const report = buildReport(rows, standing);
    expect(report.rankReqs).toHaveLength(1);
  });

  it('KeepsRankRequirementLines_WhenStandingHasNoCurrentRankForThatScout', () => {
    // Standing provided, but this scout isn't in it (e.g. no rank yet) —
    // must not throw, must not suppress.
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'tenderfoot', label: 'Req' }), 'rank_requirement')
    ];
    const standing: ScoutStanding = { currentRank: new Map(), everEarnedBadges: new Set() };
    const report = buildReport(rows, standing);
    expect(report.rankReqs).toHaveLength(1);
  });

  it('DropsBadgeRequirementLines_WhenTheScoutHasEverEarnedTheBadge_EvenWithNoAwardRowThisPeriod', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'Camping', label: 'Old req' }), 'merit_badge_requirement')
    ];
    const standing: ScoutStanding = { currentRank: new Map(), everEarnedBadges: new Set(['S1::Camping']) };
    const report = buildReport(rows, standing);
    expect(report.badgeReqs).toEqual([]);
    expect(report.counts.mbReq).toBe(0);
  });

  it('KeepsBadgeRequirementLines_WhenTheScoutHasNotEverEarnedThatBadge', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'Camping', label: 'Req' }), 'merit_badge_requirement')
    ];
    const standing: ScoutStanding = { currentRank: new Map(), everEarnedBadges: new Set(['S1::First Aid']) };
    const report = buildReport(rows, standing);
    expect(report.badgeReqs).toHaveLength(1);
  });

  it('IsBackwardCompatible_WhenNoStandingIsPassed_FallingBackToThisPeriodOnly', () => {
    // buildReport(rows) with no second argument must keep working exactly
    // as before this change — every pre-existing caller/test relies on it.
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'tenderfoot', label: 'Req' }), 'rank_requirement')
    ];
    const report = buildReport(rows);
    expect(report.rankReqs).toHaveLength(1);
  });
});

describe('buildScoutView (Decision 8, 2026-08-17)', () => {
  it('GroupsEverythingAScoutEarned_UnderTheirNameAlphabetically_AcrossAllSections', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S2', scoutName: 'Zed Scout', code: 'star', group: 'star' }), 'rank_award'),
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'Amy Scout', code: '1a', group: 'scout', label: 'Buddy system' }),
        'rank_requirement'
      ),
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'Amy Scout', code: 'first-aid', group: 'First Aid' }),
        'merit_badge_award'
      )
    ];
    const view = buildScoutView(buildReport(rows));
    expect(view.map((r) => r.scoutName)).toEqual(['Amy Scout', 'Zed Scout']);
    const amy = view[0];
    expect(amy.badgesEarned).toHaveLength(1);
    expect(amy.rankReqsByRank).toHaveLength(1);
    expect(amy.itemCount).toBe(2);
  });

  it('ReturnsAnEmptyArray_WhenTheReportHasNoRows', () => {
    expect(buildScoutView(buildReport([]))).toEqual([]);
  });

  it('AppliesTheOutOfRangeDateRule_IdenticallyToTheCategoryView', () => {
    // Same underlying entry object, reorganized — the date rule must not
    // need re-implementing per view.
    const range = { startDate: '2026-08-10', endDate: '2026-08-17' };
    const rows = [
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'Marcus Whitfield', code: '1', group: 'Camping', date: '2025-06-02' }),
        'merit_badge_requirement'
      )
    ];
    const view = buildScoutView(buildReport(rows));
    const item = view[0].badgeReqsByBadge[0].items[0];
    expect(datesOutOfRange(entriesForScoutSlot(item.line, item.scoutIdx), range)).toEqual(['2025-06-02']);
  });
});

describe('removeScoutFromReport', () => {
  it('RemovesOnlyTheNamedScout_FromAnAwardGroup_LeavingOthersIntact', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award'),
      tagKind(entry({ scoutId: 'S2', scoutName: 'B', code: 'star', group: 'star' }), 'rank_award')
    ];
    const report = buildReport(rows);
    // groupKey matches AwardGroup.name as actually rendered/clicked — for
    // ranksEarned that's the pretty label (RANK_LABELS remap), not the raw
    // id the rows were built from.
    removeScoutFromReport(report, { scoutId: 'S1', section: 'ranksEarned', groupKey: 'Star' });
    expect(report.ranksEarned[0].scoutIds).toEqual(['S2']);
    expect(report.counts.rankAward).toBe(1);
    expect(report.counts.total).toBe(1);
  });

  it('DropsTheGroupEntirely_WhenItsLastScoutIsRemoved', () => {
    const rows = [tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award')];
    const report = buildReport(rows);
    removeScoutFromReport(report, { scoutId: 'S1', section: 'ranksEarned', groupKey: 'Star' });
    expect(report.ranksEarned).toEqual([]);
    expect(report.isEmpty).toBe(true);
    expect(report.counts.rankAward).toBe(0);
    expect(report.counts.total).toBe(0);
  });

  // CRITICAL bug found by qa-lead review, 2026-08-17: a scout who finishes
  // a badge's last requirement AND earns that badge in the same report
  // period appeared in both badgeReqs['Camping'] and badgesEarned['Camping']
  // — removing the requirement line fell through to the earned-badge group
  // just because the group key matched. buildReport() now suppresses this
  // exact scenario at generation time (see the "suppresses requirements"
  // describe block above), so it can no longer arise from a freshly
  // generated report — but a report GENERATED AND PUBLISHED before that fix
  // shipped still has this shape frozen in its content_json snapshot. These
  // two tests hand-construct that legacy shape directly (bypassing
  // buildReport, which would now refuse to produce it) to prove
  // removeScoutFromReport's section discriminator still defends existing
  // published reports, not just newly generated ones.
  function legacyDualSectionReport(): AdvancementReport {
    const reqEntry = entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'Camping', label: 'Req 1a' });
    const awardEntry = entry({ scoutId: 'S1', scoutName: 'A', code: 'camping', group: 'Camping' });
    return {
      ranksEarned: [],
      badgesEarned: [{ name: 'Camping', eagle: false, scoutIds: ['S1'], scoutNames: ['A'], entries: [awardEntry] }],
      rankReqs: [],
      badgeReqs: [
        {
          badge: 'Camping',
          badgeLabel: 'Camping',
          eagle: false,
          lines: [{ codes: ['1a'], labels: ['Req 1a'], scoutIds: ['S1'], scoutNames: ['A'], entries: [reqEntry] }]
        }
      ],
      leadership: [],
      otherAwards: [],
      counts: { mbReq: 1, rankReq: 0, mbAward: 1, rankAward: 0, leadership: 0, other: 0, total: 2 },
      isEmpty: false
    };
  }

  it('NeverTouchesBadgesEarned_WhenRemovingFromBadgeReqs_ForTheSameBadgeName', () => {
    const report = legacyDualSectionReport();
    removeScoutFromReport(report, { scoutId: 'S1', section: 'badgeReqs', groupKey: 'Camping', lineKey: '1a' });
    // The requirement line is gone...
    expect(report.badgeReqs).toEqual([]);
    // ...but the earned badge is completely untouched.
    expect(report.badgesEarned).toHaveLength(1);
    expect(report.badgesEarned[0].scoutIds).toEqual(['S1']);
    expect(report.counts.mbReq).toBe(0);
    expect(report.counts.mbAward).toBe(1);
    expect(report.counts.total).toBe(1);
  });

  it('NeverTouchesBadgeReqs_WhenRemovingFromBadgesEarned_ForTheSameBadgeName', () => {
    const report = legacyDualSectionReport();
    removeScoutFromReport(report, { scoutId: 'S1', section: 'badgesEarned', groupKey: 'Camping' });
    expect(report.badgesEarned).toEqual([]);
    expect(report.badgeReqs).toHaveLength(1);
    expect(report.badgeReqs[0].lines[0].scoutIds).toEqual(['S1']);
    expect(report.counts.mbAward).toBe(0);
    expect(report.counts.mbReq).toBe(1);
    expect(report.counts.total).toBe(1);
  });

  it('RemovesFromOnlyTheNamedLine_WhenTheSameScoutHoldsAConsolidatedLineToo', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'scout', label: 'Shared' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S2', scoutName: 'B', code: '1a', group: 'scout', label: 'Shared' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '2a', group: 'scout', label: 'Solo A' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '2b', group: 'scout', label: 'Solo B' }), 'rank_requirement')
    ];
    const report = buildReport(rows);
    // Remove scout A from the SHARED 1a line only — the consolidated 2a,2b
    // line must survive untouched.
    removeScoutFromReport(report, { scoutId: 'S1', section: 'rankReqs', groupKey: 'scout', lineKey: '1a' });
    const rankGroup = report.rankReqs.find((g) => g.rank === 'scout')!;
    // 1a's line survives (B still holds it), now with only B.
    const remaining1a = rankGroup.lines.find((l) => l.codes.includes('1a'));
    expect(remaining1a?.scoutIds).toEqual(['S2']);
    // A's consolidated 2a,2b line is untouched.
    const consolidated = rankGroup.lines.find((l) => l.codes.length > 1);
    expect(consolidated?.codes).toEqual(['2a', '2b']);
    expect(consolidated?.scoutIds).toEqual(['S1']);
  });

  it('IsANoOp_WhenTheScoutIsNotInThatGroup', () => {
    const rows = [tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award')];
    const report = buildReport(rows);
    removeScoutFromReport(report, { scoutId: 'S999', section: 'ranksEarned', groupKey: 'Star' });
    expect(report.ranksEarned[0].scoutIds).toEqual(['S1']);
    expect(report.counts.rankAward).toBe(1);
  });
});

describe('isDateOutOfRange', () => {
  const range = { startDate: '2026-08-10', endDate: '2026-08-17' };

  it('IsFalse_ForTheStartBoundary_Inclusive', () => {
    expect(isDateOutOfRange('2026-08-10', range)).toBe(false);
  });

  it('IsFalse_ForTheEndBoundary_Inclusive', () => {
    expect(isDateOutOfRange('2026-08-17', range)).toBe(false);
  });

  it('IsFalse_ForADateInsideTheRange', () => {
    expect(isDateOutOfRange('2026-08-13', range)).toBe(false);
  });

  it('IsTrue_ForADateBeforeTheRange', () => {
    expect(isDateOutOfRange('2026-08-09', range)).toBe(true);
  });

  it('IsTrue_ForADateAfterTheRange', () => {
    expect(isDateOutOfRange('2026-08-18', range)).toBe(true);
  });
});

describe('toMarkdown', () => {
  const range = { startDate: '2026-08-10', endDate: '2026-08-17' };

  it('RendersNoAdvancementMessage_ForAnEmptyReport', () => {
    const md = toMarkdown(buildReport([]), range, null);
    expect(md).toContain('No advancement was logged in this date range.');
  });

  it('IncludesTheEditorsNote_WhenOneIsGiven', () => {
    const md = toMarkdown(buildReport([]), range, 'Light week — most of the troop was traveling.');
    expect(md).toContain('> Light week — most of the troop was traveling.');
  });

  it('OmitsASectionHeading_WhenThatSectionHasNoRows', () => {
    const rows = [tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award')];
    const md = toMarkdown(buildReport(rows), range, null);
    expect(md).toContain('## Ranks Earned');
    expect(md).not.toContain('## Merit Badges Earned');
    expect(md).not.toContain('## Rank Requirements Completed');
  });

  it('OmitsTheTitleDateAndNotePreamble_WhenIncludeHeaderIsFalse', () => {
    // On-site rendering: the page already shows its own title/dateline/note,
    // so the category view must not duplicate them (found live-testing the
    // real page before shipping).
    const rows = [tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award')];
    const md = toMarkdown(buildReport(rows), range, 'A note', { includeHeader: false });
    expect(md).not.toContain('# Weekly Advancement Report');
    expect(md).not.toContain('A note');
    expect(md).toContain('## Ranks Earned');
  });

  it('IncludesTheHeaderByDefault_ForTheStandaloneBugleExport', () => {
    const rows = [tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star' }), 'rank_award')];
    const md = toMarkdown(buildReport(rows), range, 'A note');
    expect(md).toContain('# Weekly Advancement Report');
    expect(md).toContain('A note');
  });

  it('ShowsTheEarnedDate_OnlyOnTheOutOfRangeLine_NotOnInRangeLines', () => {
    const rows = [
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'In Range', code: '1a', group: 'scout', date: '2026-08-12' }),
        'rank_requirement'
      ),
      tagKind(
        entry({ scoutId: 'S2', scoutName: 'Backfilled Scout', code: '1a', group: 'scout', date: '2025-06-02' }),
        'rank_requirement'
      )
    ];
    // Shared code (both scouts hold 1a) -> one line, two scout sub-lines.
    const md = toMarkdown(buildReport(rows), range, null);
    expect(md).toMatch(/- In Range\s*$/m);
    expect(md).toContain('Backfilled Scout *(earned June 2, 2025)*');
  });

  it('SeparatesConsecutiveMeritBadgeGroups_WithABlankLineAndARealHeading_NotABareItalicLine', () => {
    // Found live, 2026-08-17 (Patrick): with no blank line before it, a line
    // immediately following a markdown list is "lazy continuation" and gets
    // silently absorbed into the previous list item instead of starting a
    // new block — the report read as one undifferentiated wall going
    // straight from Archery into Astronomy into Chess with no visible
    // header change between them.
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'Archery', label: 'Req' }), 'merit_badge_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'Astronomy', label: 'Req' }), 'merit_badge_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'Chess', label: 'Req' }), 'merit_badge_requirement')
    ];
    const md = toMarkdown(buildReport(rows), range, null);
    // A real heading (### ), not a bare italic (_Label_) line — headings
    // always break out of a preceding list regardless of blank-line
    // spacing, so this is robust even if a future edit drops the blank line.
    expect(md).toContain('### Archery');
    expect(md).toContain('### Astronomy');
    expect(md).toContain('### Chess');
    // And each one is preceded by a real blank line — the actual bug.
    expect(md).toMatch(/\n\n### Archery\n/);
    expect(md).toMatch(/\n\n### Astronomy\n/);
    expect(md).toMatch(/\n\n### Chess\n/);
  });

  it('SeparatesConsecutiveRankReqGroups_WithABlankLineAndARealHeading', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'scout', label: 'Req' }), 'rank_requirement'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'tenderfoot', label: 'Req' }), 'rank_requirement')
    ];
    const md = toMarkdown(buildReport(rows), range, null);
    expect(md).toMatch(/\n\n### Scout\n/);
    expect(md).toMatch(/\n\n### Tenderfoot\n/);
  });
});
