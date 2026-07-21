'use client';

import { useMemo, useState } from 'react';
import type { Household } from '@/lib/households';
import styles from './profile.module.css';

/**
 * "Find yourself" for /profile — deliberately its own small component rather
 * than Event Signup's household-picker.tsx (Plans/Scout-Self-Service-Demographics.md).
 * That component's selection is carried in the event page's URL; here the
 * pick needs to be POSTED to a server action so it can be bound into the
 * t79_profile_household cookie (lib/profile-household-session.ts) and
 * remembered on return visits. Same search UX, different write path.
 */
export default function ProfileHouseholdPicker({
  households,
  pickHouseholdAction
}: {
  households: Household[];
  pickHouseholdAction: (formData: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return households
      .flatMap((h) => [
        ...h.scouts.map((s) => ({ household: h, rowKey: `s:${s.id}`, name: s.displayName })),
        ...h.adults.map((a) => ({ household: h, rowKey: `a:${a.key}`, name: a.name }))
      ])
      .filter((p) => `${p.name} ${p.household.label}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, households]);

  return (
    <div className={styles.picker}>
      <label className={styles.gateLabel} htmlFor="profile-person-search">
        Your name, or your scout&rsquo;s name
      </label>
      <input
        id="profile-person-search"
        type="search"
        className={styles.gateInput}
        autoComplete="off"
        placeholder="Start typing a name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className={styles.pickerHint}>
        Picking anyone brings up your whole household. You&rsquo;ll stay logged in as this
        household on this device until you log out.
      </p>

      {query.trim().length >= 2 && (
        <ul className={styles.pickerResults}>
          {matches.length === 0 && (
            <li className={styles.pickerNone}>
              No one by that name. Check the spelling, or ask a leader to add you to the roster.
            </li>
          )}
          {matches.map(({ household, rowKey, name }) => (
            <li key={rowKey}>
              <form action={pickHouseholdAction}>
                <input type="hidden" name="householdKey" value={household.key} />
                <button type="submit" className={styles.pickerBtn}>
                  <span className={styles.pickerName}>{name}</span>
                  <span className={styles.pickerMeta}>
                    {household.scouts.length === 0
                      ? 'Your own profile'
                      : `${household.label} household`}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
