/**
 * Client-safe calendar formatters — no `next/headers` import chain. Split out
 * from `lib/calendar.ts` because that file's data loaders pull in the
 * server-only Supabase client, which breaks when a Client Component (e.g. the
 * admin calendar-editor) imports it even just for these.
 *
 * The category vocabulary that used to live here (CATEGORY_COLORS, CATEGORIES,
 * categoryColor) moved to the `calendar_categories` lookup table in D-082 —
 * see `lib/calendar-categories.ts` for the pure helpers and
 * `loadCalendarCategories()` in `lib/calendar.ts` for the loader. The colors
 * themselves (the Bugle's printed legend) are now seed data in
 * 20260812000000_calendar_categories_lookup.sql.
 */

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Formats a plain "YYYY-MM-DD" calendar date without ever constructing a
 * `Date` object — `entry_date` has no time/timezone component, so parsing it
 * with `new Date(...)` risks an off-by-one day depending on the server's
 * local timezone vs. any explicit `timeZone` passed to Intl formatting.
 */
export function formatCalendarDateParts(dateStr: string): { month: string; day: string } {
  const [, m, d] = dateStr.split('-').map(Number);
  return { month: MONTH_ABBR[m - 1], day: String(d) };
}

/** Formats a plain "HH:MM:SS" wall-clock time as e.g. "4:00 PM" — no Date object, no timezone involved. */
export function formatTimeOfDay(hms: string): string {
  const [h, m] = hms.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
