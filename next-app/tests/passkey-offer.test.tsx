import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * The one-time passkey offer on a signup page (Plans/Verified-Signup.md,
 * Phase A). Mocks both halves of the ceremony — this suite never runs a real
 * WebAuthn ceremony (see tests/passkey-button.test.tsx for the same pattern).
 */
const passkeyRegisterOptionsAction = vi.fn();
const passkeyRegisterVerifyAction = vi.fn();
vi.mock('../src/app/(public)/signin/actions', () => ({
  passkeyRegisterOptionsAction: (...args: unknown[]) => passkeyRegisterOptionsAction(...args),
  passkeyRegisterVerifyAction: (...args: unknown[]) => passkeyRegisterVerifyAction(...args)
}));

const startRegistration = vi.fn();
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...args: unknown[]) => startRegistration(...args)
}));

import { PasskeyOffer } from '../src/app/_components/passkey-offer';

const NEXT = '/events/12/signup?welcome=1';

beforeEach(() => {
  window.localStorage.clear();
  passkeyRegisterOptionsAction.mockReset();
  passkeyRegisterVerifyAction.mockReset();
  startRegistration.mockReset();
});

describe('PasskeyOffer', () => {
  it('PasskeyOffer_ShowsOnce_ThenRemembersDismiss', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PasskeyOffer next={NEXT} />);
    expect(
      screen.getByText(
        'Next time, sign in with your phone, fingerprint, or face — no code to type.'
      )
    ).toBeTruthy();

    // Clicking "Not now" dismisses immediately, no re-render needed.
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/Next time, sign in/)).toBeNull();
    unmount();

    // A fresh mount reads the remembered dismissal back out of localStorage
    // and never shows the offer again on this browser.
    render(<PasskeyOffer next={NEXT} />);
    expect(screen.queryByText(/Next time, sign in/)).toBeNull();
  });

  it('SetItUp_ShowsDoneAndManageLink_OnSuccessfulRegistration', async () => {
    const user = userEvent.setup();
    passkeyRegisterOptionsAction.mockResolvedValue(JSON.stringify({ challenge: 'c' }));
    startRegistration.mockResolvedValue({ id: 'cred-1' });
    passkeyRegisterVerifyAction.mockResolvedValue({ ok: true });

    render(<PasskeyOffer next={NEXT} />);
    await user.click(screen.getByRole('button', { name: 'Set it up' }));

    expect(await screen.findByText('Done — next time it’s one tap.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Manage on your profile' });
    expect(link.getAttribute('href')).toBe(`/member?next=${encodeURIComponent(NEXT)}`);
  });

  it('SetItUp_ShowsTheUVUnsupportedMessage_WhenTheAuthenticatorCannotVerify (D-124)', async () => {
    const user = userEvent.setup();
    passkeyRegisterOptionsAction.mockResolvedValue(JSON.stringify({ challenge: 'c' }));
    const err = new Error('missing UV support');
    (err as unknown as { code: string }).code = 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT';
    startRegistration.mockRejectedValue(err);

    render(<PasskeyOffer next={NEXT} />);
    await user.click(screen.getByRole('button', { name: 'Set it up' }));

    expect(
      await screen.findByText(
        'This device needs a fingerprint, PIN, or passcode set up before it can be used as a passkey here.'
      )
    ).toBeTruthy();
  });
});
