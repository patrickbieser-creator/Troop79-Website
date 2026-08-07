'use server';

/**
 * Site-wide "Log Out" in the public nav's utility bar (Patrick, 2026-08-06 —
 * requested after testing the Resource Library proof flow: a leftover
 * t79_leader_session cookie made gateAudience() see him as a leader on every
 * gated public page, and /profile's sign-out only ever touched the family
 * cookie).
 *
 * Clears every session cookie this site issues, regardless of which are
 * actually set — a genuine "log out everywhere" rather than a per-flow
 * sign-out. Deliberately its own action file (not a re-export of
 * profileSignOutAction or admin/login's logoutAction) per this project's
 * established convention of one thin action per surface rather than
 * cross-route imports (see library/submit/actions.ts's libraryGateAction
 * comment) — this one just clears a superset of what those two clear.
 *
 * t79_identity (Plans/Family-Identity-Auth.md Phase 1) added 2026-08-06 —
 * a verified session is the ONE cookie type here that isn't recoverable by
 * just re-entering a shared password, so it belongs in the "log out
 * everywhere" superset at least as much as the others.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEADER_COOKIE } from '@/lib/leader-session';
import { FAMILY_COOKIE } from '@/lib/family-session';
import { PROFILE_HOUSEHOLD_COOKIE } from '@/lib/profile-household-session';
import { IDENTITY_COOKIE } from '@/lib/identity-session';
import { safeInternalPath } from '@/lib/safe-redirect';

export async function logOutEverywhereAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  jar.delete(LEADER_COOKIE.name);
  jar.delete(FAMILY_COOKIE.name);
  jar.delete(PROFILE_HOUSEHOLD_COOKIE.name);
  jar.delete(IDENTITY_COOKIE.name);

  const next = safeInternalPath(String(formData.get('next') ?? ''), '/');
  redirect(next);
}
