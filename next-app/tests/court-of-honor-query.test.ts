import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadCourtOfHonorEntries, generateCourtOfHonor, markItemsPresented } from '../src/lib/court-of-honor';

/**
 * Court of Honor — the real query against real ledger_entries, scouts,
 * ranks, and merit_badges. Proves the SQL (date-earned filtering, kind
 * restriction) against a real schema; buildReport()'s own logic is already
 * covered by advancement-report-consolidation.test.ts.
 */
describe('court of honor — query', () => {
  let scoutIds: string[] = [];
  let ledgerEntryIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (ledgerEntryIds.length > 0) await admin.from('ledger_entries').delete().in('id', ledgerEntryIds);
    if (scoutIds.length > 0) await admin.from('scouts').delete().in('id', scoutIds);
    ledgerEntryIds = [];
    scoutIds = [];
  });

  async function makeScout(admin: ReturnType<typeof adminClient>, suffix: string): Promise<string> {
    const id = `vitest-coh-${suffix}`;
    const { error } = await admin
      .from('scouts')
      .insert({ id, first_name: '[TEST]', last_name: 'Vitest', display_name: `[TEST] Vitest ${suffix}`, active: true });
    if (error) throw new Error(`fixture: scout insert failed: ${error.message}`);
    scoutIds.push(id);
    return id;
  }

  async function makeEntry(
    admin: ReturnType<typeof adminClient>,
    row: { scoutId: string; kind: string; code: string; label?: string | null; date: string; enteredAt: string }
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
        qty: 1,
        unit: 'complete'
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: ledger entry insert failed: ${error?.message}`);
    ledgerEntryIds.push(data.id as number);
  }

  it('FiltersOnDateEarned_NotOnEnteredAt_TheOppositeRuleFromTheWeeklyReport', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `dateearned-${Date.now()}`);
    // Earned inside the window, entered_at way outside it — MUST appear
    // (this is the whole point of the earned-date rule).
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_award',
      code: 'tenderfoot',
      date: '2026-08-12',
      enteredAt: '2026-01-01T10:00:00Z'
    });
    // Earned OUTSIDE the window, entered_at inside it — must NOT appear.
    await makeEntry(admin, {
      scoutId: scout,
      kind: 'rank_award',
      code: 'second-class',
      date: '2025-01-01',
      enteredAt: '2026-08-12T10:00:00Z'
    });

    const entries = await loadCourtOfHonorEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mine = entries.filter((e) => e.scoutId === scout);
    expect(mine).toHaveLength(1);
    expect(mine[0].code).toBe('tenderfoot');
  });

  it('IncludesOnlyRankAwards_MeritBadgeAwards_AndAwards_NeverRequirements', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `kinds-${Date.now()}`);
    await makeEntry(admin, { scoutId: scout, kind: 'rank_award', code: 'tenderfoot', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });
    await makeEntry(admin, { scoutId: scout, kind: 'merit_badge_award', code: 'MB:first-aid', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });
    await makeEntry(admin, { scoutId: scout, kind: 'award', code: 'MileSwim', label: 'Mile Swim', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });
    // Must NOT appear:
    await makeEntry(admin, { scoutId: scout, kind: 'rank_requirement', code: 'tenderfoot-1a', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });
    await makeEntry(admin, { scoutId: scout, kind: 'merit_badge_requirement', code: 'first-aid-1a', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });
    await makeEntry(admin, { scoutId: scout, kind: 'leadership', code: 'SPL', label: 'Senior Patrol Leader', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });
    await makeEntry(admin, { scoutId: scout, kind: 'camping_nights', code: 'EVT:test', label: 'Test Camp', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });

    const entries = await loadCourtOfHonorEntries(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    const mine = entries.filter((e) => e.scoutId === scout);
    expect(mine).toHaveLength(3);
    expect(mine.map((e) => e.code).sort()).toEqual(['MileSwim', 'first-aid', 'tenderfoot']);
  });

  it('IncludesImportBatchRows_UnlikeTheWeeklyReport_SinceDateEarnedWasAlreadyVerifiedCorrect', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `importrow-${Date.now()}`);
    const { error } = await admin.from('ledger_entries').insert({
      scout_id: scout,
      kind: 'rank_award',
      code: 'tenderfoot',
      date: '2026-08-12',
      entered_at: '2026-08-12T10:00:00Z',
      entered_by: 'PB', // the Weekly Report's exclusion marker
      qty: 1,
      unit: 'complete'
    });
    if (error) throw new Error(`fixture insert failed: ${error.message}`);
    const { data } = await admin
      .from('ledger_entries')
      .select('id')
      .eq('scout_id', scout)
      .eq('code', 'tenderfoot')
      .single();
    if (data) ledgerEntryIds.push(data.id as number);

    const report = await generateCourtOfHonor(admin, { startDate: '2026-08-10', endDate: '2026-08-17' });
    expect(report.ranksEarned.some((g) => g.scoutIds.includes(scout))).toBe(true);
  });

  it('ReturnsAnEmptyReport_ForADateRangeWithNothingEarned', async () => {
    const report = await generateCourtOfHonor(adminClient(), { startDate: '1999-01-01', endDate: '1999-01-02' });
    expect(report.isEmpty).toBe(true);
  });

  it('markItemsPresented_StampsPresentedAtAndBy_OnlyForRowsNotAlreadyPresented', async () => {
    const admin = adminClient();
    const scout = await makeScout(admin, `present-${Date.now()}`);
    await makeEntry(admin, { scoutId: scout, kind: 'rank_award', code: 'tenderfoot', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });
    await makeEntry(admin, { scoutId: scout, kind: 'merit_badge_award', code: 'MB:first-aid', date: '2026-08-12', enteredAt: '2026-08-12T10:00:00Z' });

    // Simulate one of them already having been individually presented
    // earlier — this row's mark must survive untouched.
    const { data: existingRows } = await admin
      .from('ledger_entries')
      .select('id, code')
      .in('id', ledgerEntryIds);
    const alreadyPresentedId = (existingRows as { id: number; code: string }[]).find((r) => r.code === 'MB:first-aid')!.id;
    await admin
      .from('ledger_entries')
      .update({ presented_at: '2020-01-01T12:00:00-06:00', presented_by: 'Someone Else' })
      .eq('id', alreadyPresentedId);

    const range = { startDate: '2026-08-10', endDate: '2026-08-17' };
    const report = await generateCourtOfHonor(admin, range);
    await markItemsPresented(admin, report, range.endDate, 'Test Leader');

    const { data: after } = await admin.from('ledger_entries').select('id, code, presented_at, presented_by').in('id', ledgerEntryIds);
    const rows = after as { id: number; code: string; presented_at: string | null; presented_by: string | null }[];

    const tenderfootRow = rows.find((r) => r.code === 'tenderfoot')!;
    expect(tenderfootRow.presented_by).toBe('Test Leader');
    expect(tenderfootRow.presented_at?.startsWith('2026-08-17')).toBe(true);

    const badgeRow = rows.find((r) => r.code === 'MB:first-aid')!;
    expect(badgeRow.presented_by).toBe('Someone Else'); // untouched
    expect(badgeRow.presented_at?.startsWith('2020-01-01')).toBe(true); // untouched
  });
});
