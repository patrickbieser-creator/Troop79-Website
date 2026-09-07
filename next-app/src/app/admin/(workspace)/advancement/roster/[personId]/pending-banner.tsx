'use client';

/**
 * The family's pending update, INSIDE the section it touches (Plans/Person-
 * Editor-Rethink.md Phase 5; spec: prototypes/person-editor/a-record-page.html
 * renderPendingFor). A request that changes phone + birthdate shows one
 * banner in Contact & sign-in and one in Details, each with a Field /
 * Current / Proposed table of ITS OWN fields only; a section none of the
 * keys map to renders nothing.
 *
 * ONE REQUEST, ONE DECISION. change_requests is a single row approved or
 * rejected whole (D-098/D-103) — there is no field-level entry point, so
 * Approve / Reject from any section act on the entire request, and when it
 * also touches other sections the buttons say so ("Approve all N changes")
 * with a note naming those sections. Reject… reveals an optional reason the
 * family sees, then Confirm reject. On success the shell drops the request,
 * so every section's banner disappears at once, and router.refresh() brings
 * in the History row the action recorded.
 *
 * Styling: the shared warning Notice holds it (no new "pending" class
 * family — the styleguide has none and the Notice IS the treatment); the
 * diff is a DataTable·Compact.
 */
import { useState } from 'react';
import { fieldLabel, type FieldValue } from '@/lib/change-requests';
import { fmtDateTime } from '@/lib/format-date';
import { Button } from '../../../../_components/button';
import { Notice } from '../../../_components/notice';
import { approveChangeRequest, rejectChangeRequest } from '../change-request-actions';
import { fieldsInSection, otherSectionsTouched, shownValue, type SectionKey } from './pending-map';
import type { FamilyNotice, PendingChangeRequest } from './record-types';
import { Field, FieldGrid } from './section-card';
import styles from './person-record.module.css';

export function PendingBanner({
  request,
  section,
  current,
  today,
  onResolved
}: {
  request: PendingChangeRequest;
  section: SectionKey;
  /** The record's current values keyed by the request's field names
   *  (pending-map currentValuesFor). */
  current: Record<string, FieldValue>;
  today: string;
  /** The whole request was approved or rejected — drop it everywhere. */
  onResolved: (outcome: 'approved' | 'rejected') => void;
}) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const keys = fieldsInSection(request, section);
  if (keys.length === 0) return null;

  const total = Object.keys(request.proposed).length;
  const others = otherSectionsTouched(request, section);
  const whole = others.length > 0;
  const noun = total === 1 ? 'this change' : `these ${total} changes`;
  const approveLabel = whole ? `Approve all ${total} changes` : `Approve ${noun}`;
  const rejectLabel = whole ? `Reject all ${total} changes…` : 'Reject…';

  async function approve() {
    setError(null);
    setBusy('approve');
    try {
      const res = await approveChangeRequest(request.id);
      if (!res.ok) {
        setError(res.error ?? 'Could not approve.');
        return;
      }
      onResolved('approved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve.');
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setError(null);
    setBusy('reject');
    try {
      const res = await rejectChangeRequest(request.id, reason);
      if (!res.ok) {
        setError(res.error ?? 'Could not reject.');
        return;
      }
      onResolved('rejected');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reject.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Notice variant="warning" className={styles.pending}>
      <h3 className={styles.pendingHead}>Pending update from the family — awaiting your review</h3>
      <p className={styles.pendingCopy}>
        Submitted {fmtDateTime(request.submittedAt)}
        {request.submittedByName ? (
          <>
            {' '}
            by <strong>{request.submittedByName}</strong> (verified sign-in)
          </>
        ) : (
          ' through the shared troop password'
        )}{' '}
        from /profile. Nothing below changes until you approve it.
      </p>
      <table className={styles.pendingTable}>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Current</th>
            <th scope="col">Proposed</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((field) => (
            <tr key={field}>
              <th scope="row">{fieldLabel(request.entityType, field)}</th>
              <td className={styles.muted}>{shownValue(field, current[field], today)}</td>
              <td>
                <strong>{shownValue(field, request.proposed[field], today)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {whole && (
        <p className={styles.pendingCopy}>
          This request also changes {others.join(' and ')} — approving or rejecting here decides all {total} changes.
        </p>
      )}
      {error && <Notice className={styles.pendingError}>{error}</Notice>}
      {rejecting && (
        <FieldGrid>
          <Field label="Reason (optional — the family sees it)" full>
            <input
              type="text"
              value={reason}
              disabled={busy != null}
              placeholder="e.g. Please use the address on the BSA application"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </FieldGrid>
      )}
      <div className={styles.actions}>
        {rejecting ? (
          <>
            <Button size="sm" disabled={busy != null} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" disabled={busy != null} onClick={reject}>
              {busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" size="sm" disabled={busy != null} onClick={() => setRejecting(true)}>
              {rejectLabel}
            </Button>
            <Button variant="primary" size="sm" disabled={busy != null} onClick={approve}>
              {busy === 'approve' ? 'Applying…' : approveLabel}
            </Button>
          </>
        )}
      </div>
    </Notice>
  );
}

/**
 * "Added by a family — not yet acknowledged" (spec: the notice row above the
 * fact strip). A notice reports something that ALREADY happened: the person
 * is on the roster. There is nothing to apply and nothing to reject — a
 * Reject here would read as "remove this person" — so only Acknowledge is
 * offered; a leader who disagrees uses the ordinary tools below. Acknowledge
 * is approveChangeRequest on the 'adult_added' row, which applies no fields
 * and records the acknowledgement in History.
 */
export function FamilyAddedNotice({
  notice,
  name,
  onAcknowledged
}: {
  notice: FamilyNotice;
  name: string;
  onAcknowledged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const relationship = notice.fields.relationship;
  const phone = notice.fields.primary_phone;
  const email = notice.fields.primary_email;
  const extras = [
    relationship ? `as "${relationship}"` : null,
    phone ? `with phone ${phone}` : null,
    email ? `and email ${email}` : null
  ].filter(Boolean);

  async function acknowledge() {
    setError(null);
    setBusy(true);
    try {
      const res = await approveChangeRequest(notice.id);
      if (!res.ok) {
        setError(res.error ?? 'Could not acknowledge.');
        return;
      }
      onAcknowledged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not acknowledge.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Added by a family — not yet acknowledged">
      <Notice variant="warning">
        <strong>Added by a family — not yet acknowledged.</strong>{' '}
        {notice.submittedByName ?? 'Someone signed in with the troop password'} added {name} to their household on{' '}
        {fmtDateTime(notice.submittedAt)}
        {extras.length ? ` ${extras.join(' ')}` : ''}. They are already on the roster; acknowledging clears this from
        the dashboard and changes nothing.
        {error && <Notice className={styles.pendingError}>{error}</Notice>}
        <div className={styles.pendingAck}>
          <Button variant="primary" size="sm" disabled={busy} onClick={acknowledge}>
            {busy ? 'Acknowledging…' : 'Acknowledge'}
          </Button>
        </div>
      </Notice>
    </section>
  );
}
