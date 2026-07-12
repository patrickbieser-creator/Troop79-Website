'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import type { Media } from '@/lib/supabase/types';
import { listMediaManager, updateMediaMetadata, deleteMedia, type MediaUsage } from './actions';
import styles from './media-manager.module.css';

const PAGE_SIZE = 60;

type View = 'browse' | 'list';

export function MediaManagerView() {
  const [view, setView] = useState<View>('browse');
  const [search, setSearch] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<Media | null>(null);
  const [deleting, setDeleting] = useState<Media | null>(null);

  useEffect(() => {
    let ignore = false;
    const t = setTimeout(() => {
      setLoading(true);
      listMediaManager(search, 0, PAGE_SIZE).then((res) => {
        if (ignore) return;
        setMedia(res.media);
        setTotal(res.total);
        setLoading(false);
      });
    }, 200);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [search]);

  function loadMore() {
    setLoadingMore(true);
    listMediaManager(search, media.length, PAGE_SIZE).then((res) => {
      setMedia((prev) => [...prev, ...res.media]);
      setTotal(res.total);
      setLoadingMore(false);
    });
  }

  function handleUpdated(updated: Media) {
    setMedia((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditing(null);
  }

  function handleDeleted(id: number) {
    setMedia((prev) => prev.filter((m) => m.id !== id));
    setTotal((t) => t - 1);
    setDeleting(null);
  }

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Media Manager</h1>
        <p>
          Every photo in the library — uploaded here or synced in from Bunny. Edit alt text and
          captions, or delete photos that are no longer needed (deleting only removes it from this
          library; the file stays in Bunny and a Sync will re-index it).
        </p>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by filename or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search photos"
        />
        <div className={styles.viewToggle} role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'browse'}
            className={`${styles.viewToggleBtn} ${view === 'browse' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => setView('browse')}
          >
            Browse
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'list'}
            className={`${styles.viewToggleBtn} ${view === 'list' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
        <span className={styles.count}>
          {loading ? 'Loading…' : `${total} photo${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {!loading && media.length === 0 ? (
        <div className={styles.empty}>
          No photos match &ldquo;{search || '(the library is empty)'}.&rdquo;
        </div>
      ) : view === 'browse' ? (
        <div className={styles.grid}>
          {media.map((item) => (
            <div key={item.id} className={styles.thumb}>
              <Image src={item.cdn_url} alt="" fill sizes="150px" style={{ objectFit: 'cover' }} />
              <div className={styles.thumbOverlay}>
                <div className={styles.thumbMeta}>
                  <span className="fn">{item.bunny_path.split('/').pop()}</span>
                  <span className={`alt ${item.alt_text ? '' : styles.thumbAltMissing}`}>
                    {item.alt_text || '⚠ No alt text'}
                  </span>
                </div>
                <div className={styles.thumbActions}>
                  <button type="button" className={styles.editBtn} onClick={() => setEditing(item)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`${styles.editBtn} ${styles.dangerBtn}`}
                    onClick={() => setDeleting(item)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th></th>
              <th>Filename</th>
              <th>Alt Text</th>
              <th>Caption</th>
              <th>Uploaded By</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {media.map((item) => (
              <tr key={item.id}>
                <td>
                  <Image src={item.cdn_url} alt="" width={48} height={48} className={styles.listThumb} />
                </td>
                <td className={styles.pathCell}>{item.bunny_path}</td>
                <td>
                  {item.alt_text || <span className={styles.thumbAltMissing}>⚠ Missing</span>}
                </td>
                <td>{item.caption || <span className={styles.muted}>—</span>}</td>
                <td>{item.uploaded_by}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className={styles.editBtn} onClick={() => setEditing(item)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`${styles.editBtn} ${styles.dangerBtn}`}
                    onClick={() => setDeleting(item)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && media.length < total && (
        <div className={styles.loadMoreRow}>
          <button type="button" className={styles.loadMoreBtn} disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Loading…' : `Load more (${total - media.length} remaining)`}
          </button>
        </div>
      )}

      <EditDialog media={editing} onClose={() => setEditing(null)} onSaved={handleUpdated} />
      <DeleteDialog media={deleting} onClose={() => setDeleting(null)} onDeleted={handleDeleted} />
    </>
  );
}

function EditDialog({
  media,
  onClose,
  onSaved
}: {
  media: Media | null;
  onClose: () => void;
  onSaved: (m: Media) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (media && !dlg.open) dlg.showModal();
    if (!media && dlg.open) dlg.close();
  }, [media]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {media && <EditForm key={media.id} media={media} onClose={onClose} onSaved={onSaved} />}
    </dialog>
  );
}

function EditForm({
  media,
  onClose,
  onSaved
}: {
  media: Media;
  onClose: () => void;
  onSaved: (m: Media) => void;
}) {
  const [altText, setAltText] = useState(media.alt_text ?? '');
  const [caption, setCaption] = useState(media.caption ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    startTransition(async () => {
      const res = await updateMediaMetadata(media.id, altText, caption);
      if (!res.ok || !res.media) {
        setErr(res.error ?? 'Save failed');
        return;
      }
      onSaved(res.media);
    });
  }

  return (
    <div className={styles.dialogInner}>
      <div className={styles.dialogHeader}>
        <h3>Edit Photo Details</h3>
        <p>{media.bunny_path.split('/').pop()}</p>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.cdn_url} alt="" className={styles.dialogPreview} />

      <label className={styles.editField}>
        <span className={styles.editLabel}>Alt Text (required)</span>
        <input
          type="text"
          className={styles.editInput}
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          placeholder="Describe this photo for screen readers…"
          autoFocus
        />
      </label>
      <label className={styles.editField}>
        <span className={styles.editLabel}>Caption (optional)</span>
        <input
          type="text"
          className={styles.editInput}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </label>

      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.dialogActions}>
        <button type="button" className={styles.editBtn} onClick={onClose} disabled={isPending}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.editSaveBtn}
          onClick={submit}
          disabled={isPending || !altText.trim()}
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function DeleteDialog({
  media,
  onClose,
  onDeleted
}: {
  media: Media | null;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (media && !dlg.open) dlg.showModal();
    if (!media && dlg.open) dlg.close();
  }, [media]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {media && <DeleteConfirm key={media.id} media={media} onClose={onClose} onDeleted={onDeleted} />}
    </dialog>
  );
}

function DeleteConfirm({
  media,
  onClose,
  onDeleted
}: {
  media: Media;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<MediaUsage[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    setErr(null);
    startTransition(async () => {
      const res = await deleteMedia(media.id);
      if (res.blockedBy) {
        setBlockedBy(res.blockedBy);
        return;
      }
      if (!res.ok) {
        setErr(res.error ?? 'Delete failed');
        return;
      }
      onDeleted(media.id);
    });
  }

  return (
    <div className={styles.dialogInner}>
      <div className={styles.dialogHeader}>
        <h3>Delete Photo</h3>
        <p>
          {blockedBy
            ? "This photo can't be deleted while it's in use."
            : 'Removes it from the media library. The file stays in Bunny storage — a Bunny Library Sync will re-index it if you change your mind.'}
        </p>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.cdn_url} alt="" className={styles.dialogPreview} />

      {blockedBy && (
        <div className={styles.blockedNotice}>
          Used by {blockedBy.length} article{blockedBy.length === 1 ? '' : 's'}:
          <ul className={styles.blockedList}>
            {blockedBy.map((a) => (
              <li key={a.id}>
                {a.title} ({a.roles.join(' + ')}, {a.status})
              </li>
            ))}
          </ul>
          Remove it from those articles first, then delete it here.
        </div>
      )}
      {err && <div className={styles.editError}>{err}</div>}

      <div className={styles.dialogActions}>
        <button type="button" className={styles.editBtn} onClick={onClose} disabled={isPending}>
          {blockedBy ? 'Close' : 'Cancel'}
        </button>
        {!blockedBy && (
          <button type="button" className={styles.deleteConfirmBtn} onClick={confirmDelete} disabled={isPending}>
            {isPending ? 'Deleting…' : 'Delete photo'}
          </button>
        )}
      </div>
    </div>
  );
}
