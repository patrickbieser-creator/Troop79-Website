/**
 * Shared troop-calendar date helpers. All "what day is it" logic uses
 * America/Chicago: the server runs in UTC (Vercel), where new Date()'s
 * calendar date flips at 7 PM Central — a naive localToday() there hides
 * "today's" meeting during Sunday evenings. Consolidates the isoDate/
 * localToday/nextSunday copies that grew in individual pages.
 */

const TIME_ZONE = 'America/Chicago';

/** Today's date in Central time as yyyy-mm-dd, regardless of host timezone. */
export function centralToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

/** Local-time yyyy-mm-dd for a Date — toISOString() is UTC and shifts the
 *  date +1 during Central-time evenings. For client-side Date objects. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Next Sunday on/after `from` (default: today, Central) — the troop meets
 *  on Sundays, and "next meeting" includes today when today is Sunday. */
export function nextSunday(from: string = centralToday()): string {
  const d = new Date(`${from}T12:00:00Z`); // noon UTC dodges DST edges
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/** yyyy-mm-dd → "Sunday, July 12, 2026". Parses at UTC noon so the label
 *  never shifts a day across timezones. */
export function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`));
}
