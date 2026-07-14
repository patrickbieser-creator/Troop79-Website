'use client';

/**
 * Internal Requirement Codes — top-level (parent_id IS NULL) rows only;
 * nested sub-requirement tree editing still ships in a later slice (that's
 * done per-MB in the Merit Badge Catalog card's own tree editor instead).
 *
 * Renaming `code` cascades to ledger_entries.code (updateReqCode in
 * actions.ts) — historical rows store `<parentId>-<code>` composite keys
 * that the Fast Entry picker and award-gating logic match against, so a
 * silent rename would otherwise strand already-completed requirements.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { updateReqCode } from './actions';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';

export interface ReqRow {
  id: number;
  source: 'rank' | 'mb';
  parentId: string;
  parentLabel: string;
  code: string;
  label: string;
}

export function ReqCodesTable({ rows }: { rows: ReqRow[] }) {
  const [openFor, setOpenFor] = useState<ReqRow | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = useLookupTable(rows, (r) => `${r.code} ${r.label} ${r.parentLabel}`);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  return (
    <>
      {t.searchEl}
      <div className={t.scrollClass}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Source</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={`${r.source}-${r.parentId}-${r.code}`}>
                <td className={styles.codeCell}>{r.code}</td>
                <td>{r.label}</td>
                <td>
                  <span className={`${styles.tag} ${r.source === 'rank' ? styles.tagRank : styles.tagMb}`}>
                    {r.source === 'rank' ? 'Rank' : 'MB'}: {r.parentLabel}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className={styles.editBtn} onClick={() => setOpenFor(r)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.footerEl}

      <dialog
        ref={dialogRef}
        className={styles.editDialog}
        onClose={() => setOpenFor(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpenFor(null);
        }}
      >
        {openFor && <ReqCodeForm row={openFor} onClose={() => setOpenFor(null)} />}
      </dialog>
    </>
  );
}

function ReqCodeForm({ row, onClose }: { row: ReqRow; onClose: () => void }) {
  const [code, setCode] = useState(row.code);
  const [label, setLabel] = useState(row.label);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    if (!code.trim()) return setErr('Code is required.');
    if (!label.trim()) return setErr('Label is required.');
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('source', row.source);
    fd.set('parent_id', row.parentId);
    fd.set('original_code', row.code);
    fd.set('code', code.trim());
    fd.set('label', label.trim());
    startTransition(async () => {
      const res = await updateReqCode(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onClose();
    });
  }

  return (
    <div className={styles.editDialogInner}>
      <div className={styles.editDialogHeader}>
        <h3>
          Edit {row.source === 'rank' ? 'Rank' : 'MB'} requirement — {row.parentLabel}
        </h3>
        <p>
          Renaming the code updates every ledger entry already recorded under
          the old code, so completed requirements stay matched to the catalog.
        </p>
      </div>

      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Code</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${styles.editInput} ${styles.editInputMono}`}
          />
        </label>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={styles.editInput}
          />
        </label>
      </div>

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.editActions}>
        <button type="button" className={styles.editBtn} onClick={onClose} disabled={isPending}>
          Cancel
        </button>
        <button type="button" className={styles.editSaveBtn} onClick={submit} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
