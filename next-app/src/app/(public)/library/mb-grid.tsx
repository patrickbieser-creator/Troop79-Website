'use client';

/**
 * The library's "Browse by Merit Badge" grid, with the Resources / Progress
 * toggle (Patrick, 2026-08-22).
 *
 * WHY IT BECAME A CLIENT COMPONENT: the tiles are unchanged — the toggle is
 * the only interactive part, and it needs state. Everything the tiles show is
 * computed on the server and handed down as plain numbers, so the payload is
 * two small maps rather than the badge rows.
 *
 * THE PATTERN IS BORROWED, not reinvented: one URL param so a chosen view is
 * shareable, one localStorage key so it is remembered, both hydrated in a
 * single mount effect. Same shape as the photo library's view tabs
 * (photos/albums-browser.tsx, v1.77.0) — the problem was solved two hours
 * earlier and there was no reason to solve it differently.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtDate, fmtMonthYear } from '@/lib/format-date';
import { TabStrip } from '@/app/_components/tab-strip';
import { SectionDivider } from '@/app/_components/section-divider';
import {
  DEFAULT_MB_GRID_MODE,
  MB_GRID_MODES,
  MB_GRID_MODE_LABELS,
  isMbGridMode,
  mbGridCaption,
  type MbGridMode
} from '@/lib/mb-scout-progress';
import styles from './library.module.css';

const MODE_STORAGE_KEY = 'troop79.library.mbGrid';

export interface MbTile {
  id: string;
  name: string;
  eagle: boolean;
  /** Resources shelved for this badge (whole-badge + per-requirement). */
  resources: number;
  /** Active scouts who have earned it. */
  earned: number;
  /** The viewing scout's own award date, when a scout is being viewed. */
  awardDate: string | null;
  href: string;
}

export function MbGrid({ tiles }: { tiles: MbTile[] }) {
  const [mode, setMode] = useState<MbGridMode>(DEFAULT_MB_GRID_MODE);

  useEffect(() => {
    const urlMode = new URLSearchParams(window.location.search).get('mb');
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage — the default is fine.
    }
    const next = isMbGridMode(urlMode) ? urlMode : isMbGridMode(stored) ? stored : DEFAULT_MB_GRID_MODE;
    if (next === DEFAULT_MB_GRID_MODE) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(next);
  }, []);

  function choose(next: MbGridMode) {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Remembering the mode is a convenience, not a feature.
    }
    /* Preserve whatever else is in the query (?viewScout=, a search) rather
       than replacing it — this grid is one section of a busier page. */
    const p = new URLSearchParams(window.location.search);
    if (next === DEFAULT_MB_GRID_MODE) p.delete('mb');
    else p.set('mb', next);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }

  return (
    <>
      <SectionDivider label="Browse by Merit Badge" />

      <div className={styles.mbToggleRow}>
        <TabStrip
          ariaLabel="What the number on each merit badge shows"
          activeKey={mode}
          items={MB_GRID_MODES.map((m) => ({
            key: m,
            label: MB_GRID_MODE_LABELS[m],
            onSelect: () => choose(m)
          }))}
        />
        <p className={styles.mbToggleCaption} aria-live="polite">
          {mbGridCaption(mode)}
        </p>
      </div>

      <div className={styles.mbGrid}>
        {tiles.map((tile) => {
          const n = mode === 'progress' ? tile.earned : tile.resources;
          return (
            <Link
              key={tile.id}
              className={`${styles.mbTile} ${tile.awardDate ? styles.mbTileCompleted : ''}`}
              href={tile.href}
              // Redundant with the always-visible date caption below —
              // native hover tooltip on top of it for a desktop mouse-over,
              // per the ask, but the date is never hover-only (D-069: title
              // text is invisible on touch, and this is a completion date on
              // an otherwise-anonymous-looking tile, not decoration).
              title={
                tile.awardDate
                  ? `Completed ${fmtDate(tile.awardDate)}`
                  : undefined
              }
            >
              {tile.awardDate ? (
                <span className={styles.mbNameCompleted}>
                  <span>
                    {tile.name}
                    {tile.eagle && <span className={styles.eagleDot}> ★ EAGLE</span>}
                  </span>
                  <span className={styles.mbCompletedDate}>
                    ✓ Completed{' '}
                    {fmtMonthYear(tile.awardDate)}
                  </span>
                </span>
              ) : (
                <span className={styles.mbName}>
                  {tile.name}
                  {tile.eagle && <span className={styles.eagleDot}> ★ EAGLE</span>}
                </span>
              )}
              <span
                className={`${styles.mbCount} ${n === 0 ? styles.mbCountZero : ''}`}
                title={
                  mode === 'progress'
                    ? `${n} scout${n === 1 ? '' : 's'} earned`
                    : `${n} resource${n === 1 ? '' : 's'}`
                }
              >
                {n === 0 ? '—' : n}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
