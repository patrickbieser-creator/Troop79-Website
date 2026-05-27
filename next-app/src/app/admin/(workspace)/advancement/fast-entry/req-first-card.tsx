'use client';

import { useState, useTransition } from 'react';
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
  const [selections, setSelections] = useState<PickerItem[]>([]); // single-select
  const [date, setDate] = useState(todayISO);
  const [by, setBy] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedScouts, setSelectedScouts] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const item = selections[0];

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
  }

  function save() {
    if (!item) {
      setStatus({ kind: 'err', msg: 'Pick a requirement first.' });
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
    const items = Array.from(selectedScouts).map((sid) => ({
      scout_id: sid,
      kind: item.kind,
      code: item.code,
      label: item.label,
      unit: item.unit,
      qty: item.qty
    }));
    const fd = new FormData();
    fd.set('date', date);
    fd.set('by', by);
    fd.set('notes', notes);
    fd.set('items', JSON.stringify(items));

    startTransition(async () => {
      const res = await addLedgerEntries(fd);
      if (!res.ok) {
        setStatus({ kind: 'err', msg: res.error ?? 'Save failed' });
        return;
      }
      setStatus({
        kind: 'ok',
        msg: `Saved ${res.inserted} entr${res.inserted === 1 ? 'y' : 'ies'}.`
      });
      setSelectedScouts(new Set());
      setSelections([]);
      setNotes('');
      router.refresh();
    });
  }

  return (
    <div className={styles.card}>
      <h3>Requirement-First Bulk Entry</h3>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Requirement</span>
        <RequirementPicker
          catalog={catalog}
          selections={selections}
          onSelectionsChange={setSelections}
          completion={new Map()}
          multi={false}
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

      <div className={styles.field}>
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
          onClick={save}
          disabled={
            isPending ||
            !item ||
            selectedScouts.size === 0 ||
            !date ||
            !by
          }
          title={
            !item
              ? 'Pick a requirement first'
              : !date
                ? 'Date is required'
                : !by
                  ? 'Signed-Off By is required'
                  : selectedScouts.size === 0
                    ? 'Select at least one scout'
                    : undefined
          }
        >
          {isPending
            ? 'Saving…'
            : selectedScouts.size > 0
              ? `Save (${selectedScouts.size})`
              : 'Save'}
        </button>
      </div>
    </div>
  );
}
