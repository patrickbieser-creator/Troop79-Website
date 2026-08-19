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
    await user.selectOptions(screen.getByLabelText('Who'), '2');
    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: /add transaction/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ personId: 2 }));
  });

  it('Who_IsOptional_ForANonScoutAccountTransaction', () => {
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Who')).toHaveProperty('required', false);
  });

  it('Who_IsRequired_WhenAccountIsScoutAccount', async () => {
    const user = userEvent.setup();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Account'), 'scout_account');
    expect(screen.getByLabelText('Who')).toHaveProperty('required', true);
  });
});

describe('RecordTransactionForm — Kind/Direction overlap', () => {
  it('KindChange_AutoSetsDirection_ToTheImpliedOne', async () => {
    // Default state is account=checking, kind=expense, direction=out
    // (already matching) — switch to Income and Direction should flip to in.
    const user = userEvent.setup();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Kind'), 'income');
    expect(screen.getByLabelText('Direction')).toHaveProperty('value', 'in');
  });

  it('Warning_AppearsWhenDirectionContradictsTheKind_AndDisappearsWhenFixed', async () => {
    const user = userEvent.setup();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    // Default kind='expense' auto-implies direction='out' already — no warning.
    expect(screen.queryByText(/usually goes/i)).toBeNull();

    await user.selectOptions(screen.getByLabelText('Direction'), 'in');
    expect(screen.getByText(/usually goes/i)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Direction'), 'out');
    expect(screen.queryByText(/usually goes/i)).toBeNull();
  });

  it('Warning_NeverAppears_ForTransferOrAdjustment_RegardlessOfDirection', async () => {
    const user = userEvent.setup();
    render(<RecordTransactionForm people={PEOPLE} activityLabels={[]} pending={false} onSubmit={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Kind'), 'adjustment');
    await user.selectOptions(screen.getByLabelText('Direction'), 'in');
    expect(screen.queryByText(/usually goes/i)).toBeNull();
    await user.selectOptions(screen.getByLabelText('Direction'), 'out');
    expect(screen.queryByText(/usually goes/i)).toBeNull();
  });
});
