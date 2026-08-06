'use server';

/**
 * Site-wide "Log Out" in the public nav's utility bar (Patrick, 2026-08-06 —
 * requested after testing the Resource Library proof flow: a leftover
 * t79_leader_session cookie made gateAudience() see him as a leader on every
 * gated public page, and /profile's sign-out only ever touched the family
 * cookie).
 *
 * Clears ALL THREE session cookies this site issues, regardless of which are
 * actually set — a genuine "log out everywhere" rather than a per-flow
 * sign-out. Deliberately its own action file (not a re-export of
 * profileSignOutAction or admin/login's logoutAction) per this project's
 * established convention of one thin action per surface rather than
 * cross-route imports (see library/submit/actions.ts's libraryGateAction
 * comment) — this one just clears a superset of what those two clear.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEADER_COOKIE } from '@/lib/leader-session';
import { FAMILY_COOKIE } from '@/lib/family-session';
import { PROFILE_HOUSEHOLD_COOKIE } from '@/lib/profile-household-session';
import { safeInternalPath } from '@/lib/safe-redirect';

export async function logOutEverywhereAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  jar.delete(LEADER_COOKIE.name);
  jar.delete(FAMILY_COOKIE.name);
  jar.delete(PROFILE_HOUSEHOLD_COOKIE.name);

  const next = safeInternalPath(String(formData.get('next') ?? ''), '/');
  redirect(next);
}
