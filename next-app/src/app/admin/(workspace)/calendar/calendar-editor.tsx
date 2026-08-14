'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Media } from '@/lib/supabase/types';
import { categoryColorMap, colorFor, type CalendarCategoryRow } from '@/lib/calendar-categories';
import { splitByTab } from '@/lib/calendar-tabs';
import type { CalendarEntryRow } from './page';
// MediaPicker still lives under news/ — the hero image it picks is the same
// media library the article editor uses.
import { MediaPicker } from '../news/_components/media-picker';
import type { ImportResult, ImportRowFields, ImportUpdate } from './actions';
import { CalendarImport } from './calendar-import';
import { DatePickerField } from '../_components/date-picker-field';
import styles from './calendar.module.css';

type ActionResult = { ok: boolean; error?: string };

interface Props {
  rows: CalendarEntryRow[];
  /** The calendar_categories lookup in display order (D-082) — labels, colors
   *  and all. Managed under Lookups & Admin, not in code. */
  categories: CalendarCategoryRow[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onDelete: (id: number) => Promise<ActionResult>;
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

export function CalendarEditor({ rows, categories, onCreate, onUpdate, onDelete, onImport }: Props) {
  // 'new' = blank form; { clone } = prefilled from an existing entry but
  // saved as a new one; a row = editing that row.
  const [openFor, setOpenFor] = useState<CalendarEntryRow | 'new' | { clone: CalendarEntryRow } | null>(
    null
  );
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
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
  const shown = tab === 'upcoming' ? upcoming : past;

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
            Upcoming <span className={styles.tabCount}>{upcoming.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'past'}
            className={`${styles.tab} ${tab === 'past' ? styles.tabOn : ''}`}
            onClick={() => setTab('past')}
          >
            Past <span className={styles.tabCount}>{past.length}</span>
          </button>
        </div>
        <CalendarImport rows={rows} categories={categories.map((c) => c.label)} onImport={onImport} />
        <button type="button" className={styles.addBtn} onClick={() => setOpenFor('new')}>
          + Add Entry
        </button>
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
                {tab === 'upcoming'
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
                <td>
                  {row.title}
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
                  {/* The quick dialog stays 30-second simple; Open escalates to
                      the workbench, where the story, agenda and signup layers
                      live. */}
                  <Link href={`/admin/calendar/${row.id}`} className={styles.editBtn}>
                    Open
                  </Link>
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => setOpenFor(row)}
                    disabled={busyId === row.id}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => setOpenFor({ clone: row })}
                    disabled={busyId === row.id}
                    title="Create a new entry pre-filled from this one"
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
        {openFor && (
          <CalendarEntryForm
            key={
              openFor === 'new'
                ? 'new'
                : 'clone' in openFor
                  ? `clone-${openFor.clone.id}`
                  : openFor.id
            }
            row={openFor === 'new' ? null : 'clone' in openFor ? openFor.clone : openFor}
            /* A clone prefills from an existing entry but must SAVE AS NEW —
               otherwise "clone" would silently overwrite the entry it copied. */
            forceNew={openFor !== 'new' && 'clone' in openFor}
            categories={categories}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onClose={() => setOpenFor(null)}
          />
        )}
      </dialog>
    </>
  );
}

function CalendarEntryForm({
  row,
  forceNew = false,
  categories,
  onCreate,
  onUpdate,
  onClose
}: {
  row: CalendarEntryRow | null;
  forceNew?: boolean;
  categories: CalendarCategoryRow[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const isNew = row === null || forceNew;
  // Cloning: keep every detail, but clear the dates. The date is the whole
  // point of the new entry, and a prefilled one is the easiest thing to
  // miss — leaving it blank makes the required check catch it.
  const [entryDate, setEntryDate] = useState(forceNew ? '' : (row?.entry_date ?? ''));
  const [endDateInit] = useState(forceNew ? '' : (row?.end_date ?? ''));
  const [endDate, setEndDate] = useState(endDateInit);
  const [startTime, setStartTime] = useState(row?.start_time?.slice(0, 5) ?? '');
  const [endTime, setEndTime] = useState(row?.end_time?.slice(0, 5) ?? '');
  const [dayNote, setDayNote] = useState(row?.day_note ?? '');
  const [category, setCategory] = useState<string>(row?.category ?? '');
  const [title, setTitle] = useState(row?.title ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [location, setLocation] = useState(row?.location ?? '');
  // News promotion (Plans/Event-News-Promotion.md). Kept on a clone — the
  // point of cloning a promoted event is usually a sequel that will also be
  // promoted; the dates were already cleared above, and promo dates follow.
  const [onCalendar, setOnCalendar] = useState(row?.on_calendar ?? true);
  const [showOnHomepage, setShowOnHomepage] = useState(row?.show_on_homepage ?? false);
  const [featured, setFeatured] = useState(row?.featured ?? false);
  const [promoStart, setPromoStart] = useState(forceNew ? '' : (row?.promo_start ?? ''));
  const [promoEnd, setPromoEnd] = useState(forceNew ? '' : (row?.promo_end ?? ''));
  const [excerpt, setExcerpt] = useState(row?.excerpt ?? '');
  const [heroMedia, setHeroMedia] = useState<Media | null>(row?.hero_media ?? null);
  const [autoArchiveAt, setAutoArchiveAt] = useState(forceNew ? '' : (row?.auto_archive_at ?? ''));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    const fd = new FormData();
    if (row && !forceNew) fd.set('id', String(row.id));
    fd.set('entry_date', entryDate);
    fd.set('end_date', endDate);
    fd.set('start_time', startTime);
    fd.set('end_time', endTime);
    fd.set('day_note', dayNote);
    fd.set('category', category);
    fd.set('title', title);
    fd.set('description', description);
    fd.set('location', location);
    fd.set('on_calendar', onCalendar ? '1' : '');
    fd.set('show_on_homepage', showOnHomepage ? '1' : '');
    fd.set('featured', featured ? '1' : '');
    fd.set('promo_start', promoStart);
    fd.set('promo_end', promoEnd);
    fd.set('excerpt', excerpt);
    fd.set('hero_media_id', heroMedia ? String(heroMedia.id) : '');
    fd.set('auto_archive_at', autoArchiveAt);
    startTransition(async () => {
      const res = isNew ? await onCreate(fd) : await onUpdate(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onClose();
    });
  }

  return (
    <div className={styles.dialogInner}>
      <div className={styles.dialogHeader}>
        <h3>{isNew ? 'Add Calendar Entry' : `Edit: ${row?.title}`}</h3>
        <p>Shows on the public calendar and the .ics subscription feed.</p>
      </div>

      <div className={styles.editGrid}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Date</span>
          <DatePickerField value={entryDate} onChange={setEntryDate} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>End Date (multi-day only)</span>
          <DatePickerField value={endDate} onChange={setEndDate} />
        </label>

        <label className={styles.editField}>
          <span className={styles.editLabel}>Start Time (optional)</span>
          <input type="time" className={styles.editInput} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>End Time (optional)</span>
          <input type="time" className={styles.editInput} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>

        <label className={styles.editField}>
          <span className={styles.editLabel}>Category</span>
          <select
            className={styles.editInput}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          >
            <option value="">— Select —</option>
            {categories.map((c) => (
              <option key={c.label} value={c.label}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Day Note (optional, e.g. &ldquo;Sat&rdquo;)</span>
          <input
            type="text"
            className={styles.editInput}
            value={dayNote}
            onChange={(e) => setDayNote(e.target.value)}
            placeholder="Sat"
          />
        </label>

        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Title</span>
          <input
            type="text"
            className={styles.editInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>

        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Description (optional)</span>
          <input
            type="text"
            className={styles.editInput}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Totin' Chip, Open Advancement, Citizen in World"
          />
        </label>

        <label className={styles.editField}>
          <span className={styles.editLabel}>Location (optional)</span>
          <input
            type="text"
            className={styles.editInput}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Auto-archive on (optional)</span>
          <input
            type="date"
            className={styles.editInput}
            value={autoArchiveAt}
            onChange={(e) => setAutoArchiveAt(e.target.value)}
          />
        </label>

        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>
            <input
              type="checkbox"
              checked={onCalendar}
              onChange={(e) => setOnCalendar(e.target.checked)}
            />{' '}
            On the troop calendar
            <span className={styles.muted}>
              {' '}&mdash; uncheck for outside opportunities (district merit badge clinics, external
              service days): they keep their event page and can appear in the news feed, but never
              on our calendar.
            </span>
          </span>
        </label>

        {/* ── News promotion — replaces the Linked Article pattern ─────────
            The event itself appears in the homepage feed for a window; no
            companion article. Fields hide (and clear on save) when the
            opt-in is off. */}
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>
            <input
              type="checkbox"
              checked={showOnHomepage}
              onChange={(e) => setShowOnHomepage(e.target.checked)}
            />{' '}
            Show in the homepage news feed
          </span>
        </label>

        {showOnHomepage && (
          <>
            <label className={styles.editField}>
              <span className={styles.editLabel}>Promote from (blank = now)</span>
              <DatePickerField value={promoStart} onChange={setPromoStart} />
            </label>
            <label className={styles.editField}>
              <span className={styles.editLabel}>Promote until (blank = event date)</span>
              <DatePickerField value={promoEnd} onChange={setPromoEnd} />
            </label>
            <label className={styles.editFieldFull}>
              <span className={styles.editLabel}>Card summary (blank = description)</span>
              <input
                type="text"
                className={styles.editInput}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                maxLength={200}
                placeholder="One sentence for the homepage card"
              />
            </label>
            <label className={styles.editField}>
              <span className={styles.editLabel}>Card image (optional)</span>
              <button type="button" className={styles.editBtn} onClick={() => setPickerOpen(true)}>
                {heroMedia ? 'Change image' : 'Choose image'}
              </button>
              {heroMedia && (
                <button type="button" className={styles.editBtn} onClick={() => setHeroMedia(null)}>
                  Remove
                </button>
              )}
            </label>
            <label className={styles.editField}>
              <span className={styles.editLabel}>
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                />{' '}
                Feature as homepage hero
              </span>
            </label>
          </>
        )}
      </div>

      {pickerOpen && (
        <MediaPicker
          mode="single"
          onClose={() => setPickerOpen(false)}
          onInsert={(media) => {
            setHeroMedia(media[0] ?? null);
            setPickerOpen(false);
          }}
        />
      )}

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.dialogActions}>
        <button type="button" className={styles.editBtn} onClick={onClose} disabled={isPending}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.editSaveBtn}
          onClick={submit}
          disabled={isPending || !entryDate.trim() || !category || !title.trim()}
        >
          {isPending ? 'Saving…' : isNew ? 'Add Entry' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
