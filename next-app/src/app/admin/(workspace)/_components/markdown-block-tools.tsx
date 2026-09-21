'use client';

/**
 * The insert-a-block half of the shared markdown editor: the toolbar buttons,
 * the inline gallery-link / video mini-forms, the MediaPicker wiring, and
 * edit-in-place of an existing block from a preview click.
 *
 * WHY A HOOK (D-081 + D-088). D-081 promised `details_md` "the news editor's
 * split-pane experience", and that experience is mostly this machinery — five
 * insert buttons and ~200 lines of picker state. Copying it into the calendar
 * workbench would have rebuilt exactly the duplication D-088 set out to end,
 * so it moved here instead. It returns nodes rather than rendering a layout
 * because its three slots land in three different places in the host's tree:
 * the toolbar above the textarea, the prompts between toolbar and textarea,
 * and the pickers (modals) at the very top level.
 *
 * The caller owns the body string; this only ever writes through the
 * MarkdownEditorHandle, so cursor position and the block splice behave the
 * same everywhere.
 */

import { useCallback, useState, type ReactNode, type RefObject } from 'react';
import type { EditableBlockInfo } from '@/lib/article-body/ArticleBody';
import {
  buildGalleryLinkToken,
  buildGalleryToken,
  buildImageMarkdown,
  buildVideoToken,
  parseGalleryToken,
  parseGalleryLinkToken,
  parseImageMarkdown,
  parseVideoToken
} from '@/lib/article-body/tokens';
import type { Media } from '@/lib/supabase/types';
import { MediaPicker } from '../news/_components/media-picker';
import type { MarkdownEditorHandle } from './markdown-split-pane';
import styles from './markdown-block-tools.module.css';

type PickerMode = 'image' | 'gallery' | 'gallerylink-cover' | null;

const TABLE_TEMPLATE = '| Column 1 | Column 2 |\n| --- | --- |\n| Row 1 | Row 1 |\n| Row 2 | Row 2 |';

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

export interface MarkdownBlockTools {
  /** Insert buttons — pass to MarkdownSource's `toolbar`. */
  toolbar: ReactNode;
  /** Inline mini-forms — render as MarkdownSource's children. */
  prompts: ReactNode;
  /** Modal pickers — render at the host's top level, outside any scroll area. */
  pickers: ReactNode;
  /** Wire to MarkdownPreview so preview blocks grow an Edit button. */
  onEditBlock: (info: EditableBlockInfo) => void;
}

export function useMarkdownBlockTools(
  editorRef: RefObject<MarkdownEditorHandle | null>
): MarkdownBlockTools {
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [galleryLinkForm, setGalleryLinkForm] = useState<{
    url: string;
    caption: string;
    coverMedia: Media | null;
  } | null>(null);
  const [videoForm, setVideoForm] = useState<{ url: string; caption: string } | null>(null);
  // Single image (Plans/Article-Image-Flexibility.md step 3): caption plus
  // "Link to" none / the full-size file / a URL. Replaces the window.prompt
  // the Insert Image button used to fire after the picker.
  const [imageForm, setImageForm] = useState<{
    media: Media;
    caption: string;
    link: 'none' | 'full' | 'url';
    url: string;
  } | null>(null);
  const [gallerySeed, setGallerySeed] = useState<Media[] | null>(null);
  // Set only when a form/picker was opened by clicking "Edit" on an existing
  // block — Insert/onInsert then splices the rebuilt token back into this
  // exact source range instead of inserting a new one at the cursor.
  const [editingRange, setEditingRange] = useState<{ start: number; end: number } | null>(null);

  function replaceOrInsert(token: string) {
    if (editingRange) {
      editorRef.current?.replaceRange(editingRange.start, editingRange.end, token);
      setEditingRange(null);
    } else {
      editorRef.current?.insertAtCursor(token);
    }
  }

  // Stable on purpose: ArticleBody caches its component overrides per
  // handler so the live preview does not remount every image on each
  // keystroke. Only state setters are used here, so no deps.
  const onEditBlock = useCallback((info: EditableBlockInfo) => {
    setEditingRange({ start: info.start, end: info.end });
    setGalleryLinkForm(null);
    setVideoForm(null);
    setImageForm(null);
    if (info.type === 'gallerylink') {
      const parsed = parseGalleryLinkToken(info.raw);
      setGalleryLinkForm({
        url: parsed.url,
        caption: parsed.caption ?? '',
        coverMedia: parsed.coverUrl ? stubMedia(parsed.coverUrl, null) : null
      });
    } else if (info.type === 'video') {
      const parsed = parseVideoToken(info.raw);
      setVideoForm({ url: parsed.url, caption: parsed.caption ?? '' });
    } else if (info.type === 'gallery') {
      setGallerySeed(parseGalleryToken(info.raw).map((img) => stubMedia(img.url, img.alt || null)));
      setPickerMode('gallery');
    } else if (info.type === 'image') {
      const parsed = parseImageMarkdown(info.raw);
      if (!parsed) {
        setEditingRange(null);
        return;
      }
      setImageForm({
        media: stubMedia(parsed.src, parsed.alt || null),
        caption: parsed.caption ?? '',
        link: parsed.href === null ? 'none' : parsed.href === parsed.src ? 'full' : 'url',
        url: parsed.href && parsed.href !== parsed.src ? parsed.href : ''
      });
    }
  }, []);

  const toolbar = (
    <>
      <button
        type="button"
        className={styles.insertBtn}
        onClick={() => {
          setEditingRange(null);
          setPickerMode('image');
        }}
      >
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
        onClick={() => editorRef.current?.insertAtCursor(TABLE_TEMPLATE)}
      >
        Insert Table
      </button>
    </>
  );

  const prompts = (
    <>
      {imageForm && (
        <div className={styles.inlinePrompt}>
          {editingRange && <div className={styles.hint}>Editing existing image</div>}
          <div className={styles.imageRow}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageForm.media.cdn_url} alt="" className={styles.imageThumb} />
            <div className={styles.imageFields}>
              <div className={styles.field}>
                <label className="adminLabel" htmlFor="imageCaption">Caption (optional)</label>
                <input
                  id="imageCaption"
                  type="text"
                  value={imageForm.caption}
                  onChange={(e) => setImageForm({ ...imageForm, caption: e.target.value })}
                />
              </div>
              <fieldset className={styles.radioGroup}>
                <legend className="adminLabel">Link to</legend>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="imageLink"
                    checked={imageForm.link === 'none'}
                    onChange={() => setImageForm({ ...imageForm, link: 'none' })}
                  />
                  <span>None</span>
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="imageLink"
                    checked={imageForm.link === 'full'}
                    onChange={() => setImageForm({ ...imageForm, link: 'full' })}
                  />
                  <span>Full-size image (opens in a new tab)</span>
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="imageLink"
                    checked={imageForm.link === 'url'}
                    onChange={() => setImageForm({ ...imageForm, link: 'url' })}
                  />
                  <span>A web address</span>
                </label>
              </fieldset>
              {imageForm.link === 'url' && (
                <div className={styles.field}>
                  <label className="adminLabel" htmlFor="imageLinkUrl">Link URL</label>
                  <input
                    id="imageLinkUrl"
                    type="text"
                    value={imageForm.url}
                    onChange={(e) => setImageForm({ ...imageForm, url: e.target.value })}
                    placeholder="/events/23 or https://…"
                  />
                  <div className={styles.hint}>A page on this site opens in the same tab; anywhere else opens in a new one.</div>
                </div>
              )}
            </div>
          </div>
          <div className={styles.inlinePromptActions}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => {
                setImageForm(null);
                setEditingRange(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={imageForm.link === 'url' && !imageForm.url.trim()}
              onClick={() => {
                const href =
                  imageForm.link === 'full'
                    ? imageForm.media.cdn_url
                    : imageForm.link === 'url'
                      ? imageForm.url.trim()
                      : null;
                replaceOrInsert(
                  buildImageMarkdown({
                    src: imageForm.media.cdn_url,
                    alt: imageForm.media.alt_text ?? '',
                    caption: imageForm.caption.trim() || null,
                    href
                  })
                );
                setImageForm(null);
              }}
            >
              {editingRange ? 'Save changes' : 'Insert'}
            </button>
          </div>
        </div>
      )}

      {galleryLinkForm && (
        <div className={styles.inlinePrompt}>
          {editingRange && <div className={styles.hint}>Editing existing gallery link</div>}
          <div className={styles.field}>
            <label className="adminLabel">Album URL</label>
            <input
              type="url"
              value={galleryLinkForm.url}
              onChange={(e) => setGalleryLinkForm({ ...galleryLinkForm, url: e.target.value })}
              placeholder="https://photos.app.goo.gl/..."
            />
          </div>
          <div className={styles.field}>
            <label className="adminLabel">Caption (optional)</label>
            <input
              type="text"
              value={galleryLinkForm.caption}
              onChange={(e) => setGalleryLinkForm({ ...galleryLinkForm, caption: e.target.value })}
            />
          </div>
          <button
            type="button"
            className={styles.chooseBtn}
            onClick={() => setPickerMode('gallerylink-cover')}
          >
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
            <label className="adminLabel">Video URL (YouTube or Vimeo)</label>
            <input
              type="url"
              value={videoForm.url}
              onChange={(e) => setVideoForm({ ...videoForm, url: e.target.value })}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
          <div className={styles.field}>
            <label className="adminLabel">Caption (optional)</label>
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
                replaceOrInsert(
                  buildVideoToken(videoForm.url.trim(), videoForm.caption.trim() || undefined)
                );
                setVideoForm(null);
              }}
            >
              {editingRange ? 'Save changes' : 'Insert'}
            </button>
          </div>
        </div>
      )}
    </>
  );

  const pickers = (
    <>
      {pickerMode === 'image' && (
        <MediaPicker
          mode="single"
          onClose={() => setPickerMode(null)}
          onInsert={(media) => {
            const m = media[0];
            if (m) {
              setGalleryLinkForm(null);
              setVideoForm(null);
              setImageForm({ media: m, caption: '', link: 'none', url: '' });
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
              replaceOrInsert(
                buildGalleryToken(media.map((m) => ({ url: m.cdn_url, alt: m.alt_text ?? '' })))
              );
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

  return { toolbar, prompts, pickers, onEditBlock };
}
