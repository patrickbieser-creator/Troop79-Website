/**
 * THE date display standard — Plans/Date-Display-Standard.md (Patrick,
 * 2026-08-24, after a sweep found 21 visible formats, 36 raw-ISO renders and
 * a handful of genuine wrong-day bugs: "UTC dates and european formats
 * slipping into lists and display").
 *
 * Two input kinds, handled explicitly and never confused:
 *   · a `date` column — 'YYYY-MM-DD' — is a CALENDAR DAY. It is formatted at
 *     UTC noon with timeZone 'UTC', so it never shifts. `new Date('2026-07-01')`
 *     is UTC midnight, which is 7 PM on June 30 in Milwaukee — the bug this
 *     module exists to end.
 *   · a timestamptz (anything with a 'T', or a Date) is an INSTANT, always
 *     rendered in America/Chicago regardless of where the server or browser is.
 *
 * Which helper (see the plan / admin styleguide):
 *   fmtDate      'Jul 12, 2026'            the default — tables, lists, hints, dialogs
 *   fmtDateLong  'July 12, 2026'           public prose, bylines, print headers
 *   fmtDateFull  'Sunday, July 12, 2026'   headings where the weekday matters
 *   fmtDay       'Sun, Jul 12'             dense day headings, deadlines, job boards
 *   fmtDateTime  'Jul 12, 2026, 3:04 PM'   any timestamp shown with its time
 *   fmtMonthYear 'July 2026'               almanacs, "updated", "earned" badges
 *   fmtRange     'Jul 12–14, 2026'         multi-day events, report ranges
 * ISO 'YYYY-MM-DD' is for data (exports, URLs, picker values) — never for display.
 * Slash forms ('7/12/26') are retired. Blank or unparseable input renders '—'.
 */

const CENTRAL = 'America/Chicago';
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateInput = string | Date | null | undefined;

/** Normalize to a Date plus the zone it should be read in. */
function resolve(input: DateInput): { d: Date; tz: string } | null {
  if (input == null || input === '') return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : { d: input, tz: CENTRAL };
  const s = input.trim();
  if (DATE_ONLY.test(s)) return { d: new Date(`${s}T12:00:00Z`), tz: 'UTC' };
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : { d, tz: CENTRAL };
}

function fmt(input: DateInput, opts: Intl.DateTimeFormatOptions): string {
  const r = resolve(input);
  if (!r) return '—';
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: r.tz }).format(r.d);
}

/** 'Jul 12, 2026' — the default everywhere. `{year:false}` inside a list that is visibly one year. */
export function fmtDate(input: DateInput, o: { year?: boolean } = {}): string {
  return fmt(input, { month: 'short', day: 'numeric', ...(o.year === false ? {} : { year: 'numeric' }) });
}

/** 'July 12, 2026' — public prose, bylines, print headers. */
export function fmtDateLong(input: DateInput): string {
  return fmt(input, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** 'Sunday, July 12, 2026' — headings where the weekday matters. */
export function fmtDateFull(input: DateInput): string {
  return fmt(input, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** 'Sun, Jul 12' — dense day headings, deadlines, job boards. `{year:true}` when the list spans years. */
export function fmtDay(input: DateInput, o: { year?: boolean } = {}): string {
  return fmt(input, { weekday: 'short', month: 'short', day: 'numeric', ...(o.year ? { year: 'numeric' } : {}) });
}

/** 'Jul 12, 2026, 3:04 PM' — any timestamp shown with its time. `{zone:true}` appends ' Central' (email). */
export function fmtDateTime(input: DateInput, o: { zone?: boolean } = {}): string {
  const s = fmt(input, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return s === '—' || !o.zone ? s : `${s} Central`;
}

/** 'July 2026' — almanacs, "updated", "earned" badges. */
export function fmtMonthYear(input: DateInput): string {
  return fmt(input, { month: 'long', year: 'numeric' });
}

/** 'Jul 12–14, 2026' / 'Jul 30 – Aug 2, 2026' / 'Dec 30, 2025 – Jan 2, 2026'. */
export function fmtRange(start: DateInput, end: DateInput): string {
  const a = resolve(start);
  const b = resolve(end);
  if (!a) return '—';
  if (!b) return fmtDate(start);
  const part = (r: { d: Date; tz: string }, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...opts, timeZone: r.tz }).format(r.d);
  const ay = part(a, { year: 'numeric' });
  const by = part(b, { year: 'numeric' });
  const am = part(a, { month: 'short' });
  const bm = part(b, { month: 'short' });
  const ad = part(a, { day: 'numeric' });
  const bd = part(b, { day: 'numeric' });
  if (ay === by && am === bm && ad === bd) return fmtDate(start);
  if (ay === by && am === bm) return `${am} ${ad}–${bd}, ${ay}`;
  if (ay === by) return `${am} ${ad} – ${bm} ${bd}, ${ay}`;
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}
