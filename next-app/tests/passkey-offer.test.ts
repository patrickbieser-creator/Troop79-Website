import { describe, it, expect } from 'vitest';
import { WELCOME_COOKIE, welcomeCookieOptions, shouldOfferPasskey } from '../src/lib/passkey-offer';

/**
 * The one-time passkey offer, everywhere (Patrick, 2026-08-27: "passkeys
 * everywhere"). It used to fire only on /events/ signup pages via
 * ?welcome=1; now a code/link sign-in sets a short-lived, identity-free
 * cookie and the public layout's gate offers on whatever page the person
 * lands on — profile, library, news submit, an event.
 */
describe('passkey offer signal', () => {
  it('Cookie_IsShortLived_AndReadableByTheClientGate', () => {
    // Not httpOnly ON PURPOSE: the gate is a client component (reading
    // cookies() in the public layout would force every ISR page dynamic),
    // and the cookie carries nothing but "1".
    const o = welcomeCookieOptions('production');
    expect(WELCOME_COOKIE.name).toBe('t79_welcome');
    expect(o.httpOnly).toBe(false);
    expect(o.secure).toBe(true);
    expect(o.sameSite).toBe('lax');
    expect(o.path).toBe('/');
    expect(o.maxAge).toBe(15 * 60);
    expect(welcomeCookieOptions('development').secure).toBe(false);
  });

  it('Offers_OnlyToAVerifiedAdult_WithNoPasskeyYet', () => {
    expect(shouldOfferPasskey({ configured: true, subjectKind: 'adult', hasPasskey: false })).toBe(true);
    // Scouts stay on codes (D-119, shared-Chromebook risk).
    expect(shouldOfferPasskey({ configured: true, subjectKind: 'scout', hasPasskey: false })).toBe(false);
    expect(shouldOfferPasskey({ configured: true, subjectKind: 'adult', hasPasskey: true })).toBe(false);
    expect(shouldOfferPasskey({ configured: false, subjectKind: 'adult', hasPasskey: false })).toBe(false);
    expect(shouldOfferPasskey({ configured: true, subjectKind: null, hasPasskey: false })).toBe(false);
  });
});
