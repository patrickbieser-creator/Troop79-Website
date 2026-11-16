import 'server-only';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { resolveFamilyScope } from '@/lib/household-scope';
import { createAdminClient } from '@/lib/supabase/server';
import { actorCanEnterAdmin, resolveAdminActor } from '@/lib/admin-actor';
import { healthStorage } from '@/lib/health-files';
import { centralToday } from '@/lib/dates';
import { isHealthViewer, isYouthOnRoster, loadTripsForAdult, type HealthAccess, type HealthDeps, type HealthViewer } from '@/lib/health-store';

/**
 * Who may see or change health records (Plans/Health-Forms.md, Patrick 2026-11-12). CHANGING them has one way
 * in, the family: a verified ADULT manages their own records and their children's (an explicit parent or guardian
 * relationship, lib/household-scope) and nobody else's. Scouts never (answer 7): a scout's session resolves to no
 * access at all. OPENING them has two more ways in, healthAccess() below.
 *
 * Every action and the file route ask this on each request; nothing is carried in the page.
 */
export interface HealthFamilyAccess {
  viewer: HealthViewer;
  /** The people this adult may act for: themselves and their children. */
  personIds: number[];
}

export async function healthFamilyAccess(): Promise<HealthFamilyAccess | null> {
  const session = await getIdentitySessionIfValid();
  if (!session || session.subjectKind !== 'adult') return null;
  const supabase = createAdminClient();
  if (!(await isEpochCurrent(supabase, session))) return null;
  if (await isYouthOnRoster(supabase, session.personId)) return null;
  const personIds = await resolveFamilyScope(supabase, session.personId, 'adult');
  return { viewer: { personId: session.personId, name: session.displayName, via: 'family' }, personIds };
}

/**
 * Everything a signed-in adult may open (release 2, Patrick's answer 1). Three ways in, resolved on every request:
 *   family — their own records and their children's;
 *   named  — on the health_viewers list: anyone's;
 *   trip   — attending an event that is inside its window (7 days before to 2 days after): that event's attendees.
 * A scout session, a signed-out visitor and a revoked session all resolve to null. A leader cookie alone is not
 * enough: this needs the person's own verified sign-in.
 */
export async function healthAccess(): Promise<HealthAccess | null> {
  const session = await getIdentitySessionIfValid();
  if (!session || session.subjectKind !== 'adult') return null;
  const supabase = createAdminClient();
  if (!(await isEpochCurrent(supabase, session))) return null;
  // The roster has the last word: a current scout or Webelos opens nothing, whatever the session claims.
  if (await isYouthOnRoster(supabase, session.personId)) return null;
  const [family, named, trips] = await Promise.all([
    resolveFamilyScope(supabase, session.personId, 'adult'),
    isHealthViewer(supabase, session.personId),
    loadTripsForAdult(supabase, session.personId, centralToday())
  ]);
  return { me: { personId: session.personId, name: session.displayName }, family, named, trips };
}

export function healthDeps(): HealthDeps {
  return { supabase: createAdminClient(), storage: healthStorage(), today: centralToday };
}

/**
 * Is this admin on the health viewers list? Decides only whether the Health Forms menu item shows
 * (Plans/Admin-Health-Forms.md, decision 3): every Health Forms page still gates itself. A password session has no
 * person, so it is never a viewer. Fails closed: the layout calls this on every admin page, and a failed lookup must
 * hide one menu item, not break the workspace (qa-lead, 2026-11-15).
 */
export async function adminIsHealthViewer(actor: { kind: 'legacy' | 'identity'; personId: number | null }): Promise<boolean> {
  if (actor.kind !== 'identity' || actor.personId == null) return false;
  try {
    return await isHealthViewer(createAdminClient(), actor.personId);
  } catch (e) {
    console.error('[health] viewer lookup failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

/** The admin Health Forms rule (decision 3): able to enter admin AND on the health viewers list. Pure, so it is tested. */
export function healthAdminAllowed(canEnterAdmin: boolean, access: Pick<HealthAccess, 'named'> | null): boolean {
  return canEnterAdmin && access?.named === true;
}

/**
 * The gate every admin Health Forms page and action calls on the request. Returns the health access (who is acting)
 * when allowed, null otherwise.
 */
export async function healthAdminAccess(): Promise<HealthAccess | null> {
  const [actor, access] = await Promise.all([resolveAdminActor(), healthAccess()]);
  return healthAdminAllowed(actorCanEnterAdmin(actor), access) ? access : null;
}
