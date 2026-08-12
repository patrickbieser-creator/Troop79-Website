'use client';

/**
 * Add Resource — the webmaster's entry form for every resource kind
 * (Plans/Library-Admin-Resource-Entry.md).
 *
 * Client Component because the fields change with the kind: a link needs a
 * URL, a document needs a URL *or* an upload, an image can be picked from the
 * media library, and a post needs a markdown body with live preview. The
 * server action does the writing; this only assembles the form.
 *
 * Publishes on save. "Save as draft" parks it in the queue instead — the
 * same place family submissions land, distinguishable there by having no
 * submitter name.
 */

import { useRef, useState, useTransition } from 'react';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import type { Media } from '@/lib/supabase/types';
import { RESOURCE_KIND_ICON, RESOURCE_KIND_LABEL, type ResourceKind } from '@/lib/library';
import { MediaPicker } from '../news/_components/media-picker';
import styles from './library.module.css';

export interface TargetOptionGroup {
  group: string;
  options: { value: string; label: string }[];
}

interface Props {
  targetGroups: TargetOptionGroup[];
  onCreate: (fd: FormData) => Promise<void>;
  onUploadDocument: (
    fd: FormData
  ) => Promise<{ ok: boolean; error?: string; url?: string; filename?: string }>;
  /** Rendered inside the quick-add dialog — drops the section heading. */
  embedded?: boolean;
}

const KINDS: ResourceKind[] = ['link', 'video', 'document', 'image', 'post'];

const KIND_HINT: Record<ResourceKind, string> = {
  link: 'Any web page — an article, a how-to, a district page.',
  video: 'A YouTube or Vimeo link. It shows as a thumbnail that links out, never an embedded player.',
  document: 'A PDF. Upload ours, or link to someone else’s.',
  image: 'A diagram, chart, or photo. Pick one already in the media library, or upload a new one.',
  post: 'Something written here on the site — a weekly Sparkler entry, a how-to in our own words.'
};

export function ResourceEntryForm({ targetGroups, onCreate, onUploadDocument, embedded }: Props) {
  const [kind, setKind] = useState<ResourceKind>('link');
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [placements, setPlacements] = useState<{ value: string; label: string }[]>([]);
  const [picker, setPicker] = useState<null | 'image' | 'body'>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [isUploading, startUpload] = useTransition();
  const targetRef = useRef<HTMLSelectElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const needsUrl = kind !== 'post';

  function addPlacement() {
    const select = targetRef.current;
    if (!select?.value) return;
    const value = select.value;
    if (placements.some((p) => p.value === value)) return;
    const label = select.options[select.selectedIndex]?.text ?? value;
    setPlacements((prev) => [...prev, { value, label }]);
    select.value = '';
  }

  function uploadDocument(file: File) {
    setUploadError(null);
    const fd = new FormData();
    fd.set('file', file);
    startUpload(async () => {
      const res = await onUploadDocument(fd);
      if (!res.ok || !res.url) {
        setUploadError(res.error ?? 'Upload failed.');
        return;
      }
      setUrl(res.url);
      setUploadedName(res.filename ?? file.name);
      if (!title.trim()) setTitle((res.filename ?? file.name).replace(/\.pdf$/i, ''));
    });
  }

  /** Inserts markdown for a picked image at the end of the post body. */
  function insertImage(media: Media[]) {
    const first = media[0];
    if (!first) return;
    const md = `\n\n![${first.alt_text ?? ''}](${first.cdn_url})\n\n`;
    setBody((prev) => prev + md);
    bodyRef.current?.focus();
  }

  return (
    <form className={styles.entryForm} action={onCreate}>
      {!embedded && <h2 className={styles.entryHeading}>Add a resource</h2>}

      <div className={styles.fieldGrid}>
        <label className={styles.fieldFull}>
          <span className={styles.fieldLabel}>What kind of resource?</span>
          <select
            className={styles.selectInput}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ResourceKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {RESOURCE_KIND_ICON[k]} {RESOURCE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <span className={styles.fieldHint}>{KIND_HINT[kind]}</span>
        </label>

        <label className={styles.fieldFull}>
          <span className={styles.fieldLabel}>Title</span>
          <input
            className={styles.textInput}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What a scout would call it"
            required
          />
        </label>

        {needsUrl && (
          <label className={styles.fieldFull}>
            <span className={styles.fieldLabel}>
              {kind === 'document' ? 'Link to the document' : kind === 'image' ? 'Image URL' : 'Link'}
            </span>
            <input
              className={styles.textInput}
              name="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
        )}

        {kind === 'image' && (
          <div className={styles.fieldFull}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setPicker('image')}
            >
              Choose from the media library…
            </button>
          </div>
        )}

        {kind === 'document' && (
          <div className={styles.fieldFull}>
            <span className={styles.fieldLabel}>…or upload a PDF</span>
            <input
              type="file"
              accept="application/pdf"
              disabled={isUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadDocument(file);
              }}
            />
            {isUploading && <span className={styles.fieldHint}>Uploading…</span>}
            {uploadedName && !isUploading && (
              <span className={styles.fieldHint}>Uploaded {uploadedName} — the link above is set.</span>
            )}
            {uploadError && <span className={styles.entryError}>{uploadError}</span>}
          </div>
        )}

        {kind === 'post' && (
          <div className={styles.fieldFull}>
            <div className={styles.entryBodyHead}>
              <span className={styles.fieldLabel}>Body</span>
              <button type="button" className={styles.btnSecondary} onClick={() => setPicker('body')}>
                Insert image
              </button>
            </div>
            <div className={styles.entrySplit}>
              <textarea
                ref={bodyRef}
                className={`${styles.textArea} ${styles.narrArea}`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write in markdown — ## heading, **bold**, - list…"
              />
              <div className={styles.entryPreview}>
                <div className={styles.entryPreviewLabel}>Live preview</div>
                {body.trim() ? (
                  <ArticleBody body={body} />
                ) : (
                  <p className={styles.fieldHint}>Nothing to preview yet.</p>
                )}
              </div>
            </div>
            <input type="hidden" name="body_md" value={body} />
          </div>
        )}

        <label className={styles.fieldFull}>
          <span className={styles.fieldLabel}>Blurb (optional)</span>
          <input
            className={styles.textInput}
            name="blurb"
            placeholder="One line on why it’s worth a scout’s time"
          />
        </label>

        <label>
          <span className={styles.fieldLabel}>Credit (optional)</span>
          <input className={styles.textInput} name="attribution_label" placeholder="Shared by Mr. Porter" />
        </label>

        <label>
          <span className={styles.fieldLabel}>Who can see it</span>
          <select className={styles.selectInput} name="visibility" defaultValue="public">
            <option value="public">Everyone</option>
            <option value="leaders">Leaders only</option>
          </select>
        </label>
      </div>

      <div className={styles.fieldFull}>
        <span className={styles.fieldLabel}>Where it shows up</span>
        <div className={styles.entryPlacementRow}>
          <select className={styles.selectInput} ref={targetRef} defaultValue="">
            <option value="">— pick a shelf or requirement —</option>
            {targetGroups.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className={styles.btnSecondary} onClick={addPlacement}>
            + Place
          </button>
        </div>
        {placements.length === 0 ? (
          <span className={styles.fieldHint}>
            Not placed anywhere yet — it will be searchable but won’t appear on a page until you place it.
          </span>
        ) : (
          <div className={styles.entryChips}>
            {placements.map((p) => (
              <span key={p.value} className={styles.entryChip}>
                <input type="hidden" name="placement" value={p.value} />
                {p.label}
                <button
                  type="button"
                  className={styles.chipBtn}
                  aria-label={`Remove ${p.label}`}
                  onClick={() => setPlacements((prev) => prev.filter((x) => x.value !== p.value))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={styles.actionsRow}>
        <button className={styles.btnPrimary} type="submit" name="intent" value="publish">
          Publish
        </button>
        <button className={styles.btnSecondary} type="submit" name="intent" value="draft">
          Save as draft
        </button>
      </div>

      {picker && (
        <MediaPicker
          mode="single"
          onClose={() => setPicker(null)}
          onInsert={(media) => {
            if (picker === 'image') {
              const first = media[0];
              if (first) {
                setUrl(first.cdn_url);
                if (!title.trim()) setTitle(first.alt_text ?? 'Image');
              }
            } else {
              insertImage(media);
            }
            setPicker(null);
          }}
        />
      )}
    </form>
  );
}
