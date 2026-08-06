'use client';

import { useMemo, useState } from 'react';
import styles from '../library.module.css';

/**
 * Scout-picker for the shared scout admin login (D-037's accepted trust
 * model — no per-scout identity exists at that session layer, so this is a
 * courtesy picker, not a binding proof; the leader reviewing the submission
 * is the actual check). Local UI state only, unlike the family path's
 * household cookie — a scout picks fresh every visit, deliberately, since
 * one shared login could be any scout in the troop.
 *
 * Renders inline INSIDE the page's <form action={submitProofAction}> rather
 * than posting its own — picking a scout doesn't need a server round trip.
 */
export default function ScoutRosterPicker({
  scouts,
  children
}: {
  scouts: { id: string; displayName: string }[];
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ id: string; displayName: string } | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return scouts.filter((s) => s.displayName.toLowerCase().includes(q)).slice(0, 8);
  }, [query, scouts]);

  if (selected) {
    return (
      <>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Scout</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong>{selected.displayName}</strong>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setSelected(null)}
              style={{ padding: '4px 12px', fontSize: 12 }}
            >
              Change
            </button>
          </div>
        </div>
        <input type="hidden" name="scoutId" value={selected.id} />
        {children}
      </>
    );
  }

  return (
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel} htmlFor="scout-roster-search">
        Which scout is this for?
      </label>
      <input
        id="scout-roster-search"
        type="search"
        className={styles.textInput}
        autoComplete="off"
        placeholder="Start typing a name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim().length >= 1 && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 4 }}>
          {matches.length === 0 && (
            <li className={styles.fieldHint}>No active scout by that name.</li>
          )}
          {matches.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setSelected(s)}
              >
                {s.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
