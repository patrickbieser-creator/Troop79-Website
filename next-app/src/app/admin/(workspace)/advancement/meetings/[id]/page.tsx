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
import type { Meeting, MeetingSession } from '@/lib/supabase/types';
import { buildMeetingPlan } from '../../meeting-plan/engine';
import { loadEngineInput } from '../../meeting-plan/load-input';
import { publicName } from '@/lib/meeting-plan-types';
import { MeetingEditor, type Candidate } from './meeting-editor';
import {
  updateMeeting,
  setMeetingStatus,
  createSession,
  updateSession,
  deleteSession,
  moveSession,
  promotePlanSession
} from '../actions';

export const metadata = {
  title: 'Edit Meeting — Troop 79'
};

async function loadCandidates(meetingDate: string, title: string): Promise<Candidate[] | null> {
  try {
    const loaded = await loadEngineInput(meetingDate, title);
    if (!loaded.ok) return null;
    const payload = buildMeetingPlan(loaded.input);
    return payload.sessions.map((s) => {
      const teachers = [...s.adultTeachers, ...s.counselors].map((t) => t.name);
      const scoutTeachers = s.scoutTeachers.map((t) => `${t.name} (${t.rankLabel})`);
      return {
        key: s.id,
        codeLabel: s.codeLabel,
        reqLabel: s.title,
        eagle: s.eagle,
        track: s.kind === 'mb' ? 'Merit Badge' : 'Open Advancement',
        skillId: s.skillId,
        skillName: s.skillName,
        leaderName: teachers.length > 0 ? teachers.join(', ') : scoutTeachers.join(', ') || null,
        scouts: s.scouts.map((sc) => publicName(sc.name)),
        groupPart: s.groupPart
      };
    });
  } catch {
    return null;
  }
}

export default async function MeetingEditorPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [{ data: sessions }, candidates] = await Promise.all([
    supabase
      .from('meeting_sessions')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    loadCandidates(meeting.meeting_date as string, meeting.title as string)
  ]);

  return (
    <MeetingEditor
      meeting={meeting as Meeting}
      sessions={(sessions ?? []) as MeetingSession[]}
      candidates={candidates}
      onUpdateMeeting={updateMeeting}
      onSetStatus={setMeetingStatus}
      onCreateSession={createSession}
      onUpdateSession={updateSession}
      onDeleteSession={deleteSession}
      onMoveSession={moveSession}
      onPromote={promotePlanSession}
    />
  );
}
