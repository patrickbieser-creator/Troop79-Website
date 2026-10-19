import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditOrderForm } from '../src/app/admin/(workspace)/finance/wreaths/edit-order-form';
import type { AdminItem, AdminOrder } from '../src/lib/wreaths/admin-data';
import type { SaleRules } from '../src/lib/wreaths/rules';

/**
 * Orders › Edit order as the treasurer drives it (Patrick, 2026-10-18: the wrong item ordered, a different one paid
 * for). The server action is the mock boundary; what it enforces is tests/wreath-edit-order.test.ts.
 */
const edit = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: boolean }>>(async () => ({ ok: true })));
vi.mock('../src/app/admin/(workspace)/finance/wreaths/actions', () => ({ editOrder: edit }));

const rules: SaleRules = { deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 1.99, feeFixed: 0.49, round1Cutoff: '2099-10-26T04:59:00.000Z', round2Cutoff: '2099-11-16T05:59:00.000Z' };
const items: AdminItem[] = [
  { id: 11, catalogNumber: 1, name: 'Wreath', size: '20″', description: '', price: 26, unitCost: 16.07, imageUrl: null, donatable: true, active: true },
  { id: 12, catalogNumber: 3, name: 'Wreath', size: '36″', description: '', price: 42, unitCost: 27.87, imageUrl: null, donatable: false, active: true }
];
function order(over: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 7, orderNumber: 'W-1030', placedAt: '2026-10-18T15:00:00.000Z', round: 1, source: 'store', fulfillment: 'pickup', creditedPersonId: null, creditedName: 'Troop store',
    deliveringPersonId: null, customerName: 'Pat Buyer', customerEmail: 'pat@example.test', customerPhone: '414-555-0100', customerAddress: '', customerCity: '', customerZip: '', outsideAreaRelative: false,
    itemsSubtotal: 42, deliveryFee: 0, feeCovered: 0, gift: 0, total: 42, paymentStatus: 'unpaid', paidMethod: null, paidAt: null, paidAmount: null, status: 'placed', stripeFee: null, refundedAt: null, needsRefund: null, cardStarted: false,
    enteredByPersonId: null, enteredByName: null, collectedByScout: false, paymentNote: '', customerNote: '',
    lines: [{ itemId: 12, label: '36″ Wreath', catalogNumber: 3, quantity: 1, donated: false, amount: 42, unitPrice: 42, unitCost: 27.87 }],
    ...over
  };
}
const paid = (amount: number, total = 42) => order({ paymentStatus: 'paid', paidMethod: 'venmo', paidAmount: amount, total, paidAt: '2026-10-18T16:00:00.000Z' });
const show = (o: AdminOrder) => render(<EditOrderForm order={o} items={items} sellers={[]} rules={rules} onClose={() => {}} />);

beforeEach(() => edit.mockClear());

describe('Edit order', () => {
  it('EditOrderForm_SwappingTheItem_ShowsTheNewTotal_AndSavesTheNewLine', async () => {
    show(order());
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), '11');
    expect(screen.getByText('$26.00')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(edit.mock.calls[0][1]).toMatchObject({ lines: [{ itemId: 11, quantity: 1, donated: false }], seen: { total: 42, paymentStatus: 'unpaid' } });
  });

  it('EditOrderForm_UnpaidOrder_HasNoPaymentSection', () => {
    show(order());
    expect(screen.queryByLabelText('Amount received')).toBeNull();
  });

  it('EditOrderForm_PaidMoreThanTheNewTotal_CountsTheExtraAsAGift', async () => {
    show(paid(42));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), '11');
    await userEvent.click(screen.getByRole('button', { name: 'Count the extra as a gift' }));
    expect((screen.getByLabelText('Gift to Troop 79') as HTMLInputElement).value).toBe('16.00');
  });

  it('EditOrderForm_TotalAboveWhatCameIn_SavesNothingUntilTheShortfallIsAccepted', async () => {
    show(paid(26, 26));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), '12');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(edit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Accept \$16\.00 short/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(edit.mock.calls[0][1]).toMatchObject({ payment: { method: 'venmo', received: 26, acceptShort: true } });
  });

  it('EditOrderForm_ScoutEnteredOrder_OffersNoCustomerEmail', () => {
    show(order({ source: 'paper' }));
    expect(screen.queryByRole('checkbox', { name: /Email the customer/ })).toBeNull();
  });
});
