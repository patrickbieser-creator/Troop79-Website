'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useLookupTable } from './use-lookup-table';
import styles from './lookups.module.css';
import { AddButton } from '../../_components/add-button';
import { Notice } from '../../_components/notice';
import { ActionsMenu } from '../../_components/actions-menu';
import { SaveButton, SaveFeedback, useSavedSnapshot, useSavePhase } from '../../_components/save-state';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { Button } from '../../../_components/button';
import {
  createRequirementClass,
  deleteRequirementClass,
  setRequirementClassRetired,
  updateRequirementClass
} from './requirement-class-actions';
import type { RequirementClass } from '@/lib/requirement-class';

export interface RequirementClassRow extends RequirementClass {
  /** Requirements tagged with it (rank and merit badge, every depth). */
  usedBy: number;
}

/**
 * Requirement classes (Plans/Requirement-Classification.md): the tags that say where a requirement can be done. Add,
 * Edit (name and description; the code never changes), Retire / Restore, and Delete for a class nothing uses. A used
 * class is retired instead: it stays on the requirements that have it and can't be added to more.
 */
export function RequirementClassesEditor({ rows }: { rows: RequirementClassRow[] }) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<RequirementClassRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = useLookupTable(rows, (r) => `${r.code} ${r.name} ${r.description}`, { alwaysSearch: true });

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (editing && !dlg.open) dlg.showModal();
    if (!editing && dlg.open) dlg.close();
  }, [editing]);

  function cancelAdd() {
    setCode('');
    setName('');
    setDescription('');
    setErr(null);
    setAdding(false);
  }

  function add() {
    setErr(null);
    if (!/^[A-Za-z]$/.test(code.trim())) return setErr('The code is one letter, A to Z.');
    if (!name.trim()) return setErr('Give the class a name.');
    const fd = new FormData();
    fd.set('code', code.trim());
    fd.set('name', name.trim());
    fd.set('description', description.trim());
    startTransition(async () => {
      const res = await createRequirementClass(fd);
      if (!res.ok) return setErr(res.error ?? 'Add failed');
      cancelAdd();
    });
  }

  function act(row: RequirementClassRow, action: string) {
    if (action === 'edit') return setEditing(row);
    const fd = new FormData();
    fd.set('code', row.code);
    if (action === 'retire' || action === 'restore') {
      fd.set('retired', String(action === 'retire'));
    } else if (action === 'delete') {
      if (!window.confirm(`Delete class ${row.code} ${row.name}?\n\nNo requirement uses it, so nothing else changes.`)) return;
    }
    setErr(null);
    startTransition(async () => {
      const res = action === 'delete' ? await deleteRequirementClass(fd) : await setRequirementClassRetired(fd);
      if (!res.ok) setErr(res.error ?? 'Change failed');
    });
  }

  return (
    <>
      <div className={styles.cardToolbar}>
        {t.searchEl}
        <AddButton onClick={() => setAdding(true)}>+ Add Class</AddButton>
      </div>

      {adding && (
        <div className={styles.addPanel}>
          <input
            type="text"
            className={`${styles.editInput} ${styles.editInputMono} ${styles.inputMax64}`}
            aria-label="Code (one letter)"
            placeholder="Code"
            maxLength={1}
            value={code}
            autoFocus
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <input
            type="text"
            className={`${styles.editInput} ${styles.inputMax220}`}
            aria-label="Name"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="text"
            className={styles.editInput}
            aria-label="Description"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <div className={styles.addPanelActions}>
            <Button variant="secondary" size="sm" onClick={cancelAdd} disabled={isPending}>
              Cancel
            </Button>
            <AddButton onClick={add} disabled={isPending || (!code.trim() && !name.trim())}>
              Add Class
            </AddButton>
          </div>
        </div>
      )}

      {err && <Notice>{err}</Notice>}

      <div className={t.scrollClass}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Class</th>
              <th>Description</th>
              <th className={styles.cellRight}>Requirements</th>
              <th className={styles.cellRight}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.code}>
                <td className={styles.codeCell}>{r.code}</td>
                <td>
                  {r.name}
                  {r.retired && <span className={`${styles.tag} ${styles.gapLeftSm}`}>Retired</span>}
                </td>
                <td>{r.description}</td>
                <td className={styles.cellRight}>{r.usedBy}</td>
                <td className={styles.cellRight}>
                  <ActionsMenu
                    ariaLabel={`Actions for class ${r.code}`}
                    placeholder="⋯"
                    disabled={isPending}
                    options={[
                      { value: 'edit', label: 'Edit' },
                      r.retired ? { value: 'restore', label: 'Restore' } : { value: 'retire', label: 'Retire' },
                      // A used class can only be retired; the menu says so rather than hiding Delete.
                      { value: 'delete', label: r.usedBy ? `Delete (in use: retire instead)` : 'Delete', disabled: r.usedBy > 0 }
                    ]}
                    onAction={(v) => act(r, v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.footerEl}

      <Dialog ref={dialogRef} onClose={() => setEditing(null)}>
        {editing && <ClassForm row={editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

function ClassForm({ row, onClose }: { row: RequirementClassRow; onClose: () => void }) {
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { dirty } = useSavedSnapshot(JSON.stringify({ name, description }));
  const feedback = useSavePhase();

  function submit() {
    setErr(null);
    if (!name.trim()) return setErr('Give the class a name.');
    const fd = new FormData();
    fd.set('code', row.code);
    fd.set('name', name.trim());
    fd.set('description', description.trim());
    feedback.start();
    startTransition(async () => {
      const res = await updateRequirementClass(fd);
      if (!res.ok) {
        feedback.fail();
        return setErr(res.error ?? 'Save failed');
      }
      feedback.doneThen(onClose);
    });
  }

  return (
    <>
      <DialogHeader title={`Editing ${row.code} ${row.name}`} sub="The code stays; it is how requirements are tagged." />
      <DialogBody>
        <div className={styles.fieldGrid}>
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>Name</span>
            <input
              type="text"
              value={name}
              aria-invalid={!name.trim() || undefined}
              onChange={(e) => setName(e.target.value)}
              className={styles.editInput}
            />
          </label>
          <label className={styles.editFieldFull}>
            <span className={styles.editLabel}>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={styles.editInput} rows={3} />
          </label>
        </div>
        {err && <Notice>{err}</Notice>}
      </DialogBody>
      <DialogActions>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <SaveButton dirty={dirty} pending={isPending} onClick={submit} />
        <SaveFeedback phase={feedback.phase} />
      </DialogActions>
    </>
  );
}
