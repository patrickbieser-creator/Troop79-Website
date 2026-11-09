/**
 * Meeting Planner: a past meeting, view only (Patrick, 2026-11-09). Server-only reads; the page gates with
 * plannerAccess first. The pure shaping is lib/past-meeting.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { centralToday } from '@/lib/dates';
import { loadPastMeetingRows, type BoardMeeting } from '@/lib/meeting-board';
import type { HappenedLedgerRow } from '@/lib/past-meeting';
import { fetchAllRows } from '@/lib/supabase/paginate';

/** How far back the past strip reaches: about a year of weekly meetings. */
const PAST_LIMIT = 60;

/** Published, open meetings before `today`, newest first. */
export async function loadPastMeetings(sb: SupabaseClient, today: string = centralToday(), labels: readonly string[]): Promise<BoardMeeting[]> {
  return (await loadPastMeetingRows(sb, today, labels, PAST_LIMIT)).filter((m) => !m.closed);
}

/** Each scout's rank awards (for the rank they held on a given night). */
export async function loadRankAwards(sb: SupabaseClient, scoutIds: readonly string[]): Promise<{ scoutId: string; code: string; date: string }[]> {
  if (!scoutIds.length) return [];
  // Paged: the ledger is far past PostgREST's 1000-row cap, and a truncated read would give scouts the wrong rank.
  const rows = await fetchAllRows<{ scout_id: string; code: string; date: string }>((from, to) =>
    sb.from('ledger_active').select('scout_id, code, date').eq('kind', 'rank_award').in('scout_id', [...scoutIds]).order('id').range(from, to)
  );
  return rows.map((r) => ({ scoutId: r.scout_id, code: r.code, date: r.date }));
}

/** Roll call for the meeting and the advancement signed off that day (requirement rows are dated, not linked). */
export async function loadHappenedRows(sb: SupabaseClient, meeting: Pick<BoardMeeting, 'entryId' | 'date'>): Promise<{ attendance: number[]; ledger: HappenedLedgerRow[] }> {
  // Paged: one day can carry far more than 1000 sign-offs (a backfill or import day, a Court of Honor).
  const [att, led] = await Promise.all([
    sb.from('event_attendance').select('person_id').eq('calendar_entry_id', meeting.entryId),
    fetchAllRows<{ scout_id: string; kind: string; code: string }>((from, to) =>
      sb
        .from('ledger_active')
        .select('scout_id, kind, code')
        .eq('date', meeting.date)
        .in('kind', ['rank_requirement', 'merit_badge_requirement', 'rank_award', 'merit_badge_award'])
        .order('id')
        .range(from, to)
    )
  ]);
  if (att.error) throw new Error(att.error.message);
  return {
    attendance: ((att.data ?? []) as { person_id: number | null }[]).flatMap((r) => (r.person_id == null ? [] : [r.person_id])),
    ledger: led.map((r) => ({ scoutId: r.scout_id, kind: r.kind, code: r.code }))
  };
}
