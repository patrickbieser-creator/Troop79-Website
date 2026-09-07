'use client';

/**
 * Status card — the whole point of Phase 1 (Plans/Person-Editor-Rethink.md).
 *
 * One read row (Active + its one-line consequence, or Inactive + the
 * reason) with ONE Edit. Edit opens an inline panel: a scout picks a
 * required reason from the fixed list, an adult may type one; "Mark
 * inactive…" then opens the shared danger Dialog that names the
 * consequences before anything is written. Inactive → Edit → "Mark active"
 * is the mirror, with no confirm (reversible, and the copy says what it
 * clears). On success the card returns to the read row with a "Saved just
 * now" stamp and a short highlight.
 *
 * No Save / Saved button exists here, by design — that grey "Saved" under
 * an immediate status change was the Marita bug. Identical for scouts and
 * adults: the only difference is which action it calls and how the reason
 * is collected.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { INACTIVE_REASON_LABEL, type InactiveReason } from '@/lib/supabase/types';
import { Button } from '../../../../_components/button';
import { FormPanel } from '../../../../_components/form-panel';
import { Badge } from '../../../_components/badge';
import { Notice } from '../../../_components/notice';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../../_components/dialog';
import { SaveFeedback, useSavePhase } from '../../../_components/save-state';
import { setPersonActive } from '../person-actions';
import { setScoutActive } from './scout-status-actions';
import type { PersonKind, PersonStatus } from './record-types';
import styles from './person-record.module.css';

const FLASH_MS = 1400;

export function reasonLabel(kind: PersonKind, reason: string | null): string | null {
  if (!reason) return null;
  if (kind === 'scout') return INACTIVE_REASON_LABEL[reason as InactiveReason] ?? reason;
  return reason;
}

export function StatusCard({
  personId,
  scoutId,
  kind,
  name,
  active,
  reason,
  onChanged
}: {
  personId: number;
  /** The scouts.id when the record is a scout — the row Status acts on. */
  scoutId: string | null;
  kind: PersonKind;
  name: string;
  active: boolean;
  reason: string | null;
  onChanged: (next: PersonStatus) => void;
}) {
  const scout = kind === 'scout' && scoutId != null;
  const [state, setState] = useState<PersonStatus>({ active, reason });
  const [editing, setEditing] = useState(false);
  const [draftReason, setDraftReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [stamped, setStamped] = useState(false);
  const [flash, setFlash] = useState(false);
  const [help, setHelp] = useState(false);
  const feedback = useSavePhase();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const dialogTitleId = useId();
  const reasonId = useId();

  // The confirm Dialog is mounted only while confirming, so its copy never
  // lingers in the DOM behind the read row; showModal() once it exists.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (confirming && dlg && !dlg.open) dlg.showModal();
  }, [confirming]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  function startEdit() {
    setDraftReason('');
    setError(null);
    setSaved(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraftReason('');
    setError(null);
  }

  async function commit(nextActive: boolean) {
    const nextReason = nextActive ? '' : draftReason.trim();
    setError(null);
    setBusy(true);
    feedback.start();
    try {
      const res = scout
        ? await setScoutActive(scoutId, nextActive, nextReason)
        : await setPersonActive(personId, nextActive, nextReason);
      if (!res.ok) {
        feedback.fail();
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      const next: PersonStatus = { active: nextActive, reason: nextActive ? null : nextReason || null };
      setState(next);
      setEditing(false);
      setConfirming(false);
      setDraftReason('');
      setStamped(true);
      setFlash(true);
      setSaved(nextActive ? `${name} is active again.` : `${name} marked inactive.`);
      feedback.done();
      onChanged(next);
    } catch (e) {
      feedback.fail();
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const currentReason = reasonLabel(kind, state.reason);
  const draftLabel = scout ? reasonLabel('scout', draftReason || null) : draftReason.trim() || null;
  const needsReason = scout && !draftReason;

  const cardClass = [styles.card, editing ? styles.cardEditing : null, flash ? styles.cardFlash : null]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={cardClass} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId}>Status</h2>
        {stamped && <span className={styles.stamp}>Saved just now</span>}
        {!editing && (
          <Button size="sm" onClick={startEdit}>
            Edit
          </Button>
        )}
      </div>
      <div className={styles.cardBody}>
        {saved && !editing && <Notice variant="success">{saved}</Notice>}
        {error && <Notice>{error}</Notice>}

        {!editing ? (
          <dl className={styles.dl}>
            <dt>Status</dt>
            <dd>
              {state.active ? (
                <>
                  <Badge variant="success">Active</Badge>{' '}
                  <span className={styles.sub}>
                    {scout ? 'On rosters, dashboards and the Fast Entry picker' : 'Offered in the family signup picker'}
                  </span>
                </>
              ) : (
                <>
                  <Badge variant="muted">Inactive</Badge> — {currentReason ?? 'no reason recorded'}{' '}
                  <span className={styles.sub}>
                    Still on record with ledger history, relationships and past events
                    {scout ? '' : '; not offered at signup'}
                  </span>
                </>
              )}
            </dd>
          </dl>
        ) : state.active ? (
          <>
            <FormPanel>
              <p className={styles.panelCopy}>
                Marking {name} inactive keeps everything on record — ledger history, relationships, past events —
                but {scout ? 'removes them from rosters, dashboards and the Fast Entry picker' : 'stops offering them in the family signup picker'}.
                Roles and household are not touched.
              </p>
              {scout ? (
                <label className={styles.field} htmlFor={reasonId}>
                  <span>
                    Reason <span className={styles.required} aria-hidden="true">*</span>
                  </span>
                  <select
                    id={reasonId}
                    value={draftReason}
                    required
                    disabled={busy}
                    onChange={(e) => setDraftReason(e.target.value)}
                  >
                    <option value="">— Pick a reason —</option>
                    {(Object.keys(INACTIVE_REASON_LABEL) as InactiveReason[]).map((code) => (
                      <option key={code} value={code}>
                        {INACTIVE_REASON_LABEL[code]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className={styles.field} htmlFor={reasonId}>
                  <span>Reason (optional)</span>
                  <input
                    id={reasonId}
                    value={draftReason}
                    disabled={busy}
                    placeholder="Moved away, aged out of the troop…"
                    onChange={(e) => setDraftReason(e.target.value)}
                  />
                </label>
              )}
            </FormPanel>
            <div className={styles.actions}>
              <Button onClick={cancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy || needsReason}
                title={needsReason ? 'Pick a reason first' : undefined}
                onClick={() => setConfirming(true)}
              >
                Mark inactive…
              </Button>
            </div>
          </>
        ) : (
          <>
            <FormPanel>
              <p className={styles.panelCopy}>
                Reactivating puts {name} back {scout ? 'on rosters and in the Fast Entry picker' : 'in the family signup picker'}.
                {currentReason ? ` The recorded reason (“${currentReason}”) is cleared.` : ''}
              </p>
            </FormPanel>
            <div className={styles.actions}>
              <Button onClick={cancel} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => commit(true)}>
                {busy ? 'Saving…' : 'Mark active'}
              </Button>
            </div>
          </>
        )}

        <div>
          <button type="button" className={styles.disc} aria-expanded={help} onClick={() => setHelp((h) => !h)}>
            How this works
          </button>
          {help && (
            <div className={styles.discBody}>
              <p>
                Inactive people stay on record — ledger history, relationships and past events are kept — but are
                {scout ? ' taken off rosters, dashboards and the Fast Entry picker' : ' no longer offered in the family signup picker'}.
                Status is separate from roles: someone who steps down from a role is still around, still a parent, still
                offered. Every change is reversible from this card.
              </p>
            </div>
          )}
        </div>
      </div>

      {confirming && (
        <Dialog ref={dialogRef} danger aria-labelledby={dialogTitleId} onClose={() => setConfirming(false)}>
          <DialogHeader title={<span id={dialogTitleId}>Mark {name} inactive?</span>} />
          <DialogBody>
            <ul className={styles.consequences}>
              <li>{scout ? 'Leaves rosters, dashboards and the Fast Entry picker' : 'No longer offered in the family signup picker'}</li>
              <li>Ledger history, relationships{scout ? '' : ', roles'} and past events are kept</li>
              <li>Reason recorded: {draftLabel ?? 'none'}</li>
              <li>Reversible — Status → Edit → Mark active</li>
            </ul>
            {error && <Notice>{error}</Notice>}
          </DialogBody>
          <DialogActions>
            <Button onClick={() => dialogRef.current?.close()} disabled={busy}>
              Cancel
            </Button>
            <Button variant="dangerSolid" disabled={busy} onClick={() => commit(false)}>
              {busy ? 'Saving…' : 'Mark inactive'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <SaveFeedback
        phase={feedback.phase}
        savingLabel="Saving…"
        doneLabel={saved ?? 'Status updated.'}
      />
    </section>
  );
}
