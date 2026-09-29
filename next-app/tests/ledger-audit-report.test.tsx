import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LedgerAuditReport } from '../src/app/admin/(workspace)/utilities/ledger-audit/ledger-audit-report';
import type { LedgerAuditResult, BankMatchActionResult } from '../src/app/admin/(workspace)/utilities/ledger-audit/actions';
import type { BankMatchReport } from '../src/lib/bank-statement';

/**
 * Ledger Audit report (Plans/Ledger-Audit.md). The server action is passed
 * in as a vi.fn(); the component is what's under test.
 */
const cleanAudit: LedgerAuditResult = {
  findings: [
    { check: 'independent_total', severity: 'info', title: 'Independent re-sum matches to the cent (3 rows)', detail: 'x', txnIds: [] }
  ],
  rows: {},
  rowCount: 3,
  ranAt: '2026-09-29T16:00:00Z'
};

const plugAudit: LedgerAuditResult = {
  findings: [
    {
      check: 'plug',
      severity: 'warning',
      title: '1 balancing adjustment (net $60.04)',
      detail: 'Adjustments made so the ledger would agree with the bank.',
      txnIds: [2038],
      amount: 60.04
    }
  ],
  rows: {
    2038: {
      id: 2038,
      occurred_on: '2026-03-31',
      account: 'checking',
      amount: 60.04,
      kind: 'adjustment',
      memo: "Can't find discrepancy. Acounting adjustment.",
      voided: false
    }
  },
  rowCount: 654,
  ranAt: '2026-09-29T16:00:00Z'
};

function report(over: Partial<BankMatchReport> = {}): BankMatchReport {
  return {
    statement: {
      rowCount: 2,
      pendingCount: 0,
      firstDate: '2025-09-02',
      lastDate: '2025-09-22',
      openingBalance: 3276.01,
      closingBalance: 2939.51,
      chainConsistent: true
    },
    openingDiff: 0,
    closingDiff: -100,
    match: {
      matched: [],
      grouped: [],
      bankOnly: [],
      ledgerOnly: [{ id: 1878, occurred_on: '2025-09-12', amount: -100, memo: 'Samoset Council - Reservation', kind: 'event_fee', method: 'other' }],
      nearMisses: []
    },
    shifts: [],
    bankOnlyTotal: 0,
    ledgerOnlyTotal: -100,
    ...over
  };
}

async function upload(matchAction: (fd: FormData) => Promise<BankMatchActionResult>) {
  const user = userEvent.setup();
  render(<LedgerAuditReport audit={cleanAudit} matchAction={matchAction} />);
  const file = new File(['"Posting Date"'], 'ExportedTransactions.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText('Landmark CSV export'), file);
  await user.click(screen.getByRole('button', { name: 'Compare with bank' }));
}

describe('LedgerAuditReport — ledger checks', () => {
  it('LedgerChecks_SaysNothingToLookAt_WhenOnlyInfoFindings', () => {
    render(<LedgerAuditReport audit={cleanAudit} matchAction={vi.fn()} />);
    expect(screen.getByText(/Nothing to look at/)).toBeTruthy();
  });

  it('LedgerChecks_ListsTheRowsAFindingNames', () => {
    render(<LedgerAuditReport audit={plugAudit} matchAction={vi.fn()} />);
    expect(screen.getByText('#2038')).toBeTruthy();
  });
});

describe('LedgerAuditReport — bank match', () => {
  it('BankMatch_CompareIsDisabled_UntilAFileIsChosen', () => {
    render(<LedgerAuditReport audit={cleanAudit} matchAction={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Compare with bank' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('BankMatch_SendsTheChosenAccountAndAFileField', async () => {
    const matchAction = vi.fn().mockResolvedValue({ ok: true, account: 'checking', report: report() });
    await upload(matchAction);
    const fd = matchAction.mock.calls[0][0] as FormData;
    // jsdom drops an uploaded File's name/contents from a form action's
    // FormData; the field's presence is what it can observe. The real upload
    // is browser-verified.
    expect([fd.get('account'), fd.has('file')]).toEqual(['checking', true]);
  });

  it('BankMatch_ShowsTheActionsError_WhenTheFileIsRejected', async () => {
    await upload(vi.fn().mockResolvedValue({ ok: false, error: "This doesn't look like a Landmark transaction export" }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Landmark transaction export/));
  });

  it('BankMatch_ShowsTheGapAndTheLedgerOnlyRow_WhenTheLedgerDisagrees', async () => {
    await upload(vi.fn().mockResolvedValue({ ok: true, account: 'checking', report: report() }));
    await waitFor(() => expect(screen.getByText(/ledger is −?\$100\.00 below the bank/)).toBeTruthy());
    expect(screen.getByText('#1878')).toBeTruthy();
  });

  it('BankMatch_WarnsThatErrorsCancel_WhenTheBalanceAgreesButRowsDoNot', async () => {
    await upload(vi.fn().mockResolvedValue({ ok: true, account: 'checking', report: report({ closingDiff: 0 }) }));
    await waitFor(() => expect(screen.getByText(/errors that happen to cancel out/)).toBeTruthy());
  });
});
