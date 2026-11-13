// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import type { HolderRow } from '../src/lib/scout-accounts';

/**
 * Money › Scout Accounts screen (2026-11-12): the holder list (chips, filter, fund last, footer total) and the ledger
 * panel a name opens, with the "Move to troop fund" step for a departed scout.
 */
const history = vi.hoisted(() => vi.fn());
const move = vi.hoisted(() => vi.fn());
vi.mock('../src/app/admin/(workspace)/finance/scout-accounts/actions', () => ({
  getScoutAccountHistoryAction: history,
  moveScoutAccountToTroopAction: move
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => '/admin/finance/scout-accounts',
  useSearchParams: () => new URLSearchParams()
}));

import { ScoutAccountsView } from '../src/app/admin/(workspace)/finance/scout-accounts/scout-accounts-view';

const rows: HolderRow[] = [
  { key: 'p7', personId: 7, name: 'Ann Active', status: 'active', wasScout: true, balance: 20, lastOn: '2026-07-18' },
  { key: 'p10', personId: 10, name: 'Jasper Stollenwerk', status: 'inactive', wasScout: true, balance: 109.49, lastOn: '2025-07-13' },
  { key: 'p24', personId: 24, name: 'Maya Sankpal-Tatera', status: 'adult', wasScout: true, balance: -5, lastOn: '2025-12-20' },
  { key: 'scholarship', personId: null, name: 'Scholarship Fund', status: 'fund', wasScout: false, balance: 760.77, lastOn: '2026-07-18' }
];

const ledger = {
  ok: true as const,
  summary: { balance: 109.49, income: 124.49, expenses: 15, lastOn: '2025-07-13' },
  txns: [
    { id: 2, occurredOn: '2025-07-13', amount: -15, bucketName: "Summer Camp '25", kindLabel: 'Expense', memo: null, enteredBy: 'KPD', voidedAt: null, voidedBy: null, voidReason: null, balanceAfter: 109.49 },
    { id: 3, occurredOn: '2025-01-01', amount: 40, bucketName: null, kindLabel: 'Adjustment', memo: 'typo', enteredBy: null, voidedAt: '2025-01-02T00:00:00Z', voidedBy: 'KPD', voidReason: 'duplicate', balanceAfter: null },
    { id: 1, occurredOn: '2024-11-10', amount: 124.49, bucketName: "Wreaths '24", kindLabel: 'Fundraiser', memo: null, enteredBy: null, voidedAt: null, voidedBy: null, voidReason: null, balanceAfter: 124.49 }
  ]
};

beforeEach(() => {
  history.mockReset().mockResolvedValue(ledger);
  move.mockReset().mockResolvedValue({ ok: true, moved: 109.49 });
  refresh.mockReset();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

function list() {
  return screen.getByRole('table', { name: 'Scout accounts' });
}

describe('the holder list', () => {
  it('marks departed scouts and adults with a chip', () => {
    render(<ScoutAccountsView rows={rows} initialKey={null} canManage />);
    const t = within(list());
    expect([t.getByText('inactive'), t.getByText('adult'), t.getByText('fund')]).toHaveLength(3);
  });
  it('shows a negative balance in parentheses', () => {
    render(<ScoutAccountsView rows={rows} initialKey={null} canManage />);
    expect(within(list()).getByText('($5.00)')).toBeTruthy();
  });
  it('totals scouts and the fund in the footer', () => {
    render(<ScoutAccountsView rows={rows} initialKey={null} canManage />);
    expect(within(list()).getByText('$885.26')).toBeTruthy();
  });
  it('the Inactive filter keeps the fund', () => {
    render(<ScoutAccountsView rows={rows} initialKey={null} canManage />);
    fireEvent.click(screen.getByRole('radio', { name: /Inactive/ }));
    const names = within(list()).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Jasper Stollenwerk', 'Scholarship Fund']);
  });
});

describe('the ledger panel', () => {
  it('opens on the first holder', async () => {
    render(<ScoutAccountsView rows={rows} initialKey={null} canManage />);
    await waitFor(() => expect(history).toHaveBeenCalledWith({ personId: 7 }));
  });
  it('clicking the fund loads the scholarship account', async () => {
    render(<ScoutAccountsView rows={rows} initialKey={null} canManage />);
    fireEvent.click(within(list()).getByRole('button', { name: 'Scholarship Fund' }));
    await waitFor(() => expect(history).toHaveBeenCalledWith({ account: 'scholarship' }));
  });
  it('shows each row with its running balance', async () => {
    render(<ScoutAccountsView rows={rows} initialKey="p10" canManage />);
    const panel = await screen.findByRole('table', { name: /Jasper Stollenwerk/ });
    expect(within(panel).getAllByText('$124.49')).toHaveLength(2);
  });
  it('keeps a voided row, marked Voided with its reason', async () => {
    render(<ScoutAccountsView rows={rows} initialKey="p10" canManage />);
    const panel = await screen.findByRole('table', { name: /Jasper Stollenwerk/ });
    expect(within(panel).getByText(/Voided by KPD: “duplicate”/)).toBeTruthy();
  });
  it('signs a row with initials', async () => {
    render(<ScoutAccountsView rows={rows} initialKey="p10" canManage />);
    const panel = await screen.findByRole('table', { name: /Jasper Stollenwerk/ });
    expect(within(panel).getByText(/Recorded by KPD/)).toBeTruthy();
  });
});

describe('moving a departed scout’s balance to the troop fund', () => {
  it('is offered for a departed scout with money', async () => {
    render(<ScoutAccountsView rows={rows} initialKey="p10" canManage />);
    expect(await screen.findByRole('button', { name: 'Move to troop fund…' })).toBeTruthy();
  });
  it('is not offered for an active scout', async () => {
    render(<ScoutAccountsView rows={rows} initialKey="p7" canManage />);
    await screen.findByRole('table', { name: /Ann Active/ });
    expect(screen.queryByRole('button', { name: 'Move to troop fund…' })).toBeNull();
  });
  it('is not offered to a read-only viewer', async () => {
    render(<ScoutAccountsView rows={rows} initialKey="p10" canManage={false} />);
    await screen.findByRole('table', { name: /Jasper Stollenwerk/ });
    expect(screen.queryByRole('button', { name: 'Move to troop fund…' })).toBeNull();
  });
  it('the confirm names the amount and moves it', async () => {
    render(<ScoutAccountsView rows={rows} initialKey="p10" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move to troop fund…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move $109.49' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith(expect.objectContaining({ personId: 10 })));
  });
  it('a refusal shows in the dialog', async () => {
    move.mockResolvedValue({ ok: false, error: 'This scout is still active.' });
    render(<ScoutAccountsView rows={rows} initialKey="p10" canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move to troop fund…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move $109.49' }));
    expect(await screen.findByText('This scout is still active.')).toBeTruthy();
  });
});
