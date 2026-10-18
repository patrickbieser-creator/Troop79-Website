import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReimbursementQueueRow } from '../src/app/admin/(workspace)/finance/actions';

/**
 * Finance › Reimbursements as the treasurer drives it (Patrick, 2026-10-18): a paid row shows how it was paid instead
 * of a button, and Mark paid can close a request against the ledger payout that already paid it rather than booking
 * a second one. What the actions enforce is tests/reimbursement-pay-db.test.ts.
 */
const acts = vi.hoisted(() => ({
  markPaid: vi.fn<(...a: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true as const })),
  link: vi.fn<(...a: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true as const }))
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../src/app/admin/(workspace)/finance/actions', () => ({
  approveReimbursementAction: vi.fn(async () => ({ ok: true })),
  denyReimbursementAction: vi.fn(async () => ({ ok: true })),
  markReimbursementPaidAction: acts.markPaid,
  linkReimbursementPaymentAction: acts.link
}));

import { ReimbursementQueue } from '../src/app/admin/(workspace)/finance/reimbursements/reimbursement-queue';

function row(over: Partial<ReimbursementQueueRow> = {}): ReimbursementQueueRow {
  return {
    id: 7, requester_person_id: 41, requesterName: 'Jason Porter', amount: 140.43, description: 'Costco order for Brat Fry and Rummage Sale',
    status: 'approved', receipt_path: 'r/7.jpg', receiptUrl: null, denial_reason: null, created_at: '2026-09-27T15:00:00.000Z',
    decided_at: null, paid_at: null, payment: null, paymentCandidates: [], ...over
  };
}
const LEDGER = { id: 2159, occurredOn: '2026-10-08', method: 'venmo', memo: 'Brat Fry Expense from Costco' };

beforeEach(() => {
  acts.markPaid.mockClear();
  acts.link.mockClear();
});

describe('a paid reimbursement', () => {
  it('ReimbursementQueue_PaidRow_ShowsTheDateAndMethod', () => {
    render(<ReimbursementQueue requests={[row({ status: 'paid', payment: { occurredOn: '2026-10-08', method: 'venmo' } })]} />);
    expect(screen.getByText('Oct 8, 2026 · Venmo')).toBeTruthy();
  });

  it('ReimbursementQueue_PaidRow_HasNoMarkPaidButton', () => {
    render(<ReimbursementQueue requests={[row({ status: 'paid', payment: { occurredOn: '2026-10-08', method: 'venmo' } })]} />);
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
  });
});

describe('Mark paid', () => {
  const open = async (r: ReimbursementQueueRow) => {
    const user = userEvent.setup();
    render(<ReimbursementQueue requests={[r]} />);
    await user.click(screen.getByRole('button', { name: 'Mark paid' }));
    return { user, dialog: within(await screen.findByRole('dialog')) };
  };

  it('ReimbursementQueue_MarkPaid_PreselectsTheMatchingLedgerPayout', async () => {
    const { dialog } = await open(row({ paymentCandidates: [LEDGER] }));
    expect((dialog.getByLabelText(/Oct 8, 2026 · Venmo/) as HTMLInputElement).checked).toBe(true);
  });

  it('ReimbursementQueue_MarkPaid_LinksTheChosenLedgerRow_InsteadOfBookingAnother', async () => {
    const { user, dialog } = await open(row({ paymentCandidates: [LEDGER] }));
    await user.click(dialog.getByRole('button', { name: 'Mark paid' }));
    expect([acts.link.mock.calls, acts.markPaid.mock.calls.length]).toEqual([[[7, 2159]], 0]);
  });

  it('ReimbursementQueue_MarkPaid_RecordsANewPayout_WhenThatIsChosen', async () => {
    const { user, dialog } = await open(row({ paymentCandidates: [LEDGER] }));
    await user.click(dialog.getByLabelText(/Record a new payout/));
    await user.selectOptions(dialog.getByLabelText('How it was paid'), 'check');
    await user.click(dialog.getByRole('button', { name: 'Mark paid' }));
    expect([acts.markPaid.mock.calls, acts.link.mock.calls.length]).toEqual([[[7, 'check']], 0]);
  });

  it('ReimbursementQueue_MarkPaid_WithNothingInTheLedger_RecordsANewPayout', async () => {
    const { user, dialog } = await open(row());
    await user.click(dialog.getByRole('button', { name: 'Mark paid' }));
    expect(acts.markPaid.mock.calls).toEqual([[7, 'venmo']]);
  });
});
