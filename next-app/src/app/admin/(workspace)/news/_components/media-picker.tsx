'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import type { Media } from '@/lib/supabase/types';
import { listMedia, setMediaAltText, uploadMedia } from '../media/actions';
import { prepareImageForUpload, beforeAfterLine, formatBytes, type ResizeKind } from '@/lib/image-resize';
import { TabStrip } from '../../_components/tab-strip';
import { Dialog } from '../../_components/dialog';
import { Button } from '../../../_components/button';
import styles from './media-picker.module.css';

interface MediaPickerProps {
  /**
   * 'single' for Insert Image, 'multi' for Insert Gallery. The caller
   * controls mounting (e.g. `{pickerMode && <MediaPicker .../>}`) — there's
   * no `open` prop, so opening it is always a fresh mount with fresh state.
   */
  mode: 'single' | 'multi';
  onClose: () => void;
  onInsert: (media: Media[]) => void;
  /**
   * Pre-seeds the selection when reopening the picker to edit an existing
   * gallery block. Best-effort: items not among the current search results
   * still count toward the selection and get included on Insert, but won't
   * visually highlight in the grid until a search brings them into view.
   */
  initialSelected?: Media[];
  /**
   * Resize-before-upload target (Plans/Photo-Thumbnails.md): 'cover' = 1200 px
   * long edge (album covers), 'general' = 1600 px (everything else). The
   * 4 MB screenshot never leaves the browser; the uploader sees "4.0 MB →
   * 180 KB" beside the filename.
   */
  resizeKind?: ResizeKind;
}

type Tab = 'browse' | 'upload';

interface PendingUpload {
  key: string;
  file: File;
  previewUrl: string;
  altText: string;
  caption: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  /** "4.0 MB → 180 KB" once the browser has resized it; absent when the
   *  file was already small enough and went up byte-identical. */
  sizeLine?: string;
  /** Patrick, 2026-08-23: the seldom-used exception — upload the file exactly
   *  as chosen (a print-quality original) instead of the browser-resized
   *  derivative. Per file, off by default, deliberately quiet. */
  keepOriginal?: boolean;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function MediaPicker({ mode, onClose, onInsert, initialSelected, resizeKind = 'general' }: MediaPickerProps) {
  const [tab, setTab] = useState<Tab>('browse');
  const [search, setSearch] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Map<number, Media>>(
    () => new Map((initialSelected ?? []).map((m) => [m.id, m]))
  );
  const [altPromptId, setAltPromptId] = useState<number | null>(null);
  const [altPromptValue, setAltPromptValue] = useState('');
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isSaving, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // The picker mounts only while open (consumers gate on their own state),
  // so open the native modal on mount. Nested consumers (calendar entry
  // form, library quick-add, albums) stack fine — the top layer handles it,
  // and Esc/cancel targets only the topmost dialog.
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Revoke any pending upload preview URLs on unmount.
  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let ignore = false;
    const t = setTimeout(() => {
      setLoading(true);
      listMedia(search).then((res) => {
        if (ignore) return;
        setMedia(res.media);
        setLoading(false);
      });
    }, 200);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [search]);

  function toggleSelect(item: Media) {
    if (!item.alt_text) {
      setAltPromptId(item.id);
      setAltPromptValue('');
      return;
    }
    setSelected((prev) => {
      const next = new Map(prev);
      if (mode === 'single') {
        next.clear();
        if (!prev.has(item.id)) next.set(item.id, item);
      } else if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, item);
      }
      return next;
    });
  }

  function confirmAltPrompt() {
    const id = altPromptId;
    const text = altPromptValue.trim();
    if (!id || !text) return;
    startTransition(async () => {
      const res = await setMediaAltText(id, text);
      if (res.ok) {
        setMedia((prev) => {
          const updated = prev.map((m) => (m.id === id ? { ...m, alt_text: text } : m));
          const item = updated.find((m) => m.id === id);
          if (item) toggleSelect(item);
          return updated;
        });
      }
      setAltPromptId(null);
    });
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const items: PendingUpload[] = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      previewUrl: URL.createObjectURL(file),
      altText: '',
      caption: '',
      status: 'pending'
    }));
    setPending((prev) => [...items, ...prev]);
  }

  function updatePendingAlt(key: string, value: string) {
    setPending((prev) => prev.map((p) => (p.key === key ? { ...p, altText: value } : p)));
  }

  function updateKeepOriginal(key: string, value: boolean) {
    setPending((prev) => prev.map((p) => (p.key === key ? { ...p, keepOriginal: value } : p)));
  }

  async function submitPending(key: string) {
    const item = pending.find((p) => p.key === key);
    if (!item || !item.altText.trim()) return;
    setPending((prev) => prev.map((p) => (p.key === key ? { ...p, status: 'uploading' } : p)));

    // Resize in the browser first (Plans/Photo-Thumbnails.md): a heavy image
    // comes back re-encoded at the target long edge; a small one, a GIF or an
    // undecodable file comes back exactly as chosen.
    const prepared = item.keepOriginal
      ? { file: item.file, before: null, width: null, height: null }
      : await prepareImageForUpload(item.file, resizeKind);
    const sizeLine = item.keepOriginal
      ? `${formatBytes(item.file.size)} · original kept`
      : prepared.before != null
        ? beforeAfterLine(prepared.before, prepared.file.size)
        : undefined;
    if (sizeLine) setPending((prev) => prev.map((p) => (p.key === key ? { ...p, sizeLine } : p)));
    const dims =
      prepared.width != null && prepared.height != null
        ? { width: prepared.width, height: prepared.height }
        : await readImageDimensions(prepared.file);
    const fd = new FormData();
    fd.set('file', prepared.file);
    fd.set('altText', item.altText.trim());
    if (item.caption.trim()) fd.set('caption', item.caption.trim());
    if (dims) {
      fd.set('width', String(dims.width));
      fd.set('height', String(dims.height));
    }
    const res = await uploadMedia(fd);
    if (res.ok && res.media) {
      const uploaded = res.media;
      setPending((prev) => prev.map((p) => (p.key === key ? { ...p, status: 'done' } : p)));
      setMedia((prev) => [uploaded, ...prev]);
      toggleSelect(uploaded);
    } else {
      setPending((prev) => prev.map((p) => (p.key === key ? { ...p, status: 'error', error: res.error } : p)));
    }
  }

  const selectedList = Array.from(selected.values());

  return (
    <Dialog
      ref={dialogRef}
      className={styles.modal}
      onClose={onClose}
      aria-labelledby="mpTitle"
    >
        <div className={styles.modalHead}>
          <h2 id="mpTitle">{mode === 'multi' ? 'Select Photos for Gallery' : 'Select an Image'}</h2>
          <button className={styles.close} aria-label="Close media picker" onClick={onClose} type="button">
            &times;
          </button>
        </div>

        {/* Shared pill TabStrip (Phase B fold-in decision, Patrick 2026-08-21) —
            replaced the picker's own public-token tab styling. */}
        <div className={styles.tabRow}>
          <TabStrip
            ariaLabel="Media picker source"
            activeKey={tab}
            items={[
              { key: 'browse', label: 'Browse Existing', onSelect: () => setTab('browse') },
              { key: 'upload', label: 'Upload New', onSelect: () => setTab('upload') }
            ]}
          />
        </div>

        <div className={styles.body}>
          <div className={`${styles.panel} ${tab === 'browse' ? styles.panelActive : ''}`} role="tabpanel">
            <div className={styles.browseBar}>
              <div className={styles.search}>
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 5L20.49 19l-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
                </svg>
                <input
                  type="search"
                  placeholder="Search by filename or description…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search photos"
                />
              </div>
            </div>

            {altPromptId !== null && (
              <div className={styles.altPrompt}>
                <input
                  autoFocus
                  placeholder="Describe this photo for screen readers…"
                  value={altPromptValue}
                  onChange={(e) => setAltPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmAltPrompt();
                  }}
                />
                <Button
                  variant="primary"
                  disabled={isSaving || !altPromptValue.trim()}
                  onClick={confirmAltPrompt}
                >
                  Save &amp; Select
                </Button>
                <Button onClick={() => setAltPromptId(null)}>
                  Cancel
                </Button>
              </div>
            )}

            {loading ? (
              <p>Loading…</p>
            ) : media.length === 0 ? (
              <div className={styles.empty}>
                <p>
                  No photos match &ldquo;{search || '(nothing uploaded yet)'}.&rdquo;
                  <br />
                  Try a different search, or switch to <strong>Upload New</strong>.
                </p>
              </div>
            ) : (
              <div className={styles.grid}>
                {media.map((item) => {
                  const isSelected = selected.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`${styles.thumb} ${isSelected ? styles.thumbSelected : ''}`}
                      role={mode === 'multi' ? 'checkbox' : 'radio'}
                      aria-checked={isSelected}
                      aria-label={`${item.bunny_path}${item.alt_text ? ': ' + item.alt_text : ': missing alt text'}`}
                      tabIndex={0}
                      onClick={() => toggleSelect(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleSelect(item);
                        }
                      }}
                    >
                      <span className={styles.thumbCheck} aria-hidden="true" />
                      <Image src={item.cdn_url} alt="" fill sizes="180px" />
                      <div className={styles.thumbOverlay}>
                        <div className={styles.thumbMeta}>
                          <span className="fn">{item.bunny_path.split('/').pop()}</span>
                          <span className="alt">{item.alt_text || '⚠ No alt text yet'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`${styles.panel} ${tab === 'upload' ? styles.panelActive : ''}`} role="tabpanel">
            <div
              className={`${styles.dropzone} ${dragOver ? styles.dropzoneDragover : ''}`}
              tabIndex={0}
              role="button"
              aria-label="Upload photos: click or drag and drop"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
            >
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
              </svg>
              <strong>Drag photos here, or click to browse</strong>
              <span className={styles.dzSub}>JPG, PNG, WEBP, or GIF, up to 12&nbsp;MB each.</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/webp, image/gif"
                multiple
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {pending.length > 0 && (
              <div className={styles.uploadList}>
                {pending.map((p) => (
                  <div
                    key={p.key}
                    className={`${styles.uploadItem} ${p.status === 'done' ? styles.uploadItemDone : ''} ${
                      p.status === 'error' ? styles.uploadItemError : ''
                    }`}
                  >
                    {/* Local blob preview — real optimization happens once it's a Bunny CDN URL. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className={styles.uploadThumb} src={p.previewUrl} alt="" />
                    <div className={styles.uploadInfo}>
                      <div className={styles.uploadName}>
                        {p.file.name}
                        {p.sizeLine && <span className={styles.uploadSize}> · {p.sizeLine}</span>}
                      </div>
                      {p.status === 'pending' && (
                        <div className={styles.altPrompt}>
                          <input
                            placeholder="Alt text (required)…"
                            value={p.altText}
                            onChange={(e) => updatePendingAlt(p.key, e.target.value)}
                          />
                          <Button
                            variant="primary"
                            disabled={!p.altText.trim()}
                            onClick={() => submitPending(p.key)}
                          >
                            Upload
                          </Button>
                        </div>
                      )}
                      {p.status === 'pending' && (
                        <label className={styles.keepOriginal}>
                          <input
                            type="checkbox"
                            checked={p.keepOriginal ?? false}
                            onChange={(e) => updateKeepOriginal(p.key, e.target.checked)}
                          />{' '}
                          Keep original size (skip the resize — for a print-quality file)
                        </label>
                      )}
                      {p.status === 'uploading' && (
                        <div className={styles.progressTrack}>
                          <div className={styles.progressFill} />
                        </div>
                      )}
                      <div className={styles.uploadStatus}>
                        {p.status === 'uploading' && 'Uploading…'}
                        {p.status === 'done' && 'Uploaded and selected'}
                        {p.status === 'error' && (p.error || 'Upload failed')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.modalFoot}>
          <span className={styles.selectedCount}>
            <strong>{selectedList.length}</strong> selected
          </span>
          <div className={styles.footActions}>
            <Button onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={selectedList.length === 0}
              onClick={() => {
                onInsert(selectedList);
                onClose();
              }}
            >
              Insert Selected
            </Button>
          </div>
        </div>
    </Dialog>
  );
}
