/**
 * Session status for the public nav's consolidated login/logout control
 * (site-auth-status.tsx). Deliberately a Route Handler fetched client-side
 * rather than a cookies() read inside SiteNav itself — SiteNav wraps EVERY
 * public page via (public)/layout.tsx, and Next bails a whole route out of
 * static/ISR generation the moment anything in its render tree calls
 * cookies()/headers(). That broke /about, /events, /join, /meeting-plan,
 * /meetings, and /photos (the last two losing their 30-minute ISR caching)
 * the first time this was tried (caught in build output, 2026-08-06) — see
 * D-040 for why this codebase already treats "accidentally-dynamic-content-
 * rendered-as-static" as a bug class, but the fix there was the opposite
 * direction (force dynamic where content needs to be fresh); here the goal
 * is the reverse — keep genuinely static pages static while a small,
 * independent, always-dynamic endpoint carries the session state the UI
 * needs.
 *
 * Extended 2026-08-06 (nav cleanup) beyond the original bare `loggedIn`
 * boolean to also carry a display level and label — the nav used to show
 * "Profile" / "Sign In" / "Members Login" unconditionally regardless of
 * session state, which this endpoint's original boolean couldn't fix on its
 * own. `label` is not new exposure: the same display name (session.leader /
 * session.displayName) was already rendered server-side on /profile and
 * every /admin page for a signed-in visitor — this just lets the client nav
 * show it too, on the same "harmless if stale" basis as `loggedIn` always
 * had (signature check only, no epoch/revocation read — a revoked-but-still-
 * signed identity cookie shows a level that's about to stop working
 * anywhere it's actually spent; Log Out still clears it, and /profile itself
 * shows the authoritative "revoked" state on load).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { FAMILY_COOKIE, verifyFamilySession } from '@/lib/family-session';
import { IDENTITY_COOKIE, verifyIdentitySession } from '@/lib/identity-session';

export type SessionLevel = 'Admin' | 'Scout' | 'Family';

export interface SessionStatus {
  loggedIn: boolean;
  /** Coarse access level for display — the three the troop actually talks
   *  about, collapsing both scout paths (shared SCOUT_PASSWORD and verified
   *  Tier 2-S identity) and both family paths (shared FAMILY_PASSWORD and
   *  verified Tier 2 identity) onto the same word. */
  level: SessionLevel | null;
  /** Display name, when the session carries one. Null for the unverified
   *  family cookie, which proves only the shared password, not a person. */
  label: string | null;
  /** True only for a verified adult identity session (Tier 2) — the one
   *  audience /profile is actually built for. */
  canViewProfile: boolean;
  /** A VERIFIED person, adult or scout — i.e. someone we can name, not just
   *  someone who knows the troop password. Gates the Member area and the
   *  story-submission surfaces, both of which act under the person's own
   *  name. */
  isVerifiedMember: boolean;
}

export async function GET() {
  const jar = await cookies();
  const [leaderSession, familySession, identitySession] = await Promise.all([
    verifySession(jar.get(LEADER_COOKIE.name)?.value),
    verifyFamilySession(jar.get(FAMILY_COOKIE.name)?.value),
    verifyIdentitySession(jar.get(IDENTITY_COOKIE.name)?.value)
  ]);

  // Precedence mirrors lib/family-access.ts's gateAudience(): a leader/admin
  // session is the strongest and most specific signal, then verified
  // identity, then the plain shared-password family cookie.
  let status: SessionStatus;
  if (leaderSession) {
    status = {
      loggedIn: true,
      level: 'Admin',
      label: leaderSession.leader,
      canViewProfile: false,
      // A leader on the shared password is not a NAMED person to us — the
      // label is whatever they typed. They work in /admin instead.
      isVerifiedMember: false
    };
  } else if (identitySession) {
    status = {
      loggedIn: true,
      level: identitySession.subjectKind === 'adult' ? 'Family' : 'Scout',
      label: identitySession.displayName,
      canViewProfile: identitySession.subjectKind === 'adult',
      isVerifiedMember: true
    };
  } else if (familySession) {
    status = { loggedIn: true, level: 'Family', label: null, canViewProfile: false, isVerifiedMember: false };
  } else {
    status = { loggedIn: false, level: null, label: null, canViewProfile: false, isVerifiedMember: false };
  }

  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
