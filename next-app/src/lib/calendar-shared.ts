import type { CalendarCategory } from '@/lib/supabase/types';

/**
 * Client-safe calendar constants/formatters — no `next/headers` import
 * chain. Split out from `lib/calendar.ts` because that file's data loaders
 * pull in the server-only Supabase client, which breaks when a Client
 * Component (e.g. the admin calendar-editor) imports it even just for these.
 */

/**
 * Category → accent color. The original 10 are ported from calendar.html's
 * --clr-* legend (kept identical for continuity with the Bugle); Ceremony
 * has no legacy equivalent — it's a new category added when the real Sheet
 * data turned out to need one (a Cub Scout Cross Over isn't a Court of Honor).
 */
export const CATEGORY_COLORS: Record<CalendarCategory, string> = {
  'Troop Meeting': '#1e3a4a',
  Campout: '#3d5a3e',
  'High Adventure': '#2d6a4f',
  'Summer Camp': '#527554',
  'Service Project': '#6a5d3a',
  Outing: '#4a6741',
  Fundraiser: '#8b6914',
  'Court of Honor': '#5a3d6a',
  'Committee Meeting': '#4c5c6a',
  'No Meeting': '#a0978a',
  Ceremony: '#a04a3d'
};

/** Display order for the legend and the category <select>. */
export const CATEGORIES: CalendarCategory[] = [
  'Troop Meeting',
  'Campout',
  'High Adventure',
  'Summer Camp',
  'Service Project',
  'Outing',
  'Fundraiser',
  'Court of Honor',
  'Committee Meeting',
  'Ceremony',
  'No Meeting'
];

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
