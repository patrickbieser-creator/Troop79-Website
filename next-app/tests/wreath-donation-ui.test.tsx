import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreView } from '../src/app/(public)/wreaths/_components/store-view';
import { CheckoutForm, type CheckoutProps } from '../src/app/(public)/wreaths/_components/checkout-form';
import type { StoreItem } from '../src/lib/wreaths/public';
import type { AdminSale } from '../src/lib/wreaths/admin-data';

/**
 * W-3, "Donate to Troop 79" (Patrick, 2026-10-19), as a customer and the treasurer drive it: the store's donate block
 * puts a Donation line in the cart, a cart with only a donation checks out with no delivery step, the cart's donation
 * IS the checkout's (never counted twice), and Settings takes the scouts' share 0 to 100.
 */
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => '/wreaths' }));
const saveSettings = vi.fn(async () => ({ ok: true }));
vi.mock('../src/app/admin/(workspace)/finance/wreaths/actions', () => ({ saveSettings }));
const { SettingsForm } = await import('../src/app/admin/(workspace)/finance/wreaths/settings-form');

const items: StoreItem[] = [{ id: 11, catalogNumber: 1, name: 'Wreath', size: '20″', description: 'd', price: 26, imageUrl: null, section: 'wreaths', donatable: false }];
const rules = { deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 1.99, feeFixed: 0.49 };
const cart = () => JSON.parse(window.localStorage.getItem('wreath-cart-v1') ?? '{}') as { lines: Record<string, number>; donation: number };

function checkout(action = vi.fn(async () => ({ ok: true as const, token: 'tok', orderNumber: 'W-1', created: true })), over: Partial<CheckoutProps> = {}) {
  render(<CheckoutForm items={items} scout={null} rules={rules} searchSellers={async () => []} pickupText="Sat, Nov 21" distributionDay="Saturday, November 21, 2026" graceCutoff={null} action={action} {...over} />);
  return action;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  window.sessionStorage.clear();
  push.mockClear();
  saveSettings.mockClear();
});

describe('Donate to Troop 79 on the store', () => {
  it('Store_PresetPutsADonationLineInTheCart', async () => {
    render(<StoreView items={items} scout={null} head={null} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '$25' }));
    const aside = screen.getByRole('complementary');
    expect([cart().donation, within(aside).getByText('Donation to Troop 79') !== null, within(aside).getByRole('link', { name: 'Checkout' }) !== null]).toEqual([25, true, true]);
  });

  it('Store_OtherAmount_RefusesNothingOrTooMuch_AndAddsAValidOne', async () => {
    render(<StoreView items={items} scout={null} head={null} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Other amount' }));
    const box = screen.getByRole('textbox', { name: /Donation amount/ });
    await user.type(box, '600');
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    const refused = [box.getAttribute('aria-invalid'), cart().donation ?? 0];
    await user.clear(box);
    await user.type(box, '12.50');
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect([refused, cart().donation]).toEqual([['true', 0], 12.5]);
  });

  it('Store_ScoutPage_SaysTheScoutsShareOfTheDonation', () => {
    render(<StoreView items={items} scout={{ slug: 'ben-b', name: 'Ben B.', firstName: 'Ben' }} head={null} donationShare={0.15} />);
    expect(screen.getByText(/15% of it goes into Ben’s scout account/)).toBeTruthy();
  });

  it('Store_RemoveTakesTheDonationOut', async () => {
    window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: {}, seller: null, donation: 10 }));
    render(<StoreView items={items} scout={null} head={null} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove the donation' }));
    expect(cart().donation).toBe(0);
  });
});

describe('checkout with a donation', () => {
  it('Checkout_DonationOnlyCart_SkipsDelivery_AndPlacesTheOrder', async () => {
    window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: {}, seller: null, donation: 25 }));
    const action = checkout();
    const user = userEvent.setup();
    const noDelivery = screen.queryByRole('heading', { name: 'Getting your wreaths' });
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ann Giver');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ann@example.test');
    await user.click(screen.getByRole('button', { name: 'Donate' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/wreaths/order/tok'));
    const sent = (action.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect([noDelivery, sent.lines, sent.gift, sent.fulfillment]).toEqual([null, [], 25, null]);
  });

  it('Checkout_CartDonationIsTheCheckoutDonation_CountedOnce', () => {
    window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 1 }, seller: null, donation: 25 }));
    checkout();
    const total = screen.getByRole('heading', { name: 'Total' }).closest('section')!;
    expect([screen.getByRole('button', { name: '$25' }).getAttribute('aria-pressed'), within(total).getByText('$51.00') !== null]).toEqual(['true', true]);
  });

  it('Checkout_ChangingTheDonationAtCheckout_UpdatesTheCart', async () => {
    window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 1 }, seller: null, donation: 25 }));
    checkout();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '$10' }));
    expect(cart().donation).toBe(10);
  });

  it('Checkout_DonationOnly_OffersNoCardFeeCover', async () => {
    window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: {}, seller: null, donation: 25 }));
    checkout(undefined, { cardLive: true, startCard: vi.fn() });
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Card/ }));
    expect(screen.queryByRole('checkbox', { name: /cover the card fee/ })).toBeNull();
  });
});

describe('Settings › scouts’ share of cash donations', () => {
  const sale: AdminSale = {
    id: 1, year: 2026, status: 'open', round1Cutoff: '2026-10-21T04:59:00.000Z', round2Cutoff: '2026-11-16T05:59:00.000Z', distributionDate: '2026-11-21', distributionWindow: '', distributionPlace: '',
    deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 1.99, feeFixed: 0.49, scoutShare: 0.3, donationShare: 0.15, orderCc: []
  };
  const field = () => screen.getByLabelText('Scouts’ share of cash donations (%)') as HTMLInputElement;

  it('Settings_ShowsTheSavedShare', () => {
    render(<SettingsForm sale={sale} />);
    expect(field().value).toBe('15');
  });

  it('Settings_RefusesAShareOver100_InPlace', () => {
    render(<SettingsForm sale={sale} />);
    fireEvent.change(field(), { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    expect([field().getAttribute('aria-invalid'), saveSettings.mock.calls.length]).toEqual(['true', 0]);
  });

  it('Settings_SavesAChangedShare', async () => {
    render(<SettingsForm sale={sale} />);
    fireEvent.change(field(), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect((saveSettings.mock.calls[0] as unknown as [number, { donationSharePercent: number }])[1].donationSharePercent).toBe(20);
  });
});
