import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PayByCard } from '../src/app/(public)/wreaths/order/[token]/pay-by-card';
import { cardWasChosen } from '../src/lib/wreaths/public';

/**
 * Patrick, 2026-10-19 (W-1040): a customer who chose Venmo or PayPal at checkout saw the whole card block on the receipt
 * page — fee box and "Pay $32.00 by card". The Venmo / PayPal way now shows only a link ("Rather pay by card?"); the fee
 * box and the Pay button come only once they open it. A card order keeps the whole block.
 */
describe('PayByCard — the way the customer chose', () => {
  it('ReceiptPage_VenmoOrPayPalOrder_ShowsOnlyTheCardLink', () => {
    render(<PayByCard token="tok" baseTotal={32} fee={1.27} initiallyCovered={false} cardChosen={false} startCard={vi.fn()} />);
    expect([
      screen.getByRole('button', { name: /Rather pay by card\?/ }) !== null,
      screen.queryByRole('checkbox', { name: /cover the card fee/ }),
      screen.queryByRole('button', { name: /^Pay .* by card$/ })
    ]).toEqual([true, null, null]);
  });

  it('ReceiptPage_VenmoOrPayPalOrder_OpeningTheLink_ShowsTheFeeBoxAndPayButton', async () => {
    const user = userEvent.setup();
    render(<PayByCard token="tok" baseTotal={32} fee={1.27} initiallyCovered={false} cardChosen={false} startCard={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Rather pay by card\?/ }));
    expect([screen.getByRole('checkbox', { name: /cover the card fee/ }) !== null, screen.getByRole('button', { name: 'Pay $32.00 by card' }) !== null]).toEqual([true, true]);
  });

  it('ReceiptPage_CardOrder_ShowsTheWholeBlock', () => {
    render(<PayByCard token="tok" baseTotal={32} fee={1.27} initiallyCovered={false} cardChosen={true} startCard={vi.fn()} />);
    expect([screen.queryByRole('button', { name: /Rather pay by card\?/ }), screen.getByRole('checkbox', { name: /cover the card fee/ }) !== null, screen.getByRole('button', { name: 'Pay $32.00 by card' }) !== null]).toEqual([null, true, true]);
  });

  it('ReceiptPage_DonationOnlyVenmoOrder_ShowsTheLink_AndNoFeeBoxOnceOpened', async () => {
    const user = userEvent.setup();
    render(<PayByCard token="tok" baseTotal={25} fee={0} initiallyCovered={false} cardChosen={false} startCard={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Rather pay by card\?/ }));
    expect([screen.queryByRole('checkbox'), screen.getByRole('button', { name: 'Pay $25.00 by card' }) !== null]).toEqual([null, true]);
  });
});

describe('cardWasChosen', () => {
  it('CardChosen_WhenACardCheckoutWasStarted_OrTheCustomerCameBackFromStripe', () => {
    expect([cardWasChosen({ cardStarted: true }, false), cardWasChosen({ cardStarted: false }, true), cardWasChosen({ cardStarted: false }, false)]).toEqual([true, true, false]);
  });
});
