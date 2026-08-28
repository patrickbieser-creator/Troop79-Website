import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlotFirstForm from '../src/app/(public)/events/[id]/slot-first-form';
import type { SignupSlot } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

/**
 * Performance-Review-2026-08-27 #15: SlotRow is React.memo'd so typing a note
 * on one job does not re-render every other job on the board. `renderProbe`
 * is the test-only hook the form threads down to each row for exactly this
 * purpose — it never reaches production markup (see the form's own doc
 * comment on the prop).
 */
const household: Household = {
  key: '7',
  label: 'Sankpal-Tatera',
  scouts: [{ id: 'S1', displayName: 'Maya', personId: 11 }],
  adults: [{ key: 'pe82', personId: 82, leaderCode: null, name: 'Patrick Bieser', relationship: 'Dad', email: null, defaultVehicleSeats: null }]
};
const server: SignupSlot = {
  id: 1,
  kind: 'shift',
  label: 'Server',
  description: null,
  slot_date: '2026-09-02',
  starts_at: '17:00:00',
  ends_at: '19:00:00',
  attendance_required: true,
  eligibility: 'both',
  needed: 4,
  sort: 0,
  filled: 0
};
const cleanup: SignupSlot = {
  id: 2,
  kind: 'shift',
  label: 'Cleanup',
  description: null,
  slot_date: '2026-09-02',
  starts_at: '19:00:00',
  ends_at: '20:00:00',
  attendance_required: true,
  eligibility: 'both',
  needed: 4,
  sort: 1,
  filled: 0
};

function renderTracked() {
  const counts: Record<string, number> = {};
  const probe = vi.fn((key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  });
  render(
    <SlotFirstForm
      eventId={35}
      signupId={9}
      household={household}
      households={[household]}
      slots={[server, cleanup]}
      guestMode="none"
      guestPrompt={null}
      existingClaims={[
        { slotId: 1, personKey: 's0', comment: null },
        { slotId: 2, personKey: 'a0', comment: null }
      ]}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
      gateAction={vi.fn()}
      signOutAction={vi.fn()}
      hasExisting
      gateState="ready"
      signedInAs="Dana Bieser"
      canSwitchHousehold={false}
      gateConfigured
      renderProbe={probe}
    />
  );
  return counts;
}

describe('SlotFirstForm — row memoisation (Performance-Review-2026-08-27 #15)', () => {
  it('TypingOneJobsNote_DoesNotRerenderTheOtherJobsRow', async () => {
    const user = userEvent.setup();
    const counts = renderTracked();
    const baseline = { ...counts };

    // Both slots have someone signed up, so both show a note field — the
    // first is Server (slotId 1), sorted ahead of Cleanup (slotId 2).
    const [serverNote] = screen.getAllByPlaceholderText(/i have a 6ft table/i);
    await user.type(serverNote, 'x');

    expect(counts['slot:1']).toBeGreaterThan(baseline['slot:1']);
    expect(counts['slot:2']).toBe(baseline['slot:2']);
  });
});
