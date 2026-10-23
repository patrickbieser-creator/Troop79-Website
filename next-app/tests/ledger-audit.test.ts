import { describe, it, expect } from 'vitest';
import { ledgerChanges, ledgerEditSummary, ledgerStatusSummary, ledgerThing, type LedgerAuditRow } from '../src/lib/ledger-audit';

/**
 * Ledger edits are audited (Patrick, 2026-10-22): before → after for the fields that changed, a summary that names the
 * scout and the requirement the short way ("Changed Anjali S Second Class BoR: date Aug 18, 2026 → Oct 5, 2025").
 * The pure half; tests/ledger-audit-db.test.ts drives the real actions.
 */
const ROW: LedgerAuditRow = {
  id: 7,
  scout_id: 's1',
  date: '2026-08-18',
  kind: 'rank_requirement',
  code: 'second-class-BoR',
  label: 'Board of Review - Second Class',
  by: 'PB',
  qty: 1,
  unit: 'complete',
  notes: null,
  archived_at: null,
  deleted_at: null,
  scoutName: 'Anjali Shah',
  personId: 5
};

describe('ledgerThing', () => {
  it('LedgerThing_RankRequirement_IsRankAndCode', () => {
    expect(ledgerThing(ROW)).toBe('Second Class BoR');
  });

  it('LedgerThing_RankAward_IsTheRank', () => {
    expect(ledgerThing({ ...ROW, kind: 'rank_award', code: 'star', label: 'Star. Complete a Board of Review' })).toBe('Star rank');
  });

  it('LedgerThing_MeritBadge_IsItsName', () => {
    expect(ledgerThing({ ...ROW, kind: 'merit_badge_award', code: 'MB:robotics', label: 'Robotics.' })).toBe('Robotics');
  });

  it('LedgerThing_Other_IsTheLabel', () => {
    expect(ledgerThing({ ...ROW, kind: 'service_hours', code: 'SP:Sp02', label: 'OLT Cleanup' })).toBe('OLT Cleanup');
  });
});

describe('ledgerChanges', () => {
  it('LedgerChanges_OnlyTheFieldsThatChanged', () => {
    expect(ledgerChanges(ROW, { ...ROW, date: '2025-10-05', by: 'PB' })).toEqual([{ field: 'date', from: 'Aug 18, 2026', to: 'Oct 5, 2025' }]);
  });

  it('LedgerChanges_BlankShowsAsDash', () => {
    expect(ledgerChanges(ROW, { ...ROW, notes: 'Signed at camp' })).toEqual([{ field: 'notes', from: '—', to: 'Signed at camp' }]);
  });

  it('LedgerChanges_Nothing_IsEmpty', () => {
    expect(ledgerChanges(ROW, { ...ROW })).toEqual([]);
  });

  it('LedgerChanges_Scout_ShowsNames', () => {
    expect(ledgerChanges(ROW, { ...ROW, scout_id: 's2' }, new Map([['s2', 'Finn Parker']]))).toEqual([{ field: 'scout', from: 'Anjali Shah', to: 'Finn Parker' }]);
  });
});

describe('summaries', () => {
  it('LedgerEditSummary_NamesScoutThingAndChange', () => {
    expect(ledgerEditSummary(ROW, [{ field: 'date', from: 'Aug 18, 2026', to: 'Oct 5, 2025' }])).toBe('Changed Anjali S Second Class BoR: date Aug 18, 2026 → Oct 5, 2025');
  });

  it('LedgerStatusSummary_Delete_CarriesTheReason', () => {
    expect(ledgerStatusSummary(ROW, 'delete', 'Duplicate')).toBe('Deleted Anjali S Second Class BoR (Duplicate)');
  });

  it('LedgerStatusSummary_Restore', () => {
    expect(ledgerStatusSummary(ROW, 'restore', null)).toBe('Restored Anjali S Second Class BoR');
  });
});
