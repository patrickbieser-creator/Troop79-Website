'use client';

/**
 * The Roll Call sheet: check who was there, correct quantities, see how it
 * compares to the signup.
 *
 * Built for the way attendance is actually taken — a leader with a phone at the
 * back of a room, working down a list — so checking someone is one tap, the
 * list stays put, and nothing is behind a dialog.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AttendanceRow, AttendeeCandidate, CreditKind } from '@/lib/attendance-shared';
import { reconcileWithSignup } from '@/lib/attendance-shared';
import styles from './roll-call.module.css';

type Result = { ok: boolean; error?: string };

interface Props {
  entryId: number;
  entryTitle: string;
  creditKind: CreditKind | null;
  creditUnit: string | null;
  countsAsActivity: boolean;
  defaultQty: number;
  hasSignup: boolean;
  candidates: AttendeeCandidate[];
  attendance: AttendanceRow[];
  onMark: (entryId: number, personId: number, qty?: number | null) => Promise<Result>;
  onUnmark: (entryId: number, personId: number) => Promise<Result>;
  onSetQty: (entryId: number, personId: number, qty: number) => Promise<Result>;
  onSeed: (entryId: number) => Promise<Result & { added?: number }>;
}

const TAB_LABEL: Record<string, string> = {
  active_scout: 'Scouts',
  inactive_scout: 'Inactive scouts',
  leader: 'Leaders',
  adult: 'Adults'
};

export function RollCall({
  entryId,
  creditKind,
  creditUnit,
  countsAsActivity,
  defaultQty,
  hasSignup,
  candidates,
  attendance,
  onMark,
  onUnmark,
  onSetQty,
  onSeed
}: Props) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const byPerson = useMemo(() => {
    const m = new Map<number, AttendanceRow>();
    for (const a of attendance) m.set(a.personId, a);
    return m;
  }, [attendance]);

  const attended = useMemo(() => new Set(byPerson.keys()), [byPerson]);
  const { missedSignup, unexpected } = useMemo(
    () => reconcileWithSignup(candidates, attended),
    [candidates, attended]
  );

  const needle = q.trim().toLowerCase();
  const shown = candidates.filter(
    (c) => !needle || c.displayName.toLowerCase().includes(needle) || (c.scoutId ?? '').toLowerCase().includes(needle)
  );

  // Present first — once roll call is under way, the useful view is who you
  // have, not the whole roster in alphabetical order.
  const groups = useMemo(() => {
    const out = new Map<string, AttendeeCandidate[]>();
    for (const c of shown) {
      const key = TAB_LABEL[c.tab] ?? 'Other';
      const list = out.get(key) ?? [];
      list.push(c);
      out.set(key, list);
    }
    return [...out.entries()];
  }, [shown]);

  function run(personId: number, fn: () => Promise<Result>) {
    setErr(null);
    setBusy(personId);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) setErr(res.error ?? 'That did not save.');
      else router.refresh();
    });
  }

  function toggle(c: AttendeeCandidate, on: boolean) {
    run(c.personId, () =>
      on ? onMark(entryId, c.personId) : onUnmark(entryId, c.personId)
    );
  }

  function seed() {
    setErr(null);
    setBusy(-1);
    startTransition(async () => {
      const res = await onSeed(entryId);
      setBusy(null);
      if (!res.ok) setErr(res.error ?? 'Could not seed from the signup.');
      else router.refresh();
    });
  }

  const creditNote = creditKind
    ? `Marking someone present grants ${defaultQty} ${creditUnit ?? ''} in the ledger.`.replace(/\s+/g, ' ')
    : 'This category grants no ledger credit.';

  return (
    <>
      <div className={styles.summary}>
        <span className={styles.count}>
          <strong>{attended.size}</strong> present
        </span>
        <span className={styles.note}>
          {creditNote}
          {countsAsActivity
            ? ' Counts as a troop activity toward Second Class 1a and First Class 1a.'
            : ' Does not count as a troop activity — this is a meeting.'}
        </span>
        {hasSignup && (
          <button type="button" className={styles.seedBtn} onClick={seed} disabled={busy !== null}>
            {busy === -1 ? 'Seeding…' : 'Mark everyone who signed up'}
          </button>
        )}
      </div>

      {err && <div className={styles.error}>{err}</div>}

      {hasSignup && (missedSignup.length > 0 || unexpected.length > 0) && (
        <div className={styles.mismatch}>
          {missedSignup.length > 0 && (
            <p>
              <strong>{missedSignup.length} signed up but not marked present</strong> —{' '}
              {missedSignup.map((c) => c.displayName).join(', ')}. They may still owe for this
              event.
            </p>
          )}
          {unexpected.length > 0 && (
            <p>
              <strong>{unexpected.length} present who never signed up</strong> —{' '}
              {unexpected.map((c) => c.displayName).join(', ')}. Worth checking they were
              invoiced.
            </p>
          )}
        </div>
      )}

      <input
        type="search"
        className={styles.search}
        placeholder="Find a name…"
        aria-label="Find a person"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {groups.map(([label, people]) => (
        <section key={label} className={styles.group}>
          <h2 className={styles.groupHead}>
            {label}
            <span className={styles.groupCount}>
              {people.filter((p) => attended.has(p.personId)).length} / {people.length}
            </span>
          </h2>
          <ul className={styles.list}>
            {people.map((c) => {
              const row = byPerson.get(c.personId);
              const isHere = row !== undefined;
              return (
                <li key={c.personId} className={isHere ? styles.rowOn : styles.row}>
                  <label className={styles.name}>
                    <input
                      type="checkbox"
                      checked={isHere}
                      disabled={busy !== null}
                      onChange={(e) => toggle(c, e.target.checked)}
                    />
                    <span>{c.displayName}</span>
                    {c.signedUp && <span className={styles.pill}>signed up</span>}
                    {row?.source === 'import' && <span className={styles.pillMuted}>historical</span>}
                  </label>
                  {isHere && creditKind && creditUnit && creditUnit !== 'each' && (
                    <span className={styles.qty}>
                      <input
                        type="number"
                        min={0}
                        step={creditUnit === 'hours' ? 0.5 : 1}
                        value={row?.qty ?? defaultQty}
                        disabled={busy !== null}
                        aria-label={`${creditUnit} for ${c.displayName}`}
                        onChange={(e) =>
                          run(c.personId, () =>
                            onSetQty(entryId, c.personId, Number(e.target.value))
                          )
                        }
                      />
                      {creditUnit}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {shown.length === 0 && <p className={styles.empty}>Nobody matches that search.</p>}
    </>
  );
}
