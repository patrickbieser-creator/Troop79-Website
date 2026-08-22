'use client';

/**
 * Client half of /photos — the header, the filter cluster, the view tabs, and
 * whichever of the four views is active.
 *
 * FOUR VIEWS OF ONE FILTERED SET (Patrick, 2026-08-22, after Brad's six
 * concepts in prototypes/photo-library-concepts.html): Prints, Timeline, List,
 * Almanac. The filters sit ABOVE the tabs on purpose — narrowing the set is a
 * different act from choosing how to draw it, and a visitor who filters to
 * "Summer Camp" should keep that when they switch to the timeline.
 *
 * Filter and view state sync to ?view=&category=&year=&q= via replaceState so
 * a filtered view is shareable (e.g. in the Bugle), and are read back on
 * mount — which keeps the page itself statically rendered. The chosen view
 * also persists in localStorage, because it is a preference rather than
 * something you mean to send someone.
 */

import { useEffect, useMemo, useState } from 'react';
import { TabStrip } from '@/app/_components/tab-strip';
import {
  DEFAULT_PHOTO_VIEW,
  PHOTO_VIEWS,
  PHOTO_VIEW_LABELS,
  filterAlbums,
  isPhotoView,
  yearOf,
  type PhotoView,
  type PhotoViewAlbum
} from '@/lib/photo-views';
import type { CategoryColorMap } from '@/lib/calendar-categories';
import { Almanac, Ledger, PrintShelf, TimelineSpine } from './views';
import styles from './photos.module.css';

export type AlbumWithCover = PhotoViewAlbum;

const VIEW_STORAGE_KEY = 'troop79.photos.view';

const VIEW_HINTS: Record<PhotoView, string> = {
  prints: 'Albums as a shelf of prints, newest year first.',
  spine: 'One rail down the years — every album on its exact date, gaps included.',
  ledger: 'A sortable index. No images, so it loads instantly and scans fast.',
  almanac: 'Years down, calendar quarters across — the shape of a troop year.'
};

interface Filters {
  category: string;
  year: string;
  query: string;
}

export function AlbumsBrowser({
  albums,
  colors
}: {
  albums: AlbumWithCover[];
  colors: CategoryColorMap;
}) {
  const [filters, setFilters] = useState<Filters>({ category: 'all', year: 'all', query: '' });
  const [view, setView] = useState<PhotoView>(DEFAULT_PHOTO_VIEW);
  const { category, year, query } = filters;

  const setCategory = (category: string) => setFilters((f) => ({ ...f, category }));
  const setYear = (year: string) => setFilters((f) => ({ ...f, year }));
  const setQuery = (query: string) => setFilters((f) => ({ ...f, query }));

  /* Shareable-link support: hydrate from the URL once on mount, then fall back
     to the remembered view. Deliberate one-time setState-in-effect — the page
     is statically prerendered (no searchParams on the server), so the URL is
     only readable here; useSearchParams would force the whole page behind a
     Suspense fallback instead. */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const urlView = p.get('view');
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage — the default view is fine.
    }
    const nextView = isPhotoView(urlView) ? urlView : isPhotoView(stored) ? stored : DEFAULT_PHOTO_VIEW;
    // The rule reports once per effect, at the FIRST setState — so the
    // directive belongs here rather than above setFilters below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(nextView);
    if (!p.get('category') && !p.get('year') && !p.get('q')) return;
    setFilters({
      category: p.get('category') ?? 'all',
      year: p.get('year') ?? 'all',
      query: p.get('q') ?? ''
    });
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (view !== DEFAULT_PHOTO_VIEW) p.set('view', view);
    if (category !== 'all') p.set('category', category);
    if (year !== 'all') p.set('year', year);
    if (query) p.set('q', query);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Nothing to do — remembering the view is a convenience, not a feature.
    }
  }, [view, category, year, query]);

  const sorted = useMemo(
    () => [...albums].sort((a, b) => b.event_date.localeCompare(a.event_date)),
    [albums]
  );
  const years = useMemo(() => [...new Set(sorted.map(yearOf))].sort().reverse(), [sorted]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of sorted) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sorted]);

  const results = useMemo(() => filterAlbums(sorted, filters), [sorted, filters]);

  function clearFilters() {
    setFilters({ category: 'all', year: 'all', query: '' });
  }

  return (
    <>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <span className={styles.sectionLabel}>Troop Life in Pictures</span>
          <h1 className={styles.pageTitle}>Photo Albums</h1>
          <p className={styles.pageDek}>
            Every campout, court of honor, and service project since 2022 &mdash; all in one place.{' '}
            <span className={styles.gpNote}>Albums open on Google Photos in a new tab.</span>
          </p>
        </div>

        <div className={styles.filterCluster} role="region" aria-label="Album filters">
          <div className={styles.filterControls}>
            <label className={styles.srOnly} htmlFor="albumCategory">
              Filter by category
            </label>
            <select
              id="albumCategory"
              className={styles.filterSelect}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All Categories ({sorted.length})</option>
              {categories.map(([cat, n]) => (
                <option key={cat} value={cat}>
                  {cat} ({n})
                </option>
              ))}
            </select>
            <label className={styles.srOnly} htmlFor="albumYear">
              Filter by year
            </label>
            <select
              id="albumYear"
              className={styles.filterSelect}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="all">All Years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <div className={styles.albumSearch}>
              <label className={styles.srOnly} htmlFor="albumSearch">
                Search albums by title or description
              </label>
              <input
                type="search"
                id="albumSearch"
                placeholder="Search albums&hellip;"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
              </svg>
            </div>
          </div>
          <p className={styles.resultsCount} aria-live="polite">
            {results.length === sorted.length ? (
              <>
                Showing all <strong>{sorted.length}</strong> albums
              </>
            ) : (
              <>
                Showing <strong>{results.length}</strong> of {sorted.length} albums
              </>
            )}
          </p>
        </div>
      </div>

      <main className={styles.mainContent}>
        <div className={styles.viewBar}>
          <TabStrip
            ariaLabel="How to show the albums"
            activeKey={view}
            items={PHOTO_VIEWS.map((v) => ({
              key: v,
              label: PHOTO_VIEW_LABELS[v],
              onSelect: () => setView(v)
            }))}
          />
          <p className={styles.viewHint}>{VIEW_HINTS[view]}</p>
        </div>

        {results.length > 0 && (
          <>
            {view === 'prints' && <PrintShelf albums={results} colors={colors} />}
            {view === 'spine' && <TimelineSpine albums={results} colors={colors} />}
            {view === 'ledger' && <Ledger albums={results} colors={colors} />}
            {view === 'almanac' && <Almanac albums={results} colors={colors} />}
          </>
        )}

        {results.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon} aria-hidden="true">
              &#128247;
            </div>
            <h3>
              {sorted.length === 0 ? 'Albums are coming soon' : 'No albums match those filters'}
            </h3>
            <p>
              {sorted.length === 0
                ? 'Check back after our next outing.'
                : 'Try a different category or year, or clear everything to browse all albums.'}
            </p>
            {sorted.length > 0 && (
              <button type="button" className={styles.clearBtn} onClick={clearFilters}>
                Clear All Filters
              </button>
            )}
          </div>
        )}

        <aside className={styles.albumsNote} aria-label="About these albums">
          <strong>Have photos to share?</strong> Albums are hosted on Google Photos so anyone at an
          event can contribute. Ask the Scoutmaster for the shared-album link after each outing
          &mdash; new albums appear here as they&rsquo;re added.
        </aside>
      </main>
    </>
  );
}
