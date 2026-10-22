/**
 * The planner's seed gate (Plans/Meeting-Planner-II.md Decision 2; Build a Plan B1): a meeting_planner.seed holder
 * acting on an upcoming, published meeting that takes sign-ups. Refused before the database is written. Server-only
 * (the service-role client); shared by the This Sunday seed actions and Build a Plan's, so both refuse alike.
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMeetingForWrite } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function plannerSeeder(entryId: unknown) {
  if (!Number.isInteger(entryId)) return fail('Malformed request');
  const actor = await resolveAdminActor();
  if (!plannerAccess(actor).canSeed || actor?.personId == null) return fail('Only the planning team can seed a meeting.');
  const sb = createAdminClient();
  const meeting = await loadMeetingForWrite(sb, entryId as number);
  if (!meeting) return fail('That meeting is no longer on the calendar.');
  if (!meeting.published || meeting.closed) return fail('That meeting isn’t taking sign-ups.');
  if (meeting.date < centralToday()) return fail('That meeting has passed.');
  return { ok: true as const, sb, meeting, actorPersonId: actor.personId };
}
