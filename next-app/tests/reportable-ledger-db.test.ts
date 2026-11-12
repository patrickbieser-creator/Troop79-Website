import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadAdvancementEntries } from '../src/lib/advancement-report';
import { loadCourtOfHonorEntries } from '../src/lib/court-of-honor';
import { loadScoutbookExport } from '../src/lib/scoutbook-export';

/**
 * Webelos on the roster: a Webelos's advancement is TRACKED (ledger_active)
 * but never REPORTED (reportable_ledger). These prove the report loaders
 * leave a Webelos's rows out while a regular scout's identical rows, in the
 * same window, still come through. Test-owned rows only (ids ZZWRL*).
 */
const admin = adminClient();
const WEB = 'ZZWRL1';
const REG = 'ZZWRL2';
const LAST = 'ZZReportableTest';
// A far-future window so nothing else in the local DB mirror lands in it.
const DAY = '2031-03-05';
const RANGE = { startDate: '2031-03-01', endDate: '2031-03-10' };
let ledgerIds: number[] = [];

async function newScout(id: string, first: string, webelos: boolean): Promise<void> {
  const { data: p, error: pe } = await admin
    .from('people')
    .insert({ first_name: first, last_name: LAST, display_name: `${first} ${LAST}`, active: true })
    .select('id')
    .single();
  if (pe || !p) throw new Error(pe?.message);
  const { error } = await admin.from('scouts').insert({
    id,
    first_name: first,
    last_name: LAST,
    display_name: `${first} ${LAST}`,
    active: !webelos,
    is_webelos: webelos,
    person_id: (p as { id: number }).id
  });
  if (error) throw new Error(error.message);
}

async function recordAdvancement(scoutId: string): Promise<void> {
  const base = { scout_id: scoutId, date: DAY, entered_at: `${DAY}T15:00:00Z`, by: 'ZZ Vitest', entered_by: 'ZZ Vitest', qty: 1, unit: 'complete' };
  const { data, error } = await admin
    .from('ledger_entries')
    .insert([
      { ...base, kind: 'rank_requirement', code: 'tenderfoot-1a', label: 'ZZ 1a' },
      { ...base, kind: 'merit_badge_award', code: 'MB:first-aid', label: 'ZZ First Aid' }
    ])
    .select('id');
  if (error) throw new Error(error.message);
  ledgerIds.push(...((data ?? []) as { id: number }[]).map((r) => r.id));
}

beforeAll(async () => {
  await newScout(WEB, 'Wren', true);
  await newScout(REG, 'Reed', false);
  await recordAdvancement(WEB);
  await recordAdvancement(REG);
});

afterAll(async () => {
  if (ledgerIds.length) await admin.from('ledger_entries').delete().in('id', ledgerIds);
  ledgerIds = [];
  await admin.from('scouts').delete().in('id', [WEB, REG]);
  await admin.from('people').delete().eq('last_name', LAST);
});

describe('report loaders leave Webelos out', () => {
  it('WebelosRows_StayOnLedgerActive_ForTheirOwnRecord', async () => {
    const { data } = await admin.from('ledger_active').select('id').eq('scout_id', WEB);
    expect((data ?? []).length).toBe(2);
  });

  it('AdvancementReport_LeavesOutAWebelosRow', async () => {
    const entries = await loadAdvancementEntries(admin, RANGE);
    const ours = entries.filter((e) => e.scoutId === WEB || e.scoutId === REG).map((e) => e.scoutId);
    expect([...new Set(ours)]).toEqual([REG]);
  });

  it('CourtOfHonor_LeavesOutAWebelosAward', async () => {
    const entries = await loadCourtOfHonorEntries(admin, RANGE);
    const ours = entries.filter((e) => e.scoutId === WEB || e.scoutId === REG).map((e) => e.scoutId);
    expect(ours).toEqual([REG]);
  });

  it('ScoutbookExport_LeavesOutAWebelosAward', async () => {
    const result = await loadScoutbookExport(admin, RANGE.startDate, RANGE.endDate);
    const text = JSON.stringify(result);
    expect({ webelos: text.includes('Wren'), regular: text.includes('Reed') }).toEqual({ webelos: false, regular: true });
  });
});
