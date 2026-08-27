import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

/**
 * The layout-level gate for the one-time passkey offer (lib/passkey-offer.ts).
 *
 * Found live 2026-08-27: a server-action redirect() is a CLIENT-SIDE
 * navigation, so the public layout — and this gate — stay mounted from the
 * /signin/verify page. A mount-only effect ran before the welcome cookie
 * existed and never looked again; the offer showed only on a hard reload.
 * The gate must re-check whenever the pathname changes.
 */
let pathname = '/signin/verify';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
const eligible = vi.fn<() => Promise<boolean>>();
vi.mock('../src/app/(public)/signin/actions', () => ({
  passkeyOfferEligibleAction: () => eligible(),
  passkeyRegisterOptionsAction: vi.fn(),
  passkeyRegisterVerifyAction: vi.fn()
}));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: vi.fn() }));

import { PasskeyOfferGate } from '../src/app/_components/passkey-offer-gate';

beforeEach(() => {
  document.cookie = 't79_welcome=; Max-Age=0; path=/';
  window.localStorage.clear();
  eligible.mockReset();
  pathname = '/signin/verify';
});

describe('PasskeyOfferGate', () => {
  it('RendersNothing_WithoutTheWelcomeCookie_AndNeverAsksTheServer', async () => {
    render(<PasskeyOfferGate />);
    await act(async () => {});
    expect(screen.queryByText(/no code to type/)).toBeNull();
    expect(eligible).not.toHaveBeenCalled();
  });

  it('ReChecks_WhenThePathnameChanges_AfterAClientSideSignInRedirect', async () => {
    eligible.mockResolvedValue(true);
    const { rerender } = render(<PasskeyOfferGate />);
    await act(async () => {});
    expect(eligible).not.toHaveBeenCalled(); // no cookie yet on /signin/verify

    // The sign-in action sets the cookie and redirect()s — a client-side
    // navigation: same layout, same gate, new pathname.
    document.cookie = 't79_welcome=1; path=/';
    pathname = '/profile';
    rerender(<PasskeyOfferGate />);
    await waitFor(() => expect(screen.getByText(/no code to type/)).toBeTruthy());
    expect(eligible).toHaveBeenCalledTimes(1);
  });

  it('ClearsTheCookie_WhenTheServerSaysNotEligible', async () => {
    eligible.mockResolvedValue(false);
    document.cookie = 't79_welcome=1; path=/';
    render(<PasskeyOfferGate />);
    await waitFor(() => expect(eligible).toHaveBeenCalled());
    await waitFor(() => expect(document.cookie.includes('t79_welcome=1')).toBe(false));
    expect(screen.queryByText(/no code to type/)).toBeNull();
  });
});
