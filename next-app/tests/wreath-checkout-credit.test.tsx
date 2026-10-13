import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckoutForm, type CheckoutProps } from '../src/app/(public)/wreaths/_components/checkout-form';

/** The optional "give a scout credit" box on the general-store checkout. The type-ahead server action is the mock boundary. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const items: CheckoutProps['items'] = [
  { id: 11, catalogNumber: 1, name: 'Wreath', size: '20″', description: '', price: 26, imageUrl: null, section: 'wreaths', donatable: true }
];
const rules = { deliveryZipPrefix: '532', deliveryFee: 5, deliveryFreeAt: 50, feePercent: 1.99, feeFixed: 0.49 };
const search = vi.fn(async (prefix: string) => (prefix.toLowerCase().startsWith('be') ? [{ id: 7, name: 'Ben B.' }] : []));

function setup(over: Partial<CheckoutProps> = {}) {
  const action = vi.fn(async () => ({ ok: true as const, token: 'tok', orderNumber: 'W-1', created: true }));
  render(
    <CheckoutForm items={items} scout={null} rules={rules} pickupText="Sat" distributionDay="Saturday" graceCutoff={null} action={action} searchSellers={search} {...over} />
  );
  return action;
}

async function fillAndPlace(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /Pick up/ }));
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pat Buyer');
  await user.type(screen.getByRole('textbox', { name: 'Email' }), 'pat@example.test');
  await user.type(screen.getByRole('textbox', { name: 'Phone' }), '414-555-0100');
  await user.click(screen.getByRole('button', { name: 'Place order' }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('wreath-cart-v1', JSON.stringify({ lines: { '11': 1 }, seller: null }));
  search.mockClear();
});

describe('credit a scout at checkout', () => {
  it('CheckoutCredit_DefaultsToTroop_AndIsOptional', async () => {
    const action = setup();
    const user = userEvent.setup();
    expect(screen.getByText('Credit: Troop 79')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    await fillAndPlace(user);
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect((action.mock.calls[0] as unknown[])[0]).toMatchObject({ creditSellerId: null });
  });

  it('CheckoutCredit_TypeAheadAsksTheServerAfterTwoLetters_AndPickingSendsTheSellerId', async () => {
    const action = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Know a scout in Troop 79/ }));
    const box = screen.getByRole('searchbox');
    await user.type(box, 'b');
    expect(search).not.toHaveBeenCalled();
    await user.type(box, 'e');
    await user.click(await screen.findByRole('button', { name: 'Give Ben B. credit' }));
    expect(screen.getByText('Credit: Ben B.')).toBeTruthy();
    await fillAndPlace(user);
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect((action.mock.calls[0] as unknown[])[0]).toMatchObject({ creditSellerId: 7, fulfillment: 'pickup' });
  });

  it('CheckoutCredit_NoTheTroop_RemovesThePick', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Know a scout in Troop 79/ }));
    await user.type(screen.getByRole('searchbox'), 'be');
    await user.click(await screen.findByRole('button', { name: 'Give Ben B. credit' }));
    await user.click(screen.getByRole('button', { name: 'No, the troop' }));
    expect(screen.getByText('Credit: Troop 79')).toBeTruthy();
  });

  // Chrome ignores autocomplete="off" on anything it takes for a name field and offers the visitor's own saved
  // contacts over our scout list (Patrick, 2026-10-13). An unrecognised token turns its address autofill off.
  it('CheckoutCredit_SearchBox_UsesAnAutocompleteTokenChromeDoesNotAutofill', async () => {
    setup();
    await userEvent.setup().click(screen.getByRole('button', { name: /Know a scout in Troop 79/ }));
    expect(screen.getByRole('searchbox').getAttribute('autocomplete')).toBe('troop79-scout-search');
  });

  // Chrome's name heuristics match "first … name" in the label and hint, so neither may say it.
  it('CheckoutCredit_SearchBox_LabelAndHintAvoidChromesFirstNamePattern', async () => {
    setup();
    await userEvent.setup().click(screen.getByRole('button', { name: /Know a scout in Troop 79/ }));
    expect(screen.getByRole('searchbox').closest('div')?.parentElement?.textContent ?? '').not.toMatch(/first.*name/i);
  });

  it('CheckoutCredit_NotOfferedOnScoutLinkCheckout', () => {
    setup({ scout: { slug: 'ben-b', name: 'Ben B.', firstName: 'Ben' } });
    expect(screen.queryByRole('button', { name: /Know a scout in Troop 79/ })).toBeNull();
  });
});
