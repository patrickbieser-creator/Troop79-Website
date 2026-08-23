import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFirstForm from '../src/app/(public)/events/[id]/person-first-form';
import type { EventSignup, PublicGroupSet } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

/**
 * Family form, Event Logistics Phase 1+2 (Plans/Event-Logistics.md §A/§B):
 * seats include the driver and prefill from the remembered capacity; every
 * attending person gets a ride status per leg; self-select sets render a
 * picker whose choice lands in the hidden `placements` field.
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
const tents: PublicGroupSet = {
  id: 40,
  label: 'Tents',
  kind: 'tent',
  groups: [
    { id: 400, name: 'Tent A', capacity: 2, filled: 2 },
    { id: 401, name: 'Tent B', capacity: 2, filled: 0 }
  ]
};

function renderForm(groupSets: PublicGroupSet[] = []) {
  return render(
    <PersonFirstForm
      eventId={35}
      signup={signup}
      household={household}
      prices={[]}
      questions={[]}
      slots={[]}
      existingClaims={[]}
      existing={[]}
      groupSets={groupSets}
      existingMemberships={[]}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
    />
  );
}
const hidden = (name: string) => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;

describe('PersonFirstForm — transportation', () => {
  it('Family_SeesVehicleSeatsPrefilled_WhenDriverHasRememberedCapacity', async () => {
    const user = userEvent.setup();
    renderForm();
    // Buttons in DOM order: the scout's Attending, then the adult's.
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[1]);
    await user.click(screen.getByLabelText('Drive there'));
    const seats = screen.getByLabelText(/Seats in your vehicle, including you/) as HTMLInputElement;
    expect(seats.value).toBe('6');
    const entries = JSON.parse(hidden('entries').value) as Record<string, unknown>[];
    const adult = entries.find((e) => e.key === 'a:pe82')!;
    expect(adult.vehicle_seats_out).toBe(6);
    expect(adult.ride_out).toBeNull(); // drives that leg
    expect(adult.ride_back).toBe('needs_ride'); // default for the leg not driven
  });

  it('Scout_DefaultsToNeedsRideBothLegs_AndCanChangeOne', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    await user.selectOptions(screen.getByLabelText('Anjali — back'), 'self');
    const entries = JSON.parse(hidden('entries').value) as Record<string, unknown>[];
    const scout = entries.find((e) => e.key === 's:S1')!;
    expect(scout.ride_out).toBe('needs_ride');
    expect(scout.ride_back).toBe('self');
  });
});

describe('PersonFirstForm — self-select placement picker', () => {
  it('FamilyPick_LandsInPlacements_AndFullGroupsAreDisabled', async () => {
    const user = userEvent.setup();
    renderForm([tents]);
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    const select = screen.getByLabelText('Anjali — Tents') as HTMLSelectElement;
    const tentA = [...select.options].find((o) => o.value === '400');
    expect(tentA?.disabled).toBe(true); // 2/2 full
    await user.selectOptions(select, '401');
    expect(JSON.parse(hidden('placements').value)).toEqual({ 's:S1': { '40': 401 } });
  });

  it('NoSelfSelectSets_NoPicker', async () => {
    const user = userEvent.setup();
    renderForm([]);
    await user.click(screen.getAllByRole('button', { name: 'Attending' })[0]);
    expect(screen.queryByLabelText('Anjali — Tents')).toBeNull();
  });
});
