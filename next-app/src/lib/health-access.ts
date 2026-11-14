import 'server-only';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { resolveFamilyScope } from '@/lib/household-scope';
import { createAdminClient } from '@/lib/supabase/server';
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
