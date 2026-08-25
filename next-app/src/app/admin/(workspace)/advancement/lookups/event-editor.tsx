'use client';

import { useMemo, useState, useTransition } from 'react';
import { useLookupTable } from './use-lookup-table';
import { DatePickerField } from '../../_components/date-picker-field';
import styles from './lookups.module.css';
import { AddButton } from '../../_components/add-button';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';

type ActionResult = { ok: boolean; error?: string };

export interface EventRow {
  id: number;
  name: string;
  default_kind: string | null;
  start_date: string | null;
}

interface Props {
  rows: EventRow[];
  onCreate: (formData: FormData) => Promise<ActionResult>;
  onUpdate: (formData: FormData) => Promise<ActionResult>;
  onDelete: (formData: FormData) => Promise<ActionResult>;
}

/** The event-tab kinds an event can be classified as. Campout/Hike are
 *  already implied by Nights/Miles once logged, but still get a stored
 *  default so the Type never needs re-picking for a recurring event. */
const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'camping_nights', label: 'Campout' },
  { value: 'hiking_miles', label: 'Hike' },
  { value: 'day_outing', label: 'Day Outing' },
  { value: 'fundraiser', label: 'Fundraiser' }
];
const KIND_NAME = new Map(KIND_OPTIONS.map((o) => [o.value, o.label]));

/**
 * Add / rename / reclassify / delete editor for the Events lookup — drives
 * the Fast Entry Events tab's pull-down. Unlike the plain name-only lookups
 * (Service Projects, Leadership Positions), each event also carries a stored
 * Type classification so Fast Entry can resolve the ledger kind automatically
 * when a leader picks a recurring event, instead of asking every time.
 */
type SortKey = 'name' | 'start_date';

export function EventEditor({ rows, onCreate, onUpdate, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState('');
  const [newDate, setNewDate] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Newest-first by default — matches the Fast Entry picker's ordering.
  const [sortKey, setSortKey] = useState<SortKey>('start_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'start_date') {
        // Undated events always sort after dated ones, regardless of direction.
        if (!a.start_date && !b.start_date) cmp = 0;
        else if (!a.start_date) return 1;
        else if (!b.start_date) return -1;
        else cmp = a.start_date.localeCompare(b.start_date);
      } else {
        cmp = a.name.localeCompare(b.name);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const t = useLookupTable(sorted, (r) => r.name, { alwaysSearch: true });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'start_date' ? 'desc' : 'asc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function add() {
    const name = newName.trim();
    if (!name || !newKind) return;
    setErr(null);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('default_kind', newKind);
    fd.set('start_date', newDate);
    startTransition(async () => {
      const res = await onCreate(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Add failed');
        return;
      }
      setNewName('');
      setNewKind('');
      setNewDate('');
      setAdding(false);
    });
  }

  function cancelAdd() {
    setNewName('');
    setNewKind('');
    setNewDate('');
    setErr(null);
    setAdding(false);
  }

  function rename(row: EventRow) {
    const next = window.prompt('Rename event:', row.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === row.name) return;
    setBusyId(row.id);
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('name', name);
    fd.set('default_kind', row.default_kind ?? '');
    fd.set('start_date', row.start_date ?? '');
    startTransition(async () => {
      const res = await onUpdate(fd);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'Rename failed');
    });
  }

  function reclassify(row: EventRow, kind: string) {
    setBusyId(row.id);
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('name', row.name);
    fd.set('default_kind', kind);
    fd.set('start_date', row.start_date ?? '');
    startTransition(async () => {
      const res = await onUpdate(fd);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'Reclassify failed');
    });
  }

  function changeDate(row: EventRow, date: string) {
    setBusyId(row.id);
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('name', row.name);
    fd.set('default_kind', row.default_kind ?? '');
    fd.set('start_date', date);
    startTransition(async () => {
      const res = await onUpdate(fd);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'Date update failed');
    });
  }

  function remove(row: EventRow) {
    if (
      !window.confirm(
        `Delete event "${row.name}" from the pull-down?\n\nExisting ledger entries keep their recorded name — this only removes it from the picker.`
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(row.id));
    startTransition(async () => {
      const res = await onDelete(fd);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'Delete failed');
    });
  }

  return (
    <>
      <div className={styles.cardToolbar}>
        {t.searchEl}
        <AddButton onClick={() => setAdding(true)}>+ Add Event</AddButton>
      </div>

      {adding && (
        <div className={styles.addPanel}>
          <input
            type="text"
            className={`${styles.editInput} ${styles.inputMax220}`}
            placeholder="New event name"
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelAdd();
              }
            }}
          />
          <DatePickerField className={styles.dateField} value={newDate} onChange={setNewDate} />
          <select
            className={`${styles.editInput} ${styles.inputMax160}`}
            value={newKind}
            onChange={(e) => setNewKind(e.target.value)}
          >
            <option value="">— Type —</option>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className={styles.addPanelActions}>
            <Button variant="secondary" size="sm" onClick={cancelAdd} disabled={isPending}>
              Cancel
            </Button>
            <AddButton onClick={add} disabled={isPending || !newName.trim() || !newKind}>
              Add Event
            </AddButton>
          </div>
        </div>
      )}

      {err && <Notice>{err}</Notice>}

      <div className={t.scrollClass}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>
              <button type="button" className={styles.sortHeaderBtn} onClick={() => toggleSort('name')}>
                Event{sortIndicator('name')}
              </button>
            </th>
            <th>
              <button
                type="button"
                className={styles.sortHeaderBtn}
                onClick={() => toggleSort('start_date')}
              >
                Start Date{sortIndicator('start_date')}
              </button>
            </th>
            <th>Type</th>
            <th className={styles.cellRight}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className={styles.muted}>
                None yet. Add one above, or they appear automatically as you log
                them in Fast Entry.
              </td>
            </tr>
          ) : (
            t.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>
                  <DatePickerField
                    className={styles.dateField}
                    value={row.start_date ?? ''}
                    onChange={(date) => changeDate(row, date)}
                    disabled={busyId === row.id}
                  />
                </td>
                <td>
                  <select
                    className={styles.editInput}
                    value={row.default_kind ?? ''}
                    onChange={(e) => reclassify(row, e.target.value)}
                    disabled={busyId === row.id}
                    title={
                      row.default_kind
                        ? undefined
                        : 'Unclassified — Fast Entry will ask for a Type each time this event is logged with no Nights/Miles'
                    }
                  >
                    <option value="">— Unclassified —</option>
                    {KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={styles.cellRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => rename(row)}
                    disabled={busyId === row.id}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className={styles.gapLeft}
                    onClick={() => remove(row)}
                    disabled={busyId === row.id}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      {t.footerEl}
    </>
  );
}

export { KIND_NAME as EVENT_KIND_NAME, KIND_OPTIONS as EVENT_KIND_OPTIONS };
