'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SessionRole } from '@/lib/leader-session';
import type { Article, ArticleType, Media, Tag } from '@/lib/supabase/types';
import { ArticleBody, type EditableBlockInfo } from '@/lib/article-body/ArticleBody';
import {
  buildGalleryLinkToken,
  buildGalleryToken,
  buildVideoToken,
  parseGalleryToken,
  parseGalleryLinkToken,
  parseVideoToken
} from '@/lib/article-body/tokens';
import { MediaPicker } from '../../_components/media-picker';
import { createArticle, updateArticle, publishArticle } from '../actions';
import styles from './article-editor.module.css';

type PickerMode = 'hero' | 'image' | 'gallery' | 'gallerylink-cover' | null;

interface Props {
  article: Article | null;
  selectedTagIds: number[];
  heroMedia: Media | null;
  allTags: Tag[];
  sessionRole: SessionRole;
  sessionName: string;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string {
  if (!value) return '';
  return new Date(value).toISOString();
}

let stubMediaId = 0;

/**
 * Custom blocks only ever store a raw cdn_url + alt text in the markdown
 * token, not a media id — when editing an existing block, this fakes just
 * enough of a `Media` row (only `cdn_url`/`alt_text` are ever read back off
 * it) so the picker/forms can reuse the same state shape as a fresh insert.
 */
function stubMedia(cdnUrl: string, altText: string | null): Media {
  stubMediaId -= 1;
  return {
    id: stubMediaId,
    bunny_path: '',
    cdn_url: cdnUrl,
    alt_text: altText,
    caption: null,
    uploaded_by: '',
    width: null,
    height: null,
    created_at: ''
  };
}

export function ArticleEditor({ article, selectedTagIds, heroMedia, allTags, sessionRole }: Props) {
  const router = useRouter();
  const isLeader = sessionRole === 'leader';
  const isNew = !article;

  const [title, setTitle] = useState(article?.title ?? '');
  const [type, setType] = useState<ArticleType>(article?.type ?? 'news');
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [tagIds, setTagIds] = useState<Set<number>>(new Set(selectedTagIds));
  const [hero, setHero] = useState<Media | null>(heroMedia);

  const [eventStart, setEventStart] = useState(toLocalInputValue(article?.event_start ?? null));
  const [eventEnd, setEventEnd] = useState(toLocalInputValue(article?.event_end ?? null));
  const [eventLocation, setEventLocation] = useState(article?.event_location ?? '');
  const [eventRegistrationUrl, setEventRegistrationUrl] = useState(article?.event_registration_url ?? '');

  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [galleryLinkForm, setGalleryLinkForm] = useState<{ url: string; caption: string; coverMedia: Media | null } | null>(null);
  const [videoForm, setVideoForm] = useState<{ url: string; caption: string } | null>(null);
  const [gallerySeed, setGallerySeed] = useState<Media[] | null>(null);
  // Set only when a form/picker was opened by clicking "Edit" on an existing
  // block — Insert/onInsert then splices the rebuilt token back into this
  // exact source range instead of inserting a new one at the cursor.
  const [editingRange, setEditingRange] = useState<{ start: number; end: number } | null>(null);

  function replaceOrInsert(token: string) {
    if (editingRange) {
      setBody((b) => b.slice(0, editingRange.start) + token + b.slice(editingRange.end));
      setEditingRange(null);
    } else {
      insertAtCursor(token);
    }
  }

  function handleEditBlock(info: EditableBlockInfo) {
    setEditingRange({ start: info.start, end: info.end });
    if (info.type === 'gallerylink') {
      const parsed = parseGalleryLinkToken(info.raw);
      setVideoForm(null);
      setGalleryLinkForm({
        url: parsed.url,
        caption: parsed.caption ?? '',
        coverMedia: parsed.coverUrl ? stubMedia(parsed.coverUrl, null) : null
      });
    } else if (info.type === 'video') {
      const parsed = parseVideoToken(info.raw);
      setGalleryLinkForm(null);
      setVideoForm({ url: parsed.url, caption: parsed.caption ?? '' });
    } else if (info.type === 'gallery') {
      setGalleryLinkForm(null);
      setVideoForm(null);
      setGallerySeed(parseGalleryToken(info.raw).map((img) => stubMedia(img.url, img.alt || null)));
      setPickerMode('gallery');
    }
  }

  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertAtCursor(token: string) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const before = body.slice(0, start).replace(/\n*$/, '');
    const after = body.slice(end).replace(/^\n*/, '');
    const beforePart = before ? before + '\n\n' : '';
    const afterPart = after ? '\n\n' + after : '';
    const next = beforePart + token + afterPart;
    setBody(next);
    const cursorPos = beforePart.length + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursorPos, cursorPos);
    });
  }

  function toggleTag(id: number) {
    setTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set('title', title);
    fd.set('type', type);
    fd.set('excerpt', excerpt);
    fd.set('body', body);
    if (hero) fd.set('heroMediaId', String(hero.id));
    fd.set('tagIds', Array.from(tagIds).join(','));
    if (type === 'event') {
      fd.set('eventStart', fromLocalInputValue(eventStart));
      fd.set('eventEnd', fromLocalInputValue(eventEnd));
      fd.set('eventLocation', eventLocation);
      fd.set('eventRegistrationUrl', eventRegistrationUrl);
    }
    return fd;
  }

  function handleSave(thenPublish: boolean) {
    setError(null);
    startTransition(async () => {
      const fd = buildFormData();
      const res = article ? await updateArticle(article.id, fd) : await createArticle(fd);
      if (!res.ok || !res.id) {
        setError(res.error ?? 'Save failed.');
        return;
      }
      if (thenPublish) {
        const pubRes = await publishArticle(res.id);
        if (!pubRes.ok) {
          setError(pubRes.error ?? 'Publish failed.');
          return;
        }
      }
      router.push('/admin/news/articles');
      router.refresh();
    });
  }

  return (
    <>
      <div className={styles.pageTitle}>
        <div>
          <h1>{isNew ? 'New Article' : `Edit: ${article.title}`}</h1>
          <p>Write in markdown on the left; see exactly how it will look on the right.</p>
        </div>
        <Link href="/admin/news/articles" className={styles.backLink}>
          ← Back to Articles
        </Link>
      </div>

      <div className={styles.editorShell}>
        <div className={styles.editorPane}>
          <div className={styles.editorPaneHead}>
            <h2>Article Details</h2>
            {article && (
              <span className={`${styles.statusPill} ${article.status === 'published' ? styles.statusPillPublished : ''}`}>
                {article.status}
              </span>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor="title">Title</label>
            <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label htmlFor="type">Type</label>
              <select id="type" value={type} onChange={(e) => setType(e.target.value as ArticleType)}>
                <option value="news">News</option>
                <option value="event">Event</option>
                <option value="recognition">Recognition</option>
              </select>
            </div>
          </div>

          {type === 'event' && (
            <>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label htmlFor="eventStart">Starts</label>
                  <input
                    id="eventStart"
                    type="datetime-local"
                    value={eventStart}
                    onChange={(e) => setEventStart(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="eventEnd">Ends (optional)</label>
                  <input id="eventEnd" type="datetime-local" value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} />
                </div>
              </div>
              <div className={styles.field}>
                <label htmlFor="eventLocation">Location</label>
                <input
                  id="eventLocation"
                  type="text"
                  value={eventLocation}
                  onChange={(e) => setEventLocation(e.target.value)}
                  placeholder="e.g. Brookfield East High School"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="eventRegistrationUrl">Registration link (optional)</label>
                <input
                  id="eventRegistrationUrl"
                  type="url"
                  value={eventRegistrationUrl}
                  onChange={(e) => setEventRegistrationUrl(e.target.value)}
                  placeholder="https://scoutbook.scouting.org/..."
                />
              </div>
            </>
          )}

          <div className={styles.field}>
            <label>Hero Image</label>
            <div className={styles.heroPreview}>
              {hero && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero.cdn_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>
            <button type="button" className={styles.chooseBtn} onClick={() => setPickerMode('hero')}>
              {hero ? 'Change Hero Image' : 'Choose Hero Image'}
            </button>
          </div>

          <div className={styles.field}>
            <label htmlFor="excerpt">Excerpt</label>
            <textarea
              id="excerpt"
              rows={3}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="A short summary that appears on the home page — 1-2 sentences."
            />
            <div className={styles.hint}>Shown on the home page and article cards. Keep it to 1-2 sentences.</div>
          </div>

          <div className={styles.field}>
            <label>Tags</label>
            <div className={styles.tagPicker}>
              {allTags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`${styles.tagChip} ${tagIds.has(t.id) ? styles.tagChipSelected : ''}`}
                  onClick={() => toggleTag(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="body">Body</label>
            <div className={styles.insertToolbar}>
              <button type="button" className={styles.insertBtn} onClick={() => setPickerMode('image')}>
                Insert Image
              </button>
              <button
                type="button"
                className={styles.insertBtn}
                onClick={() => {
                  setEditingRange(null);
                  setGallerySeed(null);
                  setPickerMode('gallery');
                }}
              >
                Insert Gallery
              </button>
              <button
                type="button"
                className={styles.insertBtn}
                onClick={() => {
                  setEditingRange(null);
                  setGalleryLinkForm({ url: '', caption: '', coverMedia: null });
                }}
              >
                Insert Gallery Link
              </button>
              <button
                type="button"
                className={styles.insertBtn}
                onClick={() => {
                  setEditingRange(null);
                  setVideoForm({ url: '', caption: '' });
                }}
              >
                Insert Video
              </button>
              <button
                type="button"
                className={styles.insertBtn}
                onClick={() =>
                  insertAtCursor('| Column 1 | Column 2 |\n| --- | --- |\n| Row 1 | Row 1 |\n| Row 2 | Row 2 |')
                }
              >
                Insert Table
              </button>
            </div>

            {galleryLinkForm && (
              <div className={styles.inlinePrompt}>
                {editingRange && <div className={styles.hint}>Editing existing gallery link</div>}
                <div className={styles.field}>
                  <label>Album URL</label>
                  <input
                    type="url"
                    value={galleryLinkForm.url}
                    onChange={(e) => setGalleryLinkForm({ ...galleryLinkForm, url: e.target.value })}
                    placeholder="https://photos.app.goo.gl/..."
                  />
                </div>
                <div className={styles.field}>
                  <label>Caption (optional)</label>
                  <input
                    type="text"
                    value={galleryLinkForm.caption}
                    onChange={(e) => setGalleryLinkForm({ ...galleryLinkForm, caption: e.target.value })}
                  />
                </div>
                <button type="button" className={styles.chooseBtn} onClick={() => setPickerMode('gallerylink-cover')}>
                  {galleryLinkForm.coverMedia ? 'Change cover photo' : 'Choose cover photo (optional)'}
                </button>
                <div className={styles.inlinePromptActions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => {
                      setGalleryLinkForm(null);
                      setEditingRange(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={!galleryLinkForm.url.trim()}
                    onClick={() => {
                      replaceOrInsert(
                        buildGalleryLinkToken(
                          galleryLinkForm.url.trim(),
                          galleryLinkForm.caption.trim() || undefined,
                          galleryLinkForm.coverMedia?.cdn_url
                        )
                      );
                      setGalleryLinkForm(null);
                    }}
                  >
                    {editingRange ? 'Save changes' : 'Insert'}
                  </button>
                </div>
              </div>
            )}

            {videoForm && (
              <div className={styles.inlinePrompt}>
                {editingRange && <div className={styles.hint}>Editing existing video</div>}
                <div className={styles.field}>
                  <label>Video URL (YouTube or Vimeo)</label>
                  <input
                    type="url"
                    value={videoForm.url}
                    onChange={(e) => setVideoForm({ ...videoForm, url: e.target.value })}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </div>
                <div className={styles.field}>
                  <label>Caption (optional)</label>
                  <input
                    type="text"
                    value={videoForm.caption}
                    onChange={(e) => setVideoForm({ ...videoForm, caption: e.target.value })}
                  />
                </div>
                <div className={styles.inlinePromptActions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => {
                      setVideoForm(null);
                      setEditingRange(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={!videoForm.url.trim()}
                    onClick={() => {
                      replaceOrInsert(buildVideoToken(videoForm.url.trim(), videoForm.caption.trim() || undefined));
                      setVideoForm(null);
                    }}
                  >
                    {editingRange ? 'Save changes' : 'Insert'}
                  </button>
                </div>
              </div>
            )}

            <textarea
              id="body"
              ref={bodyRef}
              className={styles.mdTextarea}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your article in markdown…"
            />

            <details className={styles.cheatSheet}>
              <summary>Markdown cheat sheet</summary>
              <div className={styles.cheatSheetGrid}>
                <code>## Heading</code>
                <span>Section heading</span>
                <code>**bold**</code>
                <span>Bold text</span>
                <code>*italic*</code>
                <span>Italic text</span>
                <code>[text](url)</code>
                <span>Link</span>
                <code>- item</code>
                <span>Bulleted list</span>
                <code>{'| a | b |\\n| --- | --- |'}</code>
                <span>Table (use the Insert Table button)</span>
              </div>
            </details>
          </div>

          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} disabled={isSaving} onClick={() => handleSave(false)}>
              Save Draft
            </button>
            {isLeader ? (
              <button type="button" className={styles.btnPrimary} disabled={isSaving} onClick={() => handleSave(true)}>
                Save &amp; Publish
              </button>
            ) : (
              <span className={styles.reviewNote}>A leader will review and publish this once saved.</span>
            )}
          </div>
          {error && <div className={styles.formError}>{error}</div>}
        </div>

        <div className={styles.previewPane}>
          <div className={styles.previewPaneLabel}>
            <span className={styles.liveDot} aria-hidden="true" />
            Live Preview
          </div>
          <div className={styles.previewSurface}>
            <div className={styles.previewTitle}>{title || 'Untitled article'}</div>
            <ArticleBody body={body} onEditBlock={handleEditBlock} />
          </div>
        </div>
      </div>

      {pickerMode === 'hero' && (
        <MediaPicker
          mode="single"
          onClose={() => setPickerMode(null)}
          onInsert={(media) => {
            setHero(media[0] ?? null);
            setPickerMode(null);
          }}
        />
      )}
      {pickerMode === 'image' && (
        <MediaPicker
          mode="single"
          onClose={() => setPickerMode(null)}
          onInsert={(media) => {
            const m = media[0];
            if (m) {
              const caption = window.prompt('Optional caption for this image:') ?? '';
              const md = caption.trim()
                ? `![${m.alt_text ?? ''}](${m.cdn_url} "${caption.trim()}")`
                : `![${m.alt_text ?? ''}](${m.cdn_url})`;
              insertAtCursor(md);
            }
            setPickerMode(null);
          }}
        />
      )}
      {pickerMode === 'gallery' && (
        <MediaPicker
          mode="multi"
          initialSelected={gallerySeed ?? undefined}
          onClose={() => {
            setPickerMode(null);
            setGallerySeed(null);
            setEditingRange(null);
          }}
          onInsert={(media) => {
            if (media.length > 0) {
              replaceOrInsert(buildGalleryToken(media.map((m) => ({ url: m.cdn_url, alt: m.alt_text ?? '' }))));
            }
            setPickerMode(null);
            setGallerySeed(null);
          }}
        />
      )}
      {pickerMode === 'gallerylink-cover' && (
        <MediaPicker
          mode="single"
          onClose={() => setPickerMode(null)}
          onInsert={(media) => {
            setGalleryLinkForm((f) => (f ? { ...f, coverMedia: media[0] ?? null } : f));
            setPickerMode(null);
          }}
        />
      )}
    </>
  );
}
