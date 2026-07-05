'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addLedgerEntries } from './actions';
import { RequirementPicker } from './picker';
import type { CatalogPayload, PickerItem } from './picker-types';
import styles from './fast-entry.module.css';

interface Props {
  scouts: { id: string; display_name: string; current_rank: string | null }[];
  leaders: { code: string; name: string }[];
  catalog: CatalogPayload;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ReqFirstCard({ scouts, leaders, catalog }: Props) {
  const router = useRouter();
  const [selections, setSelections] = useState<PickerItem[]>([]);
  const [date, setDate] = useState(todayISO);
  const [by, setBy] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedScouts, setSelectedScouts] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const totalEntries = selections.length * selectedScouts.size;
  const selectedScoutRows = scouts.filter((s) => selectedScouts.has(s.id));
  const byLabel = (() => {
    const l = leaders.find((x) => x.code === by);
    return l ? `${l.code} — ${l.name}` : by;
  })();

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (confirmOpen && !dlg.open) dlg.showModal();
    if (!confirmOpen && dlg.open) dlg.close();
  }, [confirmOpen]);

  function toggleScout(id: string) {
    setSelectedScouts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selectedScouts.size === scouts.length) setSelectedScouts(new Set());
    else setSelectedScouts(new Set(scouts.map((s) => s.id)));
  }

  function clear() {
    setSelections([]);
    setSelectedScouts(new Set());
    setNotes('');
    setStatus(null);
    setConfirmOpen(false);
  }

  // Validate, then open the confirmation modal (no DB write yet).
  function openConfirm() {
    if (selections.length === 0) {
      setStatus({ kind: 'err', msg: 'Pick at least one requirement.' });
      return;
    }
    if (selectedScouts.size === 0) {
      setStatus({ kind: 'err', msg: 'Select at least one scout.' });
      return;
    }
    if (!date || !by) {
      setStatus({ kind: 'err', msg: 'Date and Signed-Off By are required.' });
      return;
    }
    setStatus(null);
    setConfirmErr(null);
    setConfirmOpen(true);
  }

  // Commit the cartesian product: every selected requirement × every selected
  // scout. Server-side award gating still applies per scout.
  function commit() {
    setConfirmErr(null);
    const items: Array<{
      scout_id: string;
      kind: PickerItem['kind'];
      code: string;
      label: string;
      unit: string;
      qty?: number;
    }> = [];
    for (const s of selections) {
      for (const sid of selectedScouts) {
        items.push({
          scout_id: sid,
          kind: s.kind,
          code: s.code,
          label: s.label,
          unit: s.unit,
          qty: s.qty
        });
      }
    }
    const fd = new FormData();
    fd.set('date', date);
    fd.set('by', by);
    fd.set('notes', notes);
    fd.set('items', JSON.stringify(items));

    startTransition(async () => {
      const res = await addLedgerEntries(fd);
      if (!res.ok) {
        setConfirmErr(res.error ?? 'Save failed');
        return;
      }
      setStatus({
        kind: 'ok',
        msg: `Saved ${res.inserted} entr${res.inserted === 1 ? 'y' : 'ies'}.`
      });
      setSelectedScouts(new Set());
      setSelections([]);
      setNotes('');
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className={`${styles.card} ${styles.reqFirstCard}`}>
      <h3>Requirement-First Bulk Entry</h3>

      <div className={`${styles.field} ${styles.reqFirstFlexField}`}>
        <span className={styles.fieldLabel}>Requirements</span>
        <RequirementPicker
          catalog={catalog}
          selections={selections}
          onSelectionsChange={setSelections}
          completion={new Map()}
          multi
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Date Completed</span>
          <input
            type="date"
            className={styles.input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Signed Off By</span>
          <select
            className={styles.select}
            value={by}
            onChange={(e) => setBy(e.target.value)}
          >
            <option value="">— Leader —</option>
            {leaders.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`${styles.field} ${styles.reqFirstFlexField}`}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 4
          }}
        >
          <span className={styles.fieldLabel}>
            Scouts{' '}
            <span
              style={{
                fontWeight: 400,
                color: 'var(--admin-gray-500)',
                textTransform: 'none',
                letterSpacing: 0
              }}
            >
              ({selectedScouts.size} selected)
            </span>
          </span>
          <button
            type="button"
            onClick={selectAll}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--admin-navy)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {selectedScouts.size === scouts.length ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className={styles.scoutGrid}>
          {scouts.map((s) => (
            <label key={s.id} className={styles.scoutGridItem}>
              <input
                type="checkbox"
                checked={selectedScouts.has(s.id)}
                onChange={() => toggleScout(s.id)}
              />
              <span>{s.display_name}</span>
            </label>
          ))}
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Notes (optional)</span>
        <textarea
          className={styles.textarea}
          placeholder="Completed at Cooking MB clinic, etc."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      <div className={styles.actionsRow}>
        {status && (
          <span className={status.kind === 'ok' ? styles.statusOk : styles.statusErr}>
            {status.msg}
          </span>
        )}
        <button
          type="button"
          className={styles.btn}
          onClick={clear}
          disabled={isPending}
        >
          Clear
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={openConfirm}
          disabled={
            isPending ||
            selections.length === 0 ||
            selectedScouts.size === 0 ||
            !date ||
            !by
          }
          title={
            selections.length === 0
              ? 'Pick at least one requirement'
              : !date
                ? 'Date is required'
                : !by
                  ? 'Signed-Off By is required'
                  : selectedScouts.size === 0
                    ? 'Select at least one scout'
                    : undefined
          }
        >
          {totalEntries > 0 ? `Save (${totalEntries})` : 'Save'}
        </button>
      </div>

      {/* Confirmation modal — nothing is written until "Add …" is clicked. */}
      <dialog
        ref={dialogRef}
        className={styles.confirmDialog}
        onClose={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current && !isPending) setConfirmOpen(false);
        }}
      >
        <div className={styles.confirmInner}>
          <div className={styles.confirmHeader}>
            <h3>Confirm bulk entry</h3>
            <p>
              About to add <strong>{totalEntries}</strong> ledger entr
              {totalEntries === 1 ? 'y' : 'ies'} — <strong>{selections.length}</strong>{' '}
              requirement{selections.length === 1 ? '' : 's'} ×{' '}
              <strong>{selectedScouts.size}</strong> scout
              {selectedScouts.size === 1 ? '' : 's'}, dated <strong>{date}</strong>,
              signed off by <strong>{byLabel}</strong>.
            </p>
          </div>

          <div className={styles.confirmLists}>
            <div className={styles.confirmList}>
              <div className={styles.confirmListHead}>
                Requirements ({selections.length})
              </div>
              {selections.map((s) => (
                <div key={s.key} className={styles.confirmListRow}>
                  <span className={styles.selectedCode}>{s.code}</span> {s.label}
                </div>
              ))}
            </div>
            <div className={styles.confirmList}>
              <div className={styles.confirmListHead}>
                Scouts ({selectedScouts.size})
              </div>
              {selectedScoutRows.map((s) => (
                <div key={s.id} className={styles.confirmListRow}>
                  {s.display_name}
                </div>
              ))}
            </div>
          </div>

          {confirmErr && (
            <div className={styles.statusErr} style={{ marginTop: 12, display: 'block' }}>
              {confirmErr}
            </div>
          )}

          <div className={styles.confirmFooter}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={commit}
              disabled={isPending}
            >
              {isPending
                ? 'Saving…'
                : `Add ${totalEntries} entr${totalEntries === 1 ? 'y' : 'ies'}`}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
