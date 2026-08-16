/**
 * Server Action auth guard. Throws unless the caller satisfies one of the
 * allowed legacy roles.
 *
 * TRANSITIONAL (Plans/Unified-Identity-And-Capabilities.md Phase B).
 * Two credentials can satisfy this now: the legacy `t79_leader_session`
 * cookie, and a verified identity session carrying capabilities. There are
 * ~180 call sites between this and ensureLeader(), so they convert to
 * requireCapability() page by page in Phase B2 rather than in one commit —
 * this function is what keeps both worlds working meanwhile.
 *
 * THE IDENTITY MAPPING IS DELIBERATELY STRICT, AND THAT IS THE POINT.
 * `requireRole(['leader'])` guards ~129 call sites that mean many different
 * things — the ledger, the roster, the calendar, Scoutbook export. Mapping it
 * to "holds any capability" would let an ASM with only calendar.write reach
 * the advancement ledger: a real privilege widening, introduced silently, in
 * exchange for convenience during a transition. So an identity actor
 * satisfies 'leader' only by holding EVERY capability — i.e. by being a troop
 * admin.
 *
 * The cost is that a partially-granted leader keeps using LEADER_PASSWORD
 * until their pages are converted. That is the correct trade: no privilege is
 * ever widened, and B2 removes the restriction properly by giving each call
 * site the capability it actually means. Deleting this shim is Phase E.
 */

import { cookies } from 'next/headers';
import { LEADER_COOKIE, verifySession, type LeaderSession, type SessionRole } from '@/lib/leader-session';
import { resolveAdminActor } from '@/lib/admin-actor';
import { CAPABILITIES } from '@/lib/capabilities';
import type { AdminActor } from '@/lib/admin-actor';

/**
 * Conservative legacy-role equivalence for an identity actor. See header.
 *
 * 'leader' is the only role left (the scout login was retired in Phase C), and
 * an identity actor satisfies it only by holding EVERY capability.
 */
export function satisfiesLegacyRole(actor: AdminActor, role: SessionRole): boolean {
  if (actor.kind === 'legacy') return actor.legacyRole === role;
  return CAPABILITIES.every((c) => actor.capabilities.has(c));
}

export async function requireRole(allowed: SessionRole[]): Promise<LeaderSession> {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);

  if (session) {
    if (!allowed.includes(session.role)) {
      throw new Error(`This action requires ${allowed.join(' or ')} access.`);
    }
    return session;
  }

  // No legacy cookie — fall through to a verified identity session.
  const actor = await resolveAdminActor();
  if (!actor) throw new Error('Not authenticated');

  const matched = allowed.find((role) => satisfiesLegacyRole(actor, role));
  if (!matched) {
    throw new Error(`This action requires ${allowed.join(' or ')} access.`);
  }

  // Callers read `.leader` for audit stamps (ledger_entries.entered_by and
  // friends). An identity actor's display name is the right value there, and
  // it is a stronger one than the legacy path's typed username — it came from
  // a verified person record rather than a text box.
  return { leader: actor.label, iat: Date.now(), role: matched };
}
