'use client';

/**
 * Manage Kinds — the self-service half of the transaction_kinds lookup
 * (2026-08-20). Add, rename, or remove a Kind (Patrick, after retiring
 * 'income': "How do I make Income not appear in the kind pull-down?"). Same
 * governance shape as calendar_categories: rename cascades to every
 * transaction automatically (ON UPDATE CASCADE); delete is refused by the
 * database, not guessed at here, when a transaction still uses it (ON
 * DELETE RESTRICT) — the friendly translation of that error lives in
 * deleteTransactionKindAction. Content only, no dialog/details chrome of
 * its own — hosted inside FinanceWorkspace's shared Actions modal, which
 * owns show/hide. The bulk-reassign bar's own "+ New Kind" (same
 * createTransactionKindAction) stays separate — that one exists to keep a
 * treasurer from leaving the reassignment flow mid-task, this one is for
 * general list upkeep.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTransactionKindAction, renameTransactionKindAction, deleteTransactionKindAction } from './actions';
import type { TransactionKindRow } from '@/lib/finance';
import styles from './finance.module.css';

export function KindManager({ kinds }: { kinds: TransactionKindRow[] }) {
  const router = useRouter();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  function add() {
    const name = newName.trim();
    if (!name) return;
    setErr(null);
    const fd = new FormData();
    fd.set('code', name);
    fd.set('label', name);
    start(async () => {
      const res = await createTransactionKindAction(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Add failed.');
        return;
      }
      setNewName('');
      setAdding(false);
      router.refresh();
    });
  }

  function rename(row: TransactionKindRow) {
    const nextLabel = window.prompt(`Rename "${row.label}" to:`, row.label);
    if (nextLabel === null) return;
    const label = nextLabel.trim();
    if (!label || label === row.label) return;
    setErr(null);
    setBusyCode(row.code);
    const fd = new FormData();
    fd.set('original_code', row.code);
    // Renaming the code alongside the label keeps them in sync for a
    // brand-new-style code (lowercase_underscore); the server normalizes
    // it the same way createTransactionKindAction does.
    fd.set('code', label);
    fd.set('label', label);
    start(async () => {
      const res = await renameTransactionKindAction(fd);
      setBusyCode(null);
      if (!res.ok) {
        setErr(res.error ?? 'Rename failed.');
        return;
      }
      router.refresh();
    });
  }

  function remove(row: TransactionKindRow) {
    if (!window.confirm(`Remove "${row.label}" from the Kind pull-down?\n\nOnly possible if no transaction still uses it.`)) {
      return;
    }
    setErr(null);
    setBusyCode(row.code);
    const fd = new FormData();
    fd.set('code', row.code);
    start(async () => {
      const res = await deleteTransactionKindAction(fd);
      setBusyCode(null);
      if (!res.ok) {
        setErr(res.error ?? 'Delete failed.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.kindManager}>
      {err && <p className={styles.empty}>{err}</p>}
      <ul className={styles.kindManagerList}>
        {kinds.map((k) => (
          <li key={k.code}>
            <span>
              {k.label}
              {k.label !== k.code && <span className={styles.muted}> ({k.code})</span>}
            </span>
            <span>
              <button
                type="button"
                className={styles.saveBtnAlt}
                onClick={() => rename(k)}
                disabled={isPending && busyCode === k.code}
              >
                Rename
              </button>
              <button
                type="button"
                className={styles.saveBtnAlt}
                onClick={() => remove(k)}
                disabled={isPending && busyCode === k.code}
              >
                {isPending && busyCode === k.code ? '…' : 'Delete'}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className={styles.kindManagerAddRow}>
          <input
            type="text"
            placeholder="New Kind name"
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
          <button type="button" className={styles.saveBtn} onClick={add} disabled={!newName.trim() || isPending}>
            Add
          </button>
          <button type="button" className={styles.saveBtnAlt} onClick={() => setAdding(false)} disabled={isPending}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className={styles.saveBtnAlt} onClick={() => setAdding(true)} disabled={isPending}>
          + Add Kind
        </button>
      )}
    </div>
  );
}
