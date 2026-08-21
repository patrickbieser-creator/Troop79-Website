'use client';

import { useState, useTransition } from 'react';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';
import { AddButton } from '../../_components/add-button';
import { Notice } from '../../_components/notice';

type ActionResult = { ok: boolean; error?: string };

export interface SkillRow {
  id: string;
  name: string;
  youth_teachable: boolean;
}

interface Props {
  rows: SkillRow[];
  onCreate: (formData: FormData) => Promise<ActionResult>;
  onUpdate: (formData: FormData) => Promise<ActionResult>;
  onDelete: (formData: FormData) => Promise<ActionResult>;
}

/**
 * Skills taxonomy editor: add / rename / delete, plus the youth-teachable
 * toggle that decides whether a skill can ever be assigned to a scout
 * instructor on the Meeting Plan.
 */
export function SkillsEditor({ rows, onCreate, onUpdate, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newYouth, setNewYouth] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = useLookupTable(rows, (r) => r.name, { alwaysSearch: true });

  function add() {
    const name = newName.trim();
    if (!name) return;
    setErr(null);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('youth_teachable', String(newYouth));
    startTransition(async () => {
      const res = await onCreate(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Add failed');
        return;
      }
      setNewName('');
      setNewYouth(false);
      setAdding(false);
    });
  }

  function cancelAdd() {
    setNewName('');
    setNewYouth(false);
    setErr(null);
    setAdding(false);
  }

  function rename(row: SkillRow) {
    const next = window.prompt('Rename skill:', row.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === row.name) return;
    save(row, { name });
  }

  function toggleYouth(row: SkillRow) {
    save(row, { youth_teachable: !row.youth_teachable });
  }

  function save(row: SkillRow, patch: Partial<Pick<SkillRow, 'name' | 'youth_teachable'>>) {
    setBusyId(row.id);
    setErr(null);
    const fd = new FormData();
    fd.set('id', row.id);
    fd.set('name', patch.name ?? row.name);
    fd.set('youth_teachable', String(patch.youth_teachable ?? row.youth_teachable));
    startTransition(async () => {
      const res = await onUpdate(fd);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'Update failed');
    });
  }

  function remove(row: SkillRow) {
    if (
      !window.confirm(
        `Delete skill "${row.name}"?\n\nRequirements tagged with it lose their teacher matching; leader and scout-instructor assignments for it are removed.`
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setErr(null);
    const fd = new FormData();
    fd.set('id', row.id);
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
        <AddButton onClick={() => setAdding(true)}>+ Add Skill</AddButton>
      </div>

      {adding && (
        <div className={styles.addPanel}>
          <input
            type="text"
            className={styles.editInput}
            style={{ maxWidth: 220 }}
            placeholder="New skill name"
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
          <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={newYouth}
              onChange={(e) => setNewYouth(e.target.checked)}
            />
            Older scout may teach
          </label>
          <div className={styles.addPanelActions}>
            <button type="button" className={styles.editBtn} onClick={cancelAdd} disabled={isPending}>
              Cancel
            </button>
            <AddButton onClick={add} disabled={isPending || !newName.trim()}>
              Add Skill
            </AddButton>
          </div>
        </div>
      )}

      {err && <Notice>{err}</Notice>}

      <div className={t.scrollClass}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Skill</th>
            <th>Older scout may teach</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={row.youth_teachable}
                    disabled={busyId === row.id}
                    onChange={() => toggleYouth(row)}
                  />
                  {row.youth_teachable ? 'Yes' : 'Adults only'}
                </label>
              </td>
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
          ))}
        </tbody>
      </table>
      </div>
      {t.footerEl}
    </>
  );
}
