import { describe, it, expect } from 'vitest';
import {
  cmpCode,
  consolidateGroup,
  datesOutOfRange,
  entriesForScoutSlot,
  buildReport,
  buildScoutView,
  toMarkdown,
  tagKind,
  type AdvancementEntry
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
    const rows = [
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'A', code: 'first-aid', group: 'First Aid', eagle: true }),
        'merit_badge_award'
      ),
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'A', code: '1a', group: 'First Aid', eagle: true }),
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
});
