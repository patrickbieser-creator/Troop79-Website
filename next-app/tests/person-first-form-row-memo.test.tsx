import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFirstForm from '../src/app/(public)/events/[id]/person-first-form';
import type { EventSignup, SignupQuestion } from '../src/lib/event-signup';
import type { Household } from '../src/lib/households';

/**
 * Performance-Review-2026-08-27 #15: ScoutRow/AdultRow are React.memo'd so a
 * keystroke in one person's field doesn't re-render every other household
 * member. `renderProbe` is the test-only hook the form threads down to each
 * row for exactly this purpose — it never reaches production markup (see the
 * form's own doc comment on the prop).
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
  scouts: [
    { id: 'S1', displayName: 'Anjali', personId: 11 },
    { id: 'S2', displayName: 'Damian', personId: 12 }
  ],
  adults: []
};
const question: SignupQuestion = {
  id: 1,
  prompt: 'Anything we should know?',
  input_type: 'text',
  choices: null,
  applies_to: 'scouts',
  required: false,
  sort: 0
};

function renderTracked() {
  const counts: Record<string, number> = {};
  const probe = vi.fn((key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  });
  render(
    <PersonFirstForm
      eventId={35}
      signup={signup}
      household={household}
      prices={[]}
      questions={[question]}
      slots={[]}
      existingClaims={[]}
      existing={[]}
      submitAction={vi.fn()}
      cancelAction={vi.fn()}
      renderProbe={probe}
    />
  );
  return counts;
}

describe('PersonFirstForm — row memoisation (Performance-Review-2026-08-27 #15)', () => {
  it('TypingInOnePersonsAnswer_DoesNotRerenderTheOtherPersonsRow', async () => {
    const user = userEvent.setup();
    const counts = renderTracked();
    // Both scouts attending so both rows show the question field.
    const attendButtons = screen.getAllByRole('button', { name: 'Attending' });
    await user.click(attendButtons[0]);
    await user.click(attendButtons[1]);

    const baseline = { ...counts };
    const inputs = screen.getAllByRole('textbox', { name: /anything we should know/i });
    expect(inputs).toHaveLength(2);

    await user.type(inputs[0], 'x');

    expect(counts['s:S1']).toBeGreaterThan(baseline['s:S1']);
    expect(counts['s:S2']).toBe(baseline['s:S2']);
  });
});
