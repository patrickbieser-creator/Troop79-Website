import { createAdminClient } from '@/lib/supabase/server';
import type { CalendarEntry } from '@/lib/supabase/types';

export { CATEGORY_COLORS, CATEGORIES, formatCalendarDateParts, formatTimeOfDay } from '@/lib/calendar-shared';

export interface CalendarEntryWithSlug extends CalendarEntry {
  articleSlug: string | null;
  /** True when this entry has an event_signups row — drives the "Details &
   *  signup" link. Entries without one have nothing extra to show. */
  hasSignup: boolean;
}

/** Entry ids with signup enabled. One query, not one per row. */
async function signupEnabledIds(
  supabase: ReturnType<typeof createAdminClient>
): Promise<Set<number>> {
  const { data } = await supabase.from('event_signups').select('calendar_entry_id');
  return new Set(((data ?? []) as { calendar_entry_id: number }[]).map((r) => r.calendar_entry_id));
}

const SELECT = '*, articles(slug)';

type RawRow = CalendarEntry & { articles: { slug: string } | null };

function toEntry(row: RawRow, signupIds?: Set<number>): CalendarEntryWithSlug {
  const { articles, ...rest } = row;
  return {
    ...rest,
    articleSlug: articles?.slug ?? null,
    hasSignup: signupIds?.has(row.id) ?? false
  };
}

/** The entry's last calendar day (end_date for multi-day entries, entry_date otherwise) — the correct cutoff for upcoming vs. past. */
function lastDay(entry: Pick<CalendarEntry, 'entry_date' | 'end_date'>): string {
  return entry.end_date ?? entry.entry_date;
}

export async function loadCalendarEntries(): Promise<{
  upcoming: CalendarEntryWithSlug[];
  past: CalendarEntryWithSlug[];
}> {
  const supabase = createAdminClient();
  const [{ data }, signupIds] = await Promise.all([
    supabase.from('calendar_entries').select(SELECT).order('entry_date', { ascending: true }),
    signupEnabledIds(supabase)
  ]);
  const all = ((data ?? []) as RawRow[]).map((r) => toEntry(r, signupIds));

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter((e) => lastDay(e) >= today);
  const past = all
    .filter((e) => lastDay(e) < today)
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
  return { upcoming, past };
}

/** Every entry, past and future — feeds the .ics subscription route. */
export async function loadAllCalendarEntries(): Promise<CalendarEntryWithSlug[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('calendar_entries')
    .select(SELECT)
    .order('entry_date', { ascending: true });
  return ((data ?? []) as RawRow[]).map((r) => toEntry(r));
}
