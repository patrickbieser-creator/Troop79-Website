'use client';

/**
 * The meetings table. Built for a couple hundred rows (attendance history
 * back to 2022), so filtering/sorting/pagination are client-side — the full
 * list is small enough to ship and slice locally.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Meeting } from '@/lib/supabase/types';
import { formatLongDate } from '@/lib/dates';
import { DatePickerField } from '../../_components/date-picker-field';
import styles from './meetings.module.css';

const PAGE_SIZE = 25;

interface Props {
  rows: Meeting[];
  attendance: Record<string, { scouts: number; leaders: number }>;
  defaultDate: string;
  onCreate: (fd: FormData) => Promise<{ ok: boolean; error?: string; id?: number }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
}

export function MeetingsList({ rows, attendance, defaultDate, onCreate, onDelete }: Props) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState('');
  const [year, setYear] = useState('all');
  const [status, setStatus] = useState('all');
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);

  const years = useMemo(
    () => [...new Set(rows.map((r) => r.meeting_date.slice(0, 4)))].sort().reverse(),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (year !== 'all' && !r.meeting_date.startsWith(year)) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (needle && !`${r.title} ${r.meeting_date}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    return dir === 'desc'
      ? list
      : [...list].sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  }, [rows, q, year, status, dir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetPage() {
    setPage(1);
  }

  /**
   * The next Sunday that doesn't already have a meeting.
   *
   * The form defaulted to plain nextSunday(), which is normally already on the
   * books by the time anyone is scheduling ahead — so opening it offered a
   * date that could only fail with "A meeting already exists for that date."
   * Landing on a date you cannot use reads as the form ignoring you, which is
   * exactly how it was reported.
   */
  const firstOpenSunday = useMemo(() => {
    const taken = new Set(rows.map((r) => r.meeting_date));
    let d = defaultDate;
    // Bounded: two years of Sundays. A troop with every Sunday booked that far
    // out should get the plain default back rather than an infinite loop.
    for (let i = 0; i < 104 && taken.has(d); i += 1) {
      const parsed = new Date(`${d}T12:00:00Z`); // noon UTC dodges DST edges
      parsed.setUTCDate(parsed.getUTCDate() + 7);
      d = parsed.toISOString().slice(0, 10);
    }
    return d;
  }, [rows, defaultDate]);

  /** Re-seeded each time the form opens, so it reflects meetings added since
   *  the page loaded rather than a date chosen at first render. */
  function toggleCreate() {
    setErr(null);
    setCreating((open) => {
      if (!open) setDate(firstOpenSunday);
      return !open;
    });
  }

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
        <button
          type="button"
          className={styles.addBtn}
          onClick={toggleCreate}
          aria-expanded={creating}
        >
          + New Meeting
        </button>
      </div>

      {/* The date used to sit in the toolbar above, between the year filter,
          the status filter and the sort toggle, with only a screen-reader
          label to say what it was for. It read as one more filter — so a
          leader would leave it on its default (the next Sunday), create the
          meeting, and only then discover it had been dated for them. It now
          appears only when creating, under a visible label. */}
      {creating && (
        <div className={styles.createRow}>
          <label className={styles.createField}>
            <span className={styles.createLabel}>Date for the new meeting</span>
            <DatePickerField className={styles.dateField} value={date} onChange={setDate} />
          </label>
          <button
            type="button"
            className={styles.addBtn}
            onClick={create}
            disabled={isPending || !date}
          >
            {isPending ? 'Creating…' : 'Create meeting'}
          </button>
          <button type="button" className={styles.editBtn} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}
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
                  ? 'No meetings yet — pick a date above and create the first one.'
                  : 'No meetings match those filters.'}
              </td>
            </tr>
          ) : (
            visible.map((row) => {
              const att = attendance[row.meeting_date];
              return (
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
                  <td className={styles.dateCell}>
                    {att ? (
                      <Link
                        href={`/admin/advancement/meetings/${row.id}/attendance`}
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
                      href={`/admin/advancement/meetings/${row.id}/attendance`}
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
