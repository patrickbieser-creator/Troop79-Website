import { createAdminClient } from '@/lib/supabase/server';
import type { CalendarEntry } from '@/lib/supabase/types';
import type { CalendarCategoryRow } from '@/lib/calendar-categories';
import { isAutoArchivedOn } from '@/lib/feed-logic';

export { formatCalendarDateParts, formatTimeOfDay } from '@/lib/calendar-shared';

/**
 * The category vocabulary (D-082), in display order.
 *
 * Every surface that renders a category color or offers a category picker
 * loads this and passes it down — the old module-level CATEGORY_COLORS /
 * CATEGORIES constants are gone, because Patrick can now add, rename, recolor
 * and reorder categories from Lookups & Admin without a deploy.
 *
 * 14 rows on a lookup table: cheap enough to fetch per page render, and always
 * current, which a build-time constant could not be.
 */
export async function loadCalendarCategories(): Promise<CalendarCategoryRow[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('calendar_categories')
    .select('label, color, sort_order, behavior, template')
    .order('sort_order', { ascending: true });
  return (data ?? []) as CalendarCategoryRow[];
}

/*
 * The articles(slug) join and articleSlug are gone (Event→News promotion,
 * Plans/Event-News-Promotion.md): the "read the full story" link is replaced
 * by events promoting themselves into the news feed, and article_id is
 * dropped by the drop_legacy migration.
 *
 * Auto-archived entries (auto_archive_at passed) are excluded from these
 * public lists and the ICS feed, but NOT from /events/[id] — event pages
 * carry live signups whose links circulate in confirmations, so a direct
 * link keeps resolving (deliberate divergence from OMG, which hid all
 * surfaces).
 */

export interface CalendarEntryPublic extends CalendarEntry {
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

function toEntry(row: CalendarEntry, signupIds?: Set<number>): CalendarEntryPublic {
  return { ...row, hasSignup: signupIds?.has(row.id) ?? false };
}

/** The entry's last calendar day (end_date for multi-day entries, entry_date otherwise) — the correct cutoff for upcoming vs. past. */
function lastDay(entry: Pick<CalendarEntry, 'entry_date' | 'end_date'>): string {
  return entry.end_date ?? entry.entry_date;
}

function notAutoArchived(entry: CalendarEntry): boolean {
  return !isAutoArchivedOn(entry.auto_archive_at, new Date());
}

export async function loadCalendarEntries(): Promise<{
  upcoming: CalendarEntryPublic[];
  past: CalendarEntryPublic[];
}> {
  const supabase = createAdminClient();
  const [{ data }, signupIds] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('*')
      .eq('on_calendar', true)
      .order('entry_date', { ascending: true }),
    signupEnabledIds(supabase)
  ]);
  const all = ((data ?? []) as CalendarEntry[]).filter(notAutoArchived).map((r) => toEntry(r, signupIds));

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter((e) => lastDay(e) >= today);
  const past = all
    .filter((e) => lastDay(e) < today)
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
  return { upcoming, past };
}

/** Every entry, past and future — feeds the .ics subscription route. */
export async function loadAllCalendarEntries(): Promise<CalendarEntryPublic[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('calendar_entries')
    .select('*')
    .eq('on_calendar', true)
    .order('entry_date', { ascending: true });
  return ((data ?? []) as CalendarEntry[]).filter(notAutoArchived).map((r) => toEntry(r));
}
