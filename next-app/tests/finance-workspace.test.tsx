import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FinanceWorkspace } from '../src/app/admin/(workspace)/finance/finance-workspace';
import type { LedgerRow } from '../src/app/admin/(workspace)/finance/actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

/**
 * Financial Ledger table (Patrick, 2026-08-21): the running Total Funds
 * column to the right of Amount, and the per-Kind pill tints. Rendered
 * read-only (canManage=false) so no <dialog>/showModal is involved — jsdom
 * doesn't implement it, and the write surfaces aren't what these guard.
 */

// Mirrors the transaction_kinds seed (20260820220000_transaction_kinds_lookup.sql).
const KINDS = [
  { code: 'event_fee', label: 'Event', sort_order: 10 },
  { code: 'fundraiser', label: 'fundraiser', sort_order: 20 },
  { code: 'donation', label: 'donation', sort_order: 30 }
];

function row(over: Partial<LedgerRow> & { id: number }): LedgerRow {
  return {
    occurred_on: '2026-06-09',
    account: 'checking',
    amount: 100,
    kind: 'event_fee',
    method: 'venmo',
    person_id: null,
    memo: null,
    activity_label: null,
    voided_at: null,
    entered_by_person_id: null,
    created_at: '2026-06-09T12:00:00Z',
    personName: null,
    enteredByName: null,
    runningFunds: 0,
    ...over
  };
}

function renderTable(rows: LedgerRow[]) {
  return render(
    <FinanceWorkspace
      canManage={false}
      rows={rows}
      people={[]}
      reconciliation={[]}
      sort="date"
      dir="desc"
      filters={{}}
      activityLabels={[]}
      kinds={KINDS}
    />
  );
}

describe('FinanceWorkspace — running Total Funds column', () => {
  it('TotalFundsHeader_RendersToTheRightOfAmount', () => {
    renderTable([row({ id: 1 })]);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    const amountIdx = headers.indexOf('Amount');
    expect(amountIdx).toBeGreaterThan(-1);
    expect(headers[amountIdx + 1]).toBe('Total Funds');
  });

  it('TotalFundsCell_ShowsEachRowsRunningFunds_FormattedAsDollars', () => {
    renderTable([
      row({ id: 2, amount: -25.5, runningFunds: 74.5 }),
      row({ id: 1, amount: 100, runningFunds: 100 })
    ]);
    const body = screen.getAllByRole('rowgroup')[1];
    const rows = within(body).getAllByRole('row');
    const lastNumeric = (r: HTMLElement) => within(r).getAllByRole('cell').at(-1)?.textContent?.trim();
    expect(lastNumeric(rows[0])).toBe('$74.50');
    expect(lastNumeric(rows[1])).toBe('$100.00');
  });

  it('EmptyState_SpansEveryColumn_IncludingTotalFunds', () => {
    renderTable([]);
    const headerCount = screen.getAllByRole('columnheader').length;
    const empty = screen.getByText('No transactions match this filter.');
    expect(Number(empty.getAttribute('colspan'))).toBe(headerCount);
  });
});

describe('FinanceWorkspace — Kind pill tints', () => {
  it('KindPills_CarryDistinctTintClasses_ForDistinctKinds', () => {
    renderTable([
      row({ id: 1, kind: 'event_fee' }),
      row({ id: 2, kind: 'fundraiser' }),
      row({ id: 3, kind: 'donation' })
    ]);
    const pills = [screen.getByText('Event'), screen.getByText('fundraiser'), screen.getByText('donation')];
    const tintClass = (el: HTMLElement) => [...el.classList].find((c) => /kindTint\d+/.test(c));
    const tints = pills.map(tintClass);
    expect(tints.every(Boolean)).toBe(true);
    expect(new Set(tints).size).toBe(3);
  });

  it('KindPill_FallsBackToNeutral_ForAKindNotInTheGovernedList', () => {
    renderTable([row({ id: 1, kind: 'legacy_mystery' })]);
    const pill = screen.getByText('legacy_mystery');
    expect([...pill.classList].some((c) => /kindTint\d+/.test(c))).toBe(false);
  });
});

describe('FinanceWorkspace — Method column', () => {
  it('MethodHeader_RendersJustLeftOfAmount', () => {
    renderTable([row({ id: 1 })]);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(headers[headers.indexOf('Amount') - 1]).toBe('Method');
  });

  it('MethodCell_ShowsHowTheMoneyMoved_InPlainWords', () => {
    renderTable([row({ id: 1, method: 'venmo' }), row({ id: 2, method: 'card' })]);
    expect(screen.getByText('Venmo')).toBeTruthy();
    expect(screen.getByText('Card (Stripe)')).toBeTruthy();
  });

  it('MethodCell_ShowsADash_WhenNoMethodWasRecorded', () => {
    renderTable([row({ id: 1, method: null })]);
    const body = screen.getAllByRole('rowgroup')[1];
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    const cells = within(within(body).getAllByRole('row')[0]).getAllByRole('cell');
    expect(cells[headers.indexOf('Method')].textContent?.trim()).toBe('—');
  });
});

describe('FinanceWorkspace — Bucket naming (Patrick, 2026-10-17)', () => {
  it('LedgerGrid_CallsTheThemeColumn_Bucket', () => {
    renderTable([row({ id: 1, activity_label: "Wreaths '26" })]);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(headers).toContain('Bucket');
    expect(headers).not.toContain('Activity');
  });
});
