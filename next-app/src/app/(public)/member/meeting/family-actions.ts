'use server';

/**
 * /member/meeting's family writes (Plans/Meeting-Planner-III.md, Decision 5): the signed-in family's answer and ticks
 * for one scout. Who may write is decided from the VERIFIED session, never the request: a scout for themself, an adult
 * for the active scouts in their household (the same rule as before, decideActFor). Only a published troop meeting
 * within the planner's next PLANNER_WEEKS takes answers (loadOpenMeeting).
 */
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { decideActFor } from '@/lib/meeting-board-shared';
import { loadHouseholdScoutPersonIds } from '@/lib/meeting-board';
import { familyWrite, loadOpenMeeting, type FamilyOp, type FamilyWrite } from '@/lib/family-week';

export async function familyWriteAction(input: { entryId: number; scoutId: number; op: FamilyOp }): Promise<FamilyWrite> {
  if (!Number.isInteger(input?.entryId) || !Number.isInteger(input?.scoutId) || !input.op) return { ok: false, error: 'Malformed request' };
  const sb = createAdminClient();
  const session = await getIdentitySessionIfValid();
  if (!session || !(await isEpochCurrent(sb, session))) return { ok: false, error: 'Your sign-in has expired. Sign in again to save.' };
  const actorIsScout = session.subjectKind === 'scout';
  const household = actorIsScout ? [] : await loadHouseholdScoutPersonIds(sb, session.personId);
  if (!decideActFor({ actorPersonId: session.personId, actorIsScout, targetPersonId: input.scoutId, householdScoutPersonIds: household, leader: false })) {
    return { ok: false, error: 'You can only answer for yourself or the scouts in your household.' };
  }
  const meeting = await loadOpenMeeting(sb, input.entryId);
  if (!meeting) return { ok: false, error: 'That meeting isn’t taking answers. Reload the page for the next one.' };
  const res = await familyWrite(sb, { meeting, actorPersonId: session.personId, scoutPersonId: input.scoutId, catalog: await loadAdvancementCatalog() }, input.op);
  if (res.ok) {
    revalidatePath('/member');
    revalidatePath('/member/meeting');
  }
  return res;
}
