'use client';

import { useState, useTransition } from 'react';
import { emailNonResponders } from '../../actions';
import styles from '../../events-admin.module.css';

/**
 * Nudge the families who haven't answered.
 *
 * Two-step on purpose: Preview resolves the recipient list without sending
 * anything, and only then does a Send button appear. Mail cannot be recalled,
 * so the leader sees exactly who would be written to before committing.
 */
export function EmailPanel({ signupId, configured }: { signupId: number; configured: boolean }) {
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<string[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (confirm: boolean) =>
    start(async () => {
      setError(null);
      setResult(null);
      const res = await emailNonResponders(signupId, confirm);
      if (!res.ok) {
        setError(res.error ?? 'Could not send.');
        return;
      }
      if (res.status === 'dry-run') {
        setPreview(res.to ?? []);
      } else if (res.status === 'sent') {
        setPreview(null);
        setResult(`Sent to ${res.to?.length ?? 0} address${res.to?.length === 1 ? '' : 'es'}.`);
      } else {
        setPreview(res.to ?? []);
        setResult(res.error ?? 'Email is not configured on this server — nothing was sent.');
      }
    });

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Chase the non-responders</h2>
        <button type="button" className={styles.enableBtn} disabled={pending} onClick={() => run(false)}>
          {pending ? 'Working…' : 'Preview recipients'}
        </button>
      </div>
      <p className={styles.panelHint}>
        Emails the parents of active scouts with no entry yet. Nothing sends until you press Send —
        preview first and check the list.
        {!configured && ' Email is not configured on this server, so Send will report skipped.'}
      </p>

      {error && <p className={styles.err}>{error}</p>}
      {result && <p className={styles.panelHint}>{result}</p>}

      {preview && (
        <>
          <p className={styles.panelHint}>
            <strong>{preview.length}</strong> recipient{preview.length === 1 ? '' : 's'}:
          </p>
          <p className={styles.nrList}>{preview.join(' · ') || 'Nobody to chase — everyone has replied.'}</p>
          {preview.length > 0 && (
            <button
              type="button"
              className={styles.enableBtn}
              disabled={pending}
              onClick={() => run(true)}
            >
              Send to these {preview.length}
            </button>
          )}
        </>
      )}
    </section>
  );
}
