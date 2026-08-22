/**
 * Free-typed date entry — the parsing/formatting core behind the public
 * DateField (src/app/_components/date-field.tsx). Lives in lib/ (neutral
 * ground, readable by either side of the admin↔public firewall) so the
 * grammar is one tested thing, not a per-component copy.
 *
 * An EXPLICIT grammar, never `Date.parse`: engines disagree on what it
 * accepts, and it happily rolls "2/30" into March. Every plausible form a
 * family member might type lands on the same ISO day; anything else returns
 * null so the field can show a hint instead of inventing a date. All math
 * is on local calendar fields — no Date→ISO round trips that shift a day
 * west of UTC.
 */

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Real calendar date → 'YYYY-MM-DD'; null for month 13, Feb 30, etc. */
function build(year: number, month1: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month1) || !Number.isInteger(day)) return null;
  if (year < 1000 || year > 9999) return null;
  if (month1 < 1 || month1 > 12) return null;
  if (day < 1 || day > daysInMonth(year, month1)) return null;
  return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Two-digit year → four, pivot 1950: 00–49 → 20xx, 50–99 → 19xx. Kids'
 *  birth years (2010s) and parents' (1970s–80s) both land right. */
function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n < 50 ? 2000 + n : 1900 + n;
}

/** 'jul' / 'july' / 'sept' / 'septem' → 7; null when not a unique ≥3-letter
 *  prefix of one month. */
function monthFromName(token: string): number | null {
  const t = token.toLowerCase().replace(/\.$/, '');
  if (t.length < 3) return null;
  if (t === 'sept') return 9;
  const hits = MONTH_NAMES.map((m, i) => (m.startsWith(t) ? i + 1 : 0)).filter(Boolean);
  return hits.length === 1 ? hits[0] : null;
}

function dayToken(token: string): number | null {
  const m = /^(\d{1,2})(?:st|nd|rd|th)?$/i.exec(token);
  return m ? Number(m[1]) : null;
}

/** Date → 'YYYY-MM-DD' from LOCAL fields (toISOString() is UTC and shifts
 *  the date during Central evenings). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Strict 'YYYY-MM-DD' AND a real calendar day. */
export function isValidISODate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  return build(Number(m[1]), Number(m[2]), Number(m[3])) === iso;
}

/** 'YYYY-MM-DD' → 'Jul 25, 2026' (fixed English short months — no Intl, so
 *  the rendering is identical on the server and every client). '' for
 *  empty/invalid. */
export function formatDateDisplay(iso: string): string {
  if (!isValidISODate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
}

/**
 * Tolerant parse of whatever was typed → 'YYYY-MM-DD' | null.
 *
 * Accepted (separators / - .  interchangeable, case-insensitive):
 *   2026-07-25 · 2026/7/25                ISO, year first
 *   7/25/2026 · 7-25-26 · 07.25.2026       US, 4- or 2-digit year
 *   7/25                                   month/day, current year
 *   Jul 25, 2026 · july 25 · 25 Jul 2026 · 25th July   month names either side
 *   07252026 · 072512 · 20260725           bare digit runs
 *   today · tomorrow · yesterday
 *
 * `today` is injectable for deterministic tests of the no-year forms.
 */
export function parseTypedDate(text: string, today: Date = new Date()): string | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;

  // Relative words.
  if (raw === 'today' || raw === 'tomorrow' || raw === 'yesterday') {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (raw === 'tomorrow') d.setDate(d.getDate() + 1);
    if (raw === 'yesterday') d.setDate(d.getDate() - 1);
    return toISODate(d);
  }

  const thisYear = today.getFullYear();
  let m: RegExpExecArray | null;

  // Year first: 2026-07-25, 2026/7/25, 2026.7.5
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw))) {
    return build(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  // US with year: 7/25/2026, 7-25-26
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(raw))) {
    return build(expandYear(m[3]), Number(m[1]), Number(m[2]));
  }
  // Month/day only → this year.
  if ((m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(raw))) {
    return build(thisYear, Number(m[1]), Number(m[2]));
  }
  // Bare digit runs.
  if (/^\d+$/.test(raw)) {
    if (raw.length === 8) {
      if (/^(19|20)/.test(raw)) {
        return build(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8)));
      }
      return build(Number(raw.slice(4, 8)), Number(raw.slice(0, 2)), Number(raw.slice(2, 4)));
    }
    if (raw.length === 6) {
      return build(expandYear(raw.slice(4, 6)), Number(raw.slice(0, 2)), Number(raw.slice(2, 4)));
    }
    return null;
  }

  // Month-name forms: "jul 25, 2026", "25 july 2026", "sept 3", "3rd september".
  const tokens = raw.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 2 || tokens.length === 3) {
    const [a, b, c] = tokens;
    const year = c === undefined ? thisYear : /^(\d{2}|\d{4})$/.test(c) ? expandYear(c) : NaN;
    if (Number.isNaN(year)) return null;
    const monA = monthFromName(a);
    const monB = monthFromName(b);
    if (monA && dayToken(b) != null) return build(year, monA, dayToken(b)!);
    if (monB && dayToken(a) != null) return build(year, monB, dayToken(a)!);
  }

  return null;
}
