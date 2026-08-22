import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditTransactionDialog } from '../src/app/admin/(workspace)/finance/edit-transaction-dialog';
import type { LedgerRow, ReconciliationSummaryRow } from '../src/app/admin/(workspace)/finance/actions';

/**
 * The "Who" edit fix (Patrick, 2026-08-19: "why can't the who field serve
 * both purposes... this needs to be added to correct mistakes").
 *
 * The regression this specifically guards against: the Edit dialog used to
 * gate the person field on `account === 'scout_account'` — both hiding the
 * field and, worse, its submit handler unconditionally sent `personId: null`
 * for any other account. That meant editing ANY field (date, memo, amount)
 * on a checking/savings row that already carried a real Who — exactly the
 * shape of the 74 rows the same-day historical backfill produced — silently
 * wiped it out on save. `Who_SurvivesEditingAnUnrelatedField` is the test
 * that would have caught this before it ever shipped.
 */

const PEOPLE = [
  { id: 1, display_name: 'Kevin Pieper' },
  { id: 2, display_name: 'Hazel Stollenwerk' }
];

// Mirrors the transaction_kinds seed (20260820220000_transaction_kinds_lookup.sql).
const KINDS = [
  { code: 'event_fee', label: 'Event', sort_order: 10 },
  { code: 'fundraiser', label: 'fundraiser', sort_order: 20 },
  { code: 'donation', label: 'donation', sort_order: 30 },
  { code: 'expense', label: 'expense', sort_order: 40 },
  { code: 'reimbursement', label: 'reimbursement', sort_order: 50 },
  { code: 'transfer', label: 'transfer', sort_order: 60 },
  { code: 'interest', label: 'interest', sort_order: 70 },
  { code: 'adjustment', label: 'adjustment', sort_order: 80 },
  { code: 'income', label: 'income', sort_order: 90 }
];

function checkingRow(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 101,
    occurred_on: '2026-06-09',
    account: 'checking',
    amount: 593.95,
    kind: 'event_fee',
    method: 'check',
    person_id: 1,
    personName: 'Kevin Pieper',
    memo: 'Kevin Pieper',
    activity_label: "High Adventure Trip '26",
    voided_at: null,
    entered_by_person_id: null,
    enteredByName: null,
    created_at: '2026-06-09T00:00:00Z',
    runningFunds: 0,
    ...over
  };
}

function scoutAccountRow(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    ...checkingRow(),
    account: 'scout_account',
    amount: -146.05,
    runningFunds: 0,
    ...over
  };
}

const RECONCILIATION: ReconciliationSummaryRow[] = [];

describe('EditTransactionDialog — Who field', () => {
  it('Who_SurvivesEditingAnUnrelatedField_OnANonScoutAccountRow', async () => {
    // The core regression guard: open Edit on a checking row that already
    // carries a Who, change only the Memo, save — Who must be preserved.
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <EditTransactionDialog
        row={checkingRow()}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        activityLabels={[]}
        kinds={KINDS}
        pending={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    const memo = screen.getByLabelText('Memo');
    await user.clear(memo);
    await user.type(memo, 'Updated memo text');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ personId: 1 }));
  });

  it('Who_IsEditable_OnANonScoutAccountRow', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <EditTransactionDialog
        row={checkingRow()}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        activityLabels={[]}
        kinds={KINDS}
        pending={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    await user.selectOptions(screen.getByLabelText('Scout/Adult'), '2');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ personId: 2 }));
  });

  it('Who_CanBeClearedToUnattributed_OnANonScoutAccountRow', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <EditTransactionDialog
        row={checkingRow()}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        activityLabels={[]}
        kinds={KINDS}
        pending={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    await user.selectOptions(screen.getByLabelText('Scout/Adult'), '');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ personId: null }));
  });

  it('Who_RemainsRequired_OnAScoutAccountRow', () => {
    render(
      <EditTransactionDialog
        row={scoutAccountRow()}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        activityLabels={[]}
        kinds={KINDS}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Scout/Adult')).toHaveProperty('required', true);
  });

  it('Who_IsOptional_OnANonScoutAccountRow', () => {
    render(
      <EditTransactionDialog
        row={checkingRow()}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        activityLabels={[]}
        kinds={KINDS}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Scout/Adult')).toHaveProperty('required', false);
  });
});

describe('EditTransactionDialog — Kind and Direction are independent', () => {
  /**
   * Kind used to auto-set Direction when the picked Kind had an "implied"
   * one — removed 2026-08-20 after it silently flipped a real transaction's
   * signed amount when a treasurer only meant to fix its category. Kind is
   * now purely a label; changing it must never touch Direction, and there's
   * no more mismatch warning to show (a warning implies a "usual" direction
   * per kind, which is exactly the coupling being removed).
   */
  it('KindChange_NeverTouchesDirection_RegardlessOfWhichKindIsPicked', async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionDialog
        row={checkingRow()} // event_fee, positive amount → Direction starts 'in'
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        activityLabels={[]}
        kinds={KINDS}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    // Switching to a kind that used to imply 'out' must leave Direction at 'in'.
    await user.selectOptions(screen.getByLabelText('Kind'), 'expense');
    expect(screen.getByLabelText('Direction')).toHaveProperty('value', 'in');
  });

  it('NoMismatchWarning_EverAppears_ForAnyKindAndDirectionCombination', async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionDialog
        row={checkingRow({ kind: 'expense', amount: -50 })}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        activityLabels={[]}
        kinds={KINDS}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByText(/usually goes/i)).toBeNull();
    await user.selectOptions(screen.getByLabelText('Direction'), 'in');
    // Still nothing — there is no "usual" direction for a kind anymore.
    expect(screen.queryByText(/usually goes/i)).toBeNull();
  });

  it('Save_ProceedsWithWhateverKindAndDirectionAreSelected_NeverBlocked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <EditTransactionDialog
        row={checkingRow({ kind: 'expense', amount: -50 })}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        activityLabels={[]}
        kinds={KINDS}
        pending={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );
    await user.selectOptions(screen.getByLabelText('Direction'), 'in');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expense', amount: 50 }));
  });
});
