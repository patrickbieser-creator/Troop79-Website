import { describe, it, expect } from 'vitest';
import { toCsv, noonCentralIso, collectPresentableEntryIds } from '../src/lib/court-of-honor';
import { buildReport, tagKind, type AdvancementEntry } from '../src/lib/advancement-report';

/**
 * Court of Honor — CSV export (Plans discussed with Patrick, 2026-08-17).
 * buildReport()/buildScoutView() themselves are already covered by
 * advancement-report-consolidation.test.ts (this module reuses them
 * unchanged) — this file covers toCsv(), the one genuinely new piece of
 * pure logic.
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

describe('toCsv', () => {
  it('IncludesAHeaderRow', () => {
    const csv = toCsv(buildReport([]));
    expect(csv.split('\r\n')[0]).toBe('Scout,Type,Item,Date Earned');
  });

  it('IncludesOneRowPerScout_ForARankEarned', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'Amy Scout', code: 'star', group: 'star', date: '2026-07-15' }), 'rank_award')
    ];
    const csv = toCsv(buildReport(rows));
    // formatMonthDayYear's own comma ("July 15, 2026") means the date field
    // is itself CSV-quoted — not a bug, correct RFC4180 escaping.
    expect(csv).toContain('Amy Scout,Rank,Star,"July 15, 2026"');
  });

  it('IncludesOneRowPerScout_ForAMeritBadgeEarned', () => {
    const rows = [
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'Amy Scout', code: 'MB:camping', group: 'Camping', date: '2026-07-20' }),
        'merit_badge_award'
      )
    ];
    const csv = toCsv(buildReport(rows));
    expect(csv).toContain('Amy Scout,Merit Badge,Camping,"July 20, 2026"');
  });

  it('IncludesOneRowPerScout_ForASpecialAward', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'Amy Scout', code: 'MileSwim', group: 'Mile Swim', date: '2026-07-22' }), 'award')
    ];
    const csv = toCsv(buildReport(rows));
    expect(csv).toContain('Amy Scout,Award,Mile Swim,"July 22, 2026"');
  });

  it('QuotesAndEscapesFields_ContainingACommaOrQuote', () => {
    const rows = [
      tagKind(
        entry({ scoutId: 'S1', scoutName: 'Scout, Jr. "Bud"', code: 'star', group: 'star', date: '2026-07-15' }),
        'rank_award'
      )
    ];
    const csv = toCsv(buildReport(rows));
    expect(csv).toContain('"Scout, Jr. ""Bud"""');
  });

  it('IncludesOneRowPerScout_WhenMultipleScoutsShareTheSameAward', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'Amy Scout', code: 'star', group: 'star', date: '2026-07-15' }), 'rank_award'),
      tagKind(entry({ scoutId: 'S2', scoutName: 'Ben Scout', code: 'star', group: 'star', date: '2026-07-16' }), 'rank_award')
    ];
    const csv = toCsv(buildReport(rows));
    expect(csv).toContain('Amy Scout,Rank,Star,"July 15, 2026"');
    expect(csv).toContain('Ben Scout,Rank,Star,"July 16, 2026"');
  });

  it('ProducesOnlyTheHeaderRow_ForAnEmptyReport', () => {
    const csv = toCsv(buildReport([]));
    expect(csv.trim().split('\r\n')).toHaveLength(1);
  });

  it('NeutralizesALeadingEqualsSign_SoExcelDoesNotEvaluateItAsAFormula', () => {
    // CSV/formula injection (qa-lead review, 2026-08-17) — a name or award
    // starting with =, +, -, or @ must not be interpreted as a formula
    // when the exported file is opened in Excel/Sheets.
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: '=2+2', code: 'star', group: 'star', date: '2026-07-15' }), 'rank_award')
    ];
    const csv = toCsv(buildReport(rows));
    expect(csv).toContain("'=2+2,Rank");
    expect(csv).not.toMatch(/^=2\+2,Rank/m);
  });
});

describe('noonCentralIso', () => {
  it('Uses5HourOffset_ForADateInCentralDaylightTime', () => {
    // Mid-July is CDT (UTC-5).
    expect(noonCentralIso('2026-07-15')).toBe('2026-07-15T12:00:00-05:00');
  });

  it('Uses6HourOffset_ForADateInCentralStandardTime', () => {
    // Mid-January is CST (UTC-6) — the exact case a hardcoded -05:00 offset
    // would get wrong (found in review before shipping, 2026-08-17).
    expect(noonCentralIso('2026-01-15')).toBe('2026-01-15T12:00:00-06:00');
  });
});

describe('collectPresentableEntryIds', () => {
  it('CollectsIdsFromRanksBadgesLeadershipAndOtherAwards_ButNeverFromRequirements', () => {
    const rows = [
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'star', group: 'star', date: '2026-07-15' }), 'rank_award'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'MB:camping', group: 'Camping', date: '2026-07-15' }), 'merit_badge_award'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'SPL', group: 'SPL', date: '2026-07-15' }), 'leadership'),
      tagKind(entry({ scoutId: 'S1', scoutName: 'A', code: 'MileSwim', group: 'Mile Swim', date: '2026-07-15' }), 'award')
    ];
    const report = buildReport(rows);
    const ids = collectPresentableEntryIds(report);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4); // every id distinct — the seq-based fixture ids never collide
  });

  it('ReturnsAnEmptyArray_ForAnEmptyReport', () => {
    expect(collectPresentableEntryIds(buildReport([]))).toEqual([]);
  });
});
