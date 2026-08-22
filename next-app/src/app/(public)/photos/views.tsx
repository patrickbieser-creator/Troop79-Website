'use client';

/**
 * The four photo-library views (Patrick, 2026-08-22: "print shelf, timeline
 * spine, the ledger, and the almanac views as the four tabs with all of the
 * features brad suggested on each screen").
 *
 * One file rather than four, deliberately: they are four renderings of one
 * list, they share every helper, and splitting them would mean four files that
 * each import the same eight things to draw a few dozen lines of markup. All
 * the logic they disagree about already lives in lib/photo-views.ts.
 *
 * Every view preserves the four hard requirements — date, title, category,
 * chronology — because those are what Patrick asked the restyle to protect.
 */

import { useState } from 'react';
import {
  albumCategoryColor,
  almanacRows,
  dateParts,
  gapYearsAfter,
  groupByYear,
  isLedgerKey,
  monthYear,
  shortDate,
  shortMonthDay,
  sortLedger,
  yearOf,
  type LedgerKey,
  type PhotoViewAlbum,
  type SortDir
} from '@/lib/photo-views';
import type { CategoryColorMap } from '@/lib/calendar-categories';
import { AlbumCover, EXT_ICON } from './album-cover';
import styles from './photos.module.css';

interface ViewProps {
  albums: PhotoViewAlbum[];
  colors: CategoryColorMap;
}

/** Screen-reader label — every view links out to Google Photos, so every one
 *  has to say so rather than leaving a bare title as the link text. */
function ariaFor(a: PhotoViewAlbum): string {
  const bits = [a.title, a.category, shortDate(a.event_date)];
  if (a.photo_count) bits.push(`${a.photo_count} photos`);
  bits.push('Opens Google Photos in a new tab');
  return bits.join('. ');
}

function YearHeading({ year, count }: { year: string; count: number }) {
  return (
    <div className={styles.yearHeading}>
      <h2>{year}</h2>
      <span className={styles.yearCount}>
        {count} album{count === 1 ? '' : 's'}
      </span>
      <span className={styles.yearRule} aria-hidden="true" />
    </div>
  );
}

// ── 1 · Print Shelf ─────────────────────────────────────────────────────────

/* Fixed rotations rather than random: a prototype that re-tilts on every
   render looks broken, and Math.random() in a component body would also
   differ between server and client. Index-based keeps a shelf stable. */
const TILTS = ['-1.1deg', '0.8deg', '-0.5deg', '1.3deg', '-0.9deg', '0.6deg'];

/**
 * An album as a stack of prints, not a news card — the concept that fixes
 * "album cards and news cards are the same recipe". The stack silhouette is
 * two pseudo-elements behind the cover; the sticker is the category.
 *
 * Patrick, 2026-08-22: title and date go on SEPARATE LINES, not run together
 * on one meta line.
 */
export function PrintShelf({ albums, colors }: ViewProps) {
  return (
    <>
      {groupByYear(albums).map((group) => (
        <section key={group.year} className={styles.shelfYear} aria-label={`Albums from ${group.year}`}>
          <YearHeading year={group.year} count={group.albums.length} />
          <div className={styles.prints}>
            {group.albums.map((a, i) => (
              <a
                key={a.id}
                className={styles.print}
                href={a.google_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={ariaFor(a)}
                /* dynamic: per-card tilt and the category's own colour */
                style={{ '--tilt': TILTS[i % TILTS.length], '--cat': albumCategoryColor(colors, a.category) } as React.CSSProperties}
              >
                <span className={styles.printSticker}>{a.category}</span>
                <AlbumCover url={a.cover_url} alt={a.cover_alt} className={styles.printCover} showBadge={false} />
                <span className={styles.printCaption}>
                  <span className={styles.printDate}>{shortDate(a.event_date)}</span>
                  <span className={styles.printTitle}>{a.title}</span>
                  <span className={styles.printFoot}>
                    <span>{a.photo_count ? `${a.photo_count.toLocaleString()} photos` : 'Google Photos'}</span>
                    <span className={styles.printGo}>View &rarr;</span>
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ── 2 · Timeline Spine ──────────────────────────────────────────────────────

/**
 * Time drawn as a rail rather than implied by grouping — the strongest of the
 * four on chronology, and the only one that shows the troop's GAPS. The live
 * library has no albums at all for 2023 or 2024; year headings hide that
 * completely because an empty year never renders one.
 */
export function TimelineSpine({ albums, colors }: ViewProps) {
  return (
    <div className={styles.spine}>
      {groupByYear(albums).map((group) => {
        const gaps = gapYearsAfter(albums, group.year);
        return (
          <div key={group.year}>
            <div className={styles.spineYear}>
              <h2>
                {group.year}
                <span className={styles.yearCount}>
                  {group.albums.length} album{group.albums.length === 1 ? '' : 's'}
                </span>
              </h2>
              <span className={styles.spineYearRule} aria-hidden="true" />
            </div>

            {group.albums.map((a) => {
              const { month, day } = shortMonthDay(a.event_date);
              return (
                <a
                  key={a.id}
                  className={styles.spineRow}
                  href={a.google_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={ariaFor(a)}
                  /* dynamic: the category's own colour */
                  style={{ '--cat': albumCategoryColor(colors, a.category) } as React.CSSProperties}
                >
                  <span className={styles.spineDate} aria-hidden="true">
                    <span className={styles.spineMon}>{month}</span>
                    <span className={styles.spineDay}>{day}</span>
                  </span>
                  <AlbumCover url={a.cover_url} alt={a.cover_alt} className={styles.spineThumb} showBadge={false} />
                  <span className={styles.spineText}>
                    <span className={styles.spineTitle}>{a.title}</span>
                    <span className={styles.spineMeta}>
                      <span className={styles.catDot} aria-hidden="true" />
                      <span>{a.category}</span>
                      {a.photo_count ? <span className={styles.spineNum}>{a.photo_count.toLocaleString()} photos</span> : null}
                    </span>
                  </span>
                  {/* Descriptions come back on the TIMELINE ONLY (Patrick,
                      2026-08-22). They were on every card in the legacy design;
                      Prints has no room for them beside a cover, the Ledger
                      trades prose for scanability, and the Almanac's cells are
                      already narrow. A row on a rail is the one shape with a
                      column to spare. Dropped below 640px — see the stylesheet. */}
                  <span className={styles.spineDesc}>{a.description ?? ''}</span>
                  <span className={styles.spineGo}>View album &rarr;</span>
                </a>
              );
            })}

            {gaps.length > 0 && (
              <p className={styles.spineGap}>
                No albums posted for <strong>{gaps.join(' or ')}</strong> &mdash; the rail keeps
                going so the gap is visible rather than invisible.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 3 · The Ledger ──────────────────────────────────────────────────────────

const LEDGER_COLUMNS: { key: LedgerKey; label: string; numeric?: boolean }[] = [
  { key: 'date', label: 'Date' },
  { key: 'title', label: 'Album' },
  { key: 'category', label: 'Category' },
  { key: 'photos', label: 'Photos', numeric: true }
];

/**
 * A real sortable table with no images at all — the only view that stays good
 * if the library triples, and the one that costs ZERO image bytes. It is also
 * the accessible answer: a table with proper headers and aria-sort beats a
 * grid of links for anyone scanning rather than browsing.
 *
 * Year separator rows appear ONLY while the table is in date order. That is
 * how chronology stays defended under sorting: once you sort by photo count,
 * a "2025" band would be a lie.
 */
export function Ledger({ albums, colors }: ViewProps) {
  const [key, setKey] = useState<LedgerKey>('date');
  const [dir, setDir] = useState<SortDir>('desc');

  const sorted = sortLedger(albums, key, dir);
  const grouped = key === 'date';
  const maxCount = Math.max(1, ...albums.map((a) => a.photo_count ?? 0));

  function toggle(next: string) {
    if (!isLedgerKey(next)) return;
    if (next === key) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setKey(next);
      // Dates and counts are most useful biggest/newest first; words are most
      // useful A–Z. Picking the right default per column saves a second click.
      setDir(next === 'title' || next === 'category' ? 'asc' : 'desc');
    }
  }

  /* Year bands are computed BEFORE the JSX rather than by mutating a variable
     inside .map() — reassigning during render is a real correctness hazard
     (React may re-run the callback), and the linter is right to reject it. */
  type LedgerItem =
    | { kind: 'band'; year: string; count: number }
    | { kind: 'row'; album: PhotoViewAlbum };
  const items: LedgerItem[] = [];
  {
    let lastYear: string | null = null;
    for (const a of sorted) {
      if (grouped && yearOf(a) !== lastYear) {
        lastYear = yearOf(a);
        items.push({ kind: 'band', year: lastYear, count: sorted.filter((x) => yearOf(x) === lastYear).length });
      }
      items.push({ kind: 'row', album: a });
    }
  }

  return (
    <div className={styles.ledgerWrap}>
      <table className={styles.ledger}>
        <caption className={styles.srOnly}>
          Troop 79 photo albums, {sorted.length} rows. Sortable by date, album, category or photo
          count. Every album opens on Google Photos in a new tab.
        </caption>
        <thead>
          <tr>
            {LEDGER_COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? styles.num : undefined}
                aria-sort={key === col.key ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
              >
                <button type="button" onClick={() => toggle(col.key)}>
                  {col.label}
                  {key === col.key && (
                    <span aria-hidden="true" className={styles.sortCaret}>
                      {dir === 'desc' ? '▾' : '▴'}
                    </span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            if (item.kind === 'band') {
              return (
                <tr key={`y${item.year}`} className={styles.ledYear}>
                  <td colSpan={4}>
                    {item.year}
                    <span className={styles.yearCount}>
                      {item.count} album{item.count === 1 ? '' : 's'}
                    </span>
                  </td>
                </tr>
              );
            }
            const a = item.album;
            return (
              <tr
                key={a.id}
                className={styles.ledRow}
                /* dynamic: the category's own colour, from calendar_categories */
                style={{ '--cat': albumCategoryColor(colors, a.category) } as React.CSSProperties}
              >
                <td className={styles.ledDate}>{shortDate(a.event_date)}</td>
                <td>
                  <a
                    className={styles.ledTitle}
                    href={a.google_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={ariaFor(a)}
                  >
                    {a.title} {EXT_ICON}
                  </a>
                </td>
                <td>
                  <span className={styles.ledCat}>
                    <span className={styles.catDot} aria-hidden="true" />
                    {a.category}
                  </span>
                </td>
                <td className={styles.num}>
                  {a.photo_count ? (
                    <span className={styles.ledBarWrap}>
                      <span
                        className={styles.ledBar}
                        aria-hidden="true"
                        /* dynamic: bar length is proportional to the photo count */
                        style={{ width: `${Math.max(3, Math.round((a.photo_count / maxCount) * 100))}%` }}
                      />
                      <span className={styles.ledNum}>{a.photo_count.toLocaleString()}</span>
                    </span>
                  ) : (
                    <span className={styles.ledNum}>&mdash;</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 4 · The Almanac ─────────────────────────────────────────────────────────

/**
 * Years down, quarters across — two axes at once, so the troop's year is
 * readable as a rhythm rather than a list. Summer camp every July, a court of
 * honor every autumn; and the empty rows say the rest.
 *
 * Columns are CALENDAR QUARTERS labelled with their months (see SEASONS in
 * lib/photo-views.ts): true seasons read better but would file a September
 * court of honor under "Summer" and break the left-to-right reading of time.
 */
export function Almanac({ albums, colors }: ViewProps) {
  const rows = almanacRows(albums);
  return (
    <div className={styles.almanacWrap}>
      <table className={styles.almanac}>
        <caption className={styles.srOnly}>
          Troop 79 albums by year and quarter. Years run newest first down the table; quarters run
          in calendar order across it. Every album opens on Google Photos in a new tab.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles.almYr}>
              Year
            </th>
            {rows[0]?.cells.map((c) => (
              <th key={c.season.key} scope="col">
                {c.season.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year} className={row.count === 0 ? styles.almGapRow : undefined}>
              <th scope="row" className={styles.almYr}>
                {row.year}
                <small>
                  {row.count} album{row.count === 1 ? '' : 's'}
                </small>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.season.key}>
                  {cell.albums.length === 0 ? (
                    <span className={styles.almNone} aria-hidden="true">
                      &mdash;
                    </span>
                  ) : (
                    cell.albums.map((a) => (
                      <a
                        key={a.id}
                        className={styles.almItem}
                        href={a.google_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={ariaFor(a)}
                        /* dynamic: the category's own colour */
                        style={{ '--cat': albumCategoryColor(colors, a.category) } as React.CSSProperties}
                      >
                        <span className={styles.almDay}>
                          {shortMonthDay(a.event_date).month} {dateParts(a.event_date).day}
                        </span>
                        <span className={styles.almTitle}>{a.title}</span>
                        {a.photo_count ? (
                          <span className={styles.almNum}>{a.photo_count.toLocaleString()} photos</span>
                        ) : null}
                      </a>
                    ))
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.almNote}>
        Columns are calendar quarters. {monthYear(albums[0]?.event_date ?? '2026-01-01')} is the
        newest album on file.
      </p>
    </div>
  );
}
