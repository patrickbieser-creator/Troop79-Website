'use client';

/**
 * Manage Kinds — the self-service half of the transaction_kinds lookup
 * (2026-08-20). "+ New Kind" already lived in the bulk-reassign bar; this is
 * where a Kind gets renamed or removed once nothing references it anymore
 * (Patrick, after retiring 'income': "How do I make Income not appear in
 * the kind pull-down?"). Same governance shape as calendar_categories:
 * rename cascades to every transaction automatically (ON UPDATE CASCADE);
 * delete is refused by the database, not guessed at here, when a
 * transaction still uses it (ON DELETE RESTRICT) — the friendly translation
 * of that error lives in deleteTransactionKindAction.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renameTransactionKindAction, deleteTransactionKindAction } from './actions';
import type { TransactionKindRow } from '@/lib/finance';
import styles from './finance.module.css';

export function KindManager({ kinds }: { kinds: TransactionKindRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, start] = useTransition();

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
    <details className={styles.kindManager} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Manage Kinds ({kinds.length})</summary>
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
    </details>
  );
}
