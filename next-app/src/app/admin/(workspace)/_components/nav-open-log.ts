/**
 * Logs an open for whoever is signed in (decision 12). Called by the /admin/nav-open route handler, which the rail,
 * the menus, search and A–Z reach with navigator.sendBeacon: a beacon never queues behind or delays a navigation, as
 * a server action would (Next runs server actions one at a time). Scoped to the signed-in actor; a session with no
 * person id logs nothing. Never throws: a failed log is a server-side line, nothing more.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { actorCanEnterAdmin, resolveAdminActor } from '@/lib/admin-actor';
import { logNavOpen } from './nav-events';

export async function logNavOpenForActor(key: unknown): Promise<boolean> {
  if (typeof key !== 'string' || key.length === 0 || key.length > 80) return false;
  try {
    const actor = await resolveAdminActor();
    if (!actor || !actorCanEnterAdmin(actor) || actor.personId == null) return false;
    return await logNavOpen(createAdminClient(), actor.personId, key);
  } catch (e) {
    console.error('[nav-events]', e instanceof Error ? e.message : e);
    return false;
  }
}
