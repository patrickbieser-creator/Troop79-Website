'use client';

/**
 * Card shell for Lookups tables (Patrick, 2026-07-12: tables got long).
 * Collapsed: card sits in the 2-col grid and its editor shows 15 rows.
 * Expanded: card spans the full content width and the editor shows every
 * row inside a scrollable region — the "spread out to actually edit" mode.
 * The editor learns the state through LookupCardContext (via useLookupTable).
 */

import { createContext, useContext, useState } from 'react';
import styles from './lookups.module.css';

export const LookupCardContext = createContext<{ expanded: boolean }>({ expanded: false });

export function useLookupCard() {
  return useContext(LookupCardContext);
}

export function LookupCard({
  title,
  sub,
  single,
  children
}: {
  title: string;
  sub?: string;
  /** The card is the whole screen (?card=<id>): expanded, and the page title carries its name and line. */
  single?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (single) {
    return (
      <div className={styles.card}>
        <LookupCardContext.Provider value={{ expanded: true }}>{children}</LookupCardContext.Provider>
      </div>
    );
  }
  return (
    <div className={`${styles.card} ${expanded ? styles.cardExpanded : ''}`}>
      <div className={styles.cardHead}>
        <h3>{title}</h3>
        <button
          type="button"
          className={styles.expandBtn}
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? '⤡ Collapse' : '⤢ Expand'}
        </button>
      </div>
      {sub && <p className={styles.cardSub}>{sub}</p>}
      <LookupCardContext.Provider value={{ expanded }}>{children}</LookupCardContext.Provider>
    </div>
  );
}
