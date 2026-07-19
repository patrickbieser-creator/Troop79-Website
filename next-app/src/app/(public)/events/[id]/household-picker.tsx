'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Household } from '@/lib/households';
import styles from './event-detail.module.css';

/*
 * "Find your scout" — type a name, pick a household.
 *
 * Picking any scout brings up the whole household (siblings and parents), so
 * one signup covers the family. Households are derived from shared parent
 * email (lib/households.ts), which is why a blended family like
 * Kingston + Barry resolves to one household despite different surnames.
 *
 * Selection is carried in the URL (?household=<scoutId>) rather than client
 * state, so the chosen household survives a reload and the form can be
 * server-rendered with that household's existing entries.
 */
export default function HouseholdPicker({
  households,
  eventId
}: {
  households: Household[];
  eventId: number;
}) {
  const [query, setQuery] = useState('');
  const router = useRouter();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return households
      .flatMap((h) => h.scouts.map((s) => ({ household: h, scout: s })))
      .filter(({ scout, household }) =>
        `${scout.displayName} ${household.label}`.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, households]);

  return (
    <div className={styles.picker}>
      <label className={styles.gateLabel} htmlFor="scout-search">
        Your scout’s name
      </label>
      <input
        id="scout-search"
        type="search"
        className={styles.gateInput}
        autoComplete="off"
        placeholder="Start typing a name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className={styles.pickerHint}>
        Picking any scout brings up your whole household — siblings and parents included — so one
        signup covers the family.
      </p>

      {query.trim().length >= 2 && (
        <ul className={styles.pickerResults}>
          {matches.length === 0 && (
            <li className={styles.pickerNone}>
              No scout by that name. Check the spelling, or ask a leader to add your scout to the
              roster.
            </li>
          )}
          {matches.map(({ household, scout }) => (
            <li key={scout.id}>
              <button
                type="button"
                className={styles.pickerBtn}
                onClick={() =>
                  router.push(`/events/${eventId}?household=${encodeURIComponent(household.key)}`)
                }
              >
                <span className={styles.pickerName}>{scout.displayName}</span>
                <span className={styles.pickerMeta}>
                  {household.scouts.length > 1
                    ? `${household.label} household · ${household.scouts.length} scouts`
                    : `${household.label} household`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
