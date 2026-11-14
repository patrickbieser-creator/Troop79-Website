import 'server-only';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { resolveFamilyScope } from '@/lib/household-scope';
import { createAdminClient } from '@/lib/supabase/server';
import { healthStorage } from '@/lib/health-files';
import { centralToday } from '@/lib/dates';
import type { HealthDeps, HealthViewer } from '@/lib/health-store';

/**
 * Who may see or change health records (Plans/Health-Forms.md, Patrick 2026-11-12). This release has ONE way in:
 * the family. A verified ADULT sees and manages their own records and their children's (an explicit parent or
 * guardian relationship, lib/household-scope) and nobody else's. Scouts never (answer 7): a scout's session
 * resolves to no access at all. Named leaders and adults on a trip come with the leader view.
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
  const personIds = await resolveFamilyScope(supabase, session.personId, 'adult');
  return { viewer: { personId: session.personId, name: session.displayName, via: 'family' }, personIds };
}

export function healthDeps(): HealthDeps {
  return { supabase: createAdminClient(), storage: healthStorage(), today: centralToday };
}
