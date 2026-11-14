import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFirstForm, { type SignupPay } from '../src/app/(public)/events/[id]/person-first-form';
import type { EventPrice, EventSignup, HouseholdEntry } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';
import { payToFrom } from '../src/lib/event-pay/options';

/**
 * "How will you pay?" on the family sign-up form (Patrick, 2026-11-13): one row per method instead of a sentence,
 * a scout account always listed with its balance, and card with its fee.
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
const household = {
  key: '7',
  label: 'Example',
  scouts: [{ id: 'S1', personId: 301, displayName: 'Anjali Example' }],
  adults: []
} as unknown as Household;
const SCOUTS: EventPrice = { id: 5, label: 'Scouts', amount: 20, per: 'event', applies_to: 'scouts', sort: 0 };

const payTo = payToFrom(
  new Map([
    ['pay.venmo_handle', '@Troop-Treasurer'],
    ['pay.paypal_email', 'treasurer@example.test'],
    ['pay.check_mail_to', '1 Main St']
  ])
);
const payByCardAction = vi.fn();
const pay = (over: Partial<SignupPay> = {}): SignupPay => ({
  payTo,
  cardLive: true,
  scouts: [{ personId: 301, name: 'Anjali Example', balance: 0 }],
  paid: 0,
  due: 0,
  payByCardAction,
  ...over
});
const saved = (over: Partial<HouseholdEntry> = {}): HouseholdEntry =>
  ({ id: 9, person_kind: 'scout', person_id: 301, status: 'yes', participation: 'full', price_id: 5, days: null, guest_count: 0, claims: [], claimComments: {}, answers: [], ...over }) as unknown as HouseholdEntry;

function renderForm(p: SignupPay | undefined, existing: HouseholdEntry[] = []) {
  return render(
    <PersonFirstForm
      eventId={141}
      signup={signup}
      household={household}
      prices={[SCOUTS]}
      questions={[]}
      slots={[]}
      existingClaims={[]}
      existing={existing}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
      pay={p}
    />
  );
}
const hidden = (name: string) => (document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value;
const going = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Attending' }));

describe('PersonFirstForm — pressing a chosen answer again takes it back', () => {
  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

  it('Family_PressingAttendingTwice_ReturnsToNoAnswer_AndTheTotalCloses', async () => {
    const user = userEvent.setup();
    renderForm(pay());
    await going(user);
    await going(user);
    expect([pressed('Attending'), screen.queryByText('Total owed'), JSON.parse(hidden('entries') ?? '[]').length]).toEqual(['false', null, 0]);
  });

  it('Family_WhoSaidCantMakeIt_ThenAttending_ThenAttendingAgain_IsBackToCantMakeIt', async () => {
    const user = userEvent.setup();
    renderForm(pay());
    await user.click(screen.getByRole('button', { name: 'Can’t make it' }));
    await going(user);
    await going(user);
    expect([pressed('Attending'), pressed('Can’t make it')]).toEqual(['false', 'true']);
  });

  it('Family_WithASavedYes_PressingAttending_ChangesNothing', async () => {
    const user = userEvent.setup();
    renderForm(pay({ due: 20 }), [saved()]);
    await going(user);
    expect([pressed('Attending'), (screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled]).toEqual(['true', true]);
  });
});

describe('PersonFirstForm — how will you pay', () => {
  it('Family_WithNobodyAttending_SeesNoPaymentChoices', () => {
    renderForm(pay());
    expect(screen.queryByRole('group', { name: 'How will you pay?' })).toBeNull();
  });

  it('Family_WithSomeoneAttending_SeesEveryMethodAsItsOwnChoice', async () => {
    const user = userEvent.setup();
    renderForm(pay());
    await going(user);
    const names = within(screen.getByRole('group', { name: 'How will you pay?' })).getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(names).toEqual(['venmo', 'paypal', 'check', 'cash', 'scout_account', 'card']);
  });

  it('Family_WithAZeroScoutAccount_StillSeesIt_WithTheFundingReminder', async () => {
    const user = userEvent.setup();
    renderForm(pay());
    await going(user);
    await user.click(screen.getByRole('radio', { name: /Scout account/ }));
    expect(screen.getByText(/funded by taking part in the Can Drive and the Wreath Sale/)).toBeTruthy();
  });

  it('Family_SeesTheScoutAccountBalance_BeforeChoosing', async () => {
    const user = userEvent.setup();
    renderForm(pay({ scouts: [{ personId: 301, name: 'Anjali Example', balance: 45 }] }));
    await going(user);
    expect(screen.getByText('Anjali: $45 available')).toBeTruthy();
  });

  it('Family_ChoosingScoutAccount_PostsTheMethodAndWhoseAccount', async () => {
    const user = userEvent.setup();
    renderForm(pay());
    await going(user);
    await user.click(screen.getByRole('radio', { name: /Scout account/ }));
    expect([hidden('payMethod'), hidden('payFrom')]).toEqual(['scout_account', '301']);
  });

  it('Family_ChoosingCard_SeesTheFeeInTheButton', async () => {
    const user = userEvent.setup();
    renderForm(pay());
    await going(user);
    await user.click(screen.getByRole('radio', { name: /Credit or debit card/ }));
    expect(screen.getByRole('button', { name: 'Submit and pay $20.91 by card' })).toBeTruthy();
  });

  it('Family_WithoutStripeConfigured_IsNotOfferedCard', async () => {
    const user = userEvent.setup();
    renderForm(pay({ cardLive: false }));
    await going(user);
    expect(screen.queryByRole('radio', { name: /Credit or debit card/ })).toBeNull();
  });

  it('Family_ChangingOnlyTheMethod_CanSave', async () => {
    const user = userEvent.setup();
    renderForm(pay({ due: 20 }), [saved({ pay_method: 'venmo' })]);
    await user.click(screen.getByRole('radio', { name: /PayPal/ }));
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Family_WhoSavedCardAndStillOwes_CanGoBackToTheCardPage', () => {
    renderForm(pay({ due: 20 }), [saved({ pay_method: 'card' })]);
    expect(screen.getByRole('button', { name: 'Pay $20.91 by card' })).toBeTruthy();
  });

  it('Family_WhoPaidInFull_SeesPaidAndNoChoices', () => {
    renderForm(pay({ paid: 20, due: 0 }), [saved({ pay_method: 'card' })]);
    expect([screen.getByText('Paid so far').nextSibling?.textContent, screen.queryByRole('group', { name: 'How will you pay?' })]).toEqual(['$20', null]);
  });

  it('Form_WithoutPayDetails_PostsNoMethodField', async () => {
    const user = userEvent.setup();
    renderForm(undefined);
    await going(user);
    expect(hidden('payMethod')).toBeUndefined();
  });
});
