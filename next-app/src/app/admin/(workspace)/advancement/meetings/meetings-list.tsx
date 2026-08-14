'use client';

/**
 * The meetings table — now the Roll Call work list rather than a second door
 * for creating meetings.
 *
 * Calendar unification: a meeting is created as the agenda layer of a calendar
 * entry, from the Calendar workbench, so the "+ New Meeting" form is gone from
 * here. What remains is what this screen was actually used for day to day —
 * finding a meeting to take attendance for, and opening an agenda to edit.
 *
 * Roll Call deliberately stays its own route (it is a data-entry session, not
 * editing), which is why this list stays under Planning instead of folding into
 * the workbench.
 *
 * Built for a couple hundred rows (attendance history back to 2022), so
 * filtering/sorting/pagination are client-side — the full list is small enough
 * to ship and slice locally.
 */

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { formatLongDate } from '@/lib/dates';
import styles from './meetings.module.css';

const PAGE_SIZE = 25;

/** A meeting plus the date and id of the calendar entry it is a layer of. The
 *  entry owns the date; meetings.entry_date is no longer read. */
export interface MeetingRow {
  id: number;
  title: string;
  status: string;
  updated_by: string | null;
  entry_id: number;
  entry_date: string;
}

interface Props {
  rows: MeetingRow[];
  attendance: Record<string, { scouts: number; leaders: number }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
}

export function MeetingsList({ rows, attendance, onDelete }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const [q, setQ] = useState('');
  const [year, setYear] = useState('all');
  const [status, setStatus] = useState('all');
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);

  const years = useMemo(
    () => [...new Set(rows.map((r) => r.entry_date.slice(0, 4)))].sort().reverse(),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (year !== 'all' && !r.entry_date.startsWith(year)) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (needle && !`${r.title} ${r.entry_date}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    return dir === 'desc'
      ? list
      : [...list].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  }, [rows, q, year, status, dir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetPage() {
    setPage(1);
  }

  /*
   * The "first FREE Sunday" seed for the create form is gone with the form.
   * Its entire premise was that a date could be TAKEN — one meeting per date —
   * and several meetings may now share one.
   */

  function remove(row: MeetingRow) {
    if (
      !window.confirm(
        `Delete the ${row.status} meeting for ${formatLongDate(row.entry_date)}? Its agenda goes with it.`
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
        <Link href="/admin/advancement/meetings/report" className={styles.editBtn}>
          Attendance Report
        </Link>
        <span style={{ flex: 1 }} />
        <input
          type="search"
          className={styles.dateInput}
          placeholder="Search title or date…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            resetPage();
          }}
          aria-label="Search meetings"
        />
        <select
          className={styles.dateInput}
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            resetPage();
          }}
          aria-label="Filter by year"
        >
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          className={styles.dateInput}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            resetPage();
          }}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <button
          type="button"
          className={styles.editBtn}
          onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          aria-label="Toggle date sort direction"
        >
          Date {dir === 'desc' ? '↓' : '↑'}
        </button>
        <Link href="/admin/calendar" className={styles.addBtn}>
          Calendar &rarr;
        </Link>
      </div>

      {err && <div className={styles.editError}>{err}</div>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Title</th>
            <th>Status</th>
            <th>Attendance</th>
            <th>Last edited</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.muted}>
                {rows.length === 0
                  ? 'No meetings yet — add one from the Calendar, on the entry for that night.'
                  : 'No meetings match those filters.'}
              </td>
            </tr>
          ) : (
            visible.map((row) => {
              const att = attendance[row.entry_date];
              return (
                <tr key={row.id}>
                  <td className={styles.dateCell}>{row.entry_date}</td>
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
                  <td className={styles.dateCell}>
                    {att ? (
                      <Link
                        href={`/admin/calendar/${row.entry_id}/roll-call`}
                        title={`${att.scouts} scouts + ${att.leaders} leaders`}
                      >
                        {att.scouts} + {att.leaders}
                      </Link>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td className={styles.muted}>{row.updated_by ?? '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link
                      href={`/admin/calendar/${row.entry_id}/roll-call`}
                      className={styles.editBtn}
                    >
                      Roll Call
                    </Link>
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
              );
            })
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className={styles.toolbar} style={{ justifyContent: 'center', marginTop: 12 }}>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
          >
            ← Newer
          </button>
          <span className={styles.muted} style={{ fontStyle: 'normal' }}>
            Page {safePage} of {totalPages} · {filtered.length} meetings
          </span>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            Older →
          </button>
        </div>
      )}
    </>
  );
}
