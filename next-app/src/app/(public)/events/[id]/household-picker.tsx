'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Household } from '@/lib/households';
import styles from './event-detail.module.css';

/*
 * "Find yourself" — type a name, pick a household.
 *
 * Searches SCOUTS AND ADULTS. Matching only scouts meant an adult with no
 * active scout — a committee member, a merit badge counselor, the parent of a
 * scout who aged out — had no way to reach the form at all, even though
 * signup_entries has always been able to record them (see lib/households.ts
 * for the three sources that feed this list).
 *
 * Picking any person brings up their whole household (siblings and parents), so
 * one signup covers the family. An adult with no scout in the troop is a
 * household of one and lands on the same form.
 *
 * Selection is carried in the URL (?household=<key>) rather than client state,
 * so the choice survives a reload and the form can be server-rendered with that
 * household's existing entries.
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
      .flatMap((h) => [
        ...h.scouts.map((s) => ({
          household: h,
          rowKey: `s:${s.id}`,
          name: s.displayName,
          isScout: true
        })),
        ...h.adults.map((a) => ({
          household: h,
          rowKey: `a:${a.key}`,
          name: a.name,
          isScout: false
        }))
      ])
      .filter((p) => `${p.name} ${p.household.label}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, households]);

  return (
    <div className={styles.picker}>
      <label className={styles.gateLabel} htmlFor="person-search">
        Your name, or your scout&rsquo;s name
      </label>
      <input
        id="person-search"
        type="search"
        className={styles.gateInput}
        autoComplete="off"
        placeholder="Start typing a name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className={styles.pickerHint}>
        Picking anyone brings up the whole household — siblings and parents included — so one
        signup covers the family. Adults without a scout in the troop can sign themselves up.
      </p>

      {query.trim().length >= 2 && (
        <ul className={styles.pickerResults}>
          {matches.length === 0 && (
            <li className={styles.pickerNone}>
              No one by that name. Check the spelling, or ask a leader to add you to the roster.
            </li>
          )}
          {matches.map(({ household, rowKey, name, isScout }) => (
            <li key={rowKey}>
              <button
                type="button"
                className={styles.pickerBtn}
                onClick={() =>
                  router.push(`/events/${eventId}?household=${encodeURIComponent(household.key)}`)
                }
              >
                <span className={styles.pickerName}>{name}</span>
                <span className={styles.pickerMeta}>
                  {household.scouts.length === 0
                    ? 'Signing up on your own'
                    : isScout && household.scouts.length > 1
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
