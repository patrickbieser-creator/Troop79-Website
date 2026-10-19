/**
 * Session status for the public nav's account control (account-control.tsx).
 * Deliberately a Route Handler fetched client-side rather than a cookies()
 * read inside SiteNav itself — SiteNav wraps EVERY public page via
 * (public)/layout.tsx, and Next bails a whole route out of static/ISR
 * generation the moment anything in its render tree calls cookies()/headers().
 * That broke /about, /events, /join, /meeting-plan, /meetings, and /photos
 * (the last two losing their 30-minute ISR caching) the first time this was
 * tried (caught in build output, 2026-08-06) — see D-040 for why this
 * codebase already treats "accidentally-dynamic-content-rendered-as-static"
 * as a bug class, but the fix there was the opposite direction (force dynamic
 * where content needs to be fresh); here the goal is the reverse — keep
 * genuinely static pages static while a small, independent, always-dynamic
 * endpoint carries the session state the UI needs.
 *
 * `label` is not new exposure: the same display name (session.displayName)
 * is rendered server-side on /member and every /admin page for a signed-in
 * visitor — this just lets the client nav show it too, on a "harmless if
 * stale" basis (signature check only for loggedIn/label — a revoked-but-still-
 * signed identity cookie shows a name that's about to stop working anywhere
 * it's actually spent; Sign out still clears it).
 *
 * `canAdmin` is the one field that reads the database: it asks the admin
 * workspace's own admission rule (lib/admin-actor.ts actorCanEnterAdmin), so
 * the menu offers "Admin" to exactly the people the workspace would let in —
 * epoch-checked, so a revoked session never sees it. One person_authz() read,
 * only when an identity cookie is present.
 *
 * The legacy shared-password leader cookie is no longer consulted here
 * (2026-10-19): LEADER_PASSWORD retired in Phase E and nothing mints
 * t79_leader_session any more.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { IDENTITY_COOKIE, verifyIdentitySession } from '@/lib/identity-session';
import { actorCanEnterAdmin, resolveAdminActor } from '@/lib/admin-actor';

export type SessionLevel = 'Scout' | 'Family';

export interface SessionStatus {
  loggedIn: boolean;
  /** Coarse access level for display. */
  level: SessionLevel | null;
  /** The person's display name (people.display_name), when signed in. */
  label: string | null;
  /** True only for a verified adult identity session (Tier 2) — the one
   *  audience /profile is actually built for. */
  canViewProfile: boolean;
  /** A VERIFIED person, adult or scout — i.e. someone we can name, not just
   *  someone who knows the troop password. Gates the Member area and the
   *  story-submission surfaces, both of which act under the person's own
   *  name. */
  isVerifiedMember: boolean;
  /** The person may enter /admin — the workspace layout's own rule. */
  canAdmin: boolean;
}

const SIGNED_OUT: SessionStatus = {
  loggedIn: false,
  level: null,
  label: null,
  canViewProfile: false,
  isVerifiedMember: false,
  canAdmin: false
};

export async function GET() {
  const jar = await cookies();
  // THE SHARED-PASSWORD FAMILY COOKIE IS NOT A SIGN-IN (Patrick, 2026-08-16),
  // so it is deliberately not read here. Phase D demoted FAMILY_PASSWORD to
  // the gate on the name picker: it unlocks a list of names and grants
  // nothing, and the thing you leave that screen with is a per-person
  // identity session. Someone holding only that cookie has not signed in as
  // anybody, so the nav must say "Sign in".
  const identitySession = await verifyIdentitySession(jar.get(IDENTITY_COOKIE.name)?.value);

  let status: SessionStatus;
  if (identitySession) {
    status = {
      loggedIn: true,
      level: identitySession.subjectKind === 'adult' ? 'Family' : 'Scout',
      label: identitySession.displayName,
      canViewProfile: identitySession.subjectKind === 'adult',
      isVerifiedMember: true,
      canAdmin: actorCanEnterAdmin(await resolveAdminActor())
    };
  } else {
    // Covers "no cookies at all" AND "troop password only" — see above.
    status = SIGNED_OUT;
  }

  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
