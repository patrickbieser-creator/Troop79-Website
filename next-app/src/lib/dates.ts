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

// formatShortDate / formatLongDate retired 2026-08-24: every human-visible
// date goes through lib/format-date (fmtDateFull is the "Sunday, July 12,
// 2026" form; the mm/dd/yy form was retired by the date display standard).
// This module is "what day is it" only.

/** Minutes Central is ahead of UTC at a given instant (negative: -300 CDT, -360 CST). */
function centralOffsetMinutes(utcMs: number): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Math.round((Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - utcMs) / 60000);
}

/** A Central wall-clock moment ('YYYY-MM-DD' + 'HH:MM') → the ISO instant it names,
 *  DST-correct and host-timezone independent. '' when either half is missing or
 *  malformed. The signup's arrival / departure pickers speak in this. */
export function centralToInstant(date: string, time: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return '';
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  let ms = wall - centralOffsetMinutes(wall) * 60000;
  ms = wall - centralOffsetMinutes(ms) * 60000; // re-check across a DST edge
  return new Date(ms).toISOString();
}

/** The inverse: an instant → its Central 'YYYY-MM-DD' and 'HH:MM' (picker values). */
export function instantToCentral(iso: string | null | undefined): { date: string; time: string } {
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return { date: '', time: '' };
  const wall = new Date(ms + centralOffsetMinutes(ms) * 60000).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}
