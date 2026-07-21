'use client';

import { useEffect, useState } from 'react';
import { getPendingChangeRequest, approveChangeRequest, rejectChangeRequest } from './change-request-actions';
import { FIELD_LABEL, type ChangeRequestRow, type EditableScoutField } from '@/lib/change-requests';
import styles from '../lookups/lookups.module.css';

/**
 * "Pending Update" panel inside the Scout editor (Plans/Scout-Self-Service-Demographics.md)
 * — folded into the existing editor rather than a new admin screen, same
 * pattern as D-020/D-038. Fetches on mount (same pattern as scout-relations.tsx)
 * since ScoutForm has no other data-loading of its own.
 */
export function PendingUpdatePanel({
  scoutId,
  currentValues,
  onApplied
}: {
  scoutId: string;
  currentValues: Partial<Record<EditableScoutField, string | number | null>>;
  onApplied: () => void;
}) {
  // undefined = still loading, null = nothing pending — kept distinct so the
  // panel doesn't flash an empty state before the fetch resolves.
  const [request, setRequest] = useState<ChangeRequestRow | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    getPendingChangeRequest(scoutId)
      .then((r) => { if (live) setRequest(r); })
      .catch(() => { if (live) setRequest(null); });
    return () => { live = false; };
  }, [scoutId]);

  if (!request) return null;

  function approve() {
    setError(null);
    setBusy(true);
    approveChangeRequest(request!.id)
      .then((res) => {
        if (!res.ok) { setError(res.error ?? 'Could not approve.'); return; }
        setRequest(null);
        onApplied();
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not approve.'))
      .finally(() => setBusy(false));
  }

  function reject() {
    setError(null);
    setBusy(true);
    rejectChangeRequest(request!.id, reason)
      .then((res) => {
        if (!res.ok) { setError(res.error ?? 'Could not reject.'); return; }
        setRequest(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not reject.'))
      .finally(() => setBusy(false));
  }

  const fields = Object.keys(request.proposed_changes) as EditableScoutField[];

  return (
    <div className={styles.editSection}>
      <div className={styles.editSectionHeader}>
        <h4>Pending Update — awaiting review</h4>
      </div>
      {error && <p className={styles.editError}>{error}</p>}
      <p className={styles.helpText}>
        Submitted {new Date(request.submitted_at).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        })} through the public Profile page.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Field</th>
            <th>Current</th>
            <th>Proposed</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field}>
              <td>{FIELD_LABEL[field]}</td>
              <td className={styles.muted}>{String(currentValues[field] ?? '—')}</td>
              <td><strong>{String(request.proposed_changes[field] ?? '—')}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>

      {rejecting ? (
        <div className={styles.editGrid} style={{ marginTop: 10 }}>
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>Reason (optional)</span>
            <input
              className={styles.editInput}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
      ) : null}

      <div className={styles.editActions} style={{ marginTop: 10 }}>
        {rejecting ? (
          <>
            <button className={styles.editBtn} disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </button>
            <button
              className={`${styles.editBtn} ${styles.dangerBtn}`}
              disabled={busy}
              onClick={reject}
            >
              Confirm reject
            </button>
          </>
        ) : (
          <>
            <button
              className={`${styles.editBtn} ${styles.dangerBtn}`}
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              Reject
            </button>
            <button className={styles.editSaveBtn} disabled={busy} onClick={approve}>
              {busy ? 'Applying…' : 'Approve'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
