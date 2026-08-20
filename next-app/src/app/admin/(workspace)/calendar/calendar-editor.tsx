'use client';

import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { categoryColorMap, colorFor, type CalendarCategoryRow } from '@/lib/calendar-categories';
import { splitByTab } from '@/lib/calendar-tabs';
import type { ImportResult, ImportRowFields, ImportUpdate } from './actions';
import { CalendarImport } from './calendar-import';
import { DatePickerField } from '../_components/date-picker-field';
import { CalendarEntryForm, type CalendarEntryRow } from './entry-form';
import type { CalendarEntryMergePlan } from '@/lib/calendar-admin';
import styles from './calendar.module.css';

type ActionResult = { ok: boolean; error?: string };
type CloneResult = { ok: boolean; error?: string; id?: number };
type MergeResult = ActionResult & { needsConfirm?: boolean; plan?: CalendarEntryMergePlan };

interface Props {
  rows: CalendarEntryRow[];
  /** The calendar_categories lookup in display order (D-082) — labels, colors
   *  and all. Managed under Lookups & Admin, not in code. */
  categories: CalendarCategoryRow[];
  /** List state, read from the URL by the page — bookmarkable and
   *  back-button-friendly, matching News. */
  q: string;
  category: string;
  tab: 'upcoming' | 'past';
  newOpen: boolean;
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onDelete: (
    id: number,
    confirm?: boolean
  ) => Promise<ActionResult & { needsConfirm?: boolean }>;
  onMerge: (keepId: number, loseId: number, confirm?: boolean) => Promise<MergeResult>;
  onClone: (fd: FormData) => Promise<CloneResult>;
  onSetPromoted: (id: number, on: boolean) => Promise<ActionResult>;
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
  q,
  category,
  tab,
  newOpen,
  onCreate,
  onUpdate,
  onDelete,
  onMerge,
  onClone,
  onSetPromoted,
  onImport
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  /**
   * Filter state pushes to the URL rather than living in useState. Search is
   * debounced so typing doesn't push a history entry per keystroke; the local
   * `text` mirror keeps the input responsive while that settles. Same shape as
   * the News toolbar.
   */
  const [text, setText] = useState(q);
  const inputFocusedRef = useRef(false);

  useEffect(() => {
    if (!inputFocusedRef.current) setText(q);
  }, [q]);

  const push = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') params.delete(k);
        else params.set(k, v);
      }
      router.push(`/admin/calendar${params.toString() ? `?${params.toString()}` : ''}`, {
        scroll: false
      });
    },
    [router, searchParams]
  );

  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => push({ q: text }), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  /*
   * Row EDITING moved into the workbench, which is the single editor of record
   * for an entry. Two dialogs remain: Add Entry (opened from the page header
   * via `?new=1`) and Clone — the primary path, where you pick a date and
   * everything else comes along.
   */
  const [cloneFor, setCloneFor] = useState<CalendarEntryRow | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowErr, setRowErr] = useState<{ id: number; msg: string } | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Merge — the alternative to Delete for genuine duplicates. The row being
   * acted on is always the one that goes away (loseId); mergeTarget is the
   * entry it merges into (keepId). Two stages, like the delete confirm:
   * a preview (plan=null → plan set) reports exactly what would move before
   * anything happens, then a second click actually executes it.
   */
  const [mergeFor, setMergeFor] = useState<CalendarEntryRow | null>(null);
  const [mergeTarget, setMergeTarget] = useState<number | ''>('');
  const [mergePreview, setMergePreview] = useState<string | null>(null);
  const [mergeErr, setMergeErr] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

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

  const dialogOpen = newOpen || cloneFor !== null;
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (dialogOpen && !dlg.open) dlg.showModal();
    if (!dialogOpen && dlg.open) dlg.close();
  }, [dialogOpen]);

  /** Add Entry is opened by the header link (`?new=1`), so closing it has to
   *  drop that param rather than flip local state. */
  function closeDialog() {
    setCloneFor(null);
    if (newOpen) push({ new: null });
  }

  function onPromoteToggle(row: CalendarEntryRow, on: boolean) {
    setBusyId(row.id);
    setRowErr(null);
    startTransition(async () => {
      const res = await onSetPromoted(row.id, on);
      setBusyId(null);
      if (!res.ok) setRowErr({ id: row.id, msg: res.error ?? 'Could not change promotion' });
      else router.refresh();
    });
  }

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
      // Dry run first: the server reports who/what is actually attached
      // (attendance + ledger credit) before anything is destroyed. Only a
      // second, explicit confirm proceeds past a non-empty dependency set —
      // see deleteCalendarEntry's own comment for why (2026-08-20 incident).
      const res = await onDelete(row.id, false);
      if (res.ok) {
        setBusyId(null);
        return;
      }
      if (res.needsConfirm) {
        if (!window.confirm(`${res.error}\n\nDelete anyway?`)) {
          setBusyId(null);
          return;
        }
        const confirmed = await onDelete(row.id, true);
        setBusyId(null);
        if (!confirmed.ok) setRowErr({ id: row.id, msg: confirmed.error ?? 'Delete failed' });
        return;
      }
      setBusyId(null);
      setRowErr({ id: row.id, msg: res.error ?? 'Delete failed' });
    });
  }

  function onMergeClick(row: CalendarEntryRow) {
    setMergeFor(row);
    setMergeTarget('');
    setMergePreview(null);
    setMergeErr(null);
  }

  function onMergeCancel() {
    setMergeFor(null);
    setMergeTarget('');
    setMergePreview(null);
    setMergeErr(null);
  }

  /** First click previews (dry run); once a plan is showing, the same
   *  button becomes the real confirm — mirrors the delete flow's two
   *  stages, just laid out inline instead of via window.confirm since the
   *  target picker already needs its own row. */
  function onMergeSubmit() {
    if (!mergeFor || mergeTarget === '') return;
    const loseId = mergeFor.id;
    const keepId = mergeTarget;
    setMergeBusy(true);
    setMergeErr(null);
    startTransition(async () => {
      const res = await onMerge(keepId, loseId, mergePreview !== null);
      setMergeBusy(false);
      if (res.ok) {
        onMergeCancel();
        router.refresh();
        return;
      }
      if (res.needsConfirm) {
        setMergePreview(res.error ?? 'Ready to merge.');
        return;
      }
      // A real conflict (e.g. both sides have their own signup) — blocking,
      // no confirm step to offer.
      setMergePreview(null);
      setMergeErr(res.error ?? 'Could not merge.');
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
            onClick={() => push({ tab: null })}
          >
            Upcoming <span className={styles.tabCount}>{upcomingShown.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'past'}
            className={`${styles.tab} ${tab === 'past' ? styles.tabOn : ''}`}
            onClick={() => push({ tab: 'past' })}
          >
            Past <span className={styles.tabCount}>{pastShown.length}</span>
          </button>
        </div>
        <CalendarImport rows={rows} categories={categories.map((c) => c.label)} onImport={onImport} />
      </div>

      <div className={styles.toolbarRow}>
        <input
          type="search"
          className={styles.filterInput}
          placeholder="Search title, location…"
          aria-label="Search calendar entries"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            inputFocusedRef.current = true;
          }}
          onBlur={() => {
            inputFocusedRef.current = false;
          }}
        />
        <select
          className={styles.filterSelect}
          aria-label="Filter by category"
          value={category}
          onChange={(e) => push({ category: e.target.value })}
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
              setText('');
              push({ q: null, category: null });
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
            <th>Status</th>
            <th>Author</th>
            <th>Location</th>
            <th>Promoted</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={8} className={styles.muted}>
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
              <Fragment key={row.id}>
              <tr>
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
                  {rowErr?.id === row.id && <div className={styles.editError}>{rowErr.msg}</div>}
                </td>
                <td className={styles.nowrap}>
                  <StatusPills row={row} />
                </td>
                <td className={styles.muted}>{row.author_name || '—'}</td>
                <td>{row.location || <span className={styles.muted}>—</span>}</td>
                <td className={styles.nowrap}>
                  {/* Flipped straight from the list, the way News flips
                      Featured. Turning it off parks the promo window rather than
                      clearing it, so turning it back on restores the setup. */}
                  <input
                    type="checkbox"
                    checked={row.show_on_homepage}
                    disabled={busyId === row.id}
                    aria-label={`Promote ${row.title} to the homepage`}
                    onChange={(e) => onPromoteToggle(row, e.target.checked)}
                  />
                  {/* "Hero" is a STRONGER form of promoted, not a separate
                      thing: a featured in-window entry takes the homepage hero
                      slot for its promo window, and the featured article
                      resumes when the window closes. Guarded on the checkbox
                      because a hero flag with promotion off does nothing — it
                      should never render as if it were in effect. */}
                  {row.show_on_homepage && row.featured && (
                    <span
                      className={styles.heroTag}
                      title="Takes the homepage hero slot for its promotion window"
                    >
                      Hero
                    </span>
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
                    onClick={() => setCloneFor(row)}
                    disabled={busyId === row.id}
                    title="Copy this entry — write-up, agenda and signup structure — onto a new date"
                  >
                    Clone
                  </button>
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => onMergeClick(row)}
                    disabled={busyId === row.id || mergeFor !== null}
                    title="Fold this entry into another one — attendance and ledger credit come along, this row goes away"
                  >
                    Merge…
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
              {mergeFor?.id === row.id && (
                <tr className={styles.editRow}>
                  <td colSpan={8}>
                    <p>
                      Merge <strong>&ldquo;{mergeFor.title}&rdquo;</strong> into another entry. Its
                      attendance and ledger credit move onto the entry you pick below (duplicates are
                      dropped/superseded, not doubled); &ldquo;{mergeFor.title}&rdquo; is then removed.
                    </p>
                    <div className={styles.addRow}>
                      <select
                        value={mergeTarget}
                        disabled={mergeBusy || mergePreview !== null}
                        onChange={(e) => {
                          setMergeTarget(e.target.value ? Number(e.target.value) : '');
                          setMergePreview(null);
                          setMergeErr(null);
                        }}
                      >
                        <option value="">Merge into…</option>
                        {rows
                          .filter((r) => r.id !== mergeFor.id)
                          .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.title} — {formatDate(r.entry_date)}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={onMergeSubmit}
                        disabled={mergeTarget === '' || mergeBusy}
                      >
                        {mergeBusy ? '…' : mergePreview !== null ? 'Confirm merge' : 'Preview merge'}
                      </button>
                      <button type="button" className={styles.editBtn} onClick={onMergeCancel} disabled={mergeBusy}>
                        Cancel
                      </button>
                    </div>
                    {mergePreview !== null && <p className={styles.panelHint}>{mergePreview}</p>}
                    {mergeErr && <p className={styles.err}>{mergeErr}</p>}
                  </td>
                </tr>
              )}
              </Fragment>
            ))
          )}
        </tbody>
      </table>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={closeDialog}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDialog();
        }}
      >
        {newOpen && !cloneFor && (
          <CalendarEntryForm
            key="new"
            row={null}
            categories={categories}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onClose={closeDialog}
          />
        )}
        {cloneFor && (
          <CloneForm
            key={`clone-${cloneFor.id}`}
            source={cloneFor}
            onClone={onClone}
            onClose={closeDialog}
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

/**
 * What still needs doing on this entry, at a glance.
 *
 * News has shown a status pill per row since it shipped; the calendar showed
 * nothing, even though an entry now carries layers that each have a state —
 * an agenda can be draft, a signup can be closed, an entry can be off the
 * calendar entirely. A leader opens this screen asking "what is unfinished?",
 * and the answer was previously "open each one and see".
 *
 * Nothing here means the entry is a plain calendar line with no layers, which
 * is a perfectly finished state — so it renders as a quiet dash rather than a
 * pill saying "OK".
 */
function StatusPills({ row }: { row: CalendarEntryRow }) {
  const pills: { label: string; tone: 'draft' | 'closed' | 'muted' }[] = [];

  if (row.agendaStatus === 'draft') pills.push({ label: 'Draft agenda', tone: 'draft' });
  if (row.agendaStatus === 'published') pills.push({ label: 'Agenda', tone: 'muted' });
  if (row.signupStatus === 'closed') pills.push({ label: 'Signup closed', tone: 'closed' });
  if (row.signupStatus === 'open') pills.push({ label: 'Signup open', tone: 'muted' });
  if (!row.on_calendar) pills.push({ label: 'Off calendar', tone: 'closed' });

  if (pills.length === 0) return <span className={styles.muted}>—</span>;

  return (
    <>
      {pills.map((p) => (
        <span
          key={p.label}
          className={`${styles.statusPill} ${
            p.tone === 'draft'
              ? styles.statusDraft
              : p.tone === 'closed'
                ? styles.statusClosed
                : styles.statusMuted
          }`}
        >
          {p.label}
        </span>
      ))}
    </>
  );
}
