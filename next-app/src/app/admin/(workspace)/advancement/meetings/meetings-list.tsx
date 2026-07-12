'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Meeting } from '@/lib/supabase/types';
import { formatLongDate } from '@/lib/dates';
import styles from './meetings.module.css';

interface Props {
  rows: Meeting[];
  defaultDate: string;
  onCreate: (fd: FormData) => Promise<{ ok: boolean; error?: string; id?: number }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
}

export function MeetingsList({ rows, defaultDate, onCreate, onDelete }: Props) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function create() {
    setErr(null);
    const fd = new FormData();
    fd.set('meeting_date', date);
    startTransition(async () => {
      const res = await onCreate(fd);
      if (!res.ok || !res.id) {
        setErr(res.error ?? 'Could not create the meeting.');
        return;
      }
      router.push(`/admin/advancement/meetings/${res.id}`);
    });
  }

  function remove(row: Meeting) {
    if (
      !window.confirm(
        `Delete the ${row.status} meeting for ${formatLongDate(row.meeting_date)}? Its agenda goes with it.`
      )
    ) {
      return;
    }
    setErr(null);
    setBusyId(row.id);
    startTransition(async () => {
      const res = await onDelete(row.id);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'Delete failed.');
    });
  }

  return (
    <>
      <div className={styles.toolbar}>
        <input
          type="date"
          className={styles.dateInput}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="New meeting date"
        />
        <button type="button" className={styles.addBtn} onClick={create} disabled={isPending || !date}>
          {isPending ? 'Creating…' : '+ New Meeting'}
        </button>
      </div>
      {err && <div className={styles.editError}>{err}</div>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Title</th>
            <th>Status</th>
            <th>Last edited</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className={styles.muted}>
                No meetings yet — pick a date above and create the first one.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <td className={styles.dateCell}>{row.meeting_date}</td>
                <td>
                  <Link href={`/admin/advancement/meetings/${row.id}`}>{row.title}</Link>
                </td>
                <td>
                  <span
                    className={`${styles.statusPill} ${
                      row.status === 'published' ? styles.statusPublished : styles.statusDraft
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className={styles.muted}>
                  {row.updated_by ?? '—'}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Link href={`/admin/advancement/meetings/${row.id}`} className={styles.editBtn}>
                    Open
                  </Link>
                  <button
                    type="button"
                    className={`${styles.editBtn} ${styles.dangerBtn}`}
                    onClick={() => remove(row)}
                    disabled={busyId === row.id}
                  >
                    {busyId === row.id ? '…' : 'Delete'}
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
