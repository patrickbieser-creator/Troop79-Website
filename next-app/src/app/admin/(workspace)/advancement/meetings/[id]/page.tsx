/**
 * /admin/advancement/meetings/[id] — the agenda editor for one meeting.
 *
 * Left: logistics + the pre-meeting and agenda session builders.
 * Right: the candidate tray — this date's Meeting Plan engine suggestions,
 * each one promotable into the agenda as a prefilled, editable session.
 * Promotion copies data one way; plan snapshots are never touched.
 */

import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import type { Meeting } from '@/lib/supabase/types';
import { loadAgendaEditorData } from '../load-agenda';
import { MeetingEditor } from './meeting-editor';
import {
  updateMeeting,
  setMeetingStatus,
  createSession,
  updateSession,
  deleteSession,
  moveSession,
  promotePlanSession,
  deleteMeeting
} from '../actions';

export const metadata = {
  title: 'Edit Meeting — Troop 79'
};

export default async function MeetingEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCapability('advancement.write');
  const { id } = await params;
  const meetingId = Number(id);
  if (!Number.isInteger(meetingId)) notFound();

  const supabase = createAdminClient();
  const { data: meeting } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .is('archived_at', null)
    .maybeSingle();
  if (!meeting) notFound();

  // The date comes from the calendar entry this meeting is a layer of — the
  // entry owns it, and meetings.meeting_date is on its way out.
  const { data: entry } = await supabase
    .from('calendar_entries')
    .select('id, entry_date')
    .eq('id', meeting.calendar_entry_id as number)
    .maybeSingle();
  if (!entry) notFound();
  const entryDate = entry.entry_date as string;

  const { sessions, candidates } = await loadAgendaEditorData(meetingId, entryDate, meeting.title as string);

  return (
    <MeetingEditor
      meeting={meeting as Meeting}
      entry={{ id: entry.id as number, entry_date: entryDate }}
      sessions={sessions}
      candidates={candidates}
      onUpdateMeeting={updateMeeting}
      onSetStatus={setMeetingStatus}
      onCreateSession={createSession}
      onUpdateSession={updateSession}
      onDeleteSession={deleteSession}
      onMoveSession={moveSession}
      onPromote={promotePlanSession}
      onDeleteMeeting={deleteMeeting}
    />
  );
}
