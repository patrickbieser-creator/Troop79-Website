import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckoutForm, type CheckoutProps } from '../src/app/(public)/wreaths/_components/checkout-form';
import { validateCheckout } from '../src/lib/wreaths/checkout-validate';

/**
 * The wreath checkout as a customer drives it. The server action is the mock boundary: these tests assert what the
 * form SENDS and what it SHOWS; what the server does with it is tests/wreath-order.test.ts.
 */
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const items: CheckoutProps['items'] = [
  { id: 11, catalogNumber: 1, name: 'Wreath', size: '20″', description: '', price: 26, imageUrl: null, section: 'wreaths', donatable: true },
  { id: 12, catalogNumber: 3, name: 'Wreath', size: '36″', description: '', price: 42, imageUrl: null, section: 'wreaths', donatable: false }
];
const rules = { deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 1.99, feeFixed: 0.49 };

function seedCart(lines: Record<string, number>) {
  window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines, seller: null }));
}

function setup(over: Partial<CheckoutProps> = {}, action = vi.fn(async () => ({ ok: true as const, token: 'tok', orderNumber: 'W-1', created: true }))) {
  render(<CheckoutForm items={items} scout={null} rules={rules} searchSellers={async () => []} pickupText="Sat, Nov 21, 2:30 to 4:30 PM, Northwoods lot" distributionDay="Saturday, November 21, 2026" graceCutoff={null} action={action} {...over} />);
  return action;
}

beforeEach(() => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  window.sessionStorage.clear();
  push.mockClear();
});

describe('checkout form', () => {
  it('Checkout_MarksEveryProblemInPlace_AndSaysWhy_WhenPlaceOrderIsPressedIncomplete', async () => {
    seedCart({ '11': 1 });
    const action = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText(/Can’t place the order yet: check .*name.*email.*phone/)).toBeTruthy();
    expect(screen.getByText('Enter your name.')).toBeTruthy();
    expect(screen.getByText('Choose pickup or delivery.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-invalid')).toBe('true');
    expect(action).not.toHaveBeenCalled();
    // The button stays enabled: blocked is not the same as nothing to do.
    expect((screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Checkout_RefusesDelivery_ForAZipOutsideTheArea_AndOffersPickup', async () => {
    seedCart({ '11': 1 });
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    await user.type(screen.getByRole('textbox', { name: 'Delivery zip' }), '60601');
    expect(await screen.findByText(/We can’t deliver to 60601/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Switch to pickup' }));
    expect((screen.getByRole('radio', { name: /Pick up/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('Checkout_OffersTheRelativeBox_OnAScoutLink_ForAZipOutsideTheArea', async () => {
    seedCart({ '11': 1 });
    setup({ scout: { slug: 'ben-b', name: 'Ben B.', firstName: 'Ben' } });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Delivery zip' }), '60601');
    expect(await screen.findByRole('checkbox', { name: /I am a relative, and Ben has agreed to deliver to me/ })).toBeTruthy();
  });

  it('Checkout_SendsTheCartAndDetails_AndGoesToTheConfirmation', async () => {
    seedCart({ '11': 2, '12': 1 });
    const action = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Pick up/ }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pat Buyer');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'pat@example.test');
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '414-555-0100');
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/wreaths/order/tok'));
    const sent = (action.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(sent.lines).toEqual([
      { itemId: 11, quantity: 2, donated: false },
      { itemId: 12, quantity: 1, donated: false }
    ]);
    expect(sent).toMatchObject({ sellerSlug: null, fulfillment: 'pickup', coverFee: false, website: '' });
    expect(sent.customer).toMatchObject({ name: 'Pat Buyer', email: 'pat@example.test' });
    // The cart is emptied once the order is in.
    expect(JSON.parse(window.localStorage.getItem('wreath-cart-v1') ?? '{}').lines).toEqual({});
  });

  it('Checkout_ShowsTheServersReason_WhenTheOrderIsRefused', async () => {
    seedCart({ '11': 1 });
    const action = vi.fn(async () => ({ ok: false as const, code: 'closed' as const, error: 'Sorry, the wreath sale isn’t taking new orders right now.' }));
    setup({}, action as never);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Pick up/ }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pat Buyer');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'pat@example.test');
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '414-555-0100');
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText(/isn’t taking new orders right now/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('Checkout_AfterTheFinalCutoff_FinishesOnlyACheckoutBegunBeforeIt', () => {
    seedCart({ '11': 1 });
    // The cutoff passed before this tab's checkout began, so the grace window does not apply.
    setup({ graceCutoff: '2026-10-01T00:00:00.000Z' });
    expect(screen.getByText(/Sales have closed/)).toBeTruthy();
  });
});

describe('validateCheckout', () => {
  const base = {
    hasLines: true,
    allDonated: false,
    scoutFirstName: null,
    method: 'pickup' as const,
    deliveryZipPrefix: '532',
    zip: '',
    relative: false,
    name: 'A',
    email: 'a@b.co',
    phone: '4145550100',
    street: '',
    city: '',
    giftOther: false,
    giftAmount: 0
  };
  it('Validate_PassesAWholePickupOrder', () => {
    expect(validateCheckout(base)).toEqual([]);
  });
  it('Validate_AllDonatedOrderNeedsNoAddressOrMethod', () => {
    expect(validateCheckout({ ...base, allDonated: true, method: '' })).toEqual([]);
  });
  it('Validate_ScoutDeliveryNeedsAZip_AndTheRelativeBoxOutsideTheArea', () => {
    const scout = { ...base, scoutFirstName: 'Ben', method: '' as const, street: '1 St', city: 'M' };
    expect(validateCheckout(scout).map((p) => p.field)).toEqual(['zip']);
    expect(validateCheckout({ ...scout, zip: '60601' }).map((p) => p.field)).toEqual(['relative']);
    expect(validateCheckout({ ...scout, zip: '60601', relative: true })).toEqual([]);
  });
});
