/**
 * /admin/advancement/meetings — the meeting agenda list.
 *
 * The Meeting PLAN (sibling page) suggests candidates; a MEETING here is the
 * leader's published decision — logistics plus a curated agenda, rendered
 * publicly at /meetings. Create a meeting for a date (defaults to next
 * Sunday), then open it to build the agenda.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { nextSunday } from '@/lib/dates';
import type { Meeting } from '@/lib/supabase/types';
import { MeetingsList } from './meetings-list';
import { createMeeting, deleteMeeting } from './actions';
import styles from './meetings.module.css';

export const metadata = {
  title: 'Meetings — Troop 79'
};

async function loadMeetings(): Promise<Meeting[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('meetings')
    .select('*')
    .is('archived_at', null)
    .order('meeting_date', { ascending: false });
  return (data ?? []) as Meeting[];
}

export default async function MeetingsAdminPage() {
  const meetings = await loadMeetings();

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Meetings</h1>
        <p>
          The published agenda for each troop meeting — what families see on the public Meetings
          page. Build it from scratch or promote suggestions from the Meeting Plan; nothing is
          public until you hit Publish.
        </p>
      </div>

      <MeetingsList
        rows={meetings}
        defaultDate={nextSunday()}
        onCreate={createMeeting}
        onDelete={deleteMeeting}
      />
    </>
  );
}
