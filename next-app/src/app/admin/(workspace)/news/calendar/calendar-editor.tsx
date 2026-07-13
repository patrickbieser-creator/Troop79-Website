'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { CalendarCategory, CalendarEntry } from '@/lib/supabase/types';
import { CATEGORY_COLORS } from '@/lib/calendar-shared';
import type { ArticleOption } from './page';
import type { ImportResult, ImportRowFields, ImportUpdate } from './actions';
import { CalendarImport } from './calendar-import';
import styles from './calendar.module.css';

type ActionResult = { ok: boolean; error?: string };

interface Props {
  rows: CalendarEntry[];
  articles: ArticleOption[];
  categories: CalendarCategory[];
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

function formatTime(hms: string): string {
  return new Date(`2000-01-01T${hms}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function CalendarEditor({ rows, articles, categories, onCreate, onUpdate, onDelete, onImport }: Props) {
  const [openFor, setOpenFor] = useState<CalendarEntry | 'new' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowErr, setRowErr] = useState<{ id: number; msg: string } | null>(null);
  const [, startTransition] = useTransition();
  const articlesById = new Map(articles.map((a) => [a.id, a]));

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  function onDeleteClick(row: CalendarEntry) {
    if (!window.confirm(`Delete "${row.title}" (${formatDate(row.entry_date)}) from the calendar?`)) return;
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
        <CalendarImport rows={rows} categories={categories} onImport={onImport} />
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
            <th>Article</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.muted}>
                No calendar entries yet. Add one above.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
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
                    <span className={styles.catPip} style={{ background: CATEGORY_COLORS[row.category] }} />
                    {row.category}
                  </span>
                </td>
                <td>
                  {row.title}
                  {rowErr?.id === row.id && <div className={styles.editError}>{rowErr.msg}</div>}
                </td>
                <td>{row.location || <span className={styles.muted}>—</span>}</td>
                <td>
                  {row.article_id ? articlesById.get(row.article_id)?.title ?? `#${row.article_id}` : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
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
            key={openFor === 'new' ? 'new' : openFor.id}
            row={openFor === 'new' ? null : openFor}
            articles={articles}
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
  articles,
  categories,
  onCreate,
  onUpdate,
  onClose
}: {
  row: CalendarEntry | null;
  articles: ArticleOption[];
  categories: CalendarCategory[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const isNew = row === null;
  const [entryDate, setEntryDate] = useState(row?.entry_date ?? '');
  const [endDate, setEndDate] = useState(row?.end_date ?? '');
  const [startTime, setStartTime] = useState(row?.start_time?.slice(0, 5) ?? '');
  const [endTime, setEndTime] = useState(row?.end_time?.slice(0, 5) ?? '');
  const [dayNote, setDayNote] = useState(row?.day_note ?? '');
  const [category, setCategory] = useState<CalendarCategory | ''>(row?.category ?? '');
  const [title, setTitle] = useState(row?.title ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [location, setLocation] = useState(row?.location ?? '');
  const [articleId, setArticleId] = useState(row?.article_id ? String(row.article_id) : '');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    const fd = new FormData();
    if (row) fd.set('id', String(row.id));
    fd.set('entry_date', entryDate);
    fd.set('end_date', endDate);
    fd.set('start_time', startTime);
    fd.set('end_time', endTime);
    fd.set('day_note', dayNote);
    fd.set('category', category);
    fd.set('title', title);
    fd.set('description', description);
    fd.set('location', location);
    fd.set('article_id', articleId);
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
          <input
            type="date"
            className={styles.editInput}
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>End Date (multi-day only)</span>
          <input
            type="date"
            className={styles.editInput}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
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
            onChange={(e) => setCategory(e.target.value as CalendarCategory)}
            required
          >
            <option value="">— Select —</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
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
          <span className={styles.editLabel}>Linked Article (optional)</span>
          <select className={styles.editInput} value={articleId} onChange={(e) => setArticleId(e.target.value)}>
            <option value="">— None —</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
      </div>

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
