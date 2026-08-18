import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadAdvancementEntries, generateAdvancementReport, loadScoutStanding } from '../src/lib/advancement-report';

/**
 * Weekly Advancement Report — the real query against real ledger_entries,
 * scouts, ranks, and merit_badges (Plans/Weekly-Advancement-Report.md).
 * Integration-style against local Postgres, no mocking (Tests/CLAUDE.md's
 * `db` project convention) — the consolidation logic itself is covered
 * separately in advancement-report-consolidation.test.ts against plain
 * fixtures; this file proves the SQL joins and the entered_at filtering
 * rule against a real schema.
 *
 * Uses real, already-seeded rank/merit-badge reference data ('tenderfoot',
 * 'first-aid') rather than inserting throwaway taxonomy rows — same
 * convention as tests/library-scout-progress.test.ts.
 */
describe('advancement report — query', () => {
  let scoutIds: string[] = [];
  let ledgerEntryIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (ledgerEntryIds.length > 0) {
      await admin.from('ledger_entries').delete().in('id', ledgerEntryIds);
    }
    if (scoutIds.length > 0) {
      await admin.from('scouts').delete().in('id', scoutIds);
    }
    ledgerEntryIds = [];
    scoutIds = [];
  });

  async function makeScout(admin: ReturnType<typeof adminClient>, suffix: string): Promise<string> {
    const id = `vitest-advrpt-${suffix}`;
    const { error } = await admin.from('scouts').insert({
      id,
      first_name: '[TEST]',
      last_name: 'Vitest',
      display_name: `[TEST] Vitest ${suffix}`,
      active: true
    });
    if (error) throw new Error(`fixture: scout insert failed: ${error.message}`);
    scoutIds.push(id);
    return id;
  }

  async function makeEntry(
    admin: ReturnType<typeof adminClient>,
    row: {
      scoutId: string;
      kind: string;
      code: string;
      label?: string | null;
      date: string;
      enteredAt: string;
      enteredBy?: string | null;
      qty?: number;
      unit?: string;
      archived?: boolean;
      deleted?: boolean;
    }
  ): Promise<void> {
    const { data, error } = await admin
      .from('ledger_entries')
      .insert({
        scout_id: row.scoutId,
        kind: row.kind,
        code: row.code,
        label: row.label ?? null,
        date: row.date,
        entered_at: row.enteredAt,
        // `?? 'vitest'` would also swallow an explicitly-passed `null`
        // (nullish coalescing doesn't distinguish "omitted" from "null") —
        // this test file deliberately exercises a real null entered_by, so
        // only default when the key is truly absent.
        entered_by: 'enteredBy' in row ? row.enteredBy : 'vitest',
        qty: row.qty ?? 1,
        unit: row.unit ?? 'complete'
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ledger entry insert failed: ${error?.message}`);
    const id = data.id as number;
    ledgerEntryIds.push(id);
    if (row.archived) await admin.from('ledger_entries').update({ archived_at: new Date().toISOString() }).eq('id', id);
    if (row.deleted)
      await admin
        .from('ledger_entries')
        .update({ deleted_at: new Date().toISOString(), deleted_reason: '[TEST] cleanup' })
        .eq('id', id);
  }

  it('FiltersOnEnteredAt_NotOnTheEarnedDate_TheCoreRuleOfThisFeature', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `entat-${Date.now()}`);
    // Earned long ago, entered_at inside the window — must appear.
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_requirement',
      code: 'tenderfoot-1a',
      date: '2025-01-01',
      enteredAt: '2026-08-12T10:00:00Z'
    });
    // Earned inside the window, entered_at outside — must NOT appear.
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_requirement',
      code: 'tenderfoot-1b',
      date: '2026-08-12',
      enteredAt: '2026-01-01T10:00:00Z'
    });

    const entries = await loadAdvancementEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mine = entries.filter((e) => e.scoutId === scout);
    expect(mine).toHaveLength(1);
    expect(mine[0].code).toBe('1a');
    expect(mine[0].date).toBe('2025-01-01');
  });

  it('ExcludesArchivedAndDeletedEntries_EvenWhenEnteredAtIsInRange', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `excl-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_requirement',
      code: 'tenderfoot-1a',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z',
      archived: true
    });
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_requirement',
      code: 'tenderfoot-1b',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z',
      deleted: true
    });

    const entries = await loadAdvancementEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    expect(entries.filter((e) => e.scoutId === scout)).toHaveLength(0);
  });

  it('ResolvesRankRequirementLabels_FromTheRealRankRequirementsTable_NotTheLedgersOwnLabel', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `label-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_requirement',
      code: 'tenderfoot-1a',
      label: 'stale historical import text, must be ignored',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z'
    });

    const entries = await loadAdvancementEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mine = entries.find((e) => e.scoutId === scout)!;
    expect(mine.label).not.toContain('stale historical');
    expect(mine.group).toBe('tenderfoot');
  });

  it('ResolvesMeritBadgeAwardName_AndEagleFlag_FromTheMeritBadgesTable', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `mbaward-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'merit_badge_award',
      code: 'MB:first-aid',
      label: 'First Aid*.',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z'
    });

    const entries = await loadAdvancementEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mine = entries.find((e) => e.scoutId === scout)!;
    expect(mine.group).toBe('First Aid');
    expect(mine.eagle).toBe(true); // First Aid is Eagle-required
  });

  it('CarriesQtyAndUnit_AsAPerEntryDetailString_ForLogisticsKinds', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `logistics-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'camping_nights',
      code: 'EVT:vitest',
      label: 'Vitest Camp',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z',
      qty: 4,
      unit: 'nights'
    });

    const entries = await loadAdvancementEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mine = entries.find((e) => e.scoutId === scout)!;
    expect(mine.detail).toBe('4 nights');
    expect(mine.group).toBe('Vitest Camp');
  });

  it('GeneratesAConsolidatedReport_EndToEnd_FromRealLedgerRows', async () => {
    // Local dev mirrors real production data (2026-08-17 session) — this
    // date range may legitimately contain real rows beyond this test's own
    // fixtures, so assert containment, not exact equality.
    const admin = adminClient();
    const scoutA = await makeScout(admin, `e2e-a-${Date.now()}`);
    const scoutB = await makeScout(admin, `e2e-b-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scoutA,
      kind: 'rank_requirement',
      code: 'tenderfoot-1a',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z'
    });
    await makeEntry(admin, {
      scoutId: scoutB,
      kind: 'rank_requirement',
      code: 'tenderfoot-1a',
      date: '2026-08-13',
      enteredAt: '2026-08-13T10:00:00Z'
    });

    const report = await generateAdvancementReport(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const tenderfootGroup = report.rankReqs.find((g) => g.rank === 'tenderfoot');
    expect(tenderfootGroup).toBeDefined();
    const line = tenderfootGroup!.lines.find((l) => l.codes[0] === '1a')!;
    expect(line.scoutIds).toEqual(expect.arrayContaining([scoutA, scoutB]));
  });

  it('ResolvesRankAwardGroup_OnTheSameIdSpaceAsRankRequirements_SoRanksEarnedActuallyPopulates', async () => {
    // Real bug found 2026-08-17: the loader keyed rank_award's `group` on
    // ranks.display_name ("Tenderfoot") while rank_requirement keyed on
    // ranks.id ("tenderfoot") — groupAward()'s RANK_ORDER intersection needs
    // the id space, so ranksEarned was silently empty for every real rank
    // award ever generated. Assert both the join-key AND the display label.
    const admin = adminClient();
    const scout = await makeScout(admin, `rankaward-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_award',
      code: 'second-class',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z'
    });

    const entries = await loadAdvancementEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mine = entries.find((e) => e.scoutId === scout)!;
    expect(mine.group).toBe('second-class');

    const report = await generateAdvancementReport(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mineGroup = report.ranksEarned.find((g) => g.scoutIds.includes(scout))!;
    expect(mineGroup).toBeDefined();
    expect(mineGroup.name).toBe('Second Class');
  });

  it('SuppressesRankRequirementLines_WhenTheScoutAlsoEarnedThatRankInTheSamePeriod_AgainstRealData', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `suppress-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_award',
      code: 'tenderfoot',
      date: '2026-08-14',
      enteredAt: '2026-08-14T10:00:00Z'
    });
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_requirement',
      code: 'tenderfoot-1a',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z'
    });

    const report = await generateAdvancementReport(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    expect(report.ranksEarned.some((g) => g.scoutIds.includes(scout))).toBe(true);
    const tenderfootGroup = report.rankReqs.find((g) => g.rank === 'tenderfoot');
    if (tenderfootGroup) {
      const line = tenderfootGroup.lines.find((l) => l.codes.includes('1a'));
      expect(line?.scoutIds.includes(scout)).not.toBe(true);
    }
  });

  it('ExcludesKnownImportBatchMarkers_EvenWhenEnteredAtFallsInRange', async () => {
    // Data-quality investigation, 2026-08-17 (Patrick): ~75% of the active
    // ledger carries entered_by = 'PB'/'Import'/'pbieser-import' or NULL,
    // every one of them landing on an exact round-hour entered_at — the
    // fingerprint of a historical migration/backfill, not a leader
    // recording something in real time. A report whose date range happens
    // to span one of those migration dates must not surface the entire
    // historical batch as if it were this week's news.
    const admin = adminClient();
    const scout = await makeScout(admin, `importmark-${Date.now()}`);
    for (const enteredBy of ['PB', 'Import', 'pbieser-import', null]) {
      await makeEntry(admin, {
        scoutId: scout,
        kind: 'rank_requirement',
        code: 'tenderfoot-1a',
        date: '2026-08-12',
        enteredAt: '2026-08-12T10:00:00Z',
        enteredBy
      });
    }
    // A genuine leader entry, same scout/code/date range — must still show.
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_requirement',
      code: 'tenderfoot-1b',
      date: '2026-08-12',
      enteredAt: '2026-08-12T10:00:00Z',
      enteredBy: 'Melissa R'
    });

    const entries = await loadAdvancementEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mine = entries.filter((e) => e.scoutId === scout);
    expect(mine).toHaveLength(1);
    expect(mine[0].code).toBe('1b');
  });

  it('SuppressesARankRequirement_WhenTheScoutsRealCurrentRankAlreadyCoversIt_EvenThoughTheAwardIsOutsideThisWindow', async () => {
    // Patrick's exact report: a leader backfills a Tenderfoot requirement
    // signoff long after the scout actually made Tenderfoot. The award
    // itself is entered_at OUTSIDE this report's window (so the existing
    // this-period check can't catch it) — only the real
    // recompute_scout_current_rank trigger firing off the rank_award
    // insert, then loadScoutStanding reading scouts.current_rank, catches
    // this end to end.
    const admin = adminClient();
    const scout = await makeScout(admin, `standing-rank-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_award',
      code: 'tenderfoot',
      date: '2026-01-05',
      enteredAt: '2026-01-05T10:00:00Z' // well outside the report window below
    });
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_requirement',
      code: 'tenderfoot-1a',
      date: '2026-01-04',
      enteredAt: '2026-08-12T10:00:00Z' // backfilled THIS week
    });

    const report = await generateAdvancementReport(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const tenderfootGroup = report.rankReqs.find((g) => g.rank === 'tenderfoot');
    if (tenderfootGroup) {
      const line = tenderfootGroup.lines.find((l) => l.codes.includes('1a'));
      expect(line?.scoutIds.includes(scout)).not.toBe(true);
    }
    // And the award itself, entered outside this window, correctly does
    // NOT show up in ranksEarned either — it's not part of THIS report.
    expect(report.ranksEarned.some((g) => g.scoutIds.includes(scout))).toBe(false);
  });

  it('SuppressesABadgeRequirement_WhenTheScoutHasEverEarnedTheBadge_EvenThoughTheAwardIsOutsideThisWindow', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `standing-badge-${Date.now()}`);
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'merit_badge_award',
      code: 'MB:first-aid',
      date: '2026-01-05',
      enteredAt: '2026-01-05T10:00:00Z'
    });
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'merit_badge_requirement',
      code: 'first-aid-1a',
      date: '2026-01-04',
      enteredAt: '2026-08-12T10:00:00Z'
    });

    const report = await generateAdvancementReport(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const firstAidGroup = report.badgeReqs.find((g) => g.badge === 'First Aid');
    if (firstAidGroup) {
      const line = firstAidGroup.lines.find((l) => l.codes.includes('1a'));
      expect(line?.scoutIds.includes(scout)).not.toBe(true);
    }
  });

  it('loadScoutStanding_ReturnsEmptyMaps_ForAnEmptyScoutIdList', async () => {
    const standing = await loadScoutStanding(adminClient(), []);
    expect(standing.currentRank.size).toBe(0);
    expect(standing.everEarnedBadges.size).toBe(0);
  });

  it('ReturnsAnEmptyReport_ForADateRangeWithNothingEntered', async () => {
    const report = await generateAdvancementReport(adminClient(), { startDate: '1999-01-01', endDate: '1999-01-02' });
    expect(report.isEmpty).toBe(true);
    expect(report.counts.total).toBe(0);
  });
});
