import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignupFact, type SignupFactProps } from '../src/app/(public)/events/[id]/signup-fact';

/**
 * The event page's "Signup deadline" card IS the way in to the signup (Patrick, 2026-10-13): the whole card is a
 * button-link, and the old "Signing up" section at the foot of the page folded into it.
 */
const base: SignupFactProps = { entryId: 42, deadline: 'Fri, Oct 23', locked: false, signedUp: [], capacity: null };

function renderFact(over: Partial<SignupFactProps> = {}) {
  return render(
    <dl>
      <SignupFact {...base} {...over} />
    </dl>
  );
}

describe('SignupFact', () => {
  it('SignupFact_LinksToTheSignupPage_WhileOpen', () => {
    renderFact();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/events/42/signup');
  });

  it('SignupFact_NamesTheActionForScreenReaders_WhenNobodyIsSignedUp', () => {
    renderFact();
    expect(screen.getByRole('link', { name: 'Sign up — deadline Fri, Oct 23' })).toBeTruthy();
  });

  it('SignupFact_NamesTheChangeAction_WhenTheFamilyIsSignedUp', () => {
    renderFact({ signedUp: ['Ben'] });
    expect(screen.getByRole('link', { name: 'Change your signup — deadline Fri, Oct 23' })).toBeTruthy();
  });

  it('SignupFact_KeepsTheDeadlineCopy', () => {
    renderFact();
    expect(screen.getByText('Signup deadline')).toBeTruthy();
  });

  it('SignupFact_SaysOpenNow_WhenNobodyIsSignedUp', () => {
    renderFact();
    expect(screen.getByText('Open now')).toBeTruthy();
  });

  it('SignupFact_SaysWhoIsSignedUp_WhenTheFamilyHasResponded', () => {
    renderFact({ signedUp: ['Ben', 'Patrick'] });
    expect(screen.getByText('✓ You’re signed up: Ben, Patrick')).toBeTruthy();
  });

  it('SignupFact_ShowsSpotsTaken_WhenTheEventHasACapacity', () => {
    renderFact({ capacity: { taken: 12, of: 20, waitlist: false } });
    expect(screen.getByText('12 of 20 spots taken')).toBeTruthy();
  });

  it('SignupFact_SaysTheWaitlistIsOpen_WhenFullWithAWaitlist', () => {
    renderFact({ capacity: { taken: 20, of: 20, waitlist: true } });
    expect(screen.getByText('20 of 20 spots taken — waitlist is open')).toBeTruthy();
  });

  it('SignupFact_IsNotALink_WhenSignupsAreClosed', () => {
    renderFact({ locked: true });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('SignupFact_SaysClosed_WhenSignupsAreClosed', () => {
    renderFact({ locked: true });
    expect(screen.getByText('Closed')).toBeTruthy();
  });
});
