/**
 * "Which household is logged in on /profile" — a SECOND signed cookie layered
 * on top of the family gate (lib/family-session.ts), not a change to it.
 *
 * lib/family-session.ts is deliberately documented as proof-of-password only
 * ("Do not treat this cookie as identity") and Event Signup relies on exactly
 * that contract via its URL-param-carried household selection. This module
 * doesn't touch that — it's additive, used only by /profile, so a returning
 * visitor there can see "Logged in as {name}" instead of re-picking every
 * visit. Set once a household is picked on /profile; cleared together with
 * the family session cookie on Log out (Plans/Scout-Self-Service-Demographics.md
 * — "logout and re-enter the password for a different family").
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
