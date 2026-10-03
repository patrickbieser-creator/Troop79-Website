import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFirstForm from '../src/app/(public)/events/[id]/person-first-form';
import type { EventPrice, EventSignup, SignupQuestion } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

/**
 * Calm restyle R2 (Plans/Completed/Calm-Site-Restyle-Sweep.md §1, "chip rows for single
 * choices"): a person's price and a choice question are quiet pulldowns, not
 * pill rows — one choice, so a select says it and takes one line on a phone.
 */
const signup: EventSignup = {
  id: 1,
  status: 'open',
  deadline: '2099-01-01T00:00:00Z',
  capacity: null,
  waitlist_enabled: false,
  attendance_enabled: true,
  drivers_needed: false,
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
  adults: []
};
const PRICES: EventPrice[] = [
  { id: 1, label: 'Full weekend', amount: 40, per: 'event', applies_to: 'both', sort: 1 },
  { id: 2, label: 'Saturday only', amount: 20, per: 'event', applies_to: 'both', sort: 2 }
];
const SIZE: SignupQuestion = { id: 5, prompt: 'T-shirt size', input_type: 'choice', choices: ['Small', 'Medium', 'Large'], applies_to: 'both', required: true, sort: 0 };

async function attending(prices: EventPrice[], questions: SignupQuestion[]) {
  const user = userEvent.setup();
  render(
    <PersonFirstForm
      eventId={35}
      signup={signup}
      household={household}
      prices={prices}
      questions={questions}
      slots={[]}
      existingClaims={[]}
      existing={[]}
      groupSets={[]}
      existingMemberships={[]}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Attending' }));
  return user;
}

describe('PersonFirstForm — single choices are pulldowns (calm restyle R2)', () => {
  it('Price_IsAPulldown_WhenThereAreSeveralPrices', async () => {
    await attending(PRICES, []);
    const price = screen.getByRole('combobox', { name: 'Price' }) as HTMLSelectElement;
    expect([...price.options].map((o) => o.textContent)).toEqual(['Choose a price', 'Full weekend — $40', 'Saturday only — $20']);
  });

  it('Price_IsNotAPillRow', async () => {
    await attending(PRICES, []);
    expect(screen.queryByRole('button', { name: /Full weekend/ })).toBeNull();
  });

  it('Price_PickedFromThePulldown_IsKept', async () => {
    const user = await attending(PRICES, []);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Price' }), 'Saturday only — $20');
    expect((screen.getByRole('combobox', { name: 'Price' }) as HTMLSelectElement).value).toBe('2');
  });

  it('ChoiceQuestion_IsAPulldown', async () => {
    await attending([], [SIZE]);
    const q = screen.getByRole('combobox', { name: 'T-shirt size' }) as HTMLSelectElement;
    expect([...q.options].map((o) => o.textContent)).toEqual(['Choose one', 'Small', 'Medium', 'Large']);
  });

  it('ChoiceQuestion_PickedValue_IsKept', async () => {
    const user = await attending([], [SIZE]);
    await user.selectOptions(screen.getByRole('combobox', { name: 'T-shirt size' }), 'Medium');
    expect((screen.getByRole('combobox', { name: 'T-shirt size' }) as HTMLSelectElement).value).toBe('Medium');
  });
});
