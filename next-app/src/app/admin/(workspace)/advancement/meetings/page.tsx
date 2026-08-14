/**
 * /admin/advancement/meetings — the Roll Call work list.
 *
 * Calendar unification: meetings are CREATED from the Calendar workbench, as
 * the agenda layer of the entry for that night. This page is what the screen
 * was actually used for day to day — finding a meeting to take attendance for,
 * and opening an agenda to edit — and it stays under Planning because Roll Call
 * is a data-entry session rather than editing.
 *
 * The Meeting PLAN (sibling page) suggests candidates; a MEETING here is the
 * leader's published decision — logistics plus a curated agenda, rendered
 * publicly at /events/[entryId].
 */

import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/require-role';
import { MeetingsList, type MeetingRow } from './meetings-list';
import { deleteMeeting } from './actions';
import styles from './meetings.module.css';

export const metadata = {
  title: 'Meetings — Troop 79'
};

/**
 * Meetings with the date of the calendar entry each one is a layer of. The
 * date is JOINED rather than read from meetings.meeting_date — the entry owns
 * it, and that column is on its way out.
 */
async function loadMeetings(): Promise<MeetingRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, status, updated_by, calendar_entry_id, calendar_entries!inner(entry_date)')
    .is('archived_at', null);
  // Surfaced rather than swallowed: a failed query here would render "No
  // meetings yet", which is indistinguishable from the true empty state on the
  // screen a leader uses to answer "does this meeting have an agenda?".
  if (error) throw new Error(`Meetings failed to load: ${error.message}`);

  const rows = (data ?? []) as unknown as {
    id: number;
    title: string;
    status: string;
    updated_by: string | null;
    calendar_entry_id: number;
    calendar_entries: { entry_date: string } | { entry_date: string }[];
  }[];

  return rows
    .map((r) => {
      const joined = Array.isArray(r.calendar_entries) ? r.calendar_entries[0] : r.calendar_entries;
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        updated_by: r.updated_by,
        entry_id: r.calendar_entry_id,
        entry_date: joined?.entry_date ?? ''
      };
    })
    .filter((r) => r.entry_date !== '')
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

/** meeting_date → "scouts + leaders" attendance counts (see the
 *  meeting_attendance_counts view — computed, never stored). The view is keyed
 *  by date, and attendance is recorded per meeting, so this stays date-keyed
 *  until the view itself is re-keyed. */
async function loadAttendanceCounts(): Promise<Record<string, { scouts: number; leaders: number }>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('meeting_attendance_counts').select('*');
  if (error) throw new Error(`Attendance counts failed to load: ${error.message}`);
  const out: Record<string, { scouts: number; leaders: number }> = {};
  for (const row of data ?? []) {
    out[row.meeting_date as string] = {
      scouts: (row.scout_count as number) ?? 0,
      leaders: (row.leader_count as number) ?? 0
    };
  }
  return out;
}

export default async function MeetingsAdminPage() {
  await requireRole(['leader']);
  const [meetings, attendance] = await Promise.all([loadMeetings(), loadAttendanceCounts()]);

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Meetings</h1>
        <p>
          Roll Call and agendas for each troop meeting. A meeting is added from the Calendar, on the
          entry for that night — open one here to take attendance or edit its agenda. Nothing is
          public until you hit Publish.
        </p>
      </div>

      <MeetingsList rows={meetings} attendance={attendance} onDelete={deleteMeeting} />
    </>
  );
}
