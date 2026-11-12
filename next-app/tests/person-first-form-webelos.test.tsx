import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PersonFirstForm from '../src/app/(public)/events/[id]/person-first-form';
import type { EventSignup } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

/**
 * A Webelos on the roster (Plans/Webelos-On-The-Roster.md) signs up from the
 * household like a scout, labelled Webelos so the family sees who is who.
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
  key: '54',
  label: 'Kroening',
  scouts: [
    { id: 'F01', displayName: 'Logan Kroening', personId: 201, isWebelos: true },
    { id: 'E05', displayName: 'Ada Kroening', personId: 300 }
  ],
  adults: []
};

describe('PersonFirstForm — Webelos', () => {
  it('Family_SeesTheirWebelos_LabelledWebelos_AndTheirScout_Unlabelled', () => {
    render(
      <PersonFirstForm
        eventId={141}
        signup={signup}
        household={household}
        prices={[]}
        questions={[]}
        slots={[]}
        existingClaims={[]}
        existing={[]}
        householdGuests={[]}
        submitAction={vi.fn()}
        cancelAction={vi.fn()}
      />
    );
    expect(screen.getAllByText('Webelos').map((el) => el.parentElement?.textContent)).toEqual(['Logan KroeningWebelos']);
  });
});
