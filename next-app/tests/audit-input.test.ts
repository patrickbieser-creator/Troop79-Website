import { describe, it, expect } from 'vitest';
import {
  activeScouts,
  ledgerOfKind,
  type AuditLedgerRow,
  type AuditScoutRow
} from '@/app/admin/(workspace)/advancement/audits/audit-input';

/**
 * Pure snapshot-shaping helpers behind item 10 of the 2026-08-27 perf
 * review: every audit check used to run its own `.eq('active', true)` /
 * `.eq('kind', …)` query against `scouts` / `ledger_active`. These two
 * functions are the in-memory replacement each check now applies to the
 * ONE shared snapshot `loadAuditInput` reads — no DB needed to pin their
 * behaviour, so no `adminClient()` here.
 */

function scout(id: string, active: boolean): AuditScoutRow {
  return { id, display_name: id, active, person_id: null };
}

function ledgerRow(overrides: Partial<AuditLedgerRow> & Pick<AuditLedgerRow, 'kind' | 'code'>): AuditLedgerRow {
  return {
    id: 1,
    scout_id: 'S1',
    label: null,
    date: '2026-01-01',
    by: null,
    qty: 1,
    unit: 'each',
    notes: null,
    entered_by: 'vitest',
    entered_at: '2026-01-01T00:00:00Z',
    calendar_entry_id: null,
    ...overrides
  };
}

describe('activeScouts', () => {
  it('KeepsOnlyActiveScouts_WhenTheListMixesBoth', () => {
    const scouts = [scout('a', true), scout('b', false), scout('c', true)];
    expect(activeScouts(scouts).map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('ReturnsEmpty_WhenNoScoutIsActive', () => {
    expect(activeScouts([scout('a', false)])).toEqual([]);
  });
});

describe('ledgerOfKind', () => {
  it('MatchesRowsOfASingleKind_AndExcludesOthers', () => {
    const ledger = [
      ledgerRow({ kind: 'rank_award', code: 'star', id: 1 }),
      ledgerRow({ kind: 'rank_requirement', code: 'star-1', id: 2 }),
      ledgerRow({ kind: 'rank_award', code: 'life', id: 3 })
    ];
    expect(ledgerOfKind(ledger, ['rank_award']).map((r) => r.id)).toEqual([1, 3]);
  });

  it('MatchesAnyOfSeveralKinds_TheSameWayAnInFilterWould', () => {
    const ledger = [
      ledgerRow({ kind: 'camping_nights', code: 'A', id: 1 }),
      ledgerRow({ kind: 'meeting_attendance', code: 'B', id: 2 }),
      ledgerRow({ kind: 'service_hours', code: 'C', id: 3 })
    ];
    const result = ledgerOfKind(ledger, ['camping_nights', 'service_hours']);
    expect(result.map((r) => r.id)).toEqual([1, 3]);
  });

  it('ReturnsEmpty_WhenNoRowMatchesAnyRequestedKind', () => {
    const ledger = [ledgerRow({ kind: 'leadership', code: 'SPL', id: 1 })];
    expect(ledgerOfKind(ledger, ['rank_award'])).toEqual([]);
  });
});
