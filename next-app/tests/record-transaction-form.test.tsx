import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordTransactionForm } from '../src/app/admin/(workspace)/finance/finance-workspace';

/**
 * Matches edit-transaction-dialog.test.tsx's Who coverage — the same "Who
 * applies beyond scout_account" fix (2026-08-19), on the entry side instead
 * of the edit side.
 */
const PEOPLE = [
  { id: 1, display_name: 'Kevin Pieper' },
  { id: 2, display_name: 'Hazel Stollenwerk' }
];

describe('RecordTransactionForm — Who field', () => {
  it('Who_IsSelectable_ForANonScoutAccountTransaction', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={onSubmit} />);

    // Default account is 'checking' (see the component's initial state).
    await user.selectOptions(screen.getByLabelText('Scout/Adult'), '2');
    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ personId: 2 }));
  });

  it('Who_IsOptional_ForANonScoutAccountTransaction', () => {
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Scout/Adult')).toHaveProperty('required', false);
  });

  it('Who_IsRequired_WhenAccountIsScoutAccount', async () => {
    const user = userEvent.setup();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Account'), 'scout_account');
    expect(screen.getByLabelText('Scout/Adult')).toHaveProperty('required', true);
  });
});

describe('RecordTransactionForm — Kind and Direction are independent', () => {
  /** Same removal as edit-transaction-dialog.test.tsx — Kind no longer
   *  implies or auto-sets a Direction, and there is no more mismatch
   *  warning (2026-08-20). */
  it('KindChange_NeverTouchesDirection', async () => {
    const user = userEvent.setup();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    // Default is kind='expense', direction='out'. Deliberately set Direction
    // to 'in' first so a Kind change has something to (wrongly) overwrite if
    // the coupling ever crept back in.
    await user.selectOptions(screen.getByLabelText('Direction'), 'in');
    await user.selectOptions(screen.getByLabelText('Kind'), 'income');
    expect(screen.getByLabelText('Direction')).toHaveProperty('value', 'in');
  });

  it('NoMismatchWarning_EverAppears_ForAnyKindAndDirectionCombination', async () => {
    const user = userEvent.setup();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Kind'), 'expense');
    await user.selectOptions(screen.getByLabelText('Direction'), 'in');
    expect(screen.queryByText(/usually goes/i)).toBeNull();
  });

  it('Submit_UsesWhateverKindAndDirectionAreSelected_NeverBlocked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={onSubmit} />);
    await user.selectOptions(screen.getByLabelText('Kind'), 'income');
    await user.selectOptions(screen.getByLabelText('Direction'), 'out');
    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: /add transaction/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'income', amount: -25 }));
  });
});
