import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelOrder } from '../src/app/(public)/wreaths/order/[token]/cancel-order';

/**
 * The receipt page's "Cancel this order" (Patrick, 2026-10-16). One quiet button; pressing it asks in place (no browser
 * dialog) and names the consequence; only "Yes, cancel" sends the token to the server action. The server decides.
 */
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => refresh.mockClear());

describe('CancelOrder', () => {
  it('ReceiptPage_Cancel_AsksInPlace_BeforeDoingAnything', async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    render(<CancelOrder token="tok" orderNumber="W-1006" scoutFirstName={null} cancel={cancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel this order' }));
    expect([screen.getByRole('button', { name: 'Yes, cancel W-1006' }) !== null, cancel.mock.calls.length]).toEqual([true, 0]);
  });

  it('ReceiptPage_Cancel_SaysTheScoutLosesCredit_WhenOneIsCredited', async () => {
    const user = userEvent.setup();
    render(<CancelOrder token="tok" orderNumber="W-1006" scoutFirstName="Sam" cancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Cancel this order' }));
    expect(screen.getByText(/Sam loses credit for it/)).toBeTruthy();
  });

  it('ReceiptPage_Cancel_KeepMyOrder_ClosesTheQuestion', async () => {
    const user = userEvent.setup();
    render(<CancelOrder token="tok" orderNumber="W-1006" scoutFirstName={null} cancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Cancel this order' }));
    await user.click(screen.getByRole('button', { name: 'Keep my order' }));
    expect(screen.queryByRole('button', { name: 'Yes, cancel W-1006' })).toBeNull();
  });

  it('ReceiptPage_Cancel_SendsTheToken_AndRefreshesThePage', async () => {
    const cancel = vi.fn(async () => ({ ok: true as const }));
    const user = userEvent.setup();
    render(<CancelOrder token="tok" orderNumber="W-1006" scoutFirstName={null} cancel={cancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel this order' }));
    await user.click(screen.getByRole('button', { name: 'Yes, cancel W-1006' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(cancel).toHaveBeenCalledWith('tok');
  });

  it('ReceiptPage_Cancel_ShowsTheServersReason_WhenRefused', async () => {
    const cancel = vi.fn(async () => ({ ok: false as const, error: 'This order is paid, so it can’t be cancelled here.' }));
    const user = userEvent.setup();
    render(<CancelOrder token="tok" orderNumber="W-1006" scoutFirstName={null} cancel={cancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel this order' }));
    await user.click(screen.getByRole('button', { name: 'Yes, cancel W-1006' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/is paid/);
  });
});
