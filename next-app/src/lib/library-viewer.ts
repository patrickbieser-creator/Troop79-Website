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
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAdminActor, actorHas, type AdminActor } from '@/lib/admin-actor';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { loadHouseholdByKey } from '@/lib/households';
import { loadActiveScoutsList } from '@/lib/library-data';

/**
 * Pure decision, split out of resolveLibraryViewer()/viewerIsLeader() so it's
 * unit-testable without this file's cookie-reading boundary (same reason
 * lib/require-role.ts extracted satisfiesLegacyRole() — see its header).
 *
 * `library.proxy_view` is grantable — individually or via the 'librarian'
 * bundle — to ANY person_id, and "Librarian" is a real youth position of
 * responsibility. Without the `subjectKind !== 'scout'` guard, applying that
 * bundle to a scout would hand them every active scout's advancement
 * progress in the troop (qa-lead review, 2026-08-17) — the resolver must
 * refuse that regardless of what the grants table says.
 */
export function actorCanProxyLibrary(actor: AdminActor | null): boolean {
  return !!actor && actor.subjectKind !== 'scout' && actorHas(actor, 'library.proxy_view');
}

/**
 * Pure decision behind viewerIsLeader() — see that function's header for the
 * full rationale. Deliberately not `actor !== null`: a verified scout
 * identity can hold a real capability (the youth_leader bundle grants
 * `meeting_plan.use`) without being an adult leader, so `capabilities.size`
 * alone is not enough to gate leaders-only material.
 */
export function actorIsLibraryLeader(actor: AdminActor | null): boolean {
  return !!actor && actor.subjectKind !== 'scout' && actor.capabilities.size > 0;
}

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
  // Admin actor holding `library.proxy_view` — the ONLY path that can reach
  // 'proxy-available' (Plans/Unified-Identity-And-Capabilities.md). Checked
  // first via the same AdminActor abstraction every other admin surface
  // uses — resolveAdminActor() covers both an outstanding legacy
  // `t79_leader_session` cookie and the current `t79_identity` cookie, so
  // this file never has to branch on which credential arrived (that's the
  // whole point of the abstraction — see lib/admin-actor.ts's header).
  //
  // Previously this checked ONLY the legacy leader cookie against the
  // `library_superusers` table directly — dead since LEADER_PASSWORD
  // retired 2026-08-16, because nothing mints that cookie anymore. The
  // superuser proxy silently stopped working for every leader from that
  // date until this fix; `library_superusers`' rows were already migrated
  // into `person_capabilities` as `library.proxy_view` grants by the same
  // migration, so this file just needed to start reading them.
  //
  // An admin actor who does NOT hold the grant falls through to the
  // identity check below rather than short-circuiting to 'none' — under
  // the unified session model a leader and a verified parent are often the
  // SAME `t79_identity` cookie, and a leader with no library grant must
  // still see their own scout's personalization as a parent.
  const actor = await resolveAdminActor();
  if (actorCanProxyLibrary(actor)) {
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
 * True when the current session is an adult admin actor — the gate for
 * `visibility='leaders'` resources (Plans/Library-Admin-Resource-Entry.md).
 *
 * Same dead-cookie bug as resolveLibraryViewer() above: this checked ONLY
 * the legacy `t79_leader_session` cookie, which nothing has minted since
 * LEADER_PASSWORD retired 2026-08-16 — leaders-only Library material was
 * invisible to every leader from that date until this fix. Now goes through
 * the same AdminActor abstraction as the rest of /admin.
 *
 * See actorIsLibraryLeader() above for the decision itself. Family and
 * verified-household (non-admin) sessions are excluded the same way they
 * always were: they hold no capability at all, so `capabilities.size === 0`
 * already excludes them.
 */
export async function viewerIsLeader(): Promise<boolean> {
  return actorIsLibraryLeader(await resolveAdminActor());
}
