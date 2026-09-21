import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubmitProofButton } from '../src/app/(public)/library/submit-proof/submit-button';

/**
 * The button that stopped the duplicates (Patrick, 2026-09-20).
 *
 * Sending a proof uploads media and emails a leader before the page moves
 * on, so "Send for Review" used to sit there looking dead for a second or
 * two. Scouts tapped again — one requirement reached the review queue
 * fifteen times. The DB index and the action's replace-or-ignore branch are
 * the backstops; THIS is the part that stops it happening at all, so the
 * pending state is asserted rather than assumed.
 *
 * useFormStatus reads the enclosing <form>'s submission state, which a unit
 * test cannot drive without actually submitting — it is stubbed here so both
 * states are reachable. That the component is rendered INSIDE the form (the
 * condition for useFormStatus reporting anything at all) is a wiring
 * property of page.tsx, not of this component.
 */

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return { ...actual, useFormStatus: () => mockStatus };
});

let mockStatus: { pending: boolean } = { pending: false };

describe('SubmitProofButton', () => {
  it('is clickable and reads normally before submit', () => {
    mockStatus = { pending: false };
    render(<SubmitProofButton>Send for Review</SubmitProofButton>);
    const btn = screen.getByRole('button', { name: 'Send for Review' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.type).toBe('submit');
  });

  it('disables itself and says so while the submission is in flight', () => {
    mockStatus = { pending: true };
    render(<SubmitProofButton>Send for Review</SubmitProofButton>);
    const btn = screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });
});
