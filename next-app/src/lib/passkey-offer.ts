/**
 * The one-time passkey offer, everywhere (Plans/Family-Identity-Auth.md
 * Phase 4; Patrick, 2026-08-27: "passkeys everywhere").
 *
 * A code/link sign-in sets `t79_welcome` — short-lived and identity-free
 * (the value is "1") — and the public layout's PasskeyOfferGate offers
 * one-tap sign-in on whatever page the person lands on. This replaced the
 * `?welcome=1` URL flag that only /events/ signup pages honoured.
 *
 * Deliberately NOT httpOnly: the gate is a client component. Reading
 * cookies() in the public layout would opt every ISR page into dynamic
 * rendering, and the cookie carries nothing worth protecting.
 */
import type { IdentitySubjectKind } from '@/lib/identity-session';

export const WELCOME_COOKIE = {
  name: 't79_welcome',
  maxAgeSeconds: 15 * 60
} as const;

export function welcomeCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV) {
  return {
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: nodeEnv === 'production',
    path: '/',
    maxAge: WELCOME_COOKIE.maxAgeSeconds
  };
}

/** Adults only (D-119); only while they hold no passkey; only when the
 *  server is configured for passkeys at all. */
export function shouldOfferPasskey(input: {
  configured: boolean;
  subjectKind: IdentitySubjectKind | null;
  hasPasskey: boolean;
}): boolean {
  return input.configured && input.subjectKind === 'adult' && !input.hasPasskey;
}
