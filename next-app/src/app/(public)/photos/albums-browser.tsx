'use client';

/**
 * Client half of /photos: header with the filter cluster top-right
 * (Category + Year dropdowns and search — Patrick's revision of the chip
 * design), a Latest Albums strip that hides while filtering, and
 * year-grouped album cards that link out to Google Photos.
 *
 * Filter state syncs to ?category=&year=&q= via replaceState so filtered
 * views can be shared (e.g. in the Bugle), and is read back on mount —
 * keeping the page itself statically rendered.
 */

import { useEffect, useMemo, useState } from 'react';
/* eslint-disable @next/next/no-img-element -- Bunny CDN covers, plain img with onError fallback */
import type { CalendarCategory, PhotoAlbum } from '@/lib/supabase/types';
import styles from './photos.module.css';

export interface AlbumWithCover extends PhotoAlbum {
  cover_url: string | null;
  cover_alt: string | null;
}

const CATEGORY_CLASS: Partial<Record<CalendarCategory, string>> = {
  Campout: styles.catCampout,
  'Summer Camp': styles.catSummerCamp,
  'High Adventure': styles.catHighAdventure,
  'Service Project': styles.catService,
  'Court of Honor': styles.catCoh,
  Ceremony: styles.catCoh,
  Outing: styles.catOuting,
  Fundraiser: styles.catFundraiser,
  'Troop Meeting': styles.catMeeting
};

const EXT_ICON = (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zm-9 0H3v18h18v-9h-2v7H5V5h7V3z" />
  </svg>
);

function displayMonth(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`)
  );
}

const yearOf = (a: PhotoAlbum) => a.event_date.slice(0, 4);

function Cover({ album, wide }: { album: AlbumWithCover; wide?: boolean }) {
  const [broken, setBroken] = useState(false);
  const hasCover = album.cover_url && !broken;
  return (
    <div
      className={`${styles.albumCover} ${hasCover ? '' : styles.noCover}`}
      style={wide ? { aspectRatio: '16/9' } : undefined}
    >
      {hasCover ? (
        <img
          src={album.cover_url!}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className={styles.monogram} aria-hidden="true">
          <span className={styles.mono79}>79</span>
          <span className={styles.monoLabel}>Troop Album</span>
        </span>
      )}
      <span className={styles.gpBadge}>{EXT_ICON} Google Photos</span>
    </div>
  );
}

function AlbumCard({ album, wide }: { album: AlbumWithCover; wide?: boolean }) {
  const ariaBits = [album.title, album.category, displayMonth(album.event_date)];
  if (album.photo_count) ariaBits.push(`${album.photo_count} photos`);
  ariaBits.push('Opens Google Photos in a new tab');

  return (
    <a
      className={styles.albumCard}
      href={album.google_url}
      target="_blank"
      rel="noopener noreferrer"
      title={album.title}
      aria-label={ariaBits.join('. ')}
    >
      <Cover album={album} wide={wide} />
      <div className={styles.albumBody}>
        <span className={`${styles.catTag} ${CATEGORY_CLASS[album.category] ?? ''}`}>
          {album.category}
        </span>
        <h3 className={styles.albumTitle}>{album.title}</h3>
        {album.description && <p className={styles.albumDesc}>{album.description}</p>}
        <p className={styles.albumMeta}>
          <span>{displayMonth(album.event_date)}</span>
          {album.photo_count ? (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                &middot;
              </span>
              <span>{album.photo_count} photos</span>
            </>
          ) : null}
          <span className={styles.metaDot} aria-hidden="true">
            &middot;
          </span>
          <span className={styles.metaExt}>Google Photos {EXT_ICON}</span>
        </p>
      </div>
    </a>
  );
}

interface Filters {
  category: string;
  year: string;
  query: string;
}

export function AlbumsBrowser({ albums }: { albums: AlbumWithCover[] }) {
  const [filters, setFilters] = useState<Filters>({ category: 'all', year: 'all', query: '' });
  const { category, year, query } = filters;
  const setCategory = (category: string) => setFilters((f) => ({ ...f, category }));
  const setYear = (year: string) => setFilters((f) => ({ ...f, year }));
  const setQuery = (query: string) => setFilters((f) => ({ ...f, query }));

  // Shareable-link support: hydrate filters from ?category=&year=&q= once on
  // mount. Deliberate one-time setState-in-effect — the page is statically
  // prerendered (no searchParams on the server), so the URL is only readable
  // here; useSearchParams would force the whole page behind a Suspense
  // fallback instead.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.get('category') && !p.get('year') && !p.get('q')) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters({
      category: p.get('category') ?? 'all',
      year: p.get('year') ?? 'all',
      query: p.get('q') ?? ''
    });
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (category !== 'all') p.set('category', category);
    if (year !== 'all') p.set('year', year);
    if (query) p.set('q', query);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [category, year, query]);

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

  const q = query.trim().toLowerCase();
  const results = sorted.filter((a) => {
    if (category !== 'all' && a.category !== category) return false;
    if (year !== 'all' && yearOf(a) !== year) return false;
    if (q && !(a.title + ' ' + (a.description ?? '') + ' ' + a.category).toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
  const filtering = category !== 'all' || year !== 'all' || q !== '';

  function clearFilters() {
    setCategory('all');
    setYear('all');
    setQuery('');
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
        {!filtering && sorted.length > 3 && (
          <section className={styles.featuredStrip} aria-label="Latest albums">
            <div className={styles.sectionDivider}>
              <span className={styles.divLabel}>Latest Albums</span>
              <span className={styles.divRule} aria-hidden="true" />
            </div>
            <div className={styles.featuredGrid}>
              {sorted.slice(0, 3).map((a) => (
                <AlbumCard key={`f-${a.id}`} album={a} wide />
              ))}
            </div>
          </section>
        )}

        {years.map((y) => {
          const inYear = results.filter((a) => yearOf(a) === y);
          if (inYear.length === 0) return null;
          return (
            <section key={y} className={styles.yearGroup} aria-label={`Albums from ${y}`}>
              <div className={styles.yearHeading}>
                <h2>{y}</h2>
                <span className={styles.yearCount}>
                  {inYear.length} album{inYear.length === 1 ? '' : 's'}
                </span>
                <span className={styles.yearRule} aria-hidden="true" />
              </div>
              <div className={styles.albumGrid}>
                {inYear.map((a) => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </div>
            </section>
          );
        })}

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
          <strong>Have photos to share?</strong>{' '}
          Albums are hosted on Google Photos so anyone at an event can contribute. Ask the
          Scoutmaster for the shared-album link after each outing &mdash; new albums appear here as
          they&rsquo;re added.
        </aside>
      </main>
    </>
  );
}
