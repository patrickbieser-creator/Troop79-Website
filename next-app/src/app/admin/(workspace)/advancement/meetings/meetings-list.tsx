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
import { fmtDate, fmtDateFull } from '@/lib/format-date';
import styles from './meetings.module.css';
import { ActionsMenu } from '../../_components/actions-menu';
import { Badge } from '../../_components/badge';
import { Notice } from '../../_components/notice';
import { TabStrip } from '../../_components/tab-strip';
import { naturalDir, orderByDate, splitByToday, yearsOf, type RollCallTab } from '@/lib/roll-call-list';

const PAGE_SIZE = 25;

export interface AttendanceListRow {
  entryId: number;
  title: string;
  entryDate: string;
  category: string;
  /** The agenda layer, when this entry has one. Meeting-template categories only. */
  agendaId: number | null;
  agendaStatus: string | null;
  /** No agenda yet, and the category's template carries one — so offer to
   *  add it here (Patrick, 2026-08-24: "also an agenda option" for PLC and
   *  committee meetings). Same action the entry's workbench has. */
  canAddAgenda?: boolean;
  scoutCount: number;
  adultCount: number;
}

interface Props {
  rows: AttendanceListRow[];
  /** The Central calendar day — the Current/Past boundary (Patrick, 2026-08-24). */
  today: string;
  onDeleteAgenda: (id: number) => Promise<{ ok: boolean; error?: string }>;
  onAddAgenda?: (fd: FormData) => Promise<{ ok: boolean; error?: string; id?: number }>;
}

export function AttendanceList({ rows, today, onDeleteAgenda, onAddAgenda }: Props) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  // Two views (Patrick, 2026-08-24): Current — today and later, soonest first
  // so today sits on top; Past — before today, most recent first. Every filter
  // works in both; the year list only offers years the view actually has.
  const [tab, setTab] = useState<RollCallTab>('current');
  const [q, setQ] = useState('');
  const [year, setYear] = useState('all');
  const [category, setCategory] = useState('all');
  const [taken, setTaken] = useState('all');
  // The Date button flips the view's natural order; switching views resets it.
  const [flipped, setFlipped] = useState(false);
  const [page, setPage] = useState(1);

  const split = useMemo(() => splitByToday(rows, today), [rows, today]);
  const viewRows = tab === 'current' ? split.current : split.past;
  const dir = flipped ? (naturalDir(tab) === 'asc' ? 'desc' : 'asc') : naturalDir(tab);

  const years = useMemo(() => yearsOf(viewRows), [viewRows]);
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows]
  );

  function switchTab(next: RollCallTab) {
    if (next === tab) return;
    setTab(next);
    setFlipped(false);
    // A year that only exists in the other view can't stay selected here.
    const nextRows = next === 'current' ? split.current : split.past;
    if (year !== 'all' && !yearsOf(nextRows).includes(year)) setYear('all');
    resetPage();
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = viewRows.filter((r) => {
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
    return orderByDate(list, dir);
  }, [viewRows, q, year, category, taken, dir]);

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
        `Delete the ${row.agendaStatus} agenda for ${fmtDateFull(row.entryDate)}? Its items go with it. Attendance is kept.`
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

  function addAgenda(row: AttendanceListRow) {
    if (!onAddAgenda) return;
    setErr(null);
    setBusyId(row.entryId);
    const fd = new FormData();
    fd.set('calendar_entry_id', String(row.entryId));
    fd.set('title', row.title);
    startTransition(async () => {
      const res = await onAddAgenda(fd);
      setBusyId(null);
      if (!res.ok || !res.id) {
        setErr(res.error ?? 'Could not add the agenda.');
        return;
      }
      router.push(`/admin/advancement/meetings/${res.id}`);
    });
  }

  return (
    <>
      <TabStrip
        ariaLabel="Current or past events"
        activeKey={tab}
        items={[
          { key: 'current', label: 'Current', count: split.current.length, onSelect: () => switchTab('current') },
          { key: 'past', label: 'Past', count: split.past.length, onSelect: () => switchTab('past') }
        ]}
      />
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
        <span className={styles.spacer} />
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
          onClick={() => {
            setFlipped((f) => !f);
            resetPage();
          }}
          aria-label="Toggle date sort direction"
        >
          Date {dir === 'desc' ? '↓' : '↑'}
        </button>
      </div>

      {err && <Notice>{err}</Notice>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Event</th>
            <th>Category</th>
            <th>Attendance</th>
            <th>Agenda</th>
            <th className={styles.alignRight}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.muted}>
                {rows.length === 0
                  ? 'Nothing on the calendar tracks attendance yet.'
                  : viewRows.length === 0
                    ? tab === 'current'
                      ? 'Nothing coming up tracks attendance — see Past.'
                      : 'No past events yet.'
                    : 'No events match those filters.'}
              </td>
            </tr>
          ) : (
            visible.map((row) => {
              const total = row.scoutCount + row.adultCount;
              return (
                <tr key={row.entryId}>
                  <td className={styles.dateCell}>{fmtDate(row.entryDate)}</td>
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
                        <Badge variant={row.agendaStatus === 'published' ? 'success' : 'neutral'}>
                          {row.agendaStatus}
                        </Badge>
                      </Link>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td className={styles.actionsCell}>
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
                    {!row.agendaId && row.canAddAgenda && onAddAgenda && (
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={() => addAgenda(row)}
                        disabled={busyId === row.entryId}
                        title="Start an agenda for this meeting and open the editor"
                      >
                        {busyId === row.entryId ? '…' : 'Add agenda'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className={`${styles.toolbar} ${styles.toolbarCentered}`}>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
          >
            ← Prev
          </button>
          <span className={`${styles.muted} ${styles.mutedUpright}`}>
            Page {safePage} of {totalPages} · {filtered.length} events
          </span>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
