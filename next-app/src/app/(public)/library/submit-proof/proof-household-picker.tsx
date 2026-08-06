'use client';

import { useMemo, useState } from 'react';
import type { Household } from '@/lib/households';
import styles from '../library.module.css';

/**
 * "Find yourself" for proof submission — deliberately its own small
 * component (not a shared import of /profile's ProfileHouseholdPicker) per
 * this project's established convention of one thin component per route
 * rather than cross-route imports (see submit/actions.ts's libraryGateAction
 * comment). The underlying session IS shared (lib/profile-household-session.ts)
 * so a family recognized on /profile is recognized here automatically —
 * this picker only renders when that cookie is missing.
 */
export default function ProofHouseholdPicker({
  households,
  target,
  pickHouseholdAction
}: {
  households: Household[];
  target?: string;
  pickHouseholdAction: (formData: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return households
      .filter((h) => h.scouts.length > 0) // only households with a scout can submit proof
      .flatMap((h) => [
        ...h.scouts.map((s) => ({ household: h, rowKey: `s:${s.id}`, name: s.displayName })),
        ...h.adults.map((a) => ({ household: h, rowKey: `a:${a.key}`, name: a.name }))
      ])
      .filter((p) => `${p.name} ${p.household.label}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, households]);

  return (
    <div className={styles.formCard}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
        Whose household?
      </h2>
      <label className={styles.fieldLabel} htmlFor="proof-person-search">
        Your name, or your scout&rsquo;s name
      </label>
      <input
        id="proof-person-search"
        type="search"
        className={styles.textInput}
        autoComplete="off"
        placeholder="Start typing a name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className={styles.fieldHint}>
        Picking anyone brings up your whole household. You&rsquo;ll stay recognized on this
        device until you switch households or sign out.
      </p>

      {query.trim().length >= 2 && (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 6 }}>
          {matches.length === 0 && (
            <li className={styles.fieldHint}>
              No one by that name with a scout in the troop. Check the spelling, or ask a leader.
            </li>
          )}
          {matches.map(({ household, rowKey, name }) => (
            <li key={rowKey}>
              <form action={pickHouseholdAction}>
                <input type="hidden" name="householdKey" value={household.key} />
                {target && <input type="hidden" name="target" value={target} />}
                <button type="submit" className={styles.btnSecondary} style={{ width: '100%', textAlign: 'left' }}>
                  <strong>{name}</strong> — {household.label} household
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
