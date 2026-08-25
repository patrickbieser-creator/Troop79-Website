'use client';

import { useEffect, useState } from 'react';
import { getPendingChangeRequest, approveChangeRequest, rejectChangeRequest, type ChangeRequestWithSubmitter } from './change-request-actions';
import {
  fieldLabel,
  isNoticeOnly,
  type ChangeEntityType,
  type FieldValue
} from '@/lib/change-requests';
import styles from '../lookups/lookups.module.css';
import { Notice } from '../../_components/notice';
import { fmtDateTime } from '@/lib/format-date';
import { Button } from '../../../_components/button';

/**
 * "Pending Update" panel inside the Scout editor (Plans/Scout-Self-Service-Demographics.md)
 * — folded into the existing editor rather than a new admin screen, same
 * pattern as D-020/D-038. Fetches on mount (same pattern as scout-relations.tsx)
 * since ScoutForm has no other data-loading of its own.
 *
 * Also serves the Person editor now that /profile lets a family edit the
 * ADULTS of their household, not just its scouts — same diff, same two
 * buttons, different field labels. The Person editor has no demographics form
 * of its own, so this panel is where an adult's proposed values are seen at
 * all; `currentValues` comes from the person row behind it.
 */
export function PendingUpdatePanel({
  scoutId,
  entityType = 'scout',
  currentValues,
  onApplied
}: {
  /** The entity id — a scout id, or a stringified people.id for an adult. */
  scoutId: string;
  entityType?: ChangeEntityType;
  currentValues: Record<string, FieldValue>;
  onApplied: () => void;
}) {
  // undefined = still loading, null = nothing pending — kept distinct so the
  // panel doesn't flash an empty state before the fetch resolves.
  const [request, setRequest] = useState<ChangeRequestWithSubmitter | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    getPendingChangeRequest(scoutId, entityType)
      .then((r) => { if (live) setRequest(r); })
      .catch(() => { if (live) setRequest(null); });
    return () => { live = false; };
  }, [scoutId, entityType]);

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

  const fields = Object.keys(request.proposed_changes);

  // A notice reports something that ALREADY happened — a family added this
  // person to their household, and the person exists. There is nothing to
  // apply and, crucially, nothing to reject: "Reject" here would read as
  // "remove this person", which this panel must not do silently. Only the
  // acknowledgement is offered; a leader who disagrees uses the ordinary
  // person tools below (deactivate, change household, merge, delete).
  const notice = isNoticeOnly(entityType);

  return (
    <div className={styles.editSection}>
      <div className={styles.editSectionHeader}>
        <h4>{notice ? 'Added by a family — not yet acknowledged' : 'Pending Update — awaiting review'}</h4>
      </div>
      {error && <Notice>{error}</Notice>}
      <p className={styles.helpText}>
        {notice ? 'Added ' : 'Submitted '}
        {fmtDateTime(request.submitted_at)} through the public Profile page
        {request.submittedByName ? (
          <>
            {' '}by <strong>{request.submittedByName}</strong> (verified sign-in).
          </>
        ) : (
          '.'
        )}
        {notice &&
          ' They are already on the roster. Acknowledging clears this from the dashboard — it does not change the record.'}
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Field</th>
            {!notice && <th>Current</th>}
            <th>{notice ? 'Submitted' : 'Proposed'}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field}>
              <td>{fieldLabel(entityType, field)}</td>
              {!notice && (
                <td className={styles.muted}>{String(currentValues[field] ?? '—')}</td>
              )}
              <td><strong>{String(request.proposed_changes[field] ?? '—')}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>

      {rejecting ? (
        <div className={`${styles.editGrid} ${styles.gapTop}`}>
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

      <div className={`${styles.editActions} ${styles.gapTop}`}>
        {rejecting ? (
          <>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={reject}>
              Confirm reject
            </Button>
          </>
        ) : (
          <>
            {!notice && (
              <Button variant="danger" size="sm" disabled={busy} onClick={() => setRejecting(true)}>
                Reject
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={approve}>
              {notice
                ? busy
                  ? 'Acknowledging…'
                  : 'Acknowledge'
                : busy
                  ? 'Applying…'
                  : 'Approve'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
