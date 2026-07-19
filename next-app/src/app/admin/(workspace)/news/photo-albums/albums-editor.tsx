'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
/* eslint-disable @next/next/no-img-element -- admin thumbnails; remote sizes vary */
import type { CalendarCategory, Media, PhotoAlbum } from '@/lib/supabase/types';
import { categoryColor } from '@/lib/calendar-shared';
import { MediaPicker } from '../_components/media-picker';
import styles from './albums.module.css';

type ActionResult = { ok: boolean; error?: string };

export interface CoverInfo {
  cdn_url: string;
  alt_text: string;
}

interface Props {
  rows: PhotoAlbum[];
  covers: Record<number, CoverInfo>;
  categories: CalendarCategory[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onDelete: (id: number) => Promise<ActionResult>;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function AlbumsEditor({ rows, covers, categories, onCreate, onUpdate, onDelete }: Props) {
  const [openFor, setOpenFor] = useState<PhotoAlbum | 'new' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowErr, setRowErr] = useState<{ id: number; msg: string } | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (openFor && !dlg.open) dlg.showModal();
    if (!openFor && dlg.open) dlg.close();
  }, [openFor]);

  function onDeleteClick(row: PhotoAlbum) {
    if (!window.confirm(`Remove "${row.title}" from the Photos page? The Google Photos album itself is untouched.`)) {
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
        <button type="button" className={styles.addBtn} onClick={() => setOpenFor('new')}>
          + Add Album
        </button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Cover</th>
            <th>Date</th>
            <th>Category</th>
            <th>Title</th>
            <th>Photos</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.muted}>
                No albums yet. Add the first one above — all you need is the Google Photos share link.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const cover = row.cover_media_id ? covers[row.cover_media_id] : undefined;
              return (
                <tr key={row.id}>
                  <td>
                    {cover ? (
                      <img src={cover.cdn_url} alt={cover.alt_text} className={styles.coverThumb} />
                    ) : (
                      <span className={styles.coverNone}>79</span>
                    )}
                  </td>
                  <td className={styles.dateCell}>{formatDate(row.event_date)}</td>
                  <td>
                    <span className={styles.catTag}>
                      <span
                        className={styles.catPip}
                        style={{ background: categoryColor(row.category) }}
                      />
                      {row.category}
                    </span>
                  </td>
                  <td>
                    <a href={row.google_url} target="_blank" rel="noopener noreferrer">
                      {row.title}
                    </a>
                    {rowErr?.id === row.id && <div className={styles.editError}>{rowErr.msg}</div>}
                  </td>
                  <td>{row.photo_count ?? <span className={styles.muted}>—</span>}</td>
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
              );
            })
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
          <AlbumForm
            key={openFor === 'new' ? 'new' : openFor.id}
            row={openFor === 'new' ? null : openFor}
            cover={openFor !== 'new' && openFor.cover_media_id ? covers[openFor.cover_media_id] : undefined}
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

function AlbumForm({
  row,
  cover,
  categories,
  onCreate,
  onUpdate,
  onClose
}: {
  row: PhotoAlbum | null;
  cover?: CoverInfo;
  categories: CalendarCategory[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const isNew = row === null;
  const [googleUrl, setGoogleUrl] = useState(row?.google_url ?? '');
  const [title, setTitle] = useState(row?.title ?? '');
  const [eventDate, setEventDate] = useState(row?.event_date ?? '');
  const [category, setCategory] = useState<CalendarCategory | ''>(row?.category ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [photoCount, setPhotoCount] = useState(row?.photo_count ? String(row.photo_count) : '');
  const [coverId, setCoverId] = useState<number | null>(row?.cover_media_id ?? null);
  const [coverPreview, setCoverPreview] = useState<CoverInfo | null>(cover ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    const fd = new FormData();
    if (row) fd.set('id', String(row.id));
    fd.set('google_url', googleUrl);
    fd.set('title', title);
    fd.set('event_date', eventDate);
    fd.set('category', category);
    fd.set('description', description);
    fd.set('photo_count', photoCount);
    fd.set('cover_media_id', coverId ? String(coverId) : '');
    startTransition(async () => {
      const res = isNew ? await onCreate(fd) : await onUpdate(fd);
      if (!res.ok) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onClose();
    });
  }

  function onPickCover(media: Media[]) {
    const m = media[0];
    if (m) {
      setCoverId(m.id);
      setCoverPreview({ cdn_url: m.cdn_url, alt_text: m.alt_text ?? '' });
    }
    setPickerOpen(false);
  }

  return (
    <div className={styles.dialogInner}>
      <div className={styles.dialogHeader}>
        <h3>{isNew ? 'Add Photo Album' : `Edit: ${row?.title}`}</h3>
        <p>Shows on the public Photos page; the card links out to Google Photos in a new tab.</p>
      </div>

      <div className={styles.editGrid}>
        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Google Photos share link</span>
          <input
            type="url"
            className={styles.editInput}
            value={googleUrl}
            onChange={(e) => setGoogleUrl(e.target.value)}
            placeholder="https://photos.app.goo.gl/…"
            required
          />
        </label>

        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Title</span>
          <input
            type="text"
            className={styles.editInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summer Camp — Camp Long Lake 2026"
            required
          />
        </label>

        <label className={styles.editField}>
          <span className={styles.editLabel}>Event date</span>
          <input
            type="date"
            className={styles.editInput}
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            required
          />
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

        <label className={styles.editFieldFull}>
          <span className={styles.editLabel}>Description (optional, one sentence)</span>
          <input
            type="text"
            className={styles.editInput}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className={styles.editField}>
          <span className={styles.editLabel}>Photo count (optional, approximate)</span>
          <input
            type="number"
            min="1"
            className={styles.editInput}
            value={photoCount}
            onChange={(e) => setPhotoCount(e.target.value)}
          />
        </label>
        <div className={styles.editField}>
          <span className={styles.editLabel}>Cover (optional)</span>
          <div className={styles.coverRow}>
            {coverPreview ? (
              <img src={coverPreview.cdn_url} alt={coverPreview.alt_text} />
            ) : (
              <span className={styles.coverNone}>79</span>
            )}
            <button type="button" className={styles.editBtn} onClick={() => setPickerOpen(true)}>
              {coverPreview ? 'Change' : 'Choose…'}
            </button>
            {coverPreview && (
              <button
                type="button"
                className={styles.editBtn}
                onClick={() => {
                  setCoverId(null);
                  setCoverPreview(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
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
          disabled={isPending || !googleUrl.trim() || !title.trim() || !eventDate || !category}
        >
          {isPending ? 'Saving…' : isNew ? 'Add Album' : 'Save changes'}
        </button>
      </div>

      {pickerOpen && (
        <MediaPicker mode="single" onClose={() => setPickerOpen(false)} onInsert={onPickCover} />
      )}
    </div>
  );
}
