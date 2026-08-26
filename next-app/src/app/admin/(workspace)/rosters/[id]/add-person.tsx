'use client';

/**
 * Add someone to an event roster by hand.
 *
 * The gap this closes: a leader could REMOVE a person from a signup but never
 * add one. Signups do not all arrive through the website — plenty come
 * verbally or by email, some people simply turn up on the day — so the roster
 * could be corrected downward and never upward, and a leader's only recourse
 * was to ask the family to go and fill the form in.
 *
 * Deliberately a small inline panel rather than a dialog: adding two or three
 * late names is a quick, repetitive job, and it should not cost a modal each
 * time. The picker stays open and the field re-focuses after each add.
 *
 * Anyone already on the roster is absent from the list — the server filters
 * them out. Someone previously REMOVED is offered, flagged "removed earlier —
 * will be restored": the action reinstates their original entry (capacity
 * re-checked, history intact), the same thing the Removed section's Restore
 * does. Hiding them here (the first design) read as "it only lets me add
 * once" (Patrick, 2026-08-21).
 */

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addSignupEntry } from '../../events/actions';
import { Button } from '../../../_components/button';
import styles from '../../events/events-admin.module.css';

export interface AddCandidate {
  personId: number;
  displayName: string;
  isScout: boolean;
  household: string | null;
  /** Removed from this roster earlier — adding REINSTATES the original entry. */
  removed: boolean;
}

type Participation = 'full' | 'driver_only' | 'contributor';

const PARTICIPATION_LABEL: Record<Participation, string> = {
  full: 'Attending',
  driver_only: 'Driving only',
  contributor: 'Donating only'
};

export function AddPerson({
  candidates,
  signupId,
  calendarEntryId,
  onAddGuest,
  guestDisabled = false
}: {
  candidates: AddCandidate[];
  signupId: number;
  calendarEntryId: number;
  /** Opens the roster's Add-a-guest dialog (RosterTable owns it) — the
   *  button lives here beside "+ Add a scout or adult" (Patrick, 2026-08-25). */
  onAddGuest?: () => void;
  guestDisabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [participation, setParticipation] = useState<Participation>('full');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!needle) return [];
    return candidates.filter((c) => c.displayName.toLowerCase().includes(needle)).slice(0, 8);
  }, [candidates, needle]);

  function add(c: AddCandidate) {
    setError(null);
    setAdded(null);
    setBusy(c.personId);
    start(async () => {
      const res = await addSignupEntry(signupId, calendarEntryId, c.personId, participation);
      setBusy(null);
      if (!res.ok) {
        setError(res.error ?? 'Could not add them.');
        return;
      }
      // Stay open and clear the box — late additions come in twos and threes.
      setAdded(c.displayName);
      setQ('');
      searchRef.current?.focus();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Someone missing?</h2>
          <div>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(true);
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              + Add a scout or adult
            </Button>
            {onAddGuest && (
              <>
                {' '}
                <Button variant="primary" onClick={onAddGuest} disabled={guestDisabled}>
                  + Add a guest
                </Button>
              </>
            )}
          </div>
        </div>
        <p className={styles.panelHint}>
          For the RSVPs that never reached the website &mdash; told to you at a meeting, sent by
          email, or someone who simply turned up.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Add a scout or adult</h2>
        <Button variant="primary" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>

      <p className={styles.panelHint}>
        They are added as if they had signed up &mdash; pricing, capacity and the waitlist all
        apply, so a full event will place them on the waitlist rather than over-fill.
      </p>

      <div className={styles.addRow}>
        <input
          ref={searchRef}
          type="search"
          className={styles.addInput}
          placeholder="Type a name…"
          aria-label="Find a person to add"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={styles.addInput}
          aria-label="How they are taking part"
          value={participation}
          onChange={(e) => setParticipation(e.target.value as Participation)}
        >
          {(Object.keys(PARTICIPATION_LABEL) as Participation[]).map((p) => (
            <option key={p} value={p}>
              {PARTICIPATION_LABEL[p]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className={styles.err}>{error}</p>}
      {added && <p className={styles.okNote}>Added {added}.</p>}

      {needle && shown.length === 0 && (
        <p className={styles.panelHint}>
          Nobody left to add matches &ldquo;{q}&rdquo; &mdash; anyone already on this roster is not
          listed. Only active roster people appear; someone brand new to the troop is added on
          the Roster page first.
        </p>
      )}

      <ul className={styles.addList}>
        {shown.map((c) => (
          <li key={c.personId}>
            <button
              type="button"
              className={styles.addPick}
              disabled={busy !== null}
              onClick={() => add(c)}
            >
              <span>{c.displayName}</span>
              <span className={styles.addMeta}>
                {c.isScout ? 'Scout' : 'Adult'}
                {c.household ? ` · ${c.household}` : ''}
                {c.removed ? ' · removed earlier — will be restored' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
