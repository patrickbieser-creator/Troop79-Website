/**
 * The planner's seed gate (Plans/Meeting-Planner-II.md Decision 2; Build a Plan B1): a meeting_planner.seed holder
 * acting on an upcoming, published meeting that takes sign-ups. Refused before the database is written. Server-only
 * (the service-role client); shared by Build a Plan's actions (B4: the board's own seed actions retired).
 *
 * `right: 'edit'` (Build a Plan B2, an offering's teacher): the same meeting checks for a meeting_planner.edit holder.
 * `within` (Build a Plan, qa-lead 2026-10-22): the meeting must also be one of the next N open meetings the switcher
 * offers. That list is read alongside the meeting itself (one more round trip, no more latency).
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { loadMeetingForWrite, loadUpcomingMeetings } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function plannerSeeder(entryId: unknown, opts: { within?: number; right?: 'seed' | 'edit' } = {}) {
  if (!Number.isInteger(entryId)) return fail('Malformed request');
  const actor = await resolveAdminActor();
  const access = plannerAccess(actor);
  if (opts.right === 'edit') {
    if (!access.canEdit || actor?.personId == null) return fail('Only someone who can edit the Meeting Planner can do that.');
  } else if (!access.canSeed || actor?.personId == null) return fail('Only the planning team can seed a meeting.');
  const sb = createAdminClient();
  const [meeting, upcoming] = await Promise.all([
    loadMeetingForWrite(sb, entryId as number),
    opts.within ? loadUpcomingMeetings(sb, opts.within * 2) : null
  ]);
  if (!meeting) return fail('That meeting is no longer on the calendar.');
  if (!meeting.published || meeting.closed) return fail('That meeting isn’t taking sign-ups.');
  if (meeting.date < centralToday()) return fail('That meeting has passed.');
  if (upcoming && !upcoming.filter((m) => !m.closed).slice(0, opts.within).some((m) => m.entryId === meeting.entryId)) {
    return fail(`Plans are open for the next ${opts.within} meetings only.`);
  }
  return { ok: true as const, sb, meeting, actorPersonId: actor.personId };
}
