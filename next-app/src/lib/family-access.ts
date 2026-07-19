/**
 * "May this request see gated signup content?" — the single check every
 * signup surface uses, so the rule lives in one place.
 *
 * A logged-in leader or scout passes without needing the family password:
 * they already cleared a stronger gate, and a leader hitting an event page
 * shouldn't be asked for a second password to see a roster they administer.
 *
 * Needs next/headers, so it's server-only — keep it out of lib/family-session.ts,
 * which stays framework-agnostic for the Edge middleware.
 */

import { cookies } from 'next/headers';
import { FAMILY_COOKIE, verifyFamilySession } from '@/lib/family-session';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';

export type GateAudience = 'family' | 'leader' | 'scout';

/** Which credential (if any) this request carries. Null = not gated in. */
export async function gateAudience(): Promise<GateAudience | null> {
  const jar = await cookies();
  const admin = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (admin) return admin.role;
  const family = await verifyFamilySession(jar.get(FAMILY_COOKIE.name)?.value);
  return family ? 'family' : null;
}

export async function hasFamilyAccess(): Promise<boolean> {
  return (await gateAudience()) !== null;
}

/** Server Action guard for anything that writes signup data. Mirrors
 *  requireRole()'s throw-if-not-authenticated shape. */
export async function requireFamilyAccess(): Promise<GateAudience> {
  const audience = await gateAudience();
  if (!audience) throw new Error('Not authenticated');
  return audience;
}

/** True when the family password isn't configured on this server — the gate
 *  renders an explanatory message instead of an unusable form. */
export function familyGateConfigured(): boolean {
  return !!process.env.FAMILY_PASSWORD;
}
