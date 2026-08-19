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
    ...over
  };
}

function scoutAccountRow(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    ...checkingRow(),
    account: 'scout_account',
    amount: -146.05,
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
        pending={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    await user.selectOptions(screen.getByLabelText('Who'), '2');
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
        pending={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    await user.selectOptions(screen.getByLabelText('Who'), '');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ personId: null }));
  });

  it('Who_RemainsRequired_OnAScoutAccountRow', () => {
    render(
      <EditTransactionDialog
        row={scoutAccountRow()}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Who')).toHaveProperty('required', true);
  });

  it('Who_IsOptional_OnANonScoutAccountRow', () => {
    render(
      <EditTransactionDialog
        row={checkingRow()}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Who')).toHaveProperty('required', false);
  });
});

describe('EditTransactionDialog — Kind/Direction overlap', () => {
  it('KindChange_AutoSetsDirection_ToTheImpliedOne', async () => {
    // Row starts as event_fee/in; switching Kind to Expense should flip
    // Direction to "out" without the treasurer touching it (Patrick,
    // 2026-08-19: "there is an overlap between Kind and direction").
    const user = userEvent.setup();
    render(
      <EditTransactionDialog
        row={checkingRow()}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText('Kind'), 'expense');
    expect(screen.getByLabelText('Direction')).toHaveProperty('value', 'out');
  });

  it('KindChange_LeavesDirectionAlone_ForTransferAndAdjustment', async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionDialog
        row={checkingRow({ kind: 'income', amount: 100 })}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    // Starts as income/in (implied 'in' matches the initial sign).
    await user.selectOptions(screen.getByLabelText('Kind'), 'transfer');
    // Ambiguous kind — direction stays whatever it already was ('in').
    expect(screen.getByLabelText('Direction')).toHaveProperty('value', 'in');
  });

  it('Warning_AppearsWhenDirectionIsManuallySetAgainstTheKind', async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionDialog
        row={checkingRow({ kind: 'expense', amount: -50 })}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        pending={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByText(/usually goes/i)).toBeNull();
    await user.selectOptions(screen.getByLabelText('Direction'), 'in');
    expect(screen.getByText(/usually goes/i)).toBeTruthy();
  });

  it('Warning_NeverBlocksSave_EvenWhenKindAndDirectionDisagree', async () => {
    // Nudge, not a block — same pattern as the reconciliation warning (#7).
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <EditTransactionDialog
        row={checkingRow({ kind: 'expense', amount: -50 })}
        people={PEOPLE}
        reconciliation={RECONCILIATION}
        pending={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );
    await user.selectOptions(screen.getByLabelText('Direction'), 'in');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave).toHaveBeenCalled();
  });
});
