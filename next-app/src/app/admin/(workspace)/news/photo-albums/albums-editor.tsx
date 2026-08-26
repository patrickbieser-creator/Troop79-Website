'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
/* eslint-disable @next/next/no-img-element -- admin thumbnails; remote sizes vary */
import type { Media, PhotoAlbum } from '@/lib/supabase/types';
import { categoryColorMap, colorFor, type CalendarCategoryRow } from '@/lib/calendar-categories';
import { MediaPicker } from '../_components/media-picker';
import { DatePickerField } from '../../_components/date-picker-field';
import { AddButton } from '../../_components/add-button';
import styles from './albums.module.css';
import { Dialog, DialogHeader, DialogBody, DialogActions } from '../../_components/dialog';
import { Notice } from '../../_components/notice';
import { SaveButton, SaveFeedback, useSavedSnapshot, useSavePhase } from '../../_components/save-state';
import { Button } from '../../../_components/button';

import { fmtDate } from '@/lib/format-date';
type ActionResult = { ok: boolean; error?: string };

export interface CoverInfo {
  cdn_url: string;
  alt_text: string;
}

interface Props {
  rows: PhotoAlbum[];
  covers: Record<number, CoverInfo>;
  /** The same calendar_categories lookup the calendar uses — albums share the
   *  vocabulary by FK now (D-082), not by a hand-synced copy of the list. */
  categories: CalendarCategoryRow[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onDelete: (id: number) => Promise<ActionResult>;
}

const formatDate = (iso: string): string => fmtDate(iso);

export function AlbumsEditor({ rows, covers, categories, onCreate, onUpdate, onDelete }: Props) {
  const [openFor, setOpenFor] = useState<PhotoAlbum | 'new' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowErr, setRowErr] = useState<{ id: number; msg: string } | null>(null);
  const [, startTransition] = useTransition();
  const feedback = useSavePhase(); // Done flash after the album dialog closes (Save standard)
  const colors = categoryColorMap(categories);

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
        {/* Shared AddButton (Phase A, 2026-08-21) — this screen's own .addBtn
            was the D-159 original the others copied. */}
        <AddButton onClick={() => setOpenFor('new')}>+ Add Album</AddButton>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Cover</th>
            <th>Date</th>
            <th>Category</th>
            <th>Title</th>
            <th>Photos</th>
            <th className={styles.actionsCell}>Actions</th>
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
                      {/* inline: dynamic — per-category color from the lookup table */}
                      <span
                        className={styles.catPip}
                        style={{ background: colorFor(colors, row.category) }}
                      />
                      {row.category}
                    </span>
                  </td>
                  {/* .linkCell caps a runaway title/URL with an ellipsis — the
                      class existed unused since the audit flagged it (Section 2
                      truncation sweep, 2026-08-21). */}
                  <td className={styles.linkCell}>
                    <a href={row.google_url} target="_blank" rel="noopener noreferrer">
                      {row.title}
                    </a>
                    {rowErr?.id === row.id && <Notice>{rowErr.msg}</Notice>}
                  </td>
                  <td>{row.photo_count ?? <span className={styles.muted}>—</span>}</td>
                  <td className={styles.actionsCell}>
                    <Button
                      size="sm"
                      onClick={() => setOpenFor(row)}
                      disabled={busyId === row.id}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => onDeleteClick(row)}
                      disabled={busyId === row.id}
                    >
                      {busyId === row.id ? '…' : 'Delete'}
                    </Button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <Dialog ref={dialogRef} onClose={() => setOpenFor(null)}>
        {openFor && (
          <AlbumForm
            key={openFor === 'new' ? 'new' : openFor.id}
            row={openFor === 'new' ? null : openFor}
            cover={openFor !== 'new' && openFor.cover_media_id ? covers[openFor.cover_media_id] : undefined}
            categories={categories}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onClose={() => setOpenFor(null)}
            onSaved={() => {
              setOpenFor(null);
              feedback.done();
            }}
          />
        )}
      </Dialog>
      <SaveFeedback phase={feedback.phase} />
    </>
  );
}

function AlbumForm({
  row,
  cover,
  categories,
  onCreate,
  onUpdate,
  onClose,
  onSaved
}: {
  row: PhotoAlbum | null;
  cover?: CoverInfo;
  categories: CalendarCategoryRow[];
  onCreate: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onClose: () => void;
  /** Called instead of onClose after a successful save, so the parent can flash Done. */
  onSaved: () => void;
}) {
  const isNew = row === null;
  const [googleUrl, setGoogleUrl] = useState(row?.google_url ?? '');
  const [title, setTitle] = useState(row?.title ?? '');
  const [eventDate, setEventDate] = useState(row?.event_date ?? '');
  const [category, setCategory] = useState<string>(row?.category ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [photoCount, setPhotoCount] = useState(row?.photo_count ? String(row.photo_count) : '');
  const [coverId, setCoverId] = useState<number | null>(row?.cover_media_id ?? null);
  const [coverPreview, setCoverPreview] = useState<CoverInfo | null>(cover ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { dirty } = useSavedSnapshot(
    JSON.stringify({ googleUrl, title, eventDate, category, description, photoCount, coverId })
  );

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
      onSaved();
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
    <>
      <DialogHeader
        title={isNew ? 'Add Photo Album' : `Edit: ${row?.title}`}
        sub="Shows on the public Photos page; the card links out to Google Photos in a new tab."
      />

      <DialogBody>
      <div className={styles.fieldGrid}>
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
          <DatePickerField value={eventDate} onChange={setEventDate} />
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
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              {coverPreview ? 'Change' : 'Choose…'}
            </Button>
            {coverPreview && (
              <Button
                size="sm"
                onClick={() => {
                  setCoverId(null);
                  setCoverPreview(null);
                }}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {err && <Notice>{err}</Notice>}

      {pickerOpen && (
        <MediaPicker mode="single" resizeKind="cover" onClose={() => setPickerOpen(false)} onInsert={onPickCover} />
      )}
      </DialogBody>

      <DialogActions>
        <Button onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <SaveButton
          dirty={dirty}
          pending={isPending}
          isNew={isNew}
          newLabel="Add Album"
          blocked={!googleUrl.trim() || !title.trim() || !eventDate || !category}
          blockedReason="Link, title, date and category are required"
          onClick={submit}
        />
      </DialogActions>
    </>
  );
}
