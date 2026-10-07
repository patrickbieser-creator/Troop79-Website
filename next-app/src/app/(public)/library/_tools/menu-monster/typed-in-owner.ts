
/**
 * Who a Menu Monster write is credited to, and whose a typed-in belongs to. Shared by menu-actions.ts and
 * brand-actions.ts (a 'use server' file cannot export these without making them callable from the browser).
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireVerifiedScoutIdentity } from '@/lib/family-access';
import { isMenuId } from '@/lib/menu-monster/menus';
import { loadMenuWith } from '@/lib/menu-monster/menus-store';
import { resolveAdminActor } from '@/lib/admin-actor';
import type { AuditActor } from '@/lib/audit';
import { menuViewer, recipeAuthor } from '../../menu-monster/menus/_components/scout-menus';

export type Fail = { ok: false; error: string };

export const NOT_YOURS = 'That menu isn’t one of yours.';

/** The menu's owner-to-be: a verified scout (the epoch check every scout write makes), else any other signed-in
 *  person (a leader, a parent — menuViewer re-checks a parent's sign-in). Never taken from the payload. */
export async function scoutActor(): Promise<AuditActor | Fail> {
  try {
    const s = await requireVerifiedScoutIdentity();
    return { personId: s.personId, label: s.displayName };
  } catch (e) {
    const viewer = await menuViewer();
    if (viewer && viewer.kind !== 'scout' && viewer.personId != null) {
      const who = await recipeAuthor();
      if (who) return { personId: who.personId, label: who.displayName };
    }
    // A scout hears why their sign-in ended; everyone else is simply asked to sign in.
    return { ok: false, error: e instanceof Error && viewer?.kind === 'scout' ? e.message : 'Sign in to save your menu.' };
  }
}

export const isFail = (v: AuditActor | Fail): v is Fail => 'ok' in v;

/**
 * Who is writing to this menu, and whose it is. The owner writes their own. A LEADER — an adult holding an
 * admin capability, signed in as one person, re-checked on every call — writes anyone's (Patrick,
 * 2026-10-05: "Leaders need full rights to scout menus. They often will work side by side with scouts on
 * their menus at troop meetings"). The owner always comes from the row, never the payload; everyone else
 * gets the answer a missing menu gets.
 */
export async function menuWriter(id: unknown): Promise<{ actor: AuditActor; ownerId: number; own: boolean; current: NonNullable<Awaited<ReturnType<typeof loadMenuWith>>> } | Fail> {
  const actor = await scoutActor();
  if (isFail(actor)) return actor;
  if (!isMenuId(id)) return { ok: false, error: NOT_YOURS };
  const current = await loadMenuWith(createAdminClient(), id);
  if (!current) return { ok: false, error: NOT_YOURS };
  const own = current.ownerPersonId === actor.personId;
  if (!own) {
    // The leader check and the person the write is credited to must be the same sign-in (qa-lead).
    const leader = await leaderActor();
    if (isFail(leader) || leader.personId == null || leader.personId !== actor.personId) return { ok: false, error: NOT_YOURS };
  }
  return { actor, ownerId: current.ownerPersonId, own, current };
}
export const isRefused = (v: object): v is Fail => 'ok' in v;

/** Any adult with admin access (Decision 2) — never a scout identity, even one holding a capability. */
export async function leaderActor(): Promise<AuditActor | Fail> {
  const actor = await resolveAdminActor();
  if (!actor || actor.subjectKind === 'scout' || actor.capabilities.size === 0) {
    return { ok: false, error: 'Only leaders can do that.' };
  }
  return { personId: actor.personId, label: actor.label };
}

/**
 * Who a typed-in ingredient or package belongs to. Normally the person typing. When a leader types one while
 * working on a scout's menu (`onMenuId`, checked by menuWriter), it is filed under the MENU'S OWNER: a
 * typed-in is private to its owner until a leader keeps it, so one filed under the leader could not be used
 * on the scout's menu at all. The label stays the leader's, so the audit trail says who typed it.
 */
export async function typedInOwner(onMenuId: string | undefined): Promise<AuditActor | Fail> {
  if (onMenuId === undefined) return scoutActor();
  const who = await menuWriter(onMenuId);
  if (isRefused(who)) return who;
  return who.own ? who.actor : { personId: who.ownerId, label: `${who.actor.label} (a leader, on their menu)` };
}

