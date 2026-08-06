/**
 * "Which household is logged in on this device" — a SECOND signed cookie
 * layered on top of the family gate (lib/family-session.ts), not a change to
 * it.
 *
 * lib/family-session.ts is deliberately documented as proof-of-password only
 * ("Do not treat this cookie as identity") and Event Signup relies on exactly
 * that contract via its URL-param-carried household selection. This module
 * doesn't touch that — it's additive, so a returning visitor can see
 * "Logged in as {name}" instead of re-picking every visit.
 *
 * Shared by two features whose usage pattern is "the same family returns
 * over weeks," not a one-shot transaction: /profile (originally, D-055) and
 * Resource Library proof submission (Plans/Resource-Library.md Phase 2,
 * Patrick 2026-08-06 — recommended over Event Signup's URL-param pattern for
 * exactly this reason). Each route keeps its own gate/pick/switch Server
 * Actions per this project's convention (see submit/actions.ts's
 * libraryGateAction comment) — only this cookie module and its session shape
 * are shared. Set once a household is picked; cleared together with the
 * family session cookie on full sign-out
 * (Plans/Scout-Self-Service-Demographics.md — "logout and re-enter the
 * password for a different family"). A route MAY also clear just this
 * cookie alone (keeping the family gate) to let someone switch households
 * without re-entering the troop password — see profile/actions.ts's
 * profileSignOutAction for the full-logout version this is NOT; each route
 * that wants a switch-only affordance implements its own thin action.
 */

import { signToken, verifyToken } from '@/lib/signed-cookie';

const COOKIE_NAME = 't79_profile_household';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 120; // matches FAMILY_COOKIE's span

export interface ProfileHouseholdSession {
  /** Always 'profile_household'. Present so a differently-shaped signed token
   *  (e.g. the leader or family cookie) can never verify as one of these. */
  role: 'profile_household';
  /** households.Household['key'] — same key space as Event Signup's picker. */
  householdKey: string;
  /** Household label at the time it was picked, shown in the "Logged in as"
   *  banner. Not re-resolved live — a household rename mid-session just means
   *  the banner is stale until next login, which is harmless. */
  displayName: string;
  /** Issued-at timestamp, ms since epoch. */
  iat: number;
}

export async function signProfileHouseholdSession(
  session: Omit<ProfileHouseholdSession, 'role'>
): Promise<string> {
  return signToken({ role: 'profile_household', ...session });
}

export async function verifyProfileHouseholdSession(
  token: string | undefined
): Promise<ProfileHouseholdSession | null> {
  const parsed = (await verifyToken(token)) as Partial<ProfileHouseholdSession> | null;
  if (!parsed) return null;
  if (
    parsed.role !== 'profile_household' ||
    typeof parsed.householdKey !== 'string' ||
    typeof parsed.displayName !== 'string' ||
    typeof parsed.iat !== 'number'
  ) {
    return null;
  }
  return {
    role: 'profile_household',
    householdKey: parsed.householdKey,
    displayName: parsed.displayName,
    iat: parsed.iat
  };
}

export const PROFILE_HOUSEHOLD_COOKIE = {
  name: COOKIE_NAME,
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS
};
