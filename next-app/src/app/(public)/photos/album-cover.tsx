'use client';

/* eslint-disable @next/next/no-img-element -- Bunny CDN covers, plain img with onError fallback */

/**
 * One album cover, shared by every view that shows an image (Prints, Timeline).
 * Extracted from albums-browser.tsx when the four-view shell landed so the
 * broken-image fallback and the monogram exist once rather than per view.
 *
 * `loading="lazy"` matters more here than usual: the covers are 1–4 MB PNG
 * screenshots today (Plans/Photo-Thumbnails.md), and Prints is the DEFAULT
 * tab. Until that plan ships, lazy-loading below the fold is the only thing
 * standing between a visitor and 60 MB.
 *
 * `safeImageUrl` percent-encodes a raw space in a Bunny-synced URL
 * (`Klondike Team-….jpg` never loaded) — idempotent on an encoded one.
 */

import { useState } from 'react';
import { safeImageUrl } from '@/lib/photo-backfill';
import styles from './photos.module.css';

export const EXT_ICON = (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zm-9 0H3v18h18v-9h-2v7H5V5h7V3z" />
  </svg>
);

export function AlbumCover({
  url,
  alt,
  className,
  showBadge = true
}: {
  url: string | null;
  alt: string | null;
  className?: string;
  showBadge?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const hasCover = url && !broken;
  return (
    <span className={`${styles.albumCover} ${hasCover ? '' : styles.noCover} ${className ?? ''}`}>
      {hasCover ? (
        <img src={safeImageUrl(url) ?? undefined} alt={alt ?? ''} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className={styles.monogram} aria-hidden="true">
          <span className={styles.mono79}>79</span>
          <span className={styles.monoLabel}>Troop Album</span>
        </span>
      )}
      {showBadge && <span className={styles.gpBadge}>{EXT_ICON} Google Photos</span>}
    </span>
  );
}
