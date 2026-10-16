import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PayByCard } from '../src/app/(public)/wreaths/order/[token]/pay-by-card';

/**
 * The receipt page's "Pay by card" box (Release B): it sits BELOW the Venmo / PayPal instructions (the no-fee way stays
 * first), offers the optional cover-the-fee box, and hands the order's token to the server action.
 */
describe('PayByCard', () => {
  it('ReceiptPage_PayByCard_ShowsTheTotalWithoutTheFee_ByDefault', () => {
    render(<PayByCard token="tok" baseTotal={52} fee={1.52} initiallyCovered={false} startCard={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pay $52.00 by card' })).toBeTruthy();
  });

  it('ReceiptPage_PayByCard_CoveringTheFee_RaisesTheButtonTotal', async () => {
    const user = userEvent.setup();
    render(<PayByCard token="tok" baseTotal={52} fee={1.52} initiallyCovered={false} startCard={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: /cover the card fee/ }));
    expect(screen.getByRole('button', { name: 'Pay $53.52 by card' })).toBeTruthy();
  });

  it('ReceiptPage_PayByCard_SendsTheTokenAndTheFeeChoice', async () => {
    const user = userEvent.setup();
    const startCard = vi.fn(async () => ({ ok: false as const, error: 'Card payment isn’t working right now.' }));
    render(<PayByCard token="tok" baseTotal={52} fee={1.52} initiallyCovered={true} startCard={startCard} />);
    await user.click(screen.getByRole('button', { name: 'Pay $53.52 by card' }));
    await waitFor(() => expect(startCard).toHaveBeenCalledWith('tok', true));
    expect(screen.getByText('Card payment isn’t working right now.')).toBeTruthy();
  });
});
