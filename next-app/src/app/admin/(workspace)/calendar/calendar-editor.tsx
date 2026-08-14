'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { categoryColorMap, colorFor, type CalendarCategoryRow } from '@/lib/calendar-categories';
import { splitByTab } from '@/lib/calendar-tabs';
import type { ImportResult, ImportRowFields, ImportUpdate } from './actions';
import { CalendarImport } from './calendar-import';
import { DatePickerField } from '../_components/date-picker-field';
import { CalendarEntryForm, type CalendarEntryRow } from './entry-form';
import styles from './calendar.module.css';

type ActionResult = { ok: boolean; error?: string };
type CloneResult = { ok: boolean; error?: string; id?: number };

interface Props {
  rows: CalendarEntryRow[];
  /** The calendar_categories lookup in display order (D-082) — labels, colors
   *  and all. Managed under Lookups & Admin, not in code. */
  categories: CalendarCategoryRow[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onDelete: (id: number) => Promise<ActionResult>;
  onClone: (fd: FormData) => Promise<CloneResult>;
  onImport: (inserts: ImportRowFields[], updates: ImportUpdate[]) => Promise<ImportResult>;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/** Local YYYY-MM-DD. Deliberately not toISOString(), which is UTC and can
 *  put an evening event on 'tomorrow' for anyone west of Greenwich. */
function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatTime(hms: string): string {
  return new Date(`2000-01-01T${hms}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function CalendarEditor({
  rows,
  categories,
  onCreate,
  onUpdate,
  onDelete,
  onClone,
  onImport
}: Props) {
  const router = useRouter();
  /*
   * Only two dialogs left. Row EDITING moved into the workbench, which is now
   * the single editor of record for an entry — "Open" and "Edit" were two
   * doors to the same thing, and only one of them could reach the story,
   * agenda and signup.
   *
   * 'new'      — from scratch, the less common path now
   * { clone }  — the PRIMARY path: pick a date, everything else comes along
   */
  const [openFor, setOpenFor] = useState<'new' | { clone: CalendarEntryRow } | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowErr, setRowErr] = useState<{ id: number; msg: string } | null>(null);
  const [, startTransition] = useTransition();

  const colors = categoryColorMap(categories);
  const today = todayLocal();
  // The multi-day rule and the newest-first Past ordering live in
  // lib/calendar-tabs.ts so they can be tested — they are retained behavior,
  // not incidental UI. Meetings now appear in these tabs too.
  const { upcoming, past } = splitByTab(rows, today);

  /*
   * Search and category filter apply WITHIN the selected tab, and the tab
   * counts show the filtered totals — so "Upcoming 3" after typing means three
   * matches ahead, not three entries total. A count that ignored the filter
   * would be the more confusing of the two options.
   *
   * Client-side like the rest of this screen: ~100 entries ship anyway for the
   * tab split, so filtering them here costs nothing and stays instant.
   */
  const needle = q.trim().toLowerCase();
  const matches = (r: CalendarEntryRow) => {
    if (category && r.category !== category) return false;
    if (!needle) return true;
    return `${r.title} ${r.location ?? ''} ${r.category} ${r.entry_date}`.toLowerCase().includes(needle);
  };
  const upcomingShown = upcoming.filter(matches);
  const pastShown = past.filter(matches);
  const shown = tab === 'upcoming' ? upcomingShown : pastShown;
  const filtering = needle !== '' || category !== '';

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  function onDeleteClick(row: CalendarEntryRow) {
    // The entry is the spine: deleting it cascades into its agenda layer and
    // that agenda's sessions. Say so, the way the meetings list already does —
    // a leader deleting a stale calendar line should not silently lose a
    // written agenda. (Attendance is date-keyed and survives; the agenda does
    // not.)
    const warning = row.hasAgenda
      ? '\n\nThis entry has a meeting agenda — the agenda and its items go with it. Attendance records are kept.'
      : '';
    if (
      !window.confirm(
        `Delete "${row.title}" (${formatDate(row.entry_date)}) from the calendar?${warning}`
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setRowErr(null);
    startTransition(async () => {
      const res = await onDelete(row.id);
      setBusyId(null);
      if (!res.ok) setRowErr({ id: row.id, msg: res.error ?? 'Delete failed' });
    });
  }

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Calendar range">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upcoming'}
            className={`${styles.tab} ${tab === 'upcoming' ? styles.tabOn : ''}`}
            onClick={() => setTab('upcoming')}
          >
            Upcoming <span className={styles.tabCount}>{upcomingShown.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'past'}
            className={`${styles.tab} ${tab === 'past' ? styles.tabOn : ''}`}
            onClick={() => setTab('past')}
          >
            Past <span className={styles.tabCount}>{pastShown.length}</span>
          </button>
        </div>
        <CalendarImport rows={rows} categories={categories.map((c) => c.label)} onImport={onImport} />
        <button type="button" className={styles.addBtn} onClick={() => setOpenFor('new')}>
          + Add Entry
        </button>
      </div>

      <div className={styles.toolbarRow}>
        <input
          type="search"
          className={styles.filterInput}
          placeholder="Search title, location…"
          aria-label="Search calendar entries"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={styles.filterSelect}
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.label} value={c.label}>
              {c.label}
            </option>
          ))}
        </select>
        {filtering && (
          <button
            type="button"
            className={styles.filterClear}
            onClick={() => {
              setQ('');
              setCategory('');
            }}
          >
            Clear
          </button>
        )}
        <span className={styles.filterSpacer} />
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Category</th>
            <th>Title</th>
            <th>Location</th>
            <th>News</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.muted}>
                {/* A filtered empty tab is a different situation from an empty
                    one — telling someone to add an entry when they have simply
                    mistyped a search is the wrong instruction. */}
                {filtering
                  ? 'No entries match that search or category in this tab.'
                  : tab === 'upcoming'
                    ? 'No upcoming entries. Add one above, or clone a past entry from the Past tab.'
                    : 'No past entries yet.'}
              </td>
            </tr>
          ) : (
            shown.map((row) => (
              <tr key={row.id}>
                <td className={styles.dateCell}>
                  {formatDate(row.entry_date)}
                  {row.end_date && <> &rarr; {formatDate(row.end_date)}</>}
                  {row.start_time && (
                    <div className={styles.muted}>
                      {formatTime(row.start_time)}
                      {row.end_time && <> &ndash; {formatTime(row.end_time)}</>}
                    </div>
                  )}
                  {row.day_note && <div className={styles.muted}>{row.day_note}</div>}
                </td>
                <td>
                  <span className={styles.catTag}>
                    <span className={styles.catPip} style={{ background: colorFor(colors, row.category) }} />
                    {row.category}
                  </span>
                </td>
                <td className={styles.titleCell}>
                  {/* The title is the way in, as it is on News. Clicking a row's
                      subject to edit it is the habit both screens should share. */}
                  <Link href={`/admin/calendar/${row.id}`}>{row.title}</Link>
                  {!row.on_calendar && <span className={styles.catTag}> off-calendar</span>}
                  {rowErr?.id === row.id && <div className={styles.editError}>{rowErr.msg}</div>}
                </td>
                <td>{row.location || <span className={styles.muted}>—</span>}</td>
                <td>
                  {row.show_on_homepage ? (
                    <span className={styles.catTag}>{row.featured ? 'Promoted · Hero' : 'Promoted'}</span>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {/* "Edit", not "Open" — News calls the same act Edit, and
                      these two content screens should not use different words
                      for it. It is the only editor: details, story, agenda and
                      signup all live in the workbench. */}
                  <Link href={`/admin/calendar/${row.id}`} className={styles.editBtn}>
                    Edit
                  </Link>
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => setOpenFor({ clone: row })}
                    disabled={busyId === row.id}
                    title="Copy this entry — write-up, agenda and signup structure — onto a new date"
                  >
                    Clone
                  </button>
                  <button
                    type="button"
                    className={`${styles.editBtn} ${styles.dangerBtn}`}
                    onClick={() => onDeleteClick(row)}
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

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setOpenFor(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpenFor(null);
        }}
      >
        {openFor === 'new' && (
          <CalendarEntryForm
            key="new"
            row={null}
            categories={categories}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onClose={() => setOpenFor(null)}
          />
        )}
        {openFor && openFor !== 'new' && (
          <CloneForm
            key={`clone-${openFor.clone.id}`}
            source={openFor.clone}
            onClone={onClone}
            onClose={() => setOpenFor(null)}
            onDone={(id) => router.push(`/admin/calendar/${id}`)}
          />
        )}
      </dialog>
    </>
  );
}


/**
 * Clone dialog — one field, because everything else comes along.
 *
 * Cloning is the primary way entries get created now (Patrick, 2026-08-14):
 * find the campout or meeting that most resembles what you want, copy it whole,
 * then clean it up. So the dialog does not ask WHAT to copy — it copies
 * everything structural and drops every person — it only asks WHEN.
 */
function CloneForm({
  source,
  onClone,
  onClose,
  onDone
}: {
  source: CalendarEntryRow;
  onClone: (fd: FormData) => Promise<CloneResult>;
  onClose: () => void;
  onDone: (id: number) => void;
}) {
  const [date, setDate] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    const fd = new FormData();
    fd.set('source_id', String(source.id));
    fd.set('entry_date', date);
    startTransition(async () => {
      const res = await onClone(fd);
      if (!res.ok || !res.id) {
        setErr(res.error ?? 'Could not copy that entry.');
        return;
      }
      // A partial copy still opens — the leader can see and fix what is
      // missing, which beats being told nothing happened.
      onDone(res.id);
    });
  }

  return (
    <div className={styles.dialogInner}>
      <div className={styles.dialogHeader}>
        <h3>Clone: {source.title}</h3>
        <p>
          The write-up, agenda shape and signup structure come along. People never do &mdash; no
          claims, no payments, no assigned scouts or leaders. A copied signup starts closed until
          you open it.
        </p>
      </div>

      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Date for the copy</span>
          <DatePickerField value={date} onChange={setDate} />
        </label>
      </div>

      <p className={styles.muted} style={{ fontSize: 12, marginTop: 8 }}>
        Dates that hang off the event move with it: a multi-day span keeps its length, and a signup
        deadline set ten days before stays ten days before.
      </p>

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.dialogActions}>
        <button type="button" className={styles.editBtn} onClick={onClose} disabled={isPending}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.editSaveBtn}
          onClick={submit}
          disabled={isPending || !date.trim()}
        >
          {isPending ? 'Copying…' : 'Clone and open'}
        </button>
      </div>
    </div>
  );
}
