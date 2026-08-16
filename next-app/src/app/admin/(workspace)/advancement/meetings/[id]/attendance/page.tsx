/**
 * /admin/advancement/meetings/[id]/attendance — RETIRED, redirects to Roll Call.
 *
 * WHY (Operator, 2026-08-14, from qa-lead review — CRITICAL)
 * This screen wrote scout attendance as `ledger_entries` rows keyed by
 * `code='MTG:<date>'` with NO `calendar_entry_id`, and adult attendance into
 * the date-keyed `meeting_attendance_leaders`. The new Roll Call writes the
 * same facts against the calendar entry.
 *
 * Two writers into the same ledger slot, neither aware of the other, is a
 * duplication engine: Roll Call keys its credit on `calendar_entry_id`, so it
 * could not see a row this screen had written, and would insert a second
 * meeting_attendance row for the same scout and date. That was not a rare race
 * — it was the default outcome of habitually using a page nothing warned
 * leaders off.
 *
 * So the second writer is removed rather than coordinated with. Roll Call also
 * strictly supersedes it: same scouts, same adults, plus absences by inference,
 * signup seeding, and every other kind of event.
 *
 * The route survives as a redirect because leaders have it bookmarked and the
 * meetings list linked to it for a year. Roll Call is entry-keyed, so the
 * meeting's `calendar_entry_id` is the translation.
 *
 * Old rows this screen already wrote are not orphaned: Roll Call ADOPTS them
 * (`adoptLegacyCredit`) when the same scout is marked present, and retires them
 * on uncheck — see lib/attendance-admin.ts.
 */

import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';

export default async function RetiredAttendancePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability('advancement.write');
  const { id } = await params;
  const meetingId = Number(id);
  if (!Number.isInteger(meetingId)) notFound();

  const supabase = createAdminClient();
  const { data: meeting } = await supabase
    .from('meetings')
    .select('calendar_entry_id')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) notFound();

  redirect(`/admin/calendar/${meeting.calendar_entry_id}/roll-call`);
}
