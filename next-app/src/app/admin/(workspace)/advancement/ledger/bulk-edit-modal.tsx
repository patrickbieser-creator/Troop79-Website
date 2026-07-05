'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { bulkUpdateLedgerEntries } from './actions';
import type { LedgerEntry } from '@/lib/supabase/types';
import styles from './ledger.module.css';

type Row = LedgerEntry & { scoutName?: string };

/** The safe, bulk-editable fields (Kind/Code/Description stay one-row-only). */
type FieldKey = 'date' | 'scout_id' | 'by' | 'qty' | 'unit' | 'notes';
interface FieldDef {
  key: FieldKey;
  label: string;
  type: 'date' | 'scout' | 'leader' | 'number' | 'text' | 'textarea';
}
const FIELDS: FieldDef[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'scout_id', label: 'Scout', type: 'scout' },
  { key: 'by', label: 'Signed Off By', type: 'leader' },
  { key: 'qty', label: 'Qty', type: 'number' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
];

interface Props {
  rows: Row[];
  scouts: { id: string; display_name: string }[];
  leaders: { code: string; name: string }[];
  onClose: () => void;
  onSaved: (updated: number) => void;
}

/** Raw comparable value for a field (normalized to a string). */
function rawValue(row: Row, key: FieldKey): string {
  switch (key) {
    case 'date':
      return row.date ?? '';
    case 'scout_id':
      return row.scout_id;
    case 'by':
      return row.by ?? '';
    case 'qty':
      return String(row.qty);
    case 'unit':
      return row.unit;
    case 'notes':
      return row.notes ?? '';
  }
}

export function BulkEditModal({ rows, scouts, leaders, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Mounted only while open (parent conditionally renders), so open on mount.
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const scoutName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of scouts) m.set(s.id, s.display_name);
    return m;
  }, [scouts]);
  const leaderName = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leaders) m.set(l.code, l.name);
    return m;
  }, [leaders]);

  /** Human-friendly rendering of a raw value for a field. */
  function display(key: FieldKey, raw: string): string {
    if (raw === '') return '(blank)';
    if (key === 'scout_id') return `${scoutName.get(raw) ?? raw} (${raw})`;
    if (key === 'by') return leaderName.get(raw) ? `${raw} — ${leaderName.get(raw)}` : raw;
    return raw;
  }

  /** Distinct values across the selection, most common first. */
  function distinct(key: FieldKey) {
    const map = new Map<string, number>();
    for (const r of rows) {
      const raw = rawValue(r, key);
      map.set(raw, (map.get(raw) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([raw, count]) => ({ raw, count, display: display(key, raw) }))
      .sort((a, b) => b.count - a.count);
  }

  function setFieldOn(key: FieldKey, on: boolean, seedRaw?: string) {
    setErr(null);
    setChanged((prev) => ({ ...prev, [key]: on }));
    if (on && seedRaw !== undefined) {
      setValues((prev) => ({ ...prev, [key]: seedRaw }));
    }
  }

  // Clicking a distinct-value chip: turn the field on and normalize all rows to
  // that value in one click. This is the "fix the outlier" shortcut.
  function pick(key: FieldKey, raw: string) {
    setFieldOn(key, true, raw);
  }

  function submit() {
    const patch: Record<string, string> = {};
    for (const f of FIELDS) {
      if (changed[f.key]) patch[f.key] = values[f.key] ?? '';
    }
    if (Object.keys(patch).length === 0) {
      setErr('Toggle at least one field to change.');
      return;
    }
    const fd = new FormData();
    fd.set('ids', JSON.stringify(rows.map((r) => r.id)));
    fd.set('patch', JSON.stringify(patch));
    startTransition(async () => {
      const res = await bulkUpdateLedgerEntries(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onSaved(res.updated);
    });
  }

  const changeCount = FIELDS.filter((f) => changed[f.key]).length;

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.editDialog} ${styles.bulkDialog}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className={styles.editDialogInner}>
        <div className={styles.editDialogHeader}>
          <h3>Bulk edit — {rows.length} record{rows.length === 1 ? '' : 's'}</h3>
          <p>
            Toggle a field to overwrite it on <strong>all {rows.length}</strong>{' '}
            selected rows. Untouched fields keep each row&rsquo;s current value.
            A <strong>Mixed</strong> field lists its distinct values with counts
            — click one to normalize every row to it (handy for fixing a
            mis-keyed signer, date, or scout). Kind, Code, and Description are
            edited one row at a time.
          </p>
        </div>

        <div className={styles.bulkFields}>
          {FIELDS.map((f) => {
            const dv = distinct(f.key);
            const isCommon = dv.length === 1;
            const on = !!changed[f.key];
            return (
              <div
                key={f.key}
                className={`${styles.bulkField} ${on ? styles.bulkFieldOn : ''}`.trim()}
              >
                <div className={styles.bulkFieldHead}>
                  <label className={styles.bulkToggle}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setFieldOn(
                          f.key,
                          e.target.checked,
                          // Seed from the common value when turning on manually.
                          isCommon ? dv[0].raw : ''
                        )
                      }
                    />
                    <span>{f.label}</span>
                  </label>

                  <div className={styles.bulkAgreement}>
                    {isCommon ? (
                      <span className={styles.bulkAllSame}>
                        All {rows.length}: <strong>{dv[0].display}</strong>
                      </span>
                    ) : (
                      <span className={styles.bulkMixedWrap}>
                        <span className={styles.bulkMixedTag}>Mixed</span>
                        {dv.map((v) => (
                          <button
                            key={v.raw}
                            type="button"
                            className={styles.bulkChip}
                            onClick={() => pick(f.key, v.raw)}
                            title={`Set all ${rows.length} rows to "${v.display}"`}
                          >
                            {v.display} <em>×{v.count}</em>
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>

                {on && (
                  <div className={styles.bulkFieldInput}>
                    <span className={styles.bulkSetLabel}>Set all to</span>
                    <FieldInput
                      field={f}
                      value={values[f.key] ?? ''}
                      onChange={(v) =>
                        setValues((prev) => ({ ...prev, [f.key]: v }))
                      }
                      scouts={scouts}
                      leaders={leaders}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {err && <div className={styles.editError}>{err}</div>}

        <div className={styles.editActions}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.editSaveBtn}
            onClick={submit}
            disabled={isPending || changeCount === 0}
          >
            {isPending
              ? 'Saving…'
              : changeCount === 0
                ? 'Apply changes'
                : `Apply ${changeCount} change${changeCount === 1 ? '' : 's'} to ${rows.length} rows`}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  scouts,
  leaders
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  scouts: { id: string; display_name: string }[];
  leaders: { code: string; name: string }[];
}) {
  if (field.type === 'date') {
    return (
      <input
        type="date"
        className={styles.editInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'scout') {
    return (
      <select
        className={styles.editInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Scout —</option>
        {scouts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.display_name} ({s.id})
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'leader') {
    const known = leaders.some((l) => l.code === value);
    return (
      <select
        className={styles.editInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Leader (blank) —</option>
        {leaders.map((l) => (
          <option key={l.code} value={l.code}>
            {l.code} — {l.name}
          </option>
        ))}
        {value && !known && <option value={value}>{value} (custom)</option>}
      </select>
    );
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        step="any"
        className={styles.editInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        className={`${styles.editInput} ${styles.editTextarea}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Overwrites notes on every selected row"
      />
    );
  }
  return (
    <input
      type="text"
      className={styles.editInput}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="complete / hours / nights / event / award"
    />
  );
}
