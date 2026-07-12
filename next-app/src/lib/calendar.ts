import { createClient } from '@/lib/supabase/server';
import type { CalendarEntry } from '@/lib/supabase/types';

export { CATEGORY_COLORS, CATEGORIES, formatCalendarDateParts, formatTimeOfDay } from '@/lib/calendar-shared';

export interface CalendarEntryWithSlug extends CalendarEntry {
  articleSlug: string | null;
}

const SELECT = '*, articles(slug)';

type RawRow = CalendarEntry & { articles: { slug: string } | null };

function toEntry(row: RawRow): CalendarEntryWithSlug {
  const { articles, ...rest } = row;
  return { ...rest, articleSlug: articles?.slug ?? null };
}

/** The entry's last calendar day (end_date for multi-day entries, entry_date otherwise) — the correct cutoff for upcoming vs. past. */
function lastDay(entry: Pick<CalendarEntry, 'entry_date' | 'end_date'>): string {
  return entry.end_date ?? entry.entry_date;
}

export async function loadCalendarEntries(): Promise<{
  upcoming: CalendarEntryWithSlug[];
  past: CalendarEntryWithSlug[];
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('calendar_entries')
    .select(SELECT)
    .order('entry_date', { ascending: true });
  const all = ((data ?? []) as RawRow[]).map(toEntry);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter((e) => lastDay(e) >= today);
  const past = all
    .filter((e) => lastDay(e) < today)
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
  return { upcoming, past };
}

/** Every entry, past and future — feeds the .ics subscription route. */
export async function loadAllCalendarEntries(): Promise<CalendarEntryWithSlug[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('calendar_entries')
    .select(SELECT)
    .order('entry_date', { ascending: true });
  return ((data ?? []) as RawRow[]).map(toEntry);
}
