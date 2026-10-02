import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFirstForm from '../src/app/(public)/events/[id]/person-first-form';
import type { EventPrice, EventSignup } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

/**
 * Family form, per-day pricing: the days an attending person stays is the
 * shared dialer (Calm-Site-Restyle Decision 2), and the price math follows it.
 */
const signup: EventSignup = {
  id: 1,
  status: 'open',
  deadline: '2099-01-01T00:00:00Z',
  capacity: null,
  waitlist_enabled: false,
  attendance_enabled: true,
  drivers_needed: true,
  guest_mode: 'none',
  audience: 'both',
  payment_instructions: null,
  needs_permission_slip: false,
  needs_ahmr_c: false,
  notes_prompt: null,
  guest_prompt: null,
  slots_title: null
};
const household: Household = {
  key: '7',
  label: 'Bieser',
  scouts: [{ id: 'S1', displayName: 'Anjali', personId: 11 }],
  adults: [
    {
      key: 'pe82',
      personId: 82,
      leaderCode: null,
      name: 'Patrick Bieser',
      relationship: 'Dad',
      email: null,
      defaultVehicleSeats: 6
    }
  ]
};

const PRICES: EventPrice[] = [{ id: 1, label: 'Per day', amount: 10, per: 'day', applies_to: 'both', sort: 1 }];

function renderForm() {
  return render(
    <PersonFirstForm
      eventId={35}
      signup={signup}
      household={household}
      prices={PRICES}
      questions={[]}
      slots={[]}
      existingClaims={[]}
      existing={[]}
      groupSets={[]}
      existingMemberships={[]}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
    />
  );
}

describe('PersonFirstForm — days attending', () => {
  it('Family_CanAddADay_WithThePlusButton', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    await user.click(screen.getByRole('button', { name: 'One more day' }));
    expect((screen.getByRole('spinbutton', { name: /Days attending/ }) as HTMLInputElement).value).toBe('2');
  });

  it('PriceMath_FollowsTheDays', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    await user.click(screen.getByRole('button', { name: 'One more day' }));
    expect(document.body.textContent).toContain('$10 × 2 = $20');
  });

  it('Days_CannotGoBelowOne', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    expect((screen.getByRole('button', { name: 'One fewer day' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
