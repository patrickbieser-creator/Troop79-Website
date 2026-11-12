'use client';

/**
 * Crossover card (Plans/Webelos-On-The-Roster.md, 2026-11-12) — the Webelos
 * counterpart of "Promote to adult".
 *
 *   A Webelos: read row "Webelos" + its consequence, ONE "Cross over…" that
 *     opens an inline panel (crossover date, BSA member ID) whose primary
 *     button writes it — one transaction, same ID, tracked work now counts.
 *   A scout who crossed over here: "Crossed over <date>" + a quiet
 *     "Undo crossover…" behind a danger Dialog naming the consequence.
 *
 * Shown instead of the Status card for a Webelos (Active/Inactive does not
 * apply to someone who is not a scout yet).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/format-date';
import { Button } from '../../../../_components/button';
import { FormPanel } from '../../../../_components/form-panel';
import { Badge } from '../../../_components/badge';
import { Notice } from '../../../_components/notice';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../../_components/dialog';
import { DatePickerField } from '../../../_components/date-picker-field';
import { crossOverWebelos, undoCrossOver } from './scout-status-actions';
import { Field, FieldGrid } from './section-card';
import styles from './person-record.module.css';

export function CrossoverCard({
  scoutId,
  name,
  isWebelos,
  crossedOverOn,
  bsaMemberId,
  today
}: {
  scoutId: string;
  name: string;
  isWebelos: boolean;
  crossedOverOn: string | null;
  bsaMemberId: string | null;
  today: string;
}) {
  const router = useRouter();
  const headingId = useId();
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(false);
  const [onDate, setOnDate] = useState(today);
  const [bsa, setBsa] = useState(bsaMemberId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (confirming && dlg && !dlg.open) dlg.showModal();
  }, [confirming]);

  async function crossOver() {
    setBusy(true);
    setError(null);
    const res = await crossOverWebelos(scoutId, onDate, bsa);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Crossover failed');
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function undo() {
    setBusy(true);
    setError(null);
    const res = await undoCrossOver(scoutId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Undo failed');
      return;
    }
    dialogRef.current?.close();
    router.refresh();
  }

  if (!isWebelos && !crossedOverOn) return null;

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId}>{isWebelos ? 'Webelos' : 'Crossover'}</h2>
        {isWebelos && !editing && (
          <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
            Cross over…
          </Button>
        )}
      </div>
      <div className={styles.cardBody}>
        {error && <Notice>{error}</Notice>}
        {isWebelos ? (
          !editing ? (
            <dl className={styles.dl}>
              <dt>Status</dt>
              <dd>
                <Badge variant="info">Webelos</Badge>{' '}
                <span className={styles.sub}>
                  Signs up for events and has advancement tracked; left out of advancement reports and the website
                  until crossover
                </span>
              </dd>
            </dl>
          ) : (
            <FormPanel>
              <p className={styles.sub}>
                {name} becomes an active scout with the same ID ({scoutId}). Advancement recorded as a Webelos keeps its
                dates and starts counting in reports.
              </p>
              <FieldGrid>
                <Field label="Crossover date" required>
                  <DatePickerField value={onDate} disabled={busy} onChange={(iso) => setOnDate(iso)} />
                </Field>
                <Field label="BSA member ID">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bsa}
                    disabled={busy}
                    className={styles.mono}
                    onChange={(e) => setBsa(e.target.value)}
                  />
                </Field>
              </FieldGrid>
              <div className={styles.cardHead}>
                <Button variant="primary" disabled={busy || !onDate} onClick={crossOver}>
                  {busy ? 'Crossing over…' : `Cross over ${name}`}
                </Button>
                <Button disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </FormPanel>
          )
        ) : (
          <dl className={styles.dl}>
            <dt>Crossed over</dt>
            <dd>
              {fmtDate(crossedOverOn!)}{' '}
              <Button size="sm" variant="quiet" onClick={() => setConfirming(true)}>
                Undo crossover…
              </Button>
            </dd>
          </dl>
        )}
      </div>

      {confirming && (
        <Dialog ref={dialogRef} danger aria-labelledby={dialogTitleId} onClose={() => setConfirming(false)}>
          <DialogHeader title={<span id={dialogTitleId}>Undo {name}&rsquo;s crossover?</span>} />
          <DialogBody>
            <ul className={styles.consequences}>
              <li>Back to Webelos: off the active scout roster and out of advancement reports</li>
              <li>A Scout rank awarded at crossover is removed; everything else they recorded stays</li>
              <li>The BSA member ID stays</li>
            </ul>
            {error && <Notice>{error}</Notice>}
          </DialogBody>
          <DialogActions>
            <Button onClick={() => dialogRef.current?.close()} disabled={busy}>
              Cancel
            </Button>
            <Button variant="dangerSolid" disabled={busy} onClick={undo}>
              {busy ? 'Undoing…' : 'Undo crossover'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </section>
  );
}
