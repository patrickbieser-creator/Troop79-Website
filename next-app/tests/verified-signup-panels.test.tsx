import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignInToSignUpPanel, AskAParentPanel, TroubleLine } from '../src/app/(public)/events/[id]/signup-panels';
import { SignupStatusBar } from '../src/app/(public)/events/[id]/signup-status-bar';

/**
 * Plans/Verified-Signup.md Phase A — the surfaces a visitor sees when they
 * cannot write a signup yet, and the one status bar that always says WHO is
 * signed in (Patrick, 2026-08-26).
 */
describe('verified signup panels', () => {
  it('SignInPanel_LinksToSignIn_WithNextBackToTheSignupPage', () => {
    render(<SignInToSignUpPanel next="/events/9/signup" />);
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('/signin?next=%2Fevents%2F9%2Fsignup');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('ParentPanel_NamesTheScout_AndAsksForAParent', () => {
    render(<AskAParentPanel signedInAs="Ben Bieser" next="/events/9/signup" />);
    expect(screen.getByText('Ben Bieser')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Parent sign-in' })).toBeTruthy();
  });

  it('TroubleLine_HasNoPhoneNumber_AndNoTitle', () => {
    // No number on the site; Mindy is the Scoutmaster, so no title either.
    render(<TroubleLine />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Text Patrick/);
    expect(text).not.toMatch(/\d{3}[-. ]\d{3}[-. ]\d{4}/);
    expect(text).not.toMatch(/Scoutmaster/);
    const src = readFileSync(resolve(process.cwd(), 'src/app/(public)/events/[id]/signup-panels.tsx'), 'utf8');
    expect(src).not.toMatch(/\d{3}[-. ]\d{3}[-. ]\d{4}/);
  });
});

describe('SignupStatusBar', () => {
  it('StatusBar_NamesTheSignedInPerson_AndTheHousehold', () => {
    render(
      <SignupStatusBar
        signedInAs="Dana Bieser"
        household={{ label: 'Bieser', standaloneAdult: false }}
        changeHref="/events/9/signup?household="
        signOut={{ action: () => {}, next: '/events/9/signup' }}
      />
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('Signed in as Dana Bieser');
    expect(text).toContain('signing up the Bieser household');
    expect(screen.getByRole('link', { name: 'Change household' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('StatusBar_RendersNoForm_WhenNested', () => {
    const { container } = render(
      <SignupStatusBar signedInAs="Dana Bieser" household={null} signOut={{ action: () => {}, next: '/x' }} nested />
    );
    expect(container.querySelector('form')).toBeNull();
    expect(document.body.textContent).toContain('no family chosen yet');
  });
});
