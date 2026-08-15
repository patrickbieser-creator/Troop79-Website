'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CalendarEntryPublic } from '@/lib/calendar';
import {
  categoryColorMap,
  colorFor,
  type CalendarCategoryRow,
  type CategoryColorMap
} from '@/lib/calendar-categories';
import { formatCalendarDateParts, formatTimeOfDay } from '@/lib/calendar-shared';
import { MonthGrid } from './month-grid';
import styles from './events.module.css';

type View = 'list' | 'month';

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** "2026-07-19" → "SUN". Built from numeric parts via Date.UTC — never
 *  string-parsed (the documented TZ off-by-one). */
function weekdayAbbr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAY_ABBR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "2026-07-19" → "July 2026" (string math only). */
function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return `${MONTH_FULL[m - 1]} ${y}`;
}

/** Groups an already-sorted list into consecutive [month label, entries]
 *  runs — computed per section AFTER filtering, so an empty month never
 *  renders a stranded header. */
function groupByMonth(list: CalendarEntryPublic[]): [string, CalendarEntryPublic[]][] {
  const groups: [string, CalendarEntryPublic[]][] = [];
  for (const e of list) {
    const label = monthLabel(e.entry_date);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(e);
    else groups.push([label, [e]]);
  }
  return groups;
}

function timeCell(entry: CalendarEntryPublic): React.ReactNode {
  if (!entry.start_time) return <span className={styles.metaEmpty}>&mdash;</span>;
  return (
    <>
      {formatTimeOfDay(entry.start_time)}
      {entry.end_time && <> &ndash; {formatTimeOfDay(entry.end_time)}</>}
    </>
  );
}

function EntryRow({
  entry,
  colors,
  past,
  search
}: {
  entry: CalendarEntryPublic;
  colors: CategoryColorMap;
  past?: boolean;
  /** The browsing position, already encoded — travels into the event link so
   *  the event page can offer a way back to exactly this view. */
  search: string;
}) {
  const { day } = formatCalendarDateParts(entry.entry_date);
  const color = colorFor(colors, entry.category);
  // articleSlug is gone (Event→News promotion) — an entry's own page is
  // /events/[id]; the "read the story" pattern is retired.
  const title = entry.title;

  // Multi-day: same-month spans render as "9–11" in the date block; a span
  // that crosses months keeps the start day in the block and spells the full
  // range under the title instead.
  let dayText = day;
  let spanNote: string | null = null;
  if (entry.end_date && entry.end_date !== entry.entry_date) {
    const startParts = formatCalendarDateParts(entry.entry_date);
    const endParts = formatCalendarDateParts(entry.end_date);
    if (entry.end_date.slice(0, 7) === entry.entry_date.slice(0, 7)) {
      dayText = `${day}–${endParts.day}`;
    } else {
      spanNote = `${startParts.month} ${startParts.day} – ${endParts.month} ${endParts.day}`;
    }
  }

  const timeStr = entry.start_time
    ? `${formatTimeOfDay(entry.start_time)}${entry.end_time ? ` – ${formatTimeOfDay(entry.end_time)}` : ''}`
    : null;

  /*
   * ONE link per row, stretched over the whole thing.
   *
   * Patrick asked for the date pill, the title and the category all to open the
   * event. Done as three <a>s that would be three identical tab stops on every
   * one of ~105 rows, and a screen reader would read the same destination three
   * times per entry. Instead: one real <a> on the title — which supplies the
   * accessible name — with .stretch making its ::after cover the row. The pill
   * and category become plain text under a transparent overlay: clickable, not
   * separately focusable.
   *
   * It is also the only way the row can be a link AND hold the signup link,
   * since nesting <a> inside <a> is invalid. .rowAction lifts the signup out of
   * the overlay with position/z-index rather than nesting under it.
   */
  const href = `/events/${entry.id}${search ? `?${search}` : ''}`;

  return (
    <li className={`${styles.item} ${past ? styles.pastItem : ''}`}>
      <div className={styles.dateBlock} style={past ? undefined : { background: color }}>
        <div className={styles.eWkd}>{weekdayAbbr(entry.entry_date)}</div>
        <div className={`${styles.eDay} ${dayText.length > 2 ? styles.eDayRange : ''}`}>{dayText}</div>
      </div>
      <div className={styles.itemBody}>
        <p className={styles.itemTitle}>
          <Link href={href} className={styles.stretch}>
            {title}
          </Link>
          {entry.day_note && <span className={styles.dayNote}>{entry.day_note}</span>}
        </p>
        <p className={styles.itemCategory} style={{ color }}>
          {entry.category}
        </p>
        {spanNote && <p className={styles.spanNote}>{spanNote}</p>}
        <p className={styles.mobileMeta}>
          {[timeStr, entry.location].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>
      <div className={styles.colTime}>{timeCell(entry)}</div>
      <div className={styles.colLoc} title={entry.location ?? undefined}>
        {entry.location || <span className={styles.metaEmpty}>&mdash;</span>}
      </div>
      <div className={styles.colAction}>
        {entry.hasSignup && !past && (
          /*
           * Shown to everyone, signed in or not (Patrick, 2026-08-15). It leads
           * to the family gate for a visitor without a session, which is fine —
           * a control that silently isn't there reads as a missing feature, and
           * the majority of visitors are here to read rather than to sign up.
           *
           * Its own route since step 4 — a form deserves an address, and a
           * family part-way through one should be able to bookmark it.
           */
          <Link href={`/events/${entry.id}/signup`} className={styles.rowAction}>
            Sign up
          </Link>
        )}
      </div>
      {!past && entry.description && <p className={styles.itemDesc}>{entry.description}</p>}
    </li>
  );
}

const NO_CATEGORY_FILTER = new Set<string>();

export function CalendarBrowser({
  upcoming,
  past,
  categories
}: {
  upcoming: CalendarEntryPublic[];
  past: CalendarEntryPublic[];
  /** The lookup table (D-082), already in display order — carries each
   *  category's color, so nothing here is hardcoded any more. */
  categories: CalendarCategoryRow[];
}) {
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('list');
  /** The month the grid is showing, as 'YYYY-MM'. Null until the grid says. */
  const [month, setMonth] = useState<string | null>(null);
  /**
   * The month asked for in the URL, filled in AFTER mount by the effect below
   * — never during the first render.
   *
   * Reading window.location in a useState initializer instead cost a real
   * hydration mismatch: the server has no URL, so it rendered "August 2026"
   * while the client rendered "October 2026" and React threw the subtree away.
   * Same reason category and query hydrate in an effect rather than inline.
   */
  const [urlMonth, setUrlMonth] = useState<string | null>(null);

  /*
   * Shareable-link support: hydrate from the query string once on mount (same
   * pattern as /photos — the page renders without searchParams on the server,
   * so the URL is only readable here; useSearchParams would force the whole
   * page behind a Suspense fallback instead).
   *
   * `view` and `m` joined `category` and `q` on 2026-08-15. Until then there
   * was no URL that meant "month view, October" — which made it impossible for
   * an event page to offer a link back to where the visitor actually was, and
   * meant a month could not be shared or bookmarked at all.
   */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.get('category') && !p.get('q') && !p.get('view') && !p.get('m')) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory(p.get('category') ?? 'all');
    setQuery(p.get('q') ?? '');
    if (p.get('view') === 'month') setView('month');
    setUrlMonth(p.get('m'));
  }, []);

  /**
   * The browsing position as a query string — the single source for both the
   * address bar and the links out to each event, so a visitor's way back can
   * never disagree with where they actually are.
   */
  const search = useMemo(() => {
    const p = new URLSearchParams();
    if (category !== 'all') p.set('category', category);
    if (query) p.set('q', query);
    if (view === 'month') {
      p.set('view', 'month');
      // Only while the grid is showing: a month in the URL of a list view
      // would be noise, and would survive a switch back as a stale value.
      if (month) p.set('m', month);
    }
    return p.toString();
  }, [category, query, view, month]);

  useEffect(() => {
    window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
  }, [search]);

  const colors = useMemo(() => categoryColorMap(categories), [categories]);
  const allEntries = useMemo(() => [...upcoming, ...past], [upcoming, past]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of allEntries) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [allEntries]);

  const q = query.trim().toLowerCase();
  const matches = (e: CalendarEntryPublic) => {
    if (category !== 'all' && e.category !== category) return false;
    if (q) {
      const hay = `${e.title} ${e.description ?? ''} ${e.location ?? ''} ${e.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const filteredUpcoming = upcoming.filter(matches);
  const filteredPast = past.filter(matches);
  const filtering = category !== 'all' || q !== '';

  // Month view: the grid hides non-matching entries itself via
  // activeCategories, so hand it pre-filtered entries and no category set.
  const monthEntries = useMemo(
    () => allEntries.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEntries, category, q]
  );

  function clearFilters() {
    setCategory('all');
    setQuery('');
  }

  return (
    <>
      <div className={styles.viewToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="Calendar view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'list'}
            className={`${styles.viewToggleBtn} ${view === 'list' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'month'}
            className={`${styles.viewToggleBtn} ${view === 'month' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => setView('month')}
          >
            Month
          </button>
        </div>

        <div className={styles.filterCluster} role="region" aria-label="Calendar filters">
          <div className={styles.filterControls}>
            <label className={styles.srOnly} htmlFor="calCategory">
              Filter by category
            </label>
            <select
              id="calCategory"
              className={styles.filterSelect}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All Categories ({allEntries.length})</option>
              {categories.map((c) => (
                <option key={c.label} value={c.label}>
                  {c.label}
                  {counts.has(c.label) ? ` (${counts.get(c.label)})` : ''}
                </option>
              ))}
            </select>
            <div className={styles.calSearch}>
              <label className={styles.srOnly} htmlFor="calSearch">
                Search the calendar by title, description, or location
              </label>
              <input
                type="search"
                id="calSearch"
                placeholder="Search the calendar&hellip;"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
              </svg>
            </div>
            {filtering && (
              <button type="button" className={styles.filterClear} onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
          <p className={styles.resultsCount} aria-live="polite">
            {filtering ? (
              <>
                Showing <strong>{filteredUpcoming.length + filteredPast.length}</strong> of{' '}
                {allEntries.length} entries
              </>
            ) : (
              <>
                Showing all <strong>{allEntries.length}</strong> entries
              </>
            )}
          </p>
        </div>
      </div>

      <div style={{ display: view === 'list' ? 'block' : 'none' }}>
        <div className={styles.sectionDivider}>
          <span className={styles.divLabel}>Upcoming</span>
          <span className={styles.divRule} aria-hidden="true" />
        </div>
        {filteredUpcoming.length === 0 ? (
          <p className={styles.empty}>
            {filtering ? 'No upcoming entries match that filter.' : 'Nothing on the calendar yet.'}
          </p>
        ) : (
          groupByMonth(filteredUpcoming).map(([label, items]) => (
            <section key={`u-${label}`} aria-label={label}>
              <div className={styles.monthDivider}>
                <span className={styles.monthLabel}>{label}</span>
                <span className={styles.monthRule} aria-hidden="true" />
              </div>
              <ul className={styles.list}>
                {items.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} colors={colors} search={search} />
                ))}
              </ul>
            </section>
          ))
        )}

        {filteredPast.length > 0 && (
          <>
            <div className={styles.sectionDivider}>
              <span className={styles.divLabel}>Past</span>
              <span className={styles.divRule} aria-hidden="true" />
            </div>
            {groupByMonth(filteredPast).map(([label, items]) => (
              <section key={`p-${label}`} aria-label={`${label} (past)`}>
                <div className={styles.monthDivider}>
                  <span className={styles.monthLabel}>{label}</span>
                  <span className={styles.monthRule} aria-hidden="true" />
                </div>
                <ul className={styles.list}>
                  {items.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} colors={colors} past search={search} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>

      <div style={{ display: view === 'month' ? 'block' : 'none' }}>
        <MonthGrid
          entries={monthEntries}
          activeCategories={NO_CATEGORY_FILTER}
          colors={colors}
          initialMonth={urlMonth}
          onMonthChange={setMonth}
          search={search}
        />
      </div>
    </>
  );
}
