'use client';

import { useState, useTransition } from 'react';
import styles from './lookups.module.css';

type ActionResult = { ok: boolean; error?: string };

export interface NameRow {
  id: number;
  name: string;
}

interface Props {
  rows: NameRow[];
  /** Singular noun for labels/messages, e.g. "Event", "Service Project". */
  noun: string;
  onCreate: (formData: FormData) => Promise<ActionResult>;
  onUpdate: (formData: FormData) => Promise<ActionResult>;
  onDelete: (formData: FormData) => Promise<ActionResult>;
}

/**
 * Generic add / rename / delete editor for a name-only lookup table (events,
 * service projects, leadership positions). The three server actions are passed
 * in so one component drives every such lookup.
 */
export function NameLookupEditor({ rows, noun, onCreate, onUpdate, onDelete }: Props) {
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lower = noun.toLowerCase();

  function add() {
    const name = newName.trim();
    if (!name) return;
    setErr(null);
    const fd = new FormData();
    fd.set('name', name);
    startTransition(async () => {
      const res = await onCreate(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Add failed');
        return;
      }
      setNewName('');
    });
  }

  function rename(row: NameRow) {
    const next = window.prompt(`Rename ${lower}:`, row.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === row.name) return;
    setBusyId(row.id);
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('name', name);
    startTransition(async () => {
      const res = await onUpdate(fd);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'Rename failed');
    });
  }

  function remove(row: NameRow) {
    if (
      !window.confirm(
        `Delete ${lower} "${row.name}" from the pull-down?\n\nExisting ledger entries keep their recorded name — this only removes it from the picker.`
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
      <div className={styles.cardActions} style={{ gap: 8 }}>
        <input
          type="text"
          className={styles.editInput}
          style={{ maxWidth: 260 }}
          placeholder={`New ${lower} name`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className={styles.addBtn}
          onClick={add}
          disabled={isPending || !newName.trim()}
        >
          + Add {noun}
        </button>
      </div>

      {err && (
        <div className={styles.editError} style={{ marginBottom: 10 }}>
          {err}
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>{noun}</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={2} className={styles.muted}>
                None yet. Add one above, or they appear automatically as you log
                them in Fast Entry.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => rename(row)}
                    disabled={busyId === row.id}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className={`${styles.editBtn} ${styles.dangerBtn}`}
                    onClick={() => remove(row)}
                    disabled={busyId === row.id}
                    style={{ marginLeft: 6 }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
