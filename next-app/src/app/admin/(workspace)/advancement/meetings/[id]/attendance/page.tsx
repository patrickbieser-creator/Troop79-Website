/**
 * /admin/advancement/meetings/[id]/attendance — Roll Call for one meeting.
 *
 * Scout attendance = ledger rows (kind='meeting_attendance',
 * code='MTG:<date>'); leader attendance = meeting_attendance_leaders.
 * Admin-only — the public site never renders this kind.
 */

import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import type { Meeting, MeetingAttendanceLeader } from '@/lib/supabase/types';
import { RollCall, type RollCallLeader, type RollCallScout } from './roll-call';

export const metadata = {
  title: 'Roll Call — Troop 79'
};

export default async function RollCallPage({ params }: { params: Promise<{ id: string }> }) {
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

  const code = `MTG:${meeting.meeting_date}`;
  const [{ data: scouts }, { data: leaders }, { data: scoutRows }, { data: leaderRows }] =
    await Promise.all([
      supabase
        .from('scouts')
        .select('id, display_name, patrol')
        .eq('active', true)
        .order('display_name'),
      supabase.from('leaders').select('code, name').eq('is_person', true).order('name'),
      supabase
        .from('ledger_active')
        .select('scout_id')
        .eq('kind', 'meeting_attendance')
        .eq('code', code),
      supabase
        .from('meeting_attendance_leaders')
        .select('*')
        .eq('meeting_date', meeting.meeting_date)
    ]);

  const leaderAttendance = (leaderRows ?? []) as MeetingAttendanceLeader[];
  const committed = new Set(
    leaderAttendance.filter((r) => r.status === 'committed').map((r) => r.leader_code)
  );
  const attended = leaderAttendance.filter((r) => r.status === 'attended').map((r) => r.leader_code);

  return (
    <RollCall
      meeting={meeting as Meeting}
      scouts={(scouts ?? []) as RollCallScout[]}
      leaders={((leaders ?? []) as { code: string; name: string }[]).map(
        (l): RollCallLeader => ({ ...l, committed: committed.has(l.code) })
      )}
      initialScoutIds={(scoutRows ?? []).map((r) => r.scout_id as string)}
      initialLeaderCodes={attended}
    />
  );
}
