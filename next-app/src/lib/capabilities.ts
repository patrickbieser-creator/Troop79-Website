/**
 * The capability vocabulary and the one read that answers "may this person do
 * this" (Plans/Unified-Identity-And-Capabilities.md Phase A).
 *
 * Framework-agnostic on purpose — no next/headers here, same split as
 * lib/leader-session.ts vs lib/require-role.ts. The cookie-reading guard lives
 * in lib/require-capability.ts.
 *
 * WHY CAPABILITIES ARE NOT IN THE SESSION COOKIE
 * They would go stale exactly when it matters: a leader who steps down
 * mid-session would keep every grant until their 120-day cookie expired.
 * Instead the cookie carries only identity (personId + epoch) and the grants
 * are read per privileged action — combined with the epoch check that
 * lib/identity-session.ts already spends, so the cost profile is unchanged.
 * See the person_authz() comment in 20260816120000_person_capabilities.sql.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Must stay in lockstep with the check constraint on person_capabilities. */
export const CAPABILITIES = [
  'advancement.write',
  'roster.manage',
  'calendar.write',
  'news.write',
  'meeting_plan.use',
  'library.moderate',
  'library.proxy_view'
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Human-facing labels for the grants screen. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  'advancement.write': 'Record advancement',
  'roster.manage': 'Manage the roster',
  'calendar.write': 'Manage the calendar',
  'news.write': 'Publish news',
  'meeting_plan.use': 'Generate meeting plans',
  'library.moderate': 'Moderate the Library',
  'library.proxy_view': 'View the Library as a scout'
};

/**
 * A BUNDLE IS A BUTTON, NOT A LAYER.
 *
 * Applying one writes individual person_capabilities rows and then forgets it
 * existed. There is no bundle_id on the row, no inheritance to resolve at
 * check time, and no way for editing a definition here to silently change
 * someone's existing access. That is what keeps the ergonomics of roles
 * without the resolution problem that made roles the wrong model for a troop
 * (a youth leader is not a weaker adult leader — the grants don't nest).
 */
export const BUNDLES: Record<string, { label: string; capabilities: readonly Capability[] }> = {
  youth_leader: {
    label: 'Youth leader (SPL / PL)',
    capabilities: ['meeting_plan.use']
  },
  adult_leader: {
    label: 'Adult leader (ASM)',
    capabilities: ['calendar.write', 'news.write', 'meeting_plan.use']
  },
  membership_chair: {
    label: 'Membership / committee chair',
    capabilities: ['roster.manage']
  },
  advancement_chair: {
    label: 'Advancement chair',
    capabilities: ['advancement.write', 'roster.manage', 'meeting_plan.use', 'library.moderate']
  },
  comms_lead: {
    label: 'Comms / newsletter lead',
    capabilities: ['calendar.write', 'news.write']
  },
  librarian: {
    label: 'Librarian',
    capabilities: ['library.moderate', 'library.proxy_view']
  },
  troop_admin: {
    label: 'Troop admin',
    capabilities: CAPABILITIES
  }
};

/** Flat capability list for a bundle key. Unknown key → empty, never a throw:
 *  a stale bundle name in a form post must not 500 the grants screen. */
export function expandBundle(bundleKey: string): Capability[] {
  return [...(BUNDLES[bundleKey]?.capabilities ?? [])];
}

/**
 * Would removing this person's grant leave the capability held by NOBODY?
 *
 * Pure so it can be tested without cookie or DB fixtures — the caller does the
 * read (see refuseIfLastHolder in admin/access/actions.ts). Returns false when
 * the person doesn't hold it in the first place: revoking a grant that isn't
 * there is a no-op, not an orphaning.
 */
export function wouldOrphanCapability(holderPersonIds: readonly number[], personId: number): boolean {
  if (!holderPersonIds.includes(personId)) return false;
  return holderPersonIds.every((id) => id === personId);
}

export interface PersonAuthz {
  personId: number;
  /** Live session_epoch — compare against the cookie's to detect revocation. */
  sessionEpoch: number;
  capabilities: Set<Capability>;
}

/**
 * Epoch + grants in ONE round trip. Do not split this into two queries —
 * see the person_authz() comment in the migration for why.
 *
 * Returns null when the person does not exist (deleted, or a forged id).
 */
export async function loadPersonAuthz(
  supabase: SupabaseClient,
  personId: number
): Promise<PersonAuthz | null> {
  const { data, error } = await supabase.rpc('person_authz', { p_person_id: personId });
  if (error) throw new Error(`person_authz failed: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { session_epoch: number; capabilities: string[] | null }
    | undefined;
  if (!row) return null;

  const capabilities = new Set<Capability>();
  for (const raw of row.capabilities ?? []) {
    // Validate on the way out rather than trusting the column. Same
    // defense-in-depth reasoning verifyIdentitySession() applies to
    // subjectKind: a value that shouldn't exist must not become authority
    // just because it reached us from our own database.
    if (isCapability(raw)) capabilities.add(raw);
  }

  return { personId, sessionEpoch: row.session_epoch, capabilities };
}

/**
 * The whole authorization question in one call: does this person hold this
 * capability, AND is the session that asked still current?
 *
 * `issuedEpoch` is the epoch carried by the caller's session cookie. A
 * mismatch means the session was revoked — a roster deactivation, or a leader
 * explicitly bumping it — and the answer is no regardless of the grant.
 */
export async function hasCapability(
  supabase: SupabaseClient,
  personId: number,
  capability: Capability,
  issuedEpoch: number
): Promise<boolean> {
  const authz = await loadPersonAuthz(supabase, personId);
  if (!authz) return false;
  if (authz.sessionEpoch !== issuedEpoch) return false;
  return authz.capabilities.has(capability);
}

/** True when the person holds any capability at all — the "may this person
 *  reach /admin" question, kept separate so proxy.ts has one thing to ask. */
export async function hasAnyCapability(
  supabase: SupabaseClient,
  personId: number,
  issuedEpoch: number
): Promise<boolean> {
  const authz = await loadPersonAuthz(supabase, personId);
  if (!authz) return false;
  if (authz.sessionEpoch !== issuedEpoch) return false;
  return authz.capabilities.size > 0;
}
