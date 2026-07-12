/**
 * Minimal RFC 5545 (iCalendar) writer — just enough for a flat list of
 * VEVENTs (no recurrence, no attendees/alarms). Hand-rolled rather than a
 * dependency since the surface area is this small; see
 * `calendar.ics/route.ts` for usage.
 *
 * Supports both all-day entries (date only) and timed entries (date + local
 * wall-clock time, converted to UTC) — `calendar_entries` allows either,
 * since not every entry has a known time of day.
 */

export interface IcsEvent {
  /** Stable across regenerations — same entry must always produce the same UID. */
  uid: string;
  /** "YYYY-MM-DD", inclusive. */
  startDate: string;
  /** "YYYY-MM-DD", inclusive. Defaults to `startDate` (single-day) when omitted. */
  endDate?: string | null;
  /** "HH:MM:SS" local wall-clock time in `timeZoneId`. Omit for an all-day event. */
  startTime?: string | null;
  /** "HH:MM:SS" local wall-clock time in `timeZoneId`. Defaults to `startTime` + 1 hour when omitted (and `startTime` is set). */
  endTime?: string | null;
  summary: string;
  description?: string | null;
  location?: string | null;
  /** Link back to the article on the public site, if this entry has one. */
  url?: string | null;
}

const CRLF = '\r\n';
const FOLD_LIMIT = 75; // octets, per RFC 5545 §3.1

/** Folds a single unfolded content line onto multiple physical lines per RFC 5545 §3.1. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= FOLD_LIMIT) return line;

  const chunks: string[] = [];
  let offset = 0;
  let limit = FOLD_LIMIT;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Never split a multi-byte UTF-8 character across chunks.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(offset, end).toString('utf8'));
    offset = end;
    limit = FOLD_LIMIT - 1; // continuation lines start with a single leading space
  }
  return chunks.join(CRLF + ' ');
}

/** Escapes a TEXT value per RFC 5545 §3.3.11. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function parseYMD(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split('-').map(Number);
  return [y, m, d];
}

function parseHMS(timeStr: string): [number, number, number] {
  const [h, m, s] = timeStr.split(':').map(Number);
  return [h, m, s ?? 0];
}

/**
 * Adds `days` to a "YYYY-MM-DD" string, returned as "YYYYMMDD". Computed via
 * Date.UTC so it's pure calendar arithmetic — no local-timezone/DST
 * ambiguity, since nothing here represents an actual instant in time.
 */
function addDaysCompact(dateStr: string, days: number): string {
  const [y, m, d] = parseYMD(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function formatDateOnlyCompact(dateStr: string): string {
  const [y, m, d] = parseYMD(dateStr);
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

function formatDateTimeUTC(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Converts a local wall-clock time in `timeZone` to the equivalent UTC
 * instant, without a timezone-database dependency. Works by guessing the
 * instant is UTC, checking what that instant actually reads as in `timeZone`
 * (via Intl), and correcting by the difference — safe for any time that
 * isn't within a DST transition's own ~1-hour window (troop meetings/events
 * are never scheduled at 2 AM).
 */
function zonedTimeToUTC(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, mo, d] = parseYMD(dateStr);
  const [h, mi, s] = parseHMS(timeStr);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s));

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(guess)) parts[p.type] = p.value;
  const readAsUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return new Date(guess.getTime() + (guess.getTime() - readAsUTC));
}

function line(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

export function buildCalendar(opts: { calendarName: string; timeZoneId: string; events: IcsEvent[] }): string {
  const now = formatDateTimeUTC(new Date().toISOString());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Troop 79//Bugle Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    line('X-WR-CALNAME', escapeText(opts.calendarName)),
    line('X-WR-TIMEZONE', opts.timeZoneId)
  ];

  for (const ev of opts.events) {
    lines.push('BEGIN:VEVENT', line('UID', ev.uid), line('DTSTAMP', now));

    if (ev.startTime) {
      const start = zonedTimeToUTC(ev.startDate, ev.startTime, opts.timeZoneId);
      const end = ev.endTime
        ? zonedTimeToUTC(ev.endDate ?? ev.startDate, ev.endTime, opts.timeZoneId)
        : new Date(start.getTime() + 60 * 60 * 1000);
      lines.push(line('DTSTART', formatDateTimeUTC(start.toISOString())), line('DTEND', formatDateTimeUTC(end.toISOString())));
    } else {
      // DTEND for an all-day VEVENT is EXCLUSIVE per RFC 5545 §3.6.1 — a
      // single-day entry's DTEND is the *next* day, not the same day again.
      const dtEnd = addDaysCompact(ev.endDate ?? ev.startDate, 1);
      lines.push(
        foldLine(`DTSTART;VALUE=DATE:${formatDateOnlyCompact(ev.startDate)}`),
        foldLine(`DTEND;VALUE=DATE:${dtEnd}`)
      );
    }

    lines.push(line('SUMMARY', escapeText(ev.summary)));
    if (ev.location) lines.push(line('LOCATION', escapeText(ev.location)));
    if (ev.description) lines.push(line('DESCRIPTION', escapeText(ev.description)));
    if (ev.url) lines.push(line('URL', ev.url));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join(CRLF) + CRLF;
}
