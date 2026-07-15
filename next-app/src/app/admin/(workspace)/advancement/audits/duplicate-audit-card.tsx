'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { resolveDuplicateLedgerEntries } from './actions';
import type { DuplicateGroup } from './checks/duplicate-records';
import styles from './audits.module.css';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function DuplicateAuditCard({ group }: { group: DuplicateGroup }) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(group.defaultKeepId);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function resolve() {
    const deleteIds = group.records.filter((r) => r.id !== keepId).map((r) => r.id);
    if (deleteIds.length === 0) return;

    const fd = new FormData();
    fd.set('scout_id', group.scoutId);
    fd.set('keep_id', String(keepId));
    fd.set('delete_ids', JSON.stringify(deleteIds));

    startTransition(async () => {
      const res = await resolveDuplicateLedgerEntries(fd);
      if (!res.ok) {
        setStatus({ kind: 'err', msg: res.error ?? 'Save failed' });
        return;
      }
      setStatus({ kind: 'ok', msg: `Removed ${res.deleted} duplicate${res.deleted === 1 ? '' : 's'}.` });
      router.refresh();
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <Link href={`/scouts/${group.scoutId}`} className={styles.scoutLink}>
            {group.scoutName}
          </Link>
          <span className={styles.rankTag}>{group.kindLabel}</span>
        </div>
        <div className={styles.borContext}>{group.label}</div>
      </div>

      <div className={styles.dupRecordList}>
        {group.records.map((r) => (
          <label key={r.id} className={styles.dupRecordRow}>
            <input
              type="radio"
              name={`keep-${group.key}`}
              checked={keepId === r.id}
              onChange={() => setKeepId(r.id)}
            />
            <div className={styles.dupRecordMain}>
              <span>
                #{r.id} &mdash; {fmtDate(r.date)}
                {r.by && ` · signed off by ${r.by}`}
                {r.qty !== 1 && ` · ${r.qty} ${r.unit}`}
                {r.id === group.defaultKeepId && <span className={styles.dupDefaultTag}>Oldest — default keep</span>}
              </span>
              <span className={styles.dupRecordMeta}>
                Entered by {r.enteredBy ?? '—'} on {fmtDateTime(r.enteredAt)}
                {r.notes && ` · "${r.notes}"`}
              </span>
            </div>
          </label>
        ))}
      </div>

      <div className={styles.fillRow}>
        <button type="button" className={styles.saveBtn} onClick={resolve} disabled={isPending}>
          {isPending ? 'Saving…' : `Keep #${keepId}, delete ${group.records.length - 1}`}
        </button>
        {status && (
          <span className={status.kind === 'ok' ? styles.statusOk : styles.statusErr}>{status.msg}</span>
        )}
      </div>
    </div>
  );
}
