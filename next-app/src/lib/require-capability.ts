/**
 * Server Action auth guard, capability edition
 * (Plans/Unified-Identity-And-Capabilities.md Phase B).
 *
 * Mirrors requireRole()'s throw-if-refused shape so converting a page is a
 * one-line change:
 *
 *     await requireRole(['leader'])            →  await requireCapability('advancement.write')
 *
 * Both session types satisfy it during the transition — see the legacy
 * capability shim in lib/admin-actor.ts — so a converted page keeps working
 * for people still signing in with LEADER_PASSWORD.
 *
 * Kept separate from lib/require-role.ts rather than merged into it: the two
 * need to coexist while pages are converted one at a time, and a single
 * function that took "a role or a capability" would be the kind of thing
 * nobody deletes in Phase E.
 */

import { resolveAdminActor, type AdminActor } from '@/lib/admin-actor';
import { CAPABILITY_LABEL, type Capability } from '@/lib/capabilities';

export async function requireCapability(capability: Capability): Promise<AdminActor> {
  const actor = await resolveAdminActor();
  if (!actor) throw new Error('Not authenticated');
  if (!actor.capabilities.has(capability)) {
    throw new Error(`This action requires: ${CAPABILITY_LABEL[capability]}.`);
  }
  return actor;
}

/**
 * Any ONE of a specific set — for a screen with a read/write split
 * (finance.manage OR finance.view can both reach the ledger; only
 * finance.manage can post to it). Distinct from requireAnyCapability(),
 * which means "any capability at all, i.e. may this person be in /admin".
 */
export async function requireAnyOf(capabilities: readonly Capability[]): Promise<AdminActor> {
  const actor = await resolveAdminActor();
  if (!actor) throw new Error('Not authenticated');
  if (!capabilities.some((c) => actor.capabilities.has(c))) {
    const labels = capabilities.map((c) => CAPABILITY_LABEL[c]).join(' or ');
    throw new Error(`This action requires: ${labels}.`);
  }
  return actor;
}

/** Any capability at all — the "may this person be in /admin" question. */
export async function requireAnyCapability(): Promise<AdminActor> {
  const actor = await resolveAdminActor();
  if (!actor) throw new Error('Not authenticated');
  if (actor.capabilities.size === 0) {
    throw new Error('This account does not have admin access.');
  }
  return actor;
}
