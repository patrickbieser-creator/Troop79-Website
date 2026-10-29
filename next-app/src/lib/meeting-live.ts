/**
 * Live at the meeting's reads that outlive Rotations (Plans/Meeting-Planner-III.md, Decision 10): the presence draft
 * (Live's taps, visitors) and the attendance approved after the meeting (Build a Plan B8, D-429: nothing writes
 * attendance on its own). Live itself is This week's second view, derived from the plan (lib/this-week). Server-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPeopleNames } from '@/lib/meeting-board';
import { boardName } from '@/lib/meeting-board-shared';
import { buildAttendanceReview, meetingIsOver, type AttendanceReview } from '@/lib/meeting-live-shared';

/** The system household that holds meeting visitors (guest people). */
export const VISITORS_KEY = 'meeting-visitors';

// ── P4c / B8: presence ───────────────────────────────────────────────────────────────────────────────────────────

/** The visitors household's id, or null before the first visitor. */
async function visitorsHouseholdId(sb: SupabaseClient): Promise<number | null> {
  const { data, error } = await sb.from('households').select('id').eq('system_key', VISITORS_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: number } | null)?.id ?? null;
}

/**
 * One meeting's presence: `draft` (Live's taps), `recorded` (event_attendance), `here` (the draft tap when there is
 * one, else recorded) and `visitors` (guests of the visitors household with a draft row or recorded attendance here).
 */
export async function loadPresence(sb: SupabaseClient, entryId: number) {
  const [draftRes, attRes, hhId] = await Promise.all([
    sb.from('meeting_live_presence').select('person_id, present').eq('calendar_entry_id', entryId),
    sb.from('event_attendance').select('person_id').eq('calendar_entry_id', entryId),
    visitorsHouseholdId(sb)
  ]);
  if (draftRes.error) throw new Error(draftRes.error.message);
  if (attRes.error) throw new Error(attRes.error.message);
  const draft = new Map(((draftRes.data ?? []) as { person_id: number; present: boolean }[]).map((r) => [r.person_id, r.present]));
  const recorded = new Set(((attRes.data ?? []) as { person_id: number }[]).map((r) => r.person_id));
  const here = new Map<number, boolean>([...[...recorded].map((id) => [id, true] as const), ...draft]);
  const visitors = new Set<number>();
  const everyone = [...new Set([...draft.keys(), ...recorded])];
  if (hhId != null && everyone.length) {
    const { data, error } = await sb.from('people').select('id').eq('guest_host_household_id', hhId).in('id', everyone);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: number }[]) visitors.add(r.id);
  }
  return { draft, recorded, here, visitors };
}

// ── B8: attendance approved after the meeting ───────────────────────────────────────────────────────

/** A meeting's calendar facts as the "is it over?" rule reads them. */
export interface OverFacts {
  entryId: number;
  date: string;
  endDate: string | null;
  endTime: string | null;
}

/**
 * A PUBLISHED TROOP MEETING's calendar facts (its category's behavior is 'meeting': the filter loadAttendancePrompt
 * uses), or null. B8 qa: every after-the-meeting action goes through this, so a crafted call can't reach a campout's
 * Roll Call (and its ledger credit) through the planner's Edit right.
 */
export async function loadOverFacts(sb: SupabaseClient, entryId: number): Promise<OverFacts | null> {
  const { data, error } = await sb.from('calendar_entries').select('id, entry_date, end_date, end_time, status, calendar_categories(behavior)').eq('id', entryId).maybeSingle();
  if (error) throw new Error(error.message);
  type Cat = { behavior: string | null };
  const r = data as { id: number; entry_date: string; end_date: string | null; end_time: string | null; status: string; calendar_categories: Cat | Cat[] | null } | null;
  if (!r || r.status !== 'published') return null;
  const cat = Array.isArray(r.calendar_categories) ? r.calendar_categories[0] : r.calendar_categories;
  if (cat?.behavior !== 'meeting') return null;
  return { entryId: r.id, date: r.entry_date, endDate: r.end_date, endTime: r.end_time };
}

/**
 * The approval checklist for one meeting (Planner III, Decision 10: no arrangement): scouts who said they're coming
 * (or picked something), the plan's teachers, visitors, Live's taps, and Roll Call. Can't-make-it people start
 * unticked unless tapped here.
 */
export async function loadAttendanceReview(sb: SupabaseClient, entryId: number, date: string): Promise<AttendanceReview> {
  const [presence, intentsRes, picksRes, teachRes] = await Promise.all([
    loadPresence(sb, entryId),
    sb.from('meeting_intents').select('person_id, intent').eq('calendar_entry_id', entryId),
    sb.from('meeting_topic_picks').select('person_id').eq('calendar_entry_id', entryId).eq('later', false),
    sb.from('meeting_topic_teachers').select('person_id').eq('calendar_entry_id', entryId)
  ]);
  for (const r of [intentsRes, picksRes, teachRes]) if (r.error) throw new Error(r.error.message);
  const intents = new Map(((intentsRes.data ?? []) as { person_id: number; intent: string }[]).map((r) => [r.person_id, r.intent]));
  const notComing = new Set([...intents].filter(([, i]) => i === 'not_coming').map(([id]) => id));
  const picked = ((picksRes.data ?? []) as { person_id: number }[]).map((r) => r.person_id).filter((id) => !intents.has(id));
  const coming = [...[...intents].filter(([, i]) => i === 'coming').map(([id]) => id), ...picked];
  const { data: scoutRows, error: scoutErr } = coming.length ? await sb.from('scouts').select('person_id').in('person_id', [...new Set(coming)]).eq('active', true) : { data: [], error: null };
  if (scoutErr) throw new Error(scoutErr.message);
  const placed = ((scoutRows ?? []) as { person_id: number }[]).map((r) => r.person_id);
  const teachers = [...new Set(((teachRes.data ?? []) as { person_id: number }[]).map((r) => r.person_id))].filter((id) => !notComing.has(id));
  const ids = [...new Set([...placed, ...teachers, ...presence.draft.keys(), ...presence.recorded])];
  const names = await loadPeopleNames(sb, ids);
  return buildAttendanceReview({
    entryId,
    date,
    placed,
    teachers,
    visitors: [...presence.visitors],
    draft: presence.draft,
    recorded: presence.recorded,
    nameOf: (id) => boardName(names.get(id) ?? ''),
    notComing
  });
}

/**
 * "Would you like to update attendance?": the most recent troop meeting that is over (as of `now`, Central wall
 * clock) and has a draft to approve (a Live arrangement or Live taps), with its checklist. Null when there is none.
 */
export async function loadAttendancePrompt(sb: SupabaseClient, now: { date: string; time: string }): Promise<AttendanceReview | null> {
  const { data: cats, error: catErr } = await sb.from('calendar_categories').select('label').eq('behavior', 'meeting');
  if (catErr) throw new Error(catErr.message);
  const labels = ((cats ?? []) as { label: string }[]).map((c) => c.label);
  if (!labels.length) return null;
  const { data, error } = await sb
    .from('calendar_entries')
    .select('id, entry_date, end_date, end_time')
    .in('category', labels)
    .eq('status', 'published')
    .lte('entry_date', now.date)
    .order('entry_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(3);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: number; entry_date: string; end_date: string | null; end_time: string | null }[];
  const last = rows.find((r) => meetingIsOver({ date: r.entry_date, endDate: r.end_date, endTime: r.end_time }, now));
  if (!last) return null;
  // No thanks (Patrick, 2026-10-29): an editor dismissed it for this meeting.
  const { data: board } = await sb.from('meeting_boards').select('attendance_dismissed_at').eq('calendar_entry_id', last.id).maybeSingle();
  if ((board as { attendance_dismissed_at: string | null } | null)?.attendance_dismissed_at) return null;
  // A plan (anything seeded) or Live's taps: something to approve.
  const [planRes, draftRes] = await Promise.all([
    sb.from('meeting_topics').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', last.id).not('seeded_at', 'is', null),
    sb.from('meeting_live_presence').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', last.id)
  ]);
  if (planRes.error) throw new Error(planRes.error.message);
  if (draftRes.error) throw new Error(draftRes.error.message);
  if (!planRes.count && !draftRes.count) return null;
  const review = await loadAttendanceReview(sb, last.id, last.entry_date);
  return review.groups.length ? review : null;
}
