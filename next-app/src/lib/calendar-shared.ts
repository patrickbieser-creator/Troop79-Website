import type { CalendarCategory } from '@/lib/supabase/types';

/**
 * Client-safe calendar constants/formatters — no `next/headers` import
 * chain. Split out from `lib/calendar.ts` because that file's data loaders
 * pull in the server-only Supabase client, which breaks when a Client
 * Component (e.g. the admin calendar-editor) imports it even just for these.
 */

/**
 * Category → accent color. The originals are ported from calendar.html's
 * --clr-* legend (kept identical for continuity with the Bugle), and the
 * renames of 2026-07-18 keep their predecessor's color so the printed legend
 * doesn't shift: Campout / Overnight keeps Campout's green, Day Activity /
 * Outing keeps Outing's, Leadership / Planning keeps Committee Meeting's
 * slate, and Ceremony / Recognition keeps Court of Honor's purple (the two
 * merged). The four genuinely new types take unused hues.
 */
export const CATEGORY_COLORS: Record<CalendarCategory, string> = {
  'Troop Meeting': '#1e3a4a',
  'Campout / Overnight': '#3d5a3e',
  'Day Activity / Outing': '#4a6741',
  'High Adventure': '#2d6a4f',
  'Summer Camp': '#527554',
  'Service Project': '#6a5d3a',
  Fundraiser: '#8b6914',
  'Advancement Event': '#2f6b7a',
  Training: '#7a4a6a',
  'Ceremony / Recognition': '#5a3d6a',
  'Leadership / Planning': '#4c5c6a',
  'Recruiting / Outreach': '#a04a3d',
  'Social Event': '#8a6f4a',
  'No Meeting': '#a0978a'
};

/**
 * Color for a category, tolerating values this build doesn't know about.
 *
 * Categories live in the database, so the app and the schema can be briefly
 * out of step — during a deploy, or if a row is written by hand. A raw
 * `CATEGORY_COLORS[x]` lookup returns undefined there, and callers that feed
 * it to hexToRgba() crash the whole page on `.replace` of undefined. A
 * neutral swatch is a far better failure than a blank /events.
 */
const FALLBACK_CATEGORY_COLOR = '#a0978a';
export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category as CalendarCategory] ?? FALLBACK_CATEGORY_COLOR;
}

/** Display order for the legend and the category <select>. */
export const CATEGORIES: CalendarCategory[] = [
  'Troop Meeting',
  'Campout / Overnight',
  'Day Activity / Outing',
  'High Adventure',
  'Summer Camp',
  'Service Project',
  'Fundraiser',
  'Advancement Event',
  'Training',
  'Ceremony / Recognition',
  'Leadership / Planning',
  'Recruiting / Outreach',
  'Social Event',
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
