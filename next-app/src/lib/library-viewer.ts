/**
 * "Whose advancement progress should this /library page show?" — the single
 * resolver every personalized Resource Library page calls, so authorization
 * lives in exactly one place (Patrick, 2026-08-07).
 *
 * SECURITY: the `viewScoutParam` (a `?viewScout=` URL value) is NEVER trusted
 * as authorization by itself — it only SELECTS which scout within a set the
 * session already has a right to see (a verified household's own scouts, or
 * — for an authorized superuser leader — every active scout in the troop).
 * /library is otherwise a fully open, anonymous, no-gate page (D-040); an
 * unauthenticated visitor pasting a guessed `?viewScout=` into the URL must
 * see nothing different, and does — every branch below is gated on the
 * SESSION first, and viewScoutParam is only ever used to pick among an
 * already-resolved, already-authorized list.
 *
 * Three outcomes:
 *   - 'none'             — no personalization: anonymous, Tier 1 family-only
 *                          (D-076 — a real per-person identity is required
 *                          here, the same bar /profile and proof submission
 *                          already hold), a leader who isn't an authorized
 *                          superuser, a scout admin login, or a revoked
 *                          identity session.
 *   - 'proxy-available'  — an authorized superuser leader with no `?viewScout=`
 *                          chosen yet. Personalization does NOT default on for
 *                          a leader session the way it does for a signed-in
 *                          family — a leader has no "their own scout" to
 *                          default to, and silently dropping every leader who
 *                          browses /library into "viewing as Scout X" would be
 *                          a surprising, unwanted mode. The UI shows an
 *                          explicit picker instead of a default.
 *   - 'scout'             — personalization active, one scoutId resolved.
 */
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { loadAuthorizedAdults, matchAuthorizedAdult } from '@/lib/authorized-adults';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { loadHouseholdByKey } from '@/lib/households';
import { loadActiveScoutsList, loadLibrarySuperuserCodes } from '@/lib/library-data';

export interface SwitchOption {
  id: string;
  name: string;
}

export type LibraryViewer =
  | { kind: 'none' }
  | { kind: 'proxy-available'; options: SwitchOption[] }
  | {
      kind: 'scout';
      scoutId: string;
      scoutName: string;
      /** Other scouts this viewer could switch to (empty = no toggle shown).
       *  Includes the currently-viewed scout. */
      switchOptions: SwitchOption[];
      isProxy: boolean;
    };

export async function resolveLibraryViewer(
  supabase: SupabaseClient,
  viewScoutParam: string | undefined
): Promise<LibraryViewer> {
  const jar = await cookies();

  // Leader/admin session — the ONLY path that can reach 'proxy-available'.
  // Checked first: a leader session and a verified identity session are
  // independent cookies (a leader can also be signed in as a verified
  // parent), but the leader session is the stronger, more specific
  // credential — same precedence gateAudience() already uses.
  // A scout-role admin login (SCOUT_PASSWORD) falls through to the identity
  // check below rather than short-circuiting to 'none' here — it's a
  // separate, independent credential from a verified Tier 2-S identity
  // cookie, and a scout who happens to hold both shouldn't lose their own
  // legitimate personalization just because they're also signed into
  // /admin (qa-lead review, 2026-08-07).
  const leaderSession = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (leaderSession?.role === 'leader') {
    // leaderSession.leader is a display LABEL ("Mike Ba."), not leaders.code —
    // must resolve it the same way admin/login/actions.ts does before it can
    // be checked against a code-keyed table.
    const adults = await loadAuthorizedAdults(supabase);
    const matched = matchAuthorizedAdult(adults, leaderSession.leader);
    if (!matched) return { kind: 'none' };
    const superuserCodes = await loadLibrarySuperuserCodes(supabase);
    if (!superuserCodes.has(matched.code)) return { kind: 'none' };

    const activeScouts = await loadActiveScoutsList(supabase);
    if (activeScouts.length === 0) return { kind: 'none' };
    const options: SwitchOption[] = activeScouts.map((s) => ({ id: s.id, name: s.displayName }));

    const chosen = viewScoutParam ? activeScouts.find((s) => s.id === viewScoutParam) : undefined;
    if (!chosen) return { kind: 'proxy-available', options };
    return {
      kind: 'scout',
      scoutId: chosen.id,
      scoutName: chosen.displayName,
      switchOptions: options,
      isProxy: true
    };
  }

  // Verified identity (Tier 2 adult / Tier 2-S scout) — D-076.
  const identity = await getIdentitySessionIfValid();
  if (!identity) return { kind: 'none' };
  if (!(await isEpochCurrent(supabase, identity))) return { kind: 'none' };

  const household = await loadHouseholdByKey(identity.householdKey);
  const scouts = household?.scouts ?? [];
  if (scouts.length === 0) return { kind: 'none' };

  if (identity.subjectKind === 'scout') {
    // A verified scout IS the scout — no picker, no way to view a sibling's
    // progress (Family-Identity-Auth.md's "may only ever claim their own
    // work" scope, applied here to viewing as well as claiming).
    const self = scouts.find((s) => s.personId === identity.personId);
    if (!self) return { kind: 'none' };
    return {
      kind: 'scout',
      scoutId: self.id,
      scoutName: self.displayName,
      switchOptions: [],
      isProxy: false
    };
  }

  // Verified adult — default to the first scout unless the param names one
  // of THIS household's own scouts (never a scout outside the household).
  const options: SwitchOption[] = scouts.map((s) => ({ id: s.id, name: s.displayName }));
  const chosen = (viewScoutParam && scouts.find((s) => s.id === viewScoutParam)) || scouts[0];
  return {
    kind: 'scout',
    scoutId: chosen.id,
    scoutName: chosen.displayName,
    switchOptions: scouts.length > 1 ? options : [],
    isProxy: false
  };
}

/**
 * True when the current session is an adult LEADER admin login — the gate for
 * `visibility='leaders'` resources (Plans/Library-Admin-Resource-Entry.md).
 *
 * Deliberately not `role !== null`: the scout admin login is a shared-password
 * role with no per-person identity, and a leaders-only resource is exactly the
 * material it must not reach. Family and verified-household sessions are not
 * leaders either — this is the narrowest of the session checks in this file.
 */
export async function viewerIsLeader(): Promise<boolean> {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  return session?.role === 'leader';
}
