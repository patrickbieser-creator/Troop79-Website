/**
 * Server loaders for the public Meetings pages. All reads use the
 * service-role client (v0.22 posture — meetings tables have RLS enabled with
 * no anon policies), filter to published + non-archived, and strip
 * contact_phone before anything reaches a public page.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import type { Meeting, MeetingSession } from '@/lib/supabase/types';

/** A session with the one leader-only field removed. */
export type PublicSession = Omit<MeetingSession, 'contact_phone'>;

export interface PublicMeeting {
  meeting: Meeting;
  preMeeting: PublicSession[];
  agenda: PublicSession[];
}

/** Every published, non-archived meeting date, ascending. Drives the
 *  prev/next strip and default-meeting resolution. */
export async function getPublishedMeetingDates(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('meetings')
    .select('meeting_date')
    .eq('status', 'published')
    .is('archived_at', null)
    .order('meeting_date', { ascending: true });
  if (error || !data) return [];
  return data.map((r) => r.meeting_date as string);
}

/** Home-base date for /meetings: the soonest published meeting on/after
 *  today (Central), else the most recent past one, else null. */
export function resolveDefaultMeetingDate(dates: string[], today = centralToday()): string | null {
  if (dates.length === 0) return null;
  return dates.find((d) => d >= today) ?? dates[dates.length - 1];
}

function stripPhone(rows: MeetingSession[]): PublicSession[] {
  return rows.map((row) => {
    const { contact_phone, ...rest } = row;
    void contact_phone;
    return rest;
  });
}

/** One published meeting + its sessions, phone numbers stripped.
 *  Returns null for drafts, archived rows, and unknown dates. */
export async function getPublicMeeting(date: string): Promise<PublicMeeting | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const supabase = createAdminClient();

  const { data: meeting, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('meeting_date', date)
    .eq('status', 'published')
    .is('archived_at', null)
    .maybeSingle();
  if (error || !meeting) return null;

  const { data: sessions, error: sessionsError } = await supabase
    .from('meeting_sessions')
    .select('*')
    .eq('meeting_id', meeting.id)
    .order('section', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (sessionsError) return null;

  const rows = (sessions ?? []) as MeetingSession[];
  return {
    meeting: meeting as Meeting,
    preMeeting: stripPhone(rows.filter((s) => s.section === 'pre_meeting')),
    agenda: stripPhone(rows.filter((s) => s.section === 'agenda'))
  };
}

/** Calendar logistics for a date with no published agenda yet — lets the
 *  public page show "there IS a meeting, agenda coming" instead of a 404. */
export async function getCalendarMeetingEntry(date: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('calendar_entries')
    .select('category, title, description, location, start_time, end_time, day_note')
    .eq('entry_date', date)
    .in('category', ['Troop Meeting', 'No Meeting'])
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
