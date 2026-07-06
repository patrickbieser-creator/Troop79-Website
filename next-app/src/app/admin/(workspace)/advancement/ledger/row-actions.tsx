'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  archiveLedgerEntry,
  restoreLedgerEntry,
  softDeleteLedgerEntry,
  updateLedgerEntry
} from './actions';
import type { LedgerEntry, LedgerKind } from '@/lib/supabase/types';
import styles from './ledger.module.css';

interface Props {
  row: LedgerEntry & { scoutName?: string };
  scouts: { id: string; display_name: string }[];
  leaders: { code: string; name: string }[];
}

const KIND_OPTIONS: { value: LedgerKind; label: string }[] = [
  { value: 'rank_requirement', label: 'Rank requirement' },
  { value: 'rank_award', label: 'Rank award' },
  { value: 'merit_badge_requirement', label: 'MB requirement' },
  { value: 'merit_badge_award', label: 'MB award' },
  { value: 'service_hours', label: 'Service hours' },
  { value: 'camping_nights', label: 'Campout' },
  { value: 'hiking_miles', label: 'Hike' },
  { value: 'day_outing', label: 'Day Outing' },
  { value: 'fundraiser', label: 'Fundraiser' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'award', label: 'Other award' }
];

export function RowActions({ row, scouts, leaders }: Props) {
  const [, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const archived = !!row.archived_at;
  const deleted = !!row.deleted_at;
  const isHidden = archived || deleted;

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (editOpen && !dlg.open) dlg.showModal();
    if (!editOpen && dlg.open) dlg.close();
  }, [editOpen]);

  function onArchive() {
    const reason = window.prompt(
      'Why are you archiving this row? (optional — used for the activity tape)'
    );
    if (reason === null) return;
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('reason', reason);
    startTransition(() => {
      archiveLedgerEntry(fd);
    });
  }

  function onDelete() {
    const reason = window.prompt(
      'Why are you deleting this row? (required — e.g. "entered for wrong scout")'
    );
    if (!reason || !reason.trim()) return;
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('reason', reason);
    startTransition(() => {
      softDeleteLedgerEntry(fd);
    });
  }

  function onRestore() {
    if (!window.confirm('Restore this row to active?')) return;
    const fd = new FormData();
    fd.set('id', String(row.id));
    startTransition(() => {
      restoreLedgerEntry(fd);
    });
  }

  return (
    <>
      {!isHidden && (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => setEditOpen(true)}
        >
          Edit
        </button>
      )}
      {isHidden ? (
        <button type="button" className={styles.actionBtn} onClick={onRestore}>
          Restore
        </button>
      ) : (
        <>
          <button type="button" className={styles.actionBtn} onClick={onArchive}>
            Archive
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            onClick={onDelete}
          >
            Delete
          </button>
        </>
      )}

      <dialog
        ref={dialogRef}
        className={styles.editDialog}
        onClose={() => setEditOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setEditOpen(false);
        }}
      >
        {editOpen && (
          <EditForm
            row={row}
            scouts={scouts}
            leaders={leaders}
            onCancel={() => setEditOpen(false)}
            onSaved={() => setEditOpen(false)}
          />
        )}
      </dialog>
    </>
  );
}

function EditForm({
  row,
  scouts,
  leaders,
  onCancel,
  onSaved
}: {
  row: LedgerEntry;
  scouts: { id: string; display_name: string }[];
  leaders: { code: string; name: string }[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(row.date ?? '');
  const [scoutId, setScoutId] = useState(row.scout_id);
  const [kind, setKind] = useState<LedgerKind>(row.kind);
  const [code, setCode] = useState(row.code);
  const [label, setLabel] = useState(row.label ?? '');
  const [by, setBy] = useState(row.by ?? '');
  const [qty, setQty] = useState(String(row.qty));
  const [unit, setUnit] = useState(row.unit);
  const [notes, setNotes] = useState(row.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('date', date);
    fd.set('scout_id', scoutId);
    fd.set('kind', kind);
    fd.set('code', code);
    fd.set('label', label);
    fd.set('by', by);
    fd.set('qty', qty);
    fd.set('unit', unit);
    fd.set('notes', notes);
    startTransition(async () => {
      const res = await updateLedgerEntry(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onSaved();
    });
  }

  return (
    <div className={styles.editDialogInner}>
      <div className={styles.editDialogHeader}>
        <h3>Edit ledger entry #{row.id}</h3>
        <p>
          Mutates the row in place. Audit columns (entered_by, entered_at) are
          preserved. Use Delete instead if the row is erroneous.
        </p>
      </div>

      <div className={styles.editGrid}>
        <Field label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={styles.editInput}
          />
        </Field>
        <Field label="Scout">
          <select
            value={scoutId}
            onChange={(e) => setScoutId(e.target.value)}
            className={styles.editInput}
          >
            {scouts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name} ({s.id})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as LedgerKind)}
            className={styles.editInput}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Code">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${styles.editInput} ${styles.editInputMono}`}
            placeholder="e.g. tenderfoot-2c"
          />
        </Field>
        <Field label="Description / Label" full>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={styles.editInput}
            placeholder="Short label shown in the ledger"
          />
        </Field>
        <Field label="Signed Off By">
          <select
            value={by}
            onChange={(e) => setBy(e.target.value)}
            className={styles.editInput}
          >
            <option value="">— Leader —</option>
            {leaders.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} — {l.name}
              </option>
            ))}
            {/* Preserve a value that's not in the catalog (e.g. "Camp", "Clinic"). */}
            {by && !leaders.some((l) => l.code === by) && (
              <option value={by}>{by} (custom)</option>
            )}
          </select>
        </Field>
        <Field label="Qty">
          <input
            type="number"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={styles.editInput}
          />
        </Field>
        <Field label="Unit">
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className={styles.editInput}
            placeholder="complete / hours / nights / event / award"
          />
        </Field>
        <Field label="Notes" full>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${styles.editInput} ${styles.editTextarea}`}
            placeholder="Optional — context for the BoR or counselors"
          />
        </Field>
      </div>

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.editActions}>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.editSaveBtn}
          onClick={submit}
          disabled={isPending}
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label
      className={styles.editField}
      style={full ? { gridColumn: '1 / -1' } : undefined}
    >
      <span className={styles.editLabel}>{label}</span>
      {children}
    </label>
  );
}
