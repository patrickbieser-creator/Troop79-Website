'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Article, Media, Tag } from '@/lib/supabase/types';
import { MediaPicker } from '../../_components/media-picker';
import { DatePickerField } from '../../../_components/date-picker-field';
import {
  MarkdownPreview,
  MarkdownSource,
  type MarkdownEditorHandle
} from '../../../_components/markdown-split-pane';
import { useMarkdownBlockTools } from '../../../_components/markdown-block-tools';
import { createArticle, updateArticle, publishArticle } from '../actions';
import styles from './article-editor.module.css';
import { Badge } from '../../../_components/badge';
import { PageTitle } from '../../../_components/page-title';

interface Props {
  article: Article | null;
  selectedTagIds: number[];
  heroMedia: Media | null;
  allTags: Tag[];
  sessionName: string;
}

export function ArticleEditor({ article, selectedTagIds, heroMedia, allTags }: Props) {
  const router = useRouter();
  // See ArticlesTable: news.write is the only way onto this screen now.
  const isLeader = true;
  const isNew = !article;

  const [title, setTitle] = useState(article?.title ?? '');
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? '');
  const [featured, setFeatured] = useState(article?.featured ?? false);
  const [body, setBody] = useState(article?.body ?? '');
  const [tagIds, setTagIds] = useState<Set<number>>(new Set(selectedTagIds));
  const [hero, setHero] = useState<Media | null>(heroMedia);

  // Event fields are gone (Event→News promotion): an event is a calendar
  // entry promoted from the Calendar editor, never an article.
  const [autoArchiveAt, setAutoArchiveAt] = useState(article?.auto_archive_at ?? '');

  // The hero picker is article-only — every other insert (image, gallery,
  // gallery link, video, table) plus edit-in-place moved to the shared block
  // tools (D-088), which the library form and the event story panel share.
  const [heroPicking, setHeroPicking] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();
  const bodyRef = useRef<MarkdownEditorHandle>(null);
  const blockTools = useMarkdownBlockTools(bodyRef);

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
    fd.set('excerpt', excerpt);
    fd.set('featured', featured ? '1' : '');
    fd.set('body', body);
    if (hero) fd.set('heroMediaId', String(hero.id));
    fd.set('tagIds', Array.from(tagIds).join(','));
    fd.set('autoArchiveAt', autoArchiveAt);
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
      <PageTitle
        title={isNew ? 'New Post' : `Edit: ${article.title}`}
        sub="Write in markdown on the left; see exactly how it will look on the right."
      >
        <Link href="/admin/news/articles" className={styles.backLink}>
          ← Back to News
        </Link>
      </PageTitle>

      <div className={styles.editorShell}>
        <div className={styles.editorPane}>
          <div className={styles.editorPaneHead}>
            <h2>Article Details</h2>
            {article && (
              <Badge variant={article.status === 'published' ? 'success' : 'warning'}>
                {article.status}
              </Badge>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor="title">Title</label>
            <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {/* The Type select is gone (Patrick, 2026-08-09) — every post is
              news; tags carry the sorting. Legacy 'recognition' rows keep
              their type until edited surfaces need otherwise. */}
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label htmlFor="autoArchiveAt">Auto-archive on (optional)</label>
              <DatePickerField id="autoArchiveAt" value={autoArchiveAt} onChange={setAutoArchiveAt} />
            </div>
            {isLeader && (
              <div className={styles.field}>
                <label htmlFor="featured">
                  <input
                    id="featured"
                    type="checkbox"
                    checked={featured}
                    onChange={(e) => setFeatured(e.target.checked)}
                  />{' '}
                  Feature on homepage
                </label>
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label>Hero Image</label>
            <div className={styles.heroPreview}>
              {hero && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero.cdn_url} alt="" className={styles.heroImg} />
              )}
            </div>
            <button type="button" className={styles.chooseBtn} onClick={() => setHeroPicking(true)}>
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
            <MarkdownSource
              id="body"
              ref={bodyRef}
              value={body}
              onChange={setBody}
              textareaClassName={styles.mdTextarea}
              placeholder="Write your article in markdown…"
              ariaLabel="Article body markdown source"
              cheatSheet
              toolbar={blockTools.toolbar}
            >
              {blockTools.prompts}
            </MarkdownSource>
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
          <MarkdownPreview
            className={styles.previewSurface}
            value={body}
            title={title || 'Untitled article'}
            onEditBlock={blockTools.onEditBlock}
            emptyNote="Nothing written yet — the preview fills in as you type."
          />
        </div>
      </div>

      {heroPicking && (
        <MediaPicker
          mode="single"
          onClose={() => setHeroPicking(false)}
          onInsert={(media) => {
            setHero(media[0] ?? null);
            setHeroPicking(false);
          }}
        />
      )}
      {blockTools.pickers}
    </>
  );
}
