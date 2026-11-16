'use client';

/**
 * Who can open health records (Plans/Admin-Health-Forms.md; moved from /health/access). A compact table, a quiet
 * Remove… per row behind a danger Dialog that names the consequence, and one quiet add row (pick an adult, Add).
 * The list can't be left empty: the last name's Remove is greyed and the reason is visible.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { HealthViewerRow } from '@/lib/health-store';
import { fmtDate } from '@/lib/format-date';
import { Button } from '../../../_components/button';
import { AdminCombobox } from '../../_components/admin-combobox';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import styles from '../health-forms.module.css';

type Result = { ok: true } | { ok: false; error: string };

export function HealthViewersAdmin({
  viewers,
  adults,
  grant,
  revoke
}: {
  viewers: HealthViewerRow[];
  adults: { personId: number; name: string }[];
  grant: (personId: number) => Promise<Result>;
  revoke: (personId: number) => Promise<Result>;
}) {
  const router = useRouter();
  const [pick, setPick] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<HealthViewerRow | null>(null);
  const [pending, start] = useTransition();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const last = viewers.length <= 1;
  const onList = new Set(viewers.map((v) => v.personId));
  const options = adults.filter((a) => !onList.has(a.personId)).map((a) => ({ value: String(a.personId), label: a.name }));

  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      setProblem(null);
      const res = await fn();
      if (!res.ok) setProblem(res.error);
      else {
        after?.();
        router.refresh();
      }
    });

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Added on</th>
              <th className={styles.actionsCell} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {viewers.map((v) => (
              <tr key={v.personId}>
                <td className={styles.nameCell}>{v.name}</td>
                <td className={styles.nowrap}>{fmtDate(v.grantedAt)}</td>
                <td className={styles.actionsCell}>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={last || pending}
                    aria-label={`Remove ${v.name}…`}
                    onClick={() => {
                      setRemoving(v);
                      dialogRef.current?.showModal();
                    }}
                  >
                    Remove…
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {last && <p className={styles.muted}>The list can’t be left empty: add someone before removing the last name.</p>}

      <div className={styles.addRow}>
        <AdminCombobox id="health-viewer-add" label="Add an adult" placeholder="Find an adult…" options={options} value={pick} onChange={setPick} />
        <Button
          variant="secondary"
          disabled={!pick || pending}
          onClick={() => run(() => grant(Number(pick)), () => setPick(''))}
        >
          Add
        </Button>
      </div>
      {problem && <p className={styles.problem}>{problem}</p>}

      <Dialog ref={dialogRef} danger onClose={() => setRemoving(null)}>
        <DialogHeader title={removing ? `Remove ${removing.name}?` : 'Remove'} />
        <DialogBody>
          <p>
            {removing?.name} will no longer open anyone&rsquo;s health records except their own family&rsquo;s and their trips&rsquo;,
            and Health Forms leaves their admin menu.
          </p>
        </DialogBody>
        <DialogActions>
          <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button
            variant="dangerSolid"
            disabled={pending}
            onClick={() => {
              const who = removing;
              if (!who) return;
              run(() => revoke(who.personId), () => dialogRef.current?.close());
            }}
          >
            Remove from the list
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
