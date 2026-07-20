'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setScoutbookSubmitted, setPresented } from '../ledger/actions';
import { initialsFor } from '@/lib/initials';
import type { LedgerEntry, LedgerKind } from '@/lib/supabase/types';
import styles from './records.module.css';

export interface RecordRowVM extends LedgerEntry {
  scoutName: string;
  awardLabel: string;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  rank_requirement: 'Rank req',
  rank_award: 'Rank',
  merit_badge_requirement: 'MB req',
  merit_badge_award: 'Merit Badge',
  service_hours: 'Service',
  camping_nights: 'Campout',
  hiking_miles: 'Hike',
  day_outing: 'Day Outing',
  fundraiser: 'Fundraiser',
  leadership: 'Leadership',
  award: 'Special Award',
  meeting_attendance: 'Meeting'
};
const KIND_CLASS: Record<LedgerKind, string> = {
  rank_requirement: '',
  rank_award: styles.kindRank,
  merit_badge_requirement: '',
  merit_badge_award: styles.kindMb,
  service_hours: '',
  camping_nights: '',
  hiking_miles: '',
  day_outing: '',
  fundraiser: '',
  leadership: '',
  award: styles.kindAward,
  meeting_attendance: ''
};

export function RecordsTable({ rows }: { rows: RecordRowVM[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Scout</th>
            <th>Type</th>
            <th>Award</th>
            <th>Submitted to Scoutbook</th>
            <th>Presented to Scout</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.empty}>
                No records match the current filters.
              </td>
            </tr>
          ) : (
            rows.map((r) => <Row key={r.id} row={r} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row }: { row: RecordRowVM }) {
  return (
    <tr>
      <td className={styles.nowrap}>{row.date}</td>
      <td className={styles.nowrap}>{row.scoutName}</td>
      <td className={styles.nowrap}>
        <span className={`${styles.kindPill} ${KIND_CLASS[row.kind]}`}>{KIND_LABEL[row.kind]}</span>
      </td>
      <td>{row.awardLabel}</td>
      <td>
        <ConfirmCell
          id={row.id}
          at={row.scoutbook_submitted_at}
          by={row.scoutbook_submitted_by}
          action={setScoutbookSubmitted}
          label="submitted"
        />
      </td>
      <td>
        <ConfirmCell
          id={row.id}
          at={row.presented_at}
          by={row.presented_by}
          action={setPresented}
          label="presented"
        />
      </td>
    </tr>
  );
}

function ConfirmCell({
  id,
  at,
  by,
  action,
  label
}: {
  id: number;
  at: string | null;
  by: string | null;
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  label: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const checked = !!at;

  function toggle() {
    const turningOn = !checked;
    if (!turningOn) {
      const ok = window.confirm(`Un-check ${label}? This clears the who/when record.`);
      if (!ok) return;
    }
    setErr(null);
    const fd = new FormData();
    fd.set('id', String(id));
    fd.set('on', turningOn ? '1' : '0');
    startTransition(async () => {
      const res = await action(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Failed to update');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <label className={styles.confirmCell}>
        <input type="checkbox" checked={checked} disabled={isPending} onChange={toggle} />
        {checked ? (
          <span className={styles.confirmMeta}>
            {at!.slice(0, 10)}
            {by && <span title={by}> · {initialsFor(by)}</span>}
          </span>
        ) : (
          <span className={styles.confirmMuted}>not yet</span>
        )}
      </label>
      {err && <span className={styles.confirmError}>{err}</span>}
    </div>
  );
}
