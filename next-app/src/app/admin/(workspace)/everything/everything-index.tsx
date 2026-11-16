'use client';

/**
 * Everything A–Z (Plans/Admin-Portal-Nav.md decision 9): every item this person can open, alphabetically, in columns.
 * Plain names, no type or group tags. Type filter (All · Screens · Reports · Actions · Setup), a filter box, and a
 * letter jump bar.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SegmentedControl } from '../_components/segmented-control';
import { SearchField } from '../_components/search-field';
import type { FeatureKind } from '../_components/feature-registry';
import { azGroups, type AzEntry } from './az';
import styles from './everything.module.css';

type TypeFilter = 'all' | FeatureKind;

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'screen', label: 'Screens' },
  { value: 'report', label: 'Reports' },
  { value: 'action', label: 'Actions' },
  { value: 'setup', label: 'Setup' }
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function EverythingIndex({ entries }: { entries: AzEntry[] }) {
  const [type, setType] = useState<TypeFilter>('all');
  const [q, setQ] = useState('');
  const groups = useMemo(() => azGroups(entries, { kind: type === 'all' ? null : type, q }), [entries, type, q]);
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  const present = new Set(groups.map((g) => g.letter));

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <SegmentedControl name="az-type" label="Show" value={type} options={TYPE_OPTIONS} onChange={setType} />
        <SearchField value={q} onChange={setQ} label="Filter by name" placeholder="Filter by name…" resultCount={shown} totalCount={entries.length} />
      </div>
      <nav className={styles.letters} aria-label="Jump to letter">
        {LETTERS.map((l) =>
          present.has(l) ? (
            <a key={l} href={`#az-${l}`} className={styles.letter}>
              {l}
            </a>
          ) : (
            <span key={l} className={styles.letterOff} aria-hidden="true">
              {l}
            </span>
          )
        )}
      </nav>
      {groups.length === 0 ? <p className={styles.empty}>Nothing matches. Clear the filter to see everything.</p> : null}
      <div className={styles.columns}>
        {groups.map((g) => (
          <section key={g.letter} className={styles.group} aria-labelledby={`az-${g.letter}`}>
            <h2 id={`az-${g.letter}`} className={styles.groupLetter}>
              {g.letter}
            </h2>
            <ul className={styles.list}>
              {g.entries.map((e) => (
                <li key={e.key}>
                  <Link href={e.href} className={styles.entry}>
                    {e.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
