/**
 * Who is acting in /admin, regardless of which credential got them there
 * (Plans/Unified-Identity-And-Capabilities.md Phase B).
 *
 * Two session types reach the workspace during the transition:
 *
 *   1. `t79_leader_session` — the legacy shared-password login. Still fully
 *      supported; retires in Phase E.
 *   2. `t79_identity` — a verified person who holds at least one capability.
 *      This is the one that makes "a leader who is also a parent signs in
 *      once" true.
 *
 * Callers should never branch on which cookie was presented. They ask for a
 * capability and get an answer — that is the whole point of the abstraction,
 * and it is what lets Phase E delete the legacy branch without touching a
 * single page.
 *
 * Server-only: needs next/headers. The framework-agnostic half lives in
 * lib/capabilities.ts so proxy.ts (Edge) can still import the vocabulary.
 */

import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { LEADER_COOKIE, verifySession, type SessionRole } from '@/lib/leader-session';
import { IDENTITY_COOKIE, verifyIdentitySession } from '@/lib/identity-session';
import { leaderSessionPersonId } from '@/lib/session-person';
import { CAPABILITIES, loadPersonAuthz, type Capability } from '@/lib/capabilities';

export interface AdminActor {
  /** Which credential authorized this request. */
  kind: 'legacy' | 'identity';
  /** Display label for the top bar. */
  label: string;
  /** people.id. Null only for a legacy scout session, which stores an
   *  unmatched free-text username and therefore has no person behind it. */
  personId: number | null;
  capabilities: Set<Capability>;
  /** Legacy role when kind === 'legacy'; null for identity actors. Retained
   *  only for SubNav's scout filtering, which Phase C deletes. */
  legacyRole: SessionRole | null;
}

/**
 * TRANSITION SHIM — legacy sessions get a synthetic capability set.
 *
 * A LEADER_PASSWORD session grants full admin today, so it maps to every
 * capability; otherwise converting a page to requireCapability() in Phase B2
 * would lock out the people currently using the site. A SCOUT_PASSWORD
 * session maps to news.write alone, matching the only thing scouts actually
 * do in /admin.
 *
 * Both mappings die in Phase C/E along with the passwords. They are the
 * reason the switchover is safe to do one page at a time rather than in one
 * commit.
 */
function legacyCapabilities(role: SessionRole): Set<Capability> {
  if (role === 'leader') return new Set(CAPABILITIES);
  return new Set<Capability>(['news.write']);
}

/**
 * Resolve the acting person, or null when the request carries no admin-worthy
 * credential.
 *
 * An identity session with ZERO capabilities resolves to an actor with an
 * empty set rather than null — the difference matters to the workspace
 * layout, which shows "you don't have admin access" instead of bouncing to a
 * login the visitor has already completed.
 */
export async function resolveAdminActor(): Promise<AdminActor | null> {
  const jar = await cookies();

  const legacy = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (legacy) {
    return {
      kind: 'legacy',
      label: legacy.leader,
      // Resolved by reverse label match — lossy in principle, which is why
      // identity sessions carry the id outright. See session-person.ts.
      personId: legacy.role === 'leader' ? await leaderSessionPersonId() : null,
      capabilities: legacyCapabilities(legacy.role),
      legacyRole: legacy.role
    };
  }

  const identity = await verifyIdentitySession(jar.get(IDENTITY_COOKIE.name)?.value);
  if (!identity) return null;

  // The one DB read: epoch and grants together (see person_authz()).
  const authz = await loadPersonAuthz(createAdminClient(), identity.personId);
  // Revoked (epoch bumped) or deleted → not an actor at all, so the layout
  // sends them to sign in again rather than showing an access message.
  if (!authz || authz.sessionEpoch !== identity.epoch) return null;

  return {
    kind: 'identity',
    label: identity.displayName,
    personId: identity.personId,
    capabilities: authz.capabilities,
    legacyRole: null
  };
}

export function actorHas(actor: AdminActor | null, capability: Capability): boolean {
  return actor?.capabilities.has(capability) ?? false;
}
