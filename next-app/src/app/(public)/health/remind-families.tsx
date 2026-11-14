'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/app/_components/button';
import type { HealthRemindResult } from './actions';
import styles from './health.module.css';

/**
 * Remind families (Plans/Health-Forms.md): two steps. The first press only works out who would be written to and
 * shows it; nothing is sent until Send. Each family gets one email naming its own people and documents.
 */
export function RemindFamilies({ signupId, count, remind }: { signupId: number; count: number; remind: (signupId: number, confirm: boolean) => Promise<HealthRemindResult> }) {
  const [busy, start] = useTransition();
  const [preview, setPreview] = useState<Extract<HealthRemindResult, { ok: true }>['outcome'] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (confirm: boolean) =>
    start(async () => {
      setError(null);
      const res = await remind(signupId, confirm).catch(() => ({ ok: false as const, error: 'Couldn’t do that. Try again in a minute.' }));
      if (!res.ok) return setError(res.error);
      if (!confirm) return setPreview(res.outcome);
      const o = res.outcome;
      setPreview(null);
      setDone(
        o.failed > 0
          ? `Sent to ${o.families - o.failed} of ${o.families} families. ${o.failed} could not be sent; try again later.`
          : `Sent to ${o.families} famil${o.families === 1 ? 'y' : 'ies'}.`
      );
    });

  return (
    <div className={styles.remind}>
      {/* After a send the button is gone for this visit: a second press would email every family again. */}
      {!preview && !done && (
        <Button variant="secondary" disabled={busy || count === 0} onClick={() => run(false)}>
          {busy ? 'Checking…' : `Remind families (${count})`}
        </Button>
      )}
      {preview && (
        <div className={styles.remindPreview} role="group" aria-label="Reminder preview">
          {preview.families === 0 ? (
            <p>Nobody to remind: every family either has its files in or has no email address on file.</p>
          ) : (
            <p>
              This emails {preview.families} famil{preview.families === 1 ? 'y' : 'ies'} about {preview.people} {preview.people === 1 ? 'person' : 'people'}, each
              with their own list of what is missing: {preview.to.join(', ')}
            </p>
          )}
          {preview.noEmail.length > 0 && <p>No email address on file, so ask in person: {preview.noEmail.join(', ')}</p>}
          <span className={styles.contactActs}>
            {preview.families > 0 && (
              <Button variant="primary" disabled={busy} onClick={() => run(true)}>
                {busy ? 'Sending…' : `Send ${preview.families} email${preview.families === 1 ? '' : 's'}`}
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </span>
        </div>
      )}
      {done && (
        <span role="status" className={styles.binderStatus}>
          {done}
        </span>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
