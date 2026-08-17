import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadAdvancementEntries, generateAdvancementReport } from '../src/lib/advancement-report';

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

  it('ReturnsAnEmptyReport_ForADateRangeWithNothingEntered', async () => {
    const report = await generateAdvancementReport(adminClient(), { startDate: '1999-01-01', endDate: '1999-01-02' });
    expect(report.isEmpty).toBe(true);
    expect(report.counts.total).toBe(0);
  });
});
