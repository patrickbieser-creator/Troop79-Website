/**
 * Admin calendar list — pure row helpers (Patrick, 2026-08-24: "Merge 'roll
 * call and agendas' into 'calendar' … All events must fit onto one line").
 *
 * The list absorbed the Roll Call work list, so every row now carries the
 * state of each layer as a single-letter pill and the date/author/location
 * cells compress to one line with the rest on hover. The rules live here so
 * they are tested without rendering; the editor only lays them out.
 */

import { fmtDate, fmtDateFull, fmtRange } from '@/lib/format-date';
import { formatTimeOfDay } from '@/lib/calendar-shared';

/** "Patrick Bieser" → "PBieser"; "Maya Sankpal-Tatera" → "MSankpal-Tatera";
 *  "John Q. Public" → "JPublic"; a single word passes through; blank → "—". */
export function authorInitials(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  if (!t) return '—';
  const parts = t.split(/\s+/);
  if (parts.length === 1) return t;
  return `${parts[0][0].toUpperCase()}${parts[parts.length - 1]}`;
}

/** First `max` characters plus an ellipsis; untouched when it already fits. */
export function truncate(s: string | null | undefined, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

/** One-line date: 'Aug 30, 2026' for a day; 'Oct 9–11' / 'Jul 30 – Aug 2' for
 *  a span (the year is dropped on a same-year span — Patrick, 2026-08-24). */
export function dateLabel(entryDate: string, endDate: string | null | undefined): string {
  if (!endDate || endDate === entryDate) return fmtDate(entryDate);
  const range = fmtRange(entryDate, endDate);
  return entryDate.slice(0, 4) === endDate.slice(0, 4) ? range.replace(/,\s*\d{4}$/, '') : range;
}

/** What the date cell's hover carries: weekday, the time range, the day note. */
export function dateHover(row: {
  entry_date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  day_note?: string | null;
}): string {
  const parts = [fmtDateFull(row.entry_date)];
  if (row.end_date && row.end_date !== row.entry_date) parts.push(`through ${fmtDateFull(row.end_date)}`);
  if (row.start_time) {
    parts.push(
      row.end_time
        ? `${formatTimeOfDay(row.start_time)} – ${formatTimeOfDay(row.end_time)}`
        : formatTimeOfDay(row.start_time)
    );
  }
  if (row.day_note) parts.push(row.day_note);
  return parts.join(' · ');
}

export type PillTone = 'live' | 'draft' | 'closed' | 'off';

export interface StatusPill {
  letter: 'A' | 'S' | 'R' | 'O';
  /** The hover text — the whole word the letter stands for, plus detail. */
  label: string;
  tone: PillTone;
  /** Where the pill opens — the layer's own screen — or null for a flag. */
  href: string | null;
}

export interface StatusPillInput {
  id: number;
  on_calendar: boolean;
  agendaId?: number | null;
  agendaStatus: string | null;
  signupId?: number | null;
  signupStatus: string | null;
  attendance?: { scouts: number; adults: number } | null;
}

/**
 * The Status column (Patrick, 2026-08-24): "single letter pills … Yellow is
 * for drafts. Green is for live for 'A' agendas, 'S' signups. 'R' roll call
 * taken, 'O' off calendar" — and, the same day: "Remove the off-calendar pill
 * altogether if the item is on the calendar, but display it in a red tint if
 * it is off". A layer that does not exist has no pill; the pills are also the
 * way in to each layer's screen.
 */
export function statusPills(row: StatusPillInput): StatusPill[] {
  const pills: StatusPill[] = [];

  if (row.agendaStatus) {
    const live = row.agendaStatus === 'published';
    pills.push({
      letter: 'A',
      label: live ? 'Agenda published' : `Agenda ${row.agendaStatus}`,
      tone: live ? 'live' : 'draft',
      href: row.agendaId ? `/admin/advancement/meetings/${row.agendaId}` : null
    });
  }

  if (row.signupStatus) {
    const live = row.signupStatus === 'open';
    pills.push({
      letter: 'S',
      label: live ? 'Signup open' : `Signup ${row.signupStatus}`,
      tone: live ? 'live' : row.signupStatus === 'draft' ? 'draft' : 'closed',
      href: row.signupId ? `/admin/events/${row.signupId}` : null
    });
  }

  const present = (row.attendance?.scouts ?? 0) + (row.attendance?.adults ?? 0);
  if (present > 0) {
    pills.push({
      letter: 'R',
      label: `Roll call taken — ${row.attendance!.scouts} scouts + ${row.attendance!.adults} adults`,
      tone: 'live',
      // The sheet lives in the entry's Roll Call tab (2026-08-24).
      href: `/admin/calendar/${row.id}?tab=roll-call`
    });
  }

  // O only when it is the exception (Patrick, 2026-08-24): an on-calendar
  // entry is the norm and shows nothing; off-calendar is red so it stands out.
  if (!row.on_calendar) {
    pills.push({
      letter: 'O',
      label: 'Off calendar — not published to the calendar or .ics feed',
      tone: 'off',
      href: null
    });
  }

  return pills;
}

/** Column order of the pills — each letter keeps its own column so the pills
 *  line up down the list (Patrick, 2026-08-24). */
export const PILL_COLUMNS: StatusPill['letter'][] = ['A', 'S', 'R', 'O'];
