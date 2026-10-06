import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFirstForm from '../src/app/(public)/events/[id]/person-first-form';
import type { EventSignup, HouseholdEntry } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

/**
 * Family form, Plans/Event-Signup-Arrival-Times.md: each leg is "With the
 * group" (the event's own times) or Later (There) / Earlier (Back) with a day
 * and a time. The existing ride statuses keep working beside it.
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
    { key: 'pe82', personId: 82, leaderCode: null, name: 'Patrick Bieser', relationship: 'Dad', email: null, defaultVehicleSeats: 6 }
  ]
};

function renderForm(existing: HouseholdEntry[] = []) {
  return render(
    <PersonFirstForm
      eventId={35}
      signup={signup}
      household={household}
      prices={[]}
      questions={[]}
      slots={[]}
      existingClaims={[]}
      existing={existing}
      groupSets={[]}
      existingMemberships={[]}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
    />
  );
}
const entriesOf = () =>
  JSON.parse((document.querySelector('input[name="entries"]') as HTMLInputElement).value) as Record<string, unknown>[];

describe('PersonFirstForm — leg times', () => {
  it('LaterChoice_RevealsADayAndTime_AndSavesTheInstant', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]); // Anjali

    // Default: with the group, nothing to fill in, nothing sent.
    expect(screen.queryByLabelText('Anjali — there clock time')).toBeNull();
    expect(entriesOf()[0].out_departs_at).toBeNull();

    await user.selectOptions(screen.getByLabelText('Anjali — there time'), 'own');
    const day = screen.getByPlaceholderText('e.g. 7/25/2026');
    await user.type(day, '10/24/2026');
    await user.tab();
    await user.type(screen.getByLabelText('Anjali — there clock time'), '09:00');

    const anjali = entriesOf()[0];
    expect(anjali.out_departs_at).toBe('2026-10-24T14:00:00.000Z'); // 9:00 am CDT
    expect(anjali.back_departs_at).toBeNull();
    expect(anjali.ride_out).toBe('needs_ride'); // the status is untouched
  });

  it('EarlierChoice_OnTheBackLeg_IsOfferedBesideTheStatus', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    const back = screen.getByLabelText('Anjali — back time') as HTMLSelectElement;
    expect([...back.options].map((o) => o.text)).toEqual(['With the group', 'Earlier']);
    const there = screen.getByLabelText('Anjali — there time') as HTMLSelectElement;
    expect([...there.options].map((o) => o.text)).toEqual(['With the group', 'Later']);
    // The four ride statuses are still there.
    expect(screen.getByLabelText('Anjali — back')).toBeTruthy();
  });

  it('SavedTime_PrefillsTheChoice_AndIsCleanUntilChanged', async () => {
    const entry = {
      id: 5,
      person_kind: 'scout',
      person_id: 11,
      participant_class: 'scout',
      guest_name: null,
      host_entry_id: null,
      status: 'yes',
      participation: 'full',
      price_id: null,
      days: null,
      guest_count: 0,
      guest_note: null,
      notes: null,
      permission_slip_received: false,
      drives_out: false,
      drives_back: false,
      vehicle_seats_out: null,
      vehicle_seats_back: null,
      ride_out: 'needs_ride',
      ride_back: 'needs_ride',
      out_departs_at: '2026-10-24T14:00:00+00:00',
      back_departs_at: null,
      claims: [],
      claimComments: {},
      answers: []
    } as HouseholdEntry;
    const user = userEvent.setup();
    renderForm([entry]);
    expect((screen.getByLabelText('Anjali — there time') as HTMLSelectElement).value).toBe('own');
    expect((screen.getByLabelText('Anjali — there clock time') as HTMLInputElement).value).toBe('09:00');
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText('Anjali — back time'), 'own');
    await user.type(screen.getAllByPlaceholderText('e.g. 7/25/2026')[1], '10/25/2026');
    await user.tab();
    await user.type(screen.getByLabelText('Anjali — back clock time'), '16:00');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
    expect(entriesOf()[0].back_departs_at).toBe('2026-10-25T21:00:00.000Z'); // 4:00 pm CDT
  });

  it('IncompleteTime_SaysSoInPlace_AndSendsNoTime', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    await user.selectOptions(screen.getByLabelText('Anjali — back time'), 'own');
    expect(screen.getByText(/Pick a day and a time/)).toBeTruthy();
    expect(entriesOf()[0].back_departs_at).toBeNull();
  });
});
