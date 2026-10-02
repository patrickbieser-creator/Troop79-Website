'use client';

/**
 * Lookups & Admin → Menu Monster stores: the list the price book's store
 * pickers offer (lib/menu-monster/stores.ts). Same shape as the Categories
 * editor — add panel on top, inline row edit with a dirty-gated Save and a
 * Cancel — plus Retire / Restore and move up / down. A store a package uses
 * can be retired but not deleted, so Delete is only offered for an unused
 * one (don't offer a button that can only ever fail). Retired stores sit
 * greyed at the bottom and are not offered in the pickers; packages keep
 * the name.
 */

import { useState, useTransition } from 'react';
import { SaveButton, SaveFeedback, useSavePhase } from '../../_components/save-state';
import { AddButton } from '../../_components/add-button';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { Button } from '../../../_components/button';
import { HelpBadge } from '../../../_components/help-badge';
import type { Store } from '@/lib/menu-monster/stores';
import { STORE_NAME_MAX } from '@/lib/menu-monster/stores';
import styles from './lookups.module.css';

type ActionResult = { ok: boolean; error?: string };

interface Props {
  rows: Store[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onRename: (fd: FormData) => Promise<ActionResult>;
  onRetire: (fd: FormData) => Promise<ActionResult>;
  onRestore: (fd: FormData) => Promise<ActionResult>;
  onDelete: (fd: FormData) => Promise<ActionResult>;
  onMove: (fd: FormData) => Promise<ActionResult>;
}

export function StoresEditor({ rows, onCreate, onRename, onRetire, onRestore, onDelete, onMove }: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const feedback = useSavePhase();

  const activeCount = rows.filter((r) => !r.retiredAt).length;

  function send(fn: (fd: FormData) => Promise<ActionResult>, fields: Record<string, string>, then?: () => void) {
    setErr(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(async () => {
      const res = await fn(fd);
      if (!res.ok) {
        setErr(res.error ?? 'That did not save.');
        return;
      }
      then?.();
    });
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    send(onCreate, { name }, () => {
      setNewName('');
      setAdding(false);
    });
  }

  function cancelAdd() {
    setNewName('');
    setErr(null);
    setAdding(false);
  }

  function beginEdit(row: Store) {
    setErr(null);
    setEditing(row.id);
    setEditName(row.name);
  }

  function saveEdit(row: Store) {
    const name = editName.trim();
    if (!name) return;
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(row.id));
    fd.set('name', name);
    feedback.start();
    startTransition(async () => {
      const res = await onRename(fd);
      if (!res.ok) {
        feedback.fail();
        setErr(res.error ?? 'Rename failed');
        return;
      }
      setEditing(null);
      feedback.done();
    });
  }

  function remove(row: Store) {
    if (!window.confirm(`Delete the store "${row.name}"?\n\nNo package uses it, so nothing else changes.`)) return;
    send(onDelete, { id: String(row.id) });
  }

  return (
    <>
      <SaveFeedback phase={feedback.phase} />
      <div className={styles.cardToolbar}>
        <AddButton onClick={() => setAdding(true)}>+ Add Store</AddButton>
      </div>

      {adding && (
        <div className={styles.addPanel}>
          <input
            type="text"
            className={`${styles.editInput} ${styles.inputMax260}`}
            placeholder="New store name"
            aria-label="New store name"
            maxLength={STORE_NAME_MAX}
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
          <div className={styles.addPanelActions}>
            <Button variant="secondary" size="sm" onClick={cancelAdd} disabled={isPending}>
              Cancel
            </Button>
            <AddButton onClick={add} disabled={isPending || !newName.trim()}>
              Add Store
            </AddButton>
          </div>
        </div>
      )}

      {err && <Notice>{err}</Notice>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Store</th>
            <th>Packages</th>
            <th>
              Status <HelpBadge id="stores.retired" />
            </th>
            <th className={styles.cellRight}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className={styles.muted}>
                No stores yet. Add one above and it appears in the price book.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const retired = !!row.retiredAt;
              if (editing === row.id) {
                return (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="text"
                        className={`${styles.editInput} ${styles.inputMax220}`}
                        aria-label={`Name for ${row.name}`}
                        maxLength={STORE_NAME_MAX}
                        value={editName}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveEdit(row);
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditing(null);
                          }
                        }}
                      />
                    </td>
                    <td className={styles.muted}>{row.packageCount}</td>
                    <td />
                    <td className={styles.cellRight}>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={isPending}>
                        Cancel
                      </Button>
                      <SaveButton
                        className={styles.gapLeft}
                        dirty={editName.trim() !== row.name}
                        pending={isPending}
                        blocked={!editName.trim()}
                        blockedReason="A name is required"
                        onClick={() => saveEdit(row)}
                      />
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={row.id} className={retired ? styles.muted : undefined}>
                  <td>{row.name}</td>
                  <td className={styles.muted}>{row.packageCount}</td>
                  <td>{retired ? <Badge variant="muted">Retired</Badge> : null}</td>
                  <td className={styles.cellRight}>
                    {!retired && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Move ${row.name} up`}
                          disabled={isPending || i === 0}
                          onClick={() => send(onMove, { id: String(row.id), direction: 'up' })}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className={styles.gapLeftSm}
                          aria-label={`Move ${row.name} down`}
                          disabled={isPending || i === activeCount - 1}
                          onClick={() => send(onMove, { id: String(row.id), direction: 'down' })}
                        >
                          ↓
                        </Button>
                      </>
                    )}
                    <Button variant="secondary" size="sm" className={styles.gapLeft} onClick={() => beginEdit(row)} disabled={isPending}>
                      Rename
                    </Button>
                    {retired ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className={styles.gapLeft}
                        disabled={isPending}
                        onClick={() => send(onRestore, { id: String(row.id) })}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        className={styles.gapLeft}
                        disabled={isPending}
                        onClick={() => send(onRetire, { id: String(row.id) })}
                      >
                        Retire
                      </Button>
                    )}
                    {row.packageCount === 0 && (
                      <Button variant="danger" size="sm" className={styles.gapLeft} disabled={isPending} onClick={() => remove(row)}>
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </>
  );
}
