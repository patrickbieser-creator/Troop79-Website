import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(() => new Promise(() => {}))
}));

import { PasskeyButton } from '../src/app/(public)/signin/passkey-button';
import { PasskeyAutofill } from '../src/app/(public)/signin/passkey-autofill';

/**
 * /signin passkey surfaces (Patrick, 2026-08-21): the one-tap button is
 * PRIMARY only on a browser that has registered/used a passkey before
 * (hint cookie), SECONDARY — a quiet ghost link — otherwise, so a first-time
 * member isn't asked for something they don't have. The conditional-UI
 * autofill component must be inert on browsers without WebAuthn.
 */
const noop = async () => null;
const verify = async () => ({ ok: false as const });

function withWebAuthn<T>(fn: () => T): T {
  const original = (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = function () {};
  try {
    return fn();
  } finally {
    (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = original;
  }
}

describe('PasskeyButton placement', () => {
  it('PasskeyButton_RendersThePrimaryCta_WithTheOneTapHint', () => {
    // The only variant: rendered solely when the device is known to hold a
    // passkey (Patrick, 2026-08-21: show it when it exists, never ask
    // otherwise — the quiet ghost-link variant is gone).
    withWebAuthn(() => render(<PasskeyButton getOptions={noop} verify={verify} />));
    const btn = screen.getByRole('button', { name: /sign in with a passkey/i });
    expect(btn.className).toMatch(/primary/i);
    expect(screen.getByText(/one tap/i)).toBeTruthy();
  });

  it('PasskeyButton_RendersNothing_WithoutWebAuthn', () => {
    const { container } = render(<PasskeyButton getOptions={noop} verify={verify} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('PasskeyAutofill', () => {
  it('PasskeyAutofill_RendersNothingAndDoesNotThrow_WithoutConditionalMediation', () => {
    const { container } = render(<PasskeyAutofill getOptions={noop} verify={verify} />);
    expect(container.innerHTML).toBe('');
  });
});
