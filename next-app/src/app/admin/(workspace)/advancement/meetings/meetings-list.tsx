'use client';

/**
 * The Roll Call work list — every event that tracks attendance.
 *
 * Was a meetings-only table, which meant the one screen answering "who was at
 * what" could only answer it for Sunday nights. Rows are calendar ENTRIES now;
 * an agenda is a column on a row rather than the thing rows are made of.
 *
 * Built for a few hundred rows, so filtering/sorting/pagination stay
 * client-side — the full list is small enough to ship and slice locally.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatLongDate } from '@/lib/dates';
import styles from './meetings.module.css';
import { ActionsMenu } from '../../_components/actions-menu';

const PAGE_SIZE = 25;

export interface AttendanceListRow {
  entryId: number;
  title: string;
  entryDate: string;
  category: string;
  /** The agenda layer, when this entry has one. Meetings only. */
  agendaId: number | null;
  agendaStatus: string | null;
  scoutCount: number;
  adultCount: number;
}

interface Props {
  rows: AttendanceListRow[];
  onDeleteAgenda: (id: number) => Promise<{ ok: boolean; error?: string }>;
}

export function AttendanceList({ rows, onDeleteAgenda }: Props) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const [q, setQ] = useState('');
  const [year, setYear] = useState('all');
  const [category, setCategory] = useState('all');
  const [taken, setTaken] = useState('all');
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);

  const years = useMemo(
    () => [...new Set(rows.map((r) => r.entryDate.slice(0, 4)))].sort().reverse(),
    [rows]
  );
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (year !== 'all' && !r.entryDate.startsWith(year)) return false;
      if (category !== 'all' && r.category !== category) return false;
      const total = r.scoutCount + r.adultCount;
      // "Not taken" is the useful working filter — it is the to-do list.
      if (taken === 'yes' && total === 0) return false;
      if (taken === 'no' && total > 0) return false;
      if (needle && !`${r.title} ${r.entryDate} ${r.category}`.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
    return dir === 'desc' ? list : [...list].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  }, [rows, q, year, category, taken, dir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetPage() {
    setPage(1);
  }

  function removeAgenda(row: AttendanceListRow) {
    if (!row.agendaId) return;
    if (
      !window.confirm(
        `Delete the ${row.agendaStatus} agenda for ${formatLongDate(row.entryDate)}? Its items go with it. Attendance is kept.`
      )
    ) {
      return;
    }
    setErr(null);
    setBusyId(row.entryId);
    startTransition(async () => {
      const res = await onDeleteAgenda(row.agendaId!);
      setBusyId(null);
      if (!res.ok) setErr(res.error ?? 'Delete failed.');
    });
  }

  return (
    <>
      <div className={styles.toolbar}>
        {/* Attendance Report isn't reachable from the main nav — kept as a
            nav: option here. "Calendar →" was dropped (2026-08-20): it
            just duplicated the main nav's own Calendar link. */}
        {/* Shared ActionsMenu (Phase A, 2026-08-21) — this one had quietly
            diverged by borrowing .dateInput for its styling; now it matches
            every other screen's Actions ▾. */}
        <ActionsMenu
          ariaLabel="Meetings actions"
          options={[{ value: '/admin/advancement/meetings/report', label: 'Attendance Report' }]}
          onAction={(v) => router.push(v)}
        />
        <span style={{ flex: 1 }} />
        <input
          type="search"
          className={styles.dateInput}
          placeholder="Search title, date or category…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            resetPage();
          }}
          aria-label="Search events"
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
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            resetPage();
          }}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className={styles.dateInput}
          value={taken}
          onChange={(e) => {
            setTaken(e.target.value);
            resetPage();
          }}
          aria-label="Filter by whether roll call was taken"
        >
          <option value="all">Taken or not</option>
          <option value="no">Not taken yet</option>
          <option value="yes">Roll call taken</option>
        </select>
        <button
          type="button"
          className={styles.editBtn}
          onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          aria-label="Toggle date sort direction"
        >
          Date {dir === 'desc' ? '↓' : '↑'}
        </button>
      </div>

      {err && <div className={styles.editError}>{err}</div>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Event</th>
            <th>Category</th>
            <th>Attendance</th>
            <th>Agenda</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.muted}>
                {rows.length === 0
                  ? 'Nothing on the calendar tracks attendance yet.'
                  : 'No events match those filters.'}
              </td>
            </tr>
          ) : (
            visible.map((row) => {
              const total = row.scoutCount + row.adultCount;
              return (
                <tr key={row.entryId}>
                  <td className={styles.dateCell}>{row.entryDate}</td>
                  <td>
                    <Link href={`/admin/calendar/${row.entryId}/roll-call`}>{row.title}</Link>
                  </td>
                  <td className={styles.muted}>{row.category}</td>
                  <td className={styles.dateCell}>
                    {total > 0 ? (
                      <Link
                        href={`/admin/calendar/${row.entryId}/roll-call`}
                        title={`${row.scoutCount} scouts + ${row.adultCount} adults`}
                      >
                        {row.scoutCount} + {row.adultCount}
                      </Link>
                    ) : (
                      <span className={styles.muted}>not taken</span>
                    )}
                  </td>
                  <td>
                    {row.agendaId ? (
                      <Link href={`/admin/advancement/meetings/${row.agendaId}`}>
                        <span
                          className={`${styles.statusPill} ${
                            row.agendaStatus === 'published'
                              ? styles.statusPublished
                              : styles.statusDraft
                          }`}
                        >
                          {row.agendaStatus}
                        </span>
                      </Link>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link
                      href={`/admin/calendar/${row.entryId}/roll-call`}
                      className={styles.editBtn}
                    >
                      Roll Call
                    </Link>
                    {row.agendaId && (
                      <>
                        <Link
                          href={`/admin/advancement/meetings/${row.agendaId}`}
                          className={styles.editBtn}
                        >
                          Agenda
                        </Link>
                        <button
                          type="button"
                          className={`${styles.editBtn} ${styles.dangerBtn}`}
                          onClick={() => removeAgenda(row)}
                          disabled={busyId === row.entryId}
                        >
                          {busyId === row.entryId ? '…' : 'Delete agenda'}
                        </button>
                      </>
                    )}
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
            Page {safePage} of {totalPages} · {filtered.length} events
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
