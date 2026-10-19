import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntryAside } from '../src/app/(public)/wreaths/_components/entry-mode';

/**
 * "Order for someone I know" with only a donation (Patrick, 2026-10-19, Lily P's page): the entry form takes a
 * donation with no wreath, labels it "Donation to Troop 79", and an empty order says "Add a wreath or a donation."
 */
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const setup = () => {
  const action = vi.fn(async () => ({ ok: true as const, token: 't', orderNumber: 'W-1', created: true, confirmedTo: [] }));
  const onPlaced = vi.fn();
  render(<EntryAside scout={{ slug: 'lily-p', firstName: 'Lily' }} lines={[]} itemsTotal={0} action={action} onPlaced={onPlaced} formId="entry-form" />);
  return { action, onPlaced };
};

describe('entering a donation-only order', () => {
  it('EntryForm_LabelsTheFieldDonationToTroop79', () => {
    setup();
    expect(screen.getByRole('textbox', { name: /^Donation to Troop 79/ })).toBeTruthy();
  });

  it('EntryForm_PlacesADonationWithNoWreath', async () => {
    const { action, onPlaced } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Customer name' }), 'Aunt Jo');
    await user.type(screen.getByRole('textbox', { name: /^Donation to Troop 79/ }), '100');
    await user.click(screen.getByRole('button', { name: /Place order/ }));
    await waitFor(() => expect(onPlaced).toHaveBeenCalled());
    const sent = (action.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect([sent.lines, sent.gift]).toEqual([[], 100]);
  });

  it('EntryForm_EmptyOrder_SaysAddAWreathOrADonation', async () => {
    const { action } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Customer name' }), 'Aunt Jo');
    await user.click(screen.getByRole('button', { name: /Place order/ }));
    expect([screen.getAllByText('The order is empty. Add a wreath or a donation.').length > 0, action.mock.calls.length]).toEqual([true, 0]);
  });

  it('EntryForm_DonationUnderOneDollar_IsMarkedInPlace', async () => {
    const { action } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Customer name' }), 'Aunt Jo');
    await user.type(screen.getByRole('textbox', { name: /^Donation to Troop 79/ }), '0.50');
    await user.click(screen.getByRole('button', { name: /Place order/ }));
    expect([screen.getByRole('textbox', { name: /^Donation to Troop 79/ }).getAttribute('aria-invalid'), action.mock.calls.length]).toEqual(['true', 0]);
  });
});
