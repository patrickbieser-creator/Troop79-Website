/**
 * Server loaders for meeting agendas. All reads use the service-role client
 * (v0.22 posture — meetings tables have RLS enabled with no anon policies),
 * filter to published + non-archived, and strip contact_phone before anything
 * reaches a public page.
 *
 * ENTRY-KEYED, NOT DATE-KEYED (Calendar unification, 2026-08-14). A meeting is
 * the agenda LAYER of a calendar entry, reached through
 * `meetings.calendar_entry_id`. It used to be a parallel row correlated to the
 * calendar by a matching date string at read time, which meant editing either
 * side's date silently split the pair — and which could not express two
 * meetings on one night at all.
 *
 * Nothing here reads `meeting_date` any more: the entry owns the date. That is
 * deliberate, so the column can be dropped once this code has soaked.
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { Meeting, MeetingSession } from '@/lib/supabase/types';

/** A session with the one leader-only field removed. */
export type PublicSession = Omit<MeetingSession, 'contact_phone'>;

export interface PublicMeeting {
  meeting: Meeting;
  preMeeting: PublicSession[];
  agenda: PublicSession[];
}

/** One published meeting in date order — drives the prev/next strip and the
 *  "recent meetings" list now that both are keyed by entry rather than date. */
export interface MeetingNavItem {
  entryId: number;
  date: string;
}

function stripPhone(rows: MeetingSession[]): PublicSession[] {
  return rows.map((row) => {
    const { contact_phone, ...rest } = row;
    void contact_phone;
    return rest;
  });
}

/**
 * The agenda layer of one calendar entry, phone numbers stripped. Returns null
 * for drafts, archived rows, and entries that simply have no agenda — the
 * caller renders "agenda coming" from the entry itself, which it already has.
 */
export async function getPublicMeetingForEntry(entryId: number): Promise<PublicMeeting | null> {
  if (!Number.isInteger(entryId) || entryId <= 0) return null;
  const supabase = createAdminClient();

  const { data: meeting, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('calendar_entry_id', entryId)
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

/**
 * Every published, non-archived meeting as {entryId, date}, ascending.
 *
 * The date comes from the joined calendar entry, not from meetings.meeting_date
 * — the entry is the spine, and reading the date from the layer would reopen
 * exactly the drift this merge closed.
 */
export async function getPublishedMeetingNav(): Promise<MeetingNavItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('meetings')
    .select('calendar_entry_id, calendar_entries!inner(entry_date)')
    .eq('status', 'published')
    .is('archived_at', null);
  if (error || !data) return [];

  const rows = data as unknown as {
    calendar_entry_id: number;
    calendar_entries: { entry_date: string } | { entry_date: string }[];
  }[];

  return rows
    .map((r) => {
      const joined = Array.isArray(r.calendar_entries) ? r.calendar_entries[0] : r.calendar_entries;
      return { entryId: r.calendar_entry_id, date: joined?.entry_date ?? '' };
    })
    .filter((r) => r.date !== '')
    .sort((a, b) => a.date.localeCompare(b.date));
}
