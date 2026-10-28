'use client';

/**
 * Publish snapshot (Plans/Meeting-Planner-III.md, Decision 5): freezes what families see and emails each family
 * once: the focus, this week's options, their scout's suggestions, and a link to answer. The plan is never locked;
 * after any change the bar says families see an earlier version and the button becomes "Publish new snapshot".
 * Publishing says nothing about whether the plan is final. Adults with the edit right only (email is adults only).
 */
import { useState } from 'react';
import { Button } from '@/app/_components/button';
import { fmtDateTime } from '@/lib/format-date';
import { usePlanner } from './planner-client';
import { twPublishAction, twRevokeLinksAction } from './this-week-publish-actions';
import s from './this-week.module.css';

export interface SnapshotState {
  /** The latest snapshot's number, or null before the first publish. */
  n: number | null;
  publishedAt: string | null;
  /** Today's plan differs from what families were sent. */
  changed: boolean;
  /** Families a publish would email now (all of them before the first; those whose options changed after). */
  families: number;
  allFamilies: number;
  /** The latest snapshot's families the email didn't reach (a failed or timed-out send). */
  unreached: number;
}

export function PublishBar({ entryId, snapshot }: { entryId: number; snapshot: SnapshotState }) {
  const p = usePlanner();
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = snapshot.n == null;
  const retry = !first && !snapshot.changed && snapshot.unreached > 0;
  const count = first || everyone ? snapshot.allFamilies : retry ? snapshot.unreached : snapshot.families;
  const label = first ? 'Publish snapshot' : snapshot.changed ? 'Publish new snapshot' : 'Published';

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = p ? await p.sync.run(() => twPublishAction({ entryId, everyone })) : await twPublishAction({ entryId, everyone });
      if (!res.ok) setError(res.error);
      else {
        setSaid(res.message);
        setConfirming(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const closeLinks = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = p ? await p.sync.run(() => twRevokeLinksAction({ entryId })) : await twRevokeLinksAction({ entryId });
      if (!res.ok) setError(res.error);
      else {
        setSaid(res.message);
        setClosing(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const state = first ? null : snapshot.changed ? (
    <span>
      The plan has changed since snapshot {snapshot.n} went out. Families still see the earlier version until you publish again.
    </span>
  ) : (
    <span>
      ✓ Snapshot {snapshot.n} published to families{snapshot.publishedAt ? ` ${fmtDateTime(snapshot.publishedAt)}` : ''}. The plan can still change.
    </span>
  );

  return (
    <div className={first ? s.snap : snapshot.changed ? s.snapOld : s.snapOk} role="status">
      <div className={s.row}>
        {state ?? <span>Families haven’t been sent this plan yet.</span>}
        {p?.canEmail ? (
          confirming ? (
            <>
              <span className={s.problem}>Email {count} famil{count === 1 ? 'y' : 'ies'} now?</span>
              <Button variant="primary" size="sm" onClick={publish} disabled={busy}>
                {busy ? 'Sending…' : `Send ${count} email${count === 1 ? '' : 's'}`}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              {!first && !retry ? (
                <label className={s.muted}>
                  <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Email everyone, not just families whose options changed
                </label>
              ) : null}
            </>
          ) : (
            <Button
              variant={first || snapshot.changed || retry ? 'primary' : 'secondary'}
              size="sm"
              disabled={!first && !snapshot.changed && !retry}
              onClick={() => setConfirming(true)}
              title={!first && !snapshot.changed && !retry ? 'Nothing changed since the last snapshot' : undefined}
            >
              {retry ? `Send to the ${snapshot.unreached} not reached` : label}
            </Button>
          )
        ) : null}
        {p?.canEmail && !first && !confirming ? (
          closing ? (
            <>
              <span className={s.problem}>Close every family link for this meeting? Families can still sign in to answer.</span>
              <Button variant="danger" size="sm" onClick={closeLinks} disabled={busy}>
                Close the links
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setClosing(false)} disabled={busy}>
                Keep them
              </Button>
            </>
          ) : (
            <button type="button" className={s.quiet} onClick={() => setClosing(true)}>
              Close family links…
            </button>
          )
        ) : null}
        {said ? <span>{said}</span> : null}
        {error ? (
          <span className={s.err} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
