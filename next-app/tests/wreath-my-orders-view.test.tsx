import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MyWreathOrdersView } from '../src/app/(public)/member/wreaths/wreath-orders-view';
import { buildSellerView } from '../src/lib/wreaths/my-orders';
import type { AdminOrder } from '../src/lib/wreaths/admin-data';
import type { PublicSale } from '../src/lib/wreaths/public';

// Scout-entered rows render the edit row, which uses the router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/member/wreaths' }));

/** /member/wreaths renders read-only: no form, no field, one Print button; contact only on the delivery list. */
const ME = 100;
const sale = {
  id: 1,
  year: 2026,
  status: 'open',
  distributionDate: '2026-11-21',
  distributionWindow: '2:30 to 4:30 PM',
  distributionPlace: 'Northwoods lot',
  scoutShare: 0.3
} as PublicSale;

function order(id: number, over: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id,
    orderNumber: `W-${1000 + id}`,
    placedAt: '2026-10-12T15:00:00.000Z',
    round: 1,
    source: 'scout_link',
    fulfillment: 'pickup',
    creditedPersonId: ME,
    creditedName: 'Anjali S',
    deliveringPersonId: null,
    customerName: `Buyer ${id}`,
    customerEmail: 'secret@example.test',
    customerPhone: '414-555-0100',
    customerAddress: `${id} Maple St`,
    customerCity: 'Milwaukee',
    customerZip: '53211',
    outsideAreaRelative: false,
    itemsSubtotal: 52,
    deliveryFee: 0,
    feeCovered: 0,
    gift: 0,
    total: 52,
    paymentStatus: 'unpaid',
    paidMethod: null,
    paidAt: null,
    paidAmount: null,
    status: 'placed',
    stripeFee: null,
    refundedAt: null,
    needsRefund: null,
    cardStarted: false,
    enteredByPersonId: null,
    enteredByName: null,
    collectedByScout: false,
    paymentNote: '',
    customerNote: '',
    orderNote: '',
    orderNoteBy: null,
    orderNoteAt: null,
    lines: [{ itemId: 1, label: '20″ Wreath', catalogNumber: 1, quantity: 2, donated: false, amount: 52, unitPrice: 26, unitCost: 16.07 }],
    ...over
  };
}

const view = (orders: AdminOrder[]) => ({ sale, items: [], sellers: [buildSellerView(ME, 'Anjali S', orders, 0.3)] });

describe('MyWreathOrdersView', () => {
  it('MyWreathOrders_RendersReadOnly_NoFormOrFieldOnlyThePrintButton', () => {
    const { container } = render(<MyWreathOrdersView data={view([order(1, { fulfillment: 'scout', deliveringPersonId: ME })])} />);
    expect(container.querySelector('form, input, textarea, select')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Print delivery list']);
  });

  it('MyWreathOrders_MarksAnOrderWhoseCardPaymentWasNotFinished', () => {
    render(<MyWreathOrdersView data={view([order(1, { source: 'store', cardStarted: true })])} />);
    expect(screen.getByText('Card not finished')).toBeTruthy();
  });

  it('MyWreathOrders_ShowsPaidAndOwedPerOrder_AndTheEarningsSoFar', () => {
    render(<MyWreathOrdersView data={view([order(1, { paymentStatus: 'paid' }), order(2)])} />);
    expect(screen.getByText('Paid', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('Owes $52.00')).toBeTruthy();
    expect(screen.getByText('Earned so far').nextSibling?.textContent).toBe('$11.92');
  });

  it('MyWreathOrders_ShowsStillToCollect_WhenTheScoutHasEnteredOrders', () => {
    render(<MyWreathOrdersView data={view([order(1, { source: 'paper', fulfillment: 'scout', total: 26 })])} />);
    expect(screen.getByText('Still to collect').nextSibling?.textContent).toBe('$26.00');
  });

  it('MyWreathOrders_ShowsCollectedToTurnIn_WhenTheScoutHasEnteredOrders', () => {
    render(<MyWreathOrdersView data={view([order(1, { source: 'paper', fulfillment: 'scout', total: 52, collectedByScout: true })])} />);
    expect(screen.getByText('Collected, to turn in').nextSibling?.textContent).toBe('$52.00');
  });

  it('MyWreathOrders_HidesTheCollectTotals_WithOnlyOnlineOrders', () => {
    render(<MyWreathOrdersView data={view([order(1)])} />);
    expect(screen.queryByText('Still to collect')).toBeNull();
  });

  it('MyWreathOrders_MarksCancelledOrders_AndLeavesThemOutOfTheCount', () => {
    render(<MyWreathOrdersView data={view([order(1), order(2, { status: 'cancelled' })])} />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText('Orders', { selector: 'dt' }).nextSibling?.textContent).toBe('1');
  });

  it('MyWreathOrders_DeliveryList_ShowsAddressAndPhone_ForScoutDeliveriesOnly', () => {
    render(<MyWreathOrdersView data={view([order(1, { fulfillment: 'scout', deliveringPersonId: ME }), order(2)])} />);
    const sheet = screen.getByRole('region', { name: 'Anjali S delivery list' });
    expect(within(sheet).getByText(/1 Maple St/)).toBeTruthy();
    expect(within(sheet).getByText('414-555-0100')).toBeTruthy();
    expect(within(sheet).queryByText(/2 Maple St/)).toBeNull();
    expect(screen.queryByText(/2 Maple St/)).toBeNull();
    expect(screen.queryByText(/secret@example.test/)).toBeNull();
    expect(within(sheet).getByText(/Distribution day: Sat, Nov 21/)).toBeTruthy();
  });

  // Patrick, 2026-10-13: a troop-delivered order credited to the scout looked "missing" from the list.
  it('MyWreathOrders_DeliveryList_SaysWhichOrdersItLeavesOut', () => {
    render(<MyWreathOrdersView data={view([order(1, { fulfillment: 'scout', deliveringPersonId: ME })])} />);
    const sheet = screen.getByRole('region', { name: 'Anjali S delivery list' });
    expect(within(sheet).getByText('Only orders Anjali delivers. Orders the troop delivers, or that customers pick up, aren’t on this list.')).toBeTruthy();
  });

  it('MyWreathOrders_GivesAFamilyWithNoSeller_AFriendlyEmptyState', () => {
    render(<MyWreathOrdersView data={{ sale, items: [], sellers: [] }} />);
    expect(screen.getByText(/None of the scouts in this household are selling wreaths/)).toBeTruthy();
  });
});
