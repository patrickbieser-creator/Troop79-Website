'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FAMILY_COOKIE, signFamilySession } from '@/lib/family-session';
import { secretMatches } from '@/lib/signed-cookie';
import { safeInternalPath } from '@/lib/safe-redirect';

/**
 * Family gate: exchange the shared troop password for the family cookie.
 *
 * One password for the whole troop, printed in the Bugle — no accounts, no
 * email, no signup wall, because login friction is the single biggest
 * suppressor of RSVP response rates. See lib/family-session.ts for the
 * accepted risk this carries.
 */
export async function familyGateAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/events');

  // Only ever redirect same-origin — a prefix check is not enough here.
  const safeNext = safeInternalPath(next, '/events');

  if (!process.env.FAMILY_PASSWORD) redirect(`${safeNext}?gate=not-configured`);
  if (!password) redirect(`${safeNext}?gate=missing`);
  if (!secretMatches(password, process.env.FAMILY_PASSWORD)) {
    redirect(`${safeNext}?gate=bad-password`);
  }

  const token = await signFamilySession({ role: 'family', iat: Date.now() });
  const jar = await cookies();
  jar.set(FAMILY_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FAMILY_COOKIE.maxAgeSeconds
  });

  redirect(safeNext);
}

export async function familySignOutAction(formData: FormData): Promise<void> {
  const safeNext = safeInternalPath(String(formData.get('next') ?? ''), '/events');
  const jar = await cookies();
  jar.delete(FAMILY_COOKIE.name);
  redirect(safeNext);
}
