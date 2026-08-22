/**
 * The four photo-library views (Patrick, 2026-08-22).
 *
 * Brad prototyped six concepts (prototypes/photo-library-concepts.html) and
 * recommended two behind a toggle. Patrick took the tabbed shell and asked for
 * four: "print shelf, timeline spine, the ledger, and the almanac views as the
 * four tabs with all of the features brad suggested on each screen."
 *
 * Everything the four views DISAGREE about — how albums group, how they sort,
 * where a gap year shows, which quarter a September album lands in — is
 * decided here so it can be asserted without a browser. The components render
 * what these functions return and hold no opinions of their own.
 *
 * CHRONOLOGY IS ONE OF FOUR HARD REQUIREMENTS (with date, title and category),
 * so it is defended explicitly rather than assumed: newest first everywhere by
 * default, gap years drawn rather than skipped, and the Ledger's year
 * separators appearing only while the table is actually in date order.
 */

import { FALLBACK_CATEGORY_COLOR, type CategoryColorMap } from '@/lib/calendar-categories';

/** The slice of a photo_albums row the views need. */
export interface PhotoViewAlbum {
  id: number;
  title: string;
  category: string;
  /** "YYYY-MM-DD". */
  event_date: string;
  photo_count: number | null;
  google_url: string;
  description: string | null;
  cover_url: string | null;
  cover_alt: string | null;
}

// ── The tab set ─────────────────────────────────────────────────────────────

/** Patrick's order, and not ours to re-sort. */
export const PHOTO_VIEWS = ['prints', 'spine', 'ledger', 'almanac'] as const;
export type PhotoView = (typeof PHOTO_VIEWS)[number];

export const DEFAULT_PHOTO_VIEW: PhotoView = 'prints';

export const PHOTO_VIEW_LABELS: Record<PhotoView, string> = {
  prints: 'Prints',
  spine: 'Timeline',
  ledger: 'List',
  almanac: 'Almanac'
};

/** Narrow an untrusted string (a URL param, a localStorage value). */
export function isPhotoView(v: string | null | undefined): v is PhotoView {
  return !!v && (PHOTO_VIEWS as readonly string[]).includes(v);
}

// ── Dates ───────────────────────────────────────────────────────────────────

/* Parsed from the string rather than through `new Date(iso)`, which would
   shift the day by the server's timezone — the same reason the calendar grid
   does its own parsing. */
export function dateParts(iso: string): { year: number; month: number; day: number } {
  return { year: +iso.slice(0, 4), month: +iso.slice(5, 7) - 1, day: +iso.slice(8, 10) };
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function shortDate(iso: string): string {
  const p = dateParts(iso);
  return `${MONTHS_SHORT[p.month]} ${p.day}, ${p.year}`;
}

export function monthYear(iso: string): string {
  const p = dateParts(iso);
  return `${MONTHS_LONG[p.month]} ${p.year}`;
}

export function shortMonthDay(iso: string): { month: string; day: number } {
  const p = dateParts(iso);
  return { month: MONTHS_SHORT[p.month], day: p.day };
}

export const yearOf = (a: PhotoViewAlbum) => a.event_date.slice(0, 4);

const newestFirst = (a: PhotoViewAlbum, b: PhotoViewAlbum) => b.event_date.localeCompare(a.event_date);

// ── Chronology ──────────────────────────────────────────────────────────────

/** Years that actually have albums, newest first. */
export function yearsPresent(albums: PhotoViewAlbum[]): string[] {
  return [...new Set(albums.map(yearOf))].sort().reverse();
}

/**
 * The years with NO albums between `year` and the next year that has some.
 *
 * The live library really does skip 2023 and 2024, and year-grouping hides
 * that completely — an empty year simply never renders a heading. The Spine
 * draws the gap instead, because a two-year hole is a fact about the troop.
 */
export function gapYearsAfter(albums: PhotoViewAlbum[], year: string): string[] {
  const years = yearsPresent(albums).map(Number);
  const i = years.indexOf(Number(year));
  if (i === -1 || i === years.length - 1) return [];
  const missing: string[] = [];
  for (let y = Number(year) - 1; y > years[i + 1]; y--) missing.push(String(y));
  return missing;
}

export interface YearGroup {
  year: string;
  albums: PhotoViewAlbum[];
}

/** Newest year first, newest album first within it. */
export function groupByYear(albums: PhotoViewAlbum[]): YearGroup[] {
  return yearsPresent(albums).map((year) => ({
    year,
    albums: albums.filter((a) => yearOf(a) === year).sort(newestFirst)
  }));
}

// ── The Almanac ─────────────────────────────────────────────────────────────

export interface Season {
  key: string;
  label: string;
  /** Zero-based month indices. */
  months: number[];
}

/**
 * CALENDAR QUARTERS, not true seasons.
 *
 * Brad flagged this as the Almanac's one unresolved question: true seasons
 * read better, but they file a September Court of Honor under "Summer" and
 * break the left-to-right reading of time. Chronology is a hard requirement,
 * so quarters win until Patrick says otherwise — the labels name both so the
 * reader is never guessing which convention is in force.
 */
export const SEASONS: readonly Season[] = [
  { key: 'winter', label: 'Winter · Jan–Mar', months: [0, 1, 2] },
  { key: 'spring', label: 'Spring · Apr–Jun', months: [3, 4, 5] },
  { key: 'summer', label: 'Summer · Jul–Sep', months: [6, 7, 8] },
  { key: 'fall', label: 'Fall · Oct–Dec', months: [9, 10, 11] }
];

export interface AlmanacCell {
  season: Season;
  albums: PhotoViewAlbum[];
}

export interface AlmanacRow {
  year: string;
  count: number;
  cells: AlmanacCell[];
}

/**
 * Years down, quarters across — the whole span from newest to oldest,
 * INCLUDING years with nothing in them. An empty row is the point: it shows
 * the troop's rhythm and its gaps at the same time.
 */
export function almanacRows(albums: PhotoViewAlbum[]): AlmanacRow[] {
  const present = yearsPresent(albums).map(Number);
  if (present.length === 0) return [];
  const rows: AlmanacRow[] = [];
  for (let y = Math.max(...present); y >= Math.min(...present); y--) {
    const inYear = albums.filter((a) => yearOf(a) === String(y));
    rows.push({
      year: String(y),
      count: inYear.length,
      cells: SEASONS.map((season) => ({
        season,
        albums: inYear.filter((a) => season.months.includes(dateParts(a.event_date).month)).sort(newestFirst)
      }))
    });
  }
  return rows;
}

// ── The Ledger ──────────────────────────────────────────────────────────────

export const LEDGER_KEYS = ['date', 'title', 'category', 'photos'] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export function isLedgerKey(v: string | null | undefined): v is LedgerKey {
  return !!v && (LEDGER_KEYS as readonly string[]).includes(v);
}

/**
 * Never mutates its input — the caller holds the canonical list.
 *
 * The direction flag applies to the CHOSEN KEY only. Ties then fall back to
 * date, newest first, always: sorting by category ascending should still show
 * each category's albums newest-first, not flip them into oldest-first as a
 * side effect of the direction. Chronology is a hard requirement, so it is
 * what a tie resolves to rather than something the sort can invert.
 */
export function sortLedger(albums: PhotoViewAlbum[], key: LedgerKey, dir: SortDir): PhotoViewAlbum[] {
  const sign = dir === 'desc' ? -1 : 1;
  return [...albums].sort((a, b) => {
    let r: number;
    if (key === 'photos') r = (a.photo_count ?? 0) - (b.photo_count ?? 0);
    else if (key === 'title') r = a.title.localeCompare(b.title);
    else if (key === 'category') r = a.category.localeCompare(b.category);
    else r = a.event_date.localeCompare(b.event_date);
    if (r !== 0) return sign * r;
    return b.event_date.localeCompare(a.event_date);
  });
}

// ── Filtering ───────────────────────────────────────────────────────────────

export interface AlbumFilters {
  category: string;
  year: string;
  query: string;
}

/** Filtered and normalised to newest-first, whatever order it was given. */
export function filterAlbums(albums: PhotoViewAlbum[], filters: AlbumFilters): PhotoViewAlbum[] {
  const q = filters.query.trim().toLowerCase();
  return albums
    .filter((a) => {
      if (filters.category !== 'all' && a.category !== filters.category) return false;
      if (filters.year !== 'all' && yearOf(a) !== filters.year) return false;
      if (q && !`${a.title} ${a.description ?? ''} ${a.category}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort(newestFirst);
}

// ── Category colour ─────────────────────────────────────────────────────────

/**
 * Album labels that predate the 2026-07-18 calendar rename, mapped to the
 * CURRENT category label — never to a colour. Pointing at a label means these
 * keep working when someone edits that category's colour in Lookups; pointing
 * at a hex would freeze it, which is the bug this whole mechanism replaces.
 */
export const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  Campout: 'Campout / Overnight',
  Outing: 'Day Activity / Outing',
  'Court of Honor': 'Ceremony / Recognition',
  Ceremony: 'Ceremony / Recognition'
};

/**
 * The album's accent colour, read from `calendar_categories.color` — the same
 * authoritative column the calendar month grid reads.
 *
 * REPLACES A LIVE BUG (Brad, 2026-08-22): albums-browser.tsx carried its own
 * hardcoded label→class map while the DB already held the answer, so five live
 * labels had no entry and silently fell through to the default navy chip —
 * "Troop 79 — 2025 in Review" is Recruiting / Outreach and should be #a04a3d.
 */
export function albumCategoryColor(map: CategoryColorMap, category: string): string {
  const direct = map[category];
  if (direct) return direct;
  const alias = LEGACY_CATEGORY_ALIASES[category];
  if (alias && map[alias]) return map[alias];
  return FALLBACK_CATEGORY_COLOR;
}
