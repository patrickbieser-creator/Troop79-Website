'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import { fmtDate } from '@/lib/format-date';
import type { HealthLeaderResult } from './actions';
import styles from './health.module.css';

/** "Reviewed, complete" for one person (answer 3): ticked by a named leader, cleared by any change to the files. */
export function ReviewTick({
  personId,
  name,
  review,
  setReviewed
}: {
  personId: number;
  name: string;
  review: { byName: string; at: string } | null;
  setReviewed: (personId: number, on: boolean) => Promise<HealthLeaderResult>;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <label className={styles.review}>
        <input
          type="checkbox"
          checked={review != null}
          disabled={busy}
          onChange={(e) => {
            const on = e.target.checked;
            start(async () => {
              setError(null);
              const res = await setReviewed(personId, on).catch(() => ({ ok: false as const, error: 'Couldn’t save that. Try again in a minute.' }));
              if (!res.ok) setError(res.error);
              router.refresh();
            });
          }}
        />
        <span>
          Reviewed: {name.split(' ')[0]}&rsquo;s records are complete
          <span className={styles.reviewBy}>
            {review ? `${review.byName}, ${fmtDate(review.at)}` : 'Tick after reading the form. A new or replaced page clears it.'}
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </>
  );
}

/** The named list: who else may open anyone's records. */
export function ViewerList({
  viewers,
  adults,
  grant,
  revoke
}: {
  viewers: { personId: number; name: string }[];
  adults: { personId: number; name: string }[];
  grant: (personId: number) => Promise<HealthLeaderResult>;
  revoke: (personId: number) => Promise<HealthLeaderResult>;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [confirming, setConfirming] = useState<number | null>(null);
  const run = (work: () => Promise<HealthLeaderResult>) =>
    start(async () => {
      setError(null);
      const res = await work().catch(() => ({ ok: false as const, error: 'Couldn’t save that. Try again in a minute.' }));
      if (!res.ok) setError(res.error);
      else {
        setPick('');
        setConfirming(null);
        router.refresh();
      }
    });
  const held = new Set(viewers.map((v) => v.personId));

  return (
    <>
      <ul className={styles.viewers}>
        {viewers.map((v) => (
          <li key={v.personId}>
            <span>{v.name}</span>
            {confirming === v.personId ? (
              <span className={styles.contactActs}>
                <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => revoke(v.personId))}>
                  Remove {v.name.split(' ')[0]}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="dangerGhost" disabled={busy} onClick={() => setConfirming(v.personId)} aria-label={`Remove ${v.name}`}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.addRow}>
        <select className={styles.select} aria-label="Adult to add" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose an adult…</option>
          {adults
            .filter((a) => !held.has(a.personId))
            .map((a) => (
              <option key={a.personId} value={a.personId}>
                {a.name}
              </option>
            ))}
        </select>
        <Button variant="secondary" disabled={busy || !pick} onClick={() => run(() => grant(Number(pick)))}>
          Add
        </Button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </>
  );
}
