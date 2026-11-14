'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/app/_components/badge';
import { HEALTH_STANDING_LABEL, HEALTH_STANDING_TONE, needsAttention, type HealthStanding } from '@/lib/health-records';
import styles from './health.module.css';

/**
 * The leader's list on a phone (Plans/Health-Forms.md, release 2): search first, then All or Needs attention.
 * Names and standings only; a person's record opens on its own page, where the opening is logged.
 */
export interface RosterPerson {
  personId: number;
  name: string;
  isScout: boolean;
  standing: HealthStanding;
}

export function HealthRoster({ people, query }: { people: RosterPerson[]; query: string }) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const words = q.trim().toLowerCase();
  const shown = people.filter((p) => (!only || needsAttention(p.standing)) && (!words || p.name.toLowerCase().includes(words)));
  const attention = people.filter((p) => needsAttention(p.standing)).length;

  return (
    <div>
      <div className={styles.tools}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by name…"
          aria-label="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQ('');
          }}
        />
        <div className={styles.filter} role="group" aria-label="Show">
          <button type="button" className={styles.filterBtn} aria-pressed={!only} onClick={() => setOnly(false)}>
            All ({people.length})
          </button>
          <button type="button" className={styles.filterBtn} aria-pressed={only} onClick={() => setOnly(true)}>
            Needs attention ({attention})
          </button>
        </div>
      </div>
      <p className={styles.count} role="status">
        {shown.length} of {people.length}
      </p>
      {shown.length === 0 ? (
        <p className={styles.empty}>{people.length === 0 ? 'Nobody is signed up yet.' : 'Nobody matches.'}</p>
      ) : (
        <ul className={styles.roster}>
          {shown.map((p) => (
            <li key={p.personId}>
              <Link href={`/health/${p.personId}${query}`} className={styles.rosterRow}>
                <span className={styles.rosterName}>
                  {p.name}
                  <span className={styles.rosterKind}>{p.isScout ? 'Scout' : 'Adult'}</span>
                </span>
                <Badge tone={HEALTH_STANDING_TONE[p.standing]}>{HEALTH_STANDING_LABEL[p.standing]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
