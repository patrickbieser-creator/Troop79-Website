'use server';

/**
 * Sign out of /admin when the actor got there with a verified identity cookie
 * rather than the shared leader password
 * (Plans/Unified-Identity-And-Capabilities.md Phase B).
 *
 * Clears ONLY t79_identity and lands on the public site — deliberately not
 * logOutEverywhereAction. An identity session is the same credential the
 * person uses for /profile and event signup, but "log out of the admin" is
 * still the narrower intent, and this project's convention is one thin action
 * per surface rather than cross-route imports (see site-nav-actions.ts).
 *
 * Redirects to '/' rather than '/admin/login': that page offers a password
 * this person may not have, so sending them there after they deliberately
 * left the admin would be a dead end.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { IDENTITY_COOKIE } from '@/lib/identity-session';

export async function identityLogoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(IDENTITY_COOKIE.name);
  redirect('/');
}
