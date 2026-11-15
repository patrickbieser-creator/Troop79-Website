'use client';

/**
 * Lookups & Admin › Schools (Plans/Person-Record-One-Save.md "Schools"; lib/schools.ts). The list every school
 * picker offers: name, short name, how many scouts use it, and one Actions menu per row —
 *   Rename…                  name + short name, dirty-gated Save in a dialog (Cancel discards)
 *   Merge into another…      pick the school to keep; its scouts move there and this one is deleted (danger dialog)
 *   Hide / Unhide            hidden schools leave the pickers; scouts who have one keep it
 *   Delete…                  only offered when no scout uses it (danger dialog)
 * "+ Add school" sits in the toolbar for a school nobody has picked yet; the pickers add one in place too.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ActionsMenu } from '../../_components/actions-menu';
import { AddButton } from '../../_components/add-button';
import { Badge } from '../../_components/badge';
import { Dialog, DialogActions, DialogBody, DialogHeader } from '../../_components/dialog';
import { Notice } from '../../_components/notice';
import { SaveButton, SaveProblem } from '../../_components/save-state';
import { SearchField, useTableSearch } from '../../_components/search-field';
import { Button } from '../../../_components/button';
import { SCHOOL_NAME_MAX, SCHOOL_SHORT_NAME_MAX, cleanSchoolName, type SchoolWithUsage } from '@/lib/schools';
import styles from './lookups.module.css';

type ActionResult = { ok: boolean; error?: string };
type Open = { kind: 'rename' | 'merge' | 'delete'; school: SchoolWithUsage } | null;

const searchFields = (s: SchoolWithUsage) => [s.name, s.short_name];
const plural = (n: number) => `${n} scout${n === 1 ? '' : 's'}`;

export function SchoolsManager({
  schools,
  onAdd,
  onRename,
  onMerge,
  onSetActive,
  onDelete
}: {
  schools: SchoolWithUsage[];
  onAdd: (name: string) => Promise<ActionResult>;
  onRename: (id: number, name: string, shortName: string | null) => Promise<ActionResult>;
  onMerge: (loserId: number, survivorId: number) => Promise<ActionResult>;
  onSetActive: (id: number, active: boolean) => Promise<ActionResult>;
  onDelete: (id: number) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [tried, setTried] = useState(false);
  const [survivor, setSurvivor] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  const sorted = [...schools].sort((a, b) => Number(!a.active) - Number(!b.active) || a.name.localeCompare(b.name));
  const { q: query, setQ: setQuery, visible: rows } = useTableSearch(sorted, searchFields);
  const total = sorted.length;

  function run(fn: () => Promise<ActionResult>, then?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'That did not save.');
        return;
      }
      then?.();
      router.refresh();
    });
  }

  function openDialog(kind: 'rename' | 'merge' | 'delete', school: SchoolWithUsage) {
    setError(null);
    setTried(false);
    setName(school.name);
    setShortName(school.short_name ?? '');
    setSurvivor('');
    setOpen({ kind, school });
  }

  function add() {
    const n = cleanSchoolName(newName);
    if (!n) return;
    run(
      () => onAdd(n),
      () => {
        setNewName('');
        setAdding(false);
      }
    );
  }

  const target = open?.kind === 'merge' ? schools.find((x) => String(x.id) === survivor) : undefined;
  const nameBlank = cleanSchoolName(name) === '';
  const renameDirty =
    open?.kind === 'rename' &&
    (cleanSchoolName(name) !== open.school.name || (cleanSchoolName(shortName) || null) !== (open.school.short_name ?? null));

  return (
    <>
      <div className={styles.cardToolbar}>
        <SearchField value={query} onChange={setQuery} label="Search schools" resultCount={rows.length} totalCount={total} />
        <AddButton onClick={() => setAdding(true)}>+ Add school</AddButton>
      </div>

      {adding && (
        <div className={styles.addPanel}>
          <input
            type="text"
            className={`${styles.editInput} ${styles.inputMax260}`}
            placeholder="Full school name"
            aria-label="New school name"
            maxLength={SCHOOL_NAME_MAX}
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
                setAdding(false);
                setNewName('');
              }
            }}
          />
          <div className={styles.addPanelActions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                setAdding(false);
                setNewName('');
              }}
            >
              Cancel
            </Button>
            <AddButton onClick={add} disabled={pending || !cleanSchoolName(newName)}>
              Add school
            </AddButton>
          </div>
        </div>
      )}

      {error && !open && <Notice>{error}</Notice>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>School</th>
            <th>Short name</th>
            <th>Scouts</th>
            <th>Status</th>
            <th className={styles.cellRight}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className={styles.muted}>
                {total === 0 ? 'No schools yet. Add one here, or from any school field.' : 'No school matches.'}
              </td>
            </tr>
          ) : (
            rows.map((sch) => (
              <tr key={sch.id}>
                <td>{sch.name}</td>
                <td>{sch.short_name ?? ''}</td>
                <td>{sch.scoutCount}</td>
                <td>{sch.active ? null : <Badge variant="muted">Hidden</Badge>}</td>
                <td className={styles.cellRight}>
                  <ActionsMenu
                    ariaLabel={`Actions — ${sch.name}`}
                    disabled={pending}
                    options={[
                      { value: 'rename', label: 'Rename…' },
                      { value: 'merge', label: 'Merge into another school…', disabled: schools.length < 2 },
                      { value: 'toggle', label: sch.active ? 'Hide from pickers' : 'Unhide' },
                      ...(sch.scoutCount === 0 ? [{ value: 'delete', label: 'Delete…' }] : [])
                    ]}
                    onAction={(v) => {
                      if (v === 'toggle') run(() => onSetActive(sch.id, !sch.active));
                      else if (v === 'rename' || v === 'merge' || v === 'delete') openDialog(v, sch);
                    }}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <p className={styles.hint}>
        A school in use can&rsquo;t be deleted: merge it into the right one, or hide it so it stops being offered.
      </p>

      <Dialog ref={dialogRef} danger={open?.kind === 'merge' || open?.kind === 'delete'} onClose={() => setOpen(null)}>
        {open?.kind === 'rename' && (
          <>
            <DialogHeader title={`Rename “${open.school.name}”`} sub={`${plural(open.school.scoutCount)} see the new name.`} />
            <DialogBody>
              <div className={styles.fieldGrid}>
                <label className={styles.editField}>
                  <span className={styles.editLabel}>Name</span>
                  <input
                    type="text"
                    className={styles.editInput}
                    value={name}
                    maxLength={SCHOOL_NAME_MAX}
                    aria-invalid={tried && nameBlank ? true : undefined}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className={styles.editField}>
                  <span className={styles.editLabel}>Short name (optional)</span>
                  <input
                    type="text"
                    className={styles.editInput}
                    value={shortName}
                    maxLength={SCHOOL_SHORT_NAME_MAX}
                    placeholder="e.g. SIS"
                    onChange={(e) => setShortName(e.target.value)}
                  />
                </label>
              </div>
              {error && <Notice>{error}</Notice>}
            </DialogBody>
            <DialogActions>
              {tried && nameBlank && <SaveProblem reason="a school needs a name" />}
              <Button variant="secondary" disabled={pending} onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <SaveButton
                dirty={renameDirty}
                pending={pending}
                blocked={nameBlank}
                onBlocked={() => setTried(true)}
                onClick={() => run(() => onRename(open.school.id, name, shortName || null), () => setOpen(null))}
              />
            </DialogActions>
          </>
        )}
        {open?.kind === 'merge' && (
          <>
            <DialogHeader title={`Merge “${open.school.name}” into another school?`} />
            <DialogBody>
              <label className={styles.editField}>
                <span className={styles.editLabel}>Keep this school</span>
                <select className={styles.editInput} value={survivor} onChange={(e) => setSurvivor(e.target.value)}>
                  <option value="">Pick the school to keep…</option>
                  {sorted
                    .filter((x) => x.id !== open.school.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.active ? '' : ' (hidden)'}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                {target
                  ? `${plural(open.school.scoutCount)} move to “${target.name}”, and “${open.school.name}” is deleted. This can’t be undone.`
                  : `Its ${plural(open.school.scoutCount)} move to the school you pick, and “${open.school.name}” is deleted.`}
              </p>
              {error && <Notice>{error}</Notice>}
            </DialogBody>
            <DialogActions>
              <Button variant="secondary" disabled={pending} onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button
                variant="dangerSolid"
                disabled={pending || !target}
                onClick={() => target && run(() => onMerge(open.school.id, target.id), () => setOpen(null))}
              >
                {target ? `Merge into “${target.name}”` : 'Merge'}
              </Button>
            </DialogActions>
          </>
        )}
        {open?.kind === 'delete' && (
          <>
            <DialogHeader title={`Delete the school “${open.school.name}”?`} />
            <DialogBody>
              <p>No scout uses it. It leaves every school picker. This can&rsquo;t be undone.</p>
              {error && <Notice>{error}</Notice>}
            </DialogBody>
            <DialogActions>
              <Button variant="secondary" disabled={pending} onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button variant="dangerSolid" disabled={pending} onClick={() => run(() => onDelete(open.school.id), () => setOpen(null))}>
                Delete “{open.school.name}”
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
