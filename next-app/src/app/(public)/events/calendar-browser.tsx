'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CalendarCategory } from '@/lib/supabase/types';
import type { CalendarEntryWithSlug } from '@/lib/calendar';
import { formatCalendarDateParts, formatTimeOfDay, CATEGORY_COLORS } from '@/lib/calendar-shared';
import { MonthGrid } from './month-grid';
import styles from './events.module.css';

type View = 'list' | 'month';

function EntryRow({ entry, past }: { entry: CalendarEntryWithSlug; past?: boolean }) {
  const { month, day } = formatCalendarDateParts(entry.entry_date);
  const color = CATEGORY_COLORS[entry.category];
  const title = entry.articleSlug ? (
    <Link href={`/news/${entry.articleSlug}`}>{entry.title}</Link>
  ) : (
    entry.title
  );

  return (
    <li className={`${styles.item} ${past ? styles.pastItem : ''}`}>
      <div className={styles.dateBlock} style={past ? undefined : { background: color }}>
        <div className={styles.eMonth}>{month}</div>
        <div className={styles.eDay}>{day}</div>
      </div>
      <div className={styles.itemBody}>
        <p className={styles.itemTitle}>
          {title}
          {entry.day_note && <span className={styles.dayNote}>{entry.day_note}</span>}
        </p>
        <p className={styles.itemCategory} style={{ color }}>
          {entry.category}
        </p>
        {entry.start_time && (
          <p className={styles.itemMeta}>
            {formatTimeOfDay(entry.start_time)}
            {entry.end_time && <> &ndash; {formatTimeOfDay(entry.end_time)}</>}
          </p>
        )}
        {entry.location && <p className={styles.itemMeta}>{entry.location}</p>}
        {entry.description && <p className={styles.itemDesc}>{entry.description}</p>}
      </div>
    </li>
  );
}

const NO_CATEGORY_FILTER = new Set<CalendarCategory>();

export function CalendarBrowser({
  upcoming,
  past,
  categories
}: {
  upcoming: CalendarEntryWithSlug[];
  past: CalendarEntryWithSlug[];
  categories: CalendarCategory[];
}) {
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('list');

  // Shareable-link support: hydrate filters from ?category=&q= once on mount
  // (same pattern as /photos — the page renders without searchParams on the
  // server, so the URL is only readable here; useSearchParams would force the
  // whole page behind a Suspense fallback instead).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.get('category') && !p.get('q')) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory(p.get('category') ?? 'all');
    setQuery(p.get('q') ?? '');
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (category !== 'all') p.set('category', category);
    if (query) p.set('q', query);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [category, query]);

  const allEntries = useMemo(() => [...upcoming, ...past], [upcoming, past]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of allEntries) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [allEntries]);

  const q = query.trim().toLowerCase();
  const matches = (e: CalendarEntryWithSlug) => {
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
                <option key={c} value={c}>
                  {c}
                  {counts.has(c) ? ` (${counts.get(c)})` : ''}
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
          <ul className={styles.list}>
            {filteredUpcoming.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}

        {filteredPast.length > 0 && (
          <>
            <div className={styles.sectionDivider}>
              <span className={styles.divLabel}>Past</span>
              <span className={styles.divRule} aria-hidden="true" />
            </div>
            <ul className={styles.list}>
              {filteredPast.map((entry) => (
                <EntryRow key={entry.id} entry={entry} past />
              ))}
            </ul>
          </>
        )}
      </div>

      <div style={{ display: view === 'month' ? 'block' : 'none' }}>
        <MonthGrid entries={monthEntries} activeCategories={NO_CATEGORY_FILTER} isActive={view === 'month'} />
      </div>
    </>
  );
}
