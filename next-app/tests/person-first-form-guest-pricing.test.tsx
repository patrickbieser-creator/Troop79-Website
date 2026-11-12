import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFirstForm from '../src/app/(public)/events/[id]/person-first-form';
import type { EventPrice, EventSignup } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

/**
 * A named guest is priced like a member (Patrick, 2026-11-12: Webelos guests
 * showed $0 owed). A youth guest is offered the scout tiers, an adult guest
 * the adult tiers; one tier is implied, several show a Price pulldown; and
 * the guest's line counts in "Your household total".
 */
const signup: EventSignup = {
  id: 1,
  status: 'open',
  deadline: '2099-01-01T00:00:00Z',
  capacity: null,
  waitlist_enabled: false,
  attendance_enabled: true,
  drivers_needed: false,
  guest_mode: 'named',
  audience: 'both',
  payment_instructions: null,
  needs_permission_slip: false,
  needs_ahmr_c: false,
  notes_prompt: null,
  guest_prompt: null,
  slots_title: null
};
const household: Household = {
  key: '54',
  label: 'Kroening',
  scouts: [],
  adults: [
    { key: 'pe192', personId: 192, leaderCode: null, name: 'Sarah Kroening', relationship: null, email: null, defaultVehicleSeats: null }
  ]
};
const ADULTS: EventPrice = { id: 4, label: 'Adults', amount: 25, per: 'event', applies_to: 'adults', sort: 0 };
const SCOUTS: EventPrice = { id: 5, label: 'Scouts', amount: 20, per: 'event', applies_to: 'scouts', sort: 0 };
const YOUTH_NOT_CLIMBING: EventPrice = { id: 7, label: 'Youth - Not Climbing', amount: 0, per: 'event', applies_to: 'scouts', sort: 0 };

function renderForm(prices: EventPrice[]) {
  return render(
    <PersonFirstForm
      eventId={141}
      signup={signup}
      household={household}
      prices={prices}
      questions={[]}
      slots={[]}
      existingClaims={[]}
      existing={[]}
      householdGuests={[]}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
    />
  );
}
const guestsJson = () =>
  JSON.parse((document.querySelector('input[name="guests"]') as HTMLInputElement).value) as Record<string, unknown>[];

async function addGuest(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Attending' }));
  await user.click(screen.getByRole('button', { name: /add a guest/i }));
  await user.type(screen.getByRole('textbox', { name: 'Guest name 1' }), name);
}

describe('PersonFirstForm — guests have a price', () => {
  it('Family_AddsAYouthGuest_WithOneScoutTier_GuestIsPricedAndCountedInTheTotal', async () => {
    const user = userEvent.setup();
    renderForm([ADULTS, SCOUTS]);
    await addGuest(user, 'Logan Kroening');
    expect(guestsJson()[0].priceId).toBe(5);
    const recap = screen.getByText('Your household total').parentElement!;
    expect(within(recap).getByText('Logan Kroening')).toBeTruthy();
    expect(within(recap).getByText('$45')).toBeTruthy();
  });

  it('Family_AddsAYouthGuest_WithTwoScoutTiers_ChoosesAPriceFromThePulldown', async () => {
    const user = userEvent.setup();
    renderForm([ADULTS, SCOUTS, YOUTH_NOT_CLIMBING]);
    await addGuest(user, 'Logan Kroening');
    expect(guestsJson()[0].priceId).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Price for guest 1' }), '5');
    expect(guestsJson()[0].priceId).toBe(5);
  });

  it('Family_SwitchesAGuestToAdult_IsOfferedTheAdultTier', async () => {
    const user = userEvent.setup();
    renderForm([ADULTS, SCOUTS]);
    await addGuest(user, 'Grandpa');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Guest class 1' }), 'adult_guest');
    expect(guestsJson()[0].priceId).toBe(4);
  });
});
