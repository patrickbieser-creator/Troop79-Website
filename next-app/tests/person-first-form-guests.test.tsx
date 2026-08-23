import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFirstForm from '../src/app/(public)/events/[id]/person-first-form';
import type { EventSignup, HouseholdEntry, HouseholdGuest } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

/**
 * Guests as people on the family (person-first) form
 * (Plans/Guests-As-People.md): the builder's guest_mode decides what the
 * family sees — a count on the host's entry, named rows with "add again"
 * picks, or nothing.
 */
const base: EventSignup = {
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
  adults: [
    { key: 'pe82', personId: 82, leaderCode: null, name: 'Patrick Bieser', relationship: 'Dad', email: null, defaultVehicleSeats: null }
  ]
};
const grandma: HouseholdGuest = { personId: 501, name: 'Grandma Pat', cls: 'adult_guest', phone: '414-555-0100' };

function renderForm(signup: Partial<EventSignup>, opts: { existing?: HouseholdEntry[]; householdGuests?: HouseholdGuest[] } = {}) {
  return render(
    <PersonFirstForm
      eventId={35}
      signup={{ ...base, ...signup }}
      household={household}
      prices={[]}
      questions={[]}
      slots={[]}
      existingClaims={[]}
      existing={opts.existing ?? []}
      householdGuests={opts.householdGuests ?? []}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
    />
  );
}
const entries = () =>
  JSON.parse((document.querySelector('input[name="entries"]') as HTMLInputElement).value) as Record<string, unknown>[];
const guestsField = () => document.querySelector('input[name="guests"]') as HTMLInputElement | null;

describe('PersonFirstForm — guest modes', () => {
  it('FamilyForm_NoneMode_ShowsNeitherCountNorNamedRows', () => {
    renderForm({ guest_mode: 'none' });
    expect(screen.queryByRole('spinbutton', { name: /number of guests/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add a guest/i })).toBeNull();
    expect(guestsField()).toBeNull();
  });

  it('FamilyForm_CountMode_ShowsNumber_HidesNamedRows_AndRidesOnTheAttendingAdult', async () => {
    const user = userEvent.setup();
    renderForm({ guest_mode: 'count' });
    expect(screen.queryByRole('button', { name: /add a guest/i })).toBeNull();
    // Scout attending first, then the adult — the count goes with the adult.
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[1]);
    const n = screen.getByRole('spinbutton', { name: /number of guests/i });
    await user.clear(n);
    await user.type(n, '3');
    await user.type(screen.getByRole('textbox', { name: /who are the guests/i }), 'grandparents');
    const adult = entries().find((e) => e.key === 'a:pe82')!;
    const scout = entries().find((e) => e.key === 's:S1')!;
    expect(adult.guest_count).toBe(3);
    expect(adult.guest_note).toBe('grandparents');
    expect(scout.guest_count).toBe(0);
  });

  it('FamilyForm_GuestSection_IsLockedUntilSomeoneInTheHouseholdIsAttending', async () => {
    // Patrick, 2026-08-23: a guest rides with an attending member, so until
    // there is one the section shows its heading and a note — nothing else.
    const user = userEvent.setup();
    renderForm({ guest_mode: 'named' }, { householdGuests: [grandma] });
    expect(screen.getByText(/mark at least one person in your household as attending first/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Grandma Pat again' })).toBeNull();
    expect(screen.queryByRole('button', { name: /add a guest/i })).toBeNull();
    expect(guestsField()).toBeNull();
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[1]);
    expect(screen.queryByText(/mark at least one person/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Grandma Pat again' })).toBeTruthy();
    // Marking that same person Can't make it locks it again (state is kept, nothing sent).
    await user.click(screen.getAllByRole('button', { name: 'Can’t make it' })[1]);
    expect(screen.getByText(/mark at least one person/i)).toBeTruthy();
  });

  it('FamilyForm_NamedMode_ShowsRows_HidesNumber_AndOffersPreviousGuestsAsPicks', async () => {
    const user = userEvent.setup();
    renderForm({ guest_mode: 'named' }, { householdGuests: [grandma] });
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[1]);
    expect(screen.queryByRole('spinbutton', { name: /number of guests/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Grandma Pat again' }));
    expect(JSON.parse(guestsField()!.value)).toEqual([
      { personId: 501, name: 'Grandma Pat', cls: 'adult_guest', phone: '414-555-0100', attending: true }
    ]);
    // Members' entries never carry a count in named mode.
    expect(entries().find((e) => e.key === 'a:pe82')!.guest_count).toBe(0);
  });

  it('FamilyForm_NamedMode_SeedsSavedGuestRows_WithTheirPersonIds', () => {
    const hostEntry = {
      id: 900,
      person_kind: 'adult',
      person_id: 82,
      participant_class: 'adult',
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
      ride_out: null,
      ride_back: null,
      claims: [],
      claimComments: {},
      answers: []
    } as unknown as HouseholdEntry;
    const guestEntry = {
      ...hostEntry,
      id: 901,
      person_id: 501,
      participant_class: 'adult_guest',
      guest_name: 'Grandma Pat',
      host_entry_id: 900
    } as unknown as HouseholdEntry;
    renderForm({ guest_mode: 'named' }, { existing: [hostEntry, guestEntry], householdGuests: [grandma] });
    expect((screen.getByRole('textbox', { name: /guest name 1/i }) as HTMLInputElement).value).toBe('Grandma Pat');
    expect(JSON.parse(guestsField()!.value)[0].personId).toBe(501);
    // Already on the form — not offered again as a pick.
    expect(screen.queryByRole('button', { name: 'Add Grandma Pat again' })).toBeNull();
  });

  it('FamilyForm_SaveChanges_IsGreyedOutAndReadsSaved_UntilTheDraftDiffers', async () => {
    // Patrick, 2026-08-23: "gray it out when it will do nothing."
    const user = userEvent.setup();
    const hostEntry = {
      id: 900, person_kind: 'adult', person_id: 82, participant_class: 'adult', guest_name: null, host_entry_id: null,
      status: 'yes', participation: 'full', price_id: null, days: null, guest_count: 0, guest_note: null, notes: null,
      permission_slip_received: false, drives_out: false, drives_back: false, vehicle_seats_out: null, vehicle_seats_back: null,
      ride_out: null, ride_back: null, claims: [], claimComments: {}, answers: []
    } as unknown as HouseholdEntry;
    renderForm({ guest_mode: 'named' }, { existing: [hostEntry] });
    const btn = () => screen.getByRole('button', { name: /saved|save changes/i }) as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    expect(btn().textContent).toMatch(/saved/i);
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]); // the scout joins
    expect(btn().disabled).toBe(false);
    expect(btn().textContent).toMatch(/save changes/i);
    await user.click(screen.getAllByRole('button', { name: 'Can’t make it' })[0]);
    // A different draft from the saved one (the scout was unmarked before) — still a change.
    expect(btn().disabled).toBe(false);
  });

  it('FamilyForm_ShowsSavingChangesOverlay_TheMomentTheFormSubmits', async () => {
    const user = userEvent.setup();
    renderForm({ guest_mode: 'none' });
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[1]);
    expect(screen.queryByRole('status')).toBeNull();
    const form = document.querySelector('form') as HTMLFormElement;
    form.addEventListener('submit', (e) => e.preventDefault()); // jsdom: no real navigation
    await user.click(screen.getByRole('button', { name: /submit family signup/i }));
    expect(screen.getByRole('status').textContent).toMatch(/saving changes/i);
  });
});
