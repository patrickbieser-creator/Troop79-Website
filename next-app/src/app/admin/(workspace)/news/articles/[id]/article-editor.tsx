'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Article, Media } from '@/lib/supabase/types';
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

/** A category from the ONE taxonomy (calendar_categories) — the same list
 *  events and photo albums pick from (Patrick, 2026-08-21). */
export interface CategoryOption {
  label: string;
  color: string;
}

interface Props {
  article: Article | null;
  /** Category labels currently on the article. */
  selectedCategories: string[];
  heroMedia: Media | null;
  allCategories: CategoryOption[];
  sessionName: string;
}

export function ArticleEditor({ article, selectedCategories, heroMedia, allCategories }: Props) {
  const router = useRouter();
  // See ArticlesTable: news.write is the only way onto this screen now.
  const isLeader = true;
  const isNew = !article;

  const [title, setTitle] = useState(article?.title ?? '');
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? '');
  const [authorName, setAuthorName] = useState(article?.author_name ?? '');
  const [slug, setSlug] = useState(article?.slug ?? '');
  /* Once live, the slug is frozen against title edits (lib/article-slug) — the
     hint below says so, because nothing in this UI used to mention slugs at
     all and the URL moved silently on every save. */
  const published = article?.status === 'published';
  const [featured, setFeatured] = useState(article?.featured ?? false);
  const [body, setBody] = useState(article?.body ?? '');
  const [categories, setCategories] = useState<Set<string>>(new Set(selectedCategories));
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

  function toggleCategory(label: string) {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set('title', title);
    fd.set('excerpt', excerpt);
    fd.set('authorName', authorName);
    fd.set('slug', slug);
    fd.set('featured', featured ? '1' : '');
    fd.set('body', body);
    if (hero) fd.set('heroMediaId', String(hero.id));
    fd.set('categories', JSON.stringify(Array.from(categories)));
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
            <label className="adminLabel" htmlFor="title">Title</label>
            <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {/* The Type select is gone (Patrick, 2026-08-09) — every post is
              news; tags carry the sorting. Legacy 'recognition' rows keep
              their type until edited surfaces need otherwise. */}
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className="adminLabel" htmlFor="autoArchiveAt">Auto-archive on (optional)</label>
              <DatePickerField id="autoArchiveAt" value={autoArchiveAt} onChange={setAutoArchiveAt} />
            </div>
            {isLeader && (
              <div className={styles.field}>
                <label className="adminLabel" htmlFor="featured">
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
            <label className="adminLabel">Hero Image</label>
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
            <label className="adminLabel" htmlFor="excerpt">Excerpt</label>
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
            <label className="adminLabel" htmlFor="authorName">Byline</label>
            <input
              id="authorName"
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Who wrote it"
            />
            <div className={styles.hint}>
              Who the post is credited to. Defaults to you; change it when a scout or another
              leader wrote it. Leave it blank to keep the current byline.
            </div>
          </div>

          <div className={styles.field}>
            <label className="adminLabel" htmlFor="slug">Web address</label>
            <div className={styles.slugRow}>
              <span className={styles.slugPrefix}>/news/</span>
              <input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="made-from-the-title"
              />
            </div>
            <div className={styles.hint}>
              {published ? (
                <>
                  <strong>This post is live at /news/{article?.slug}.</strong> Editing the title no
                  longer moves it — change this field only if you mean to change the address, and
                  know that any link already shared will stop working.
                </>
              ) : (
                <>Made from the title until the post is published, then it stays put so shared links keep working.</>
              )}
            </div>
          </div>

          <div className={styles.field}>
            <label className="adminLabel">Categories</label>
            {/* The ONE taxonomy (2026-08-21): the same Calendar Categories
                events and albums use — manage the list under Lookups & Admin.
                The first picked is the card chip on the home page. */}
            <div className={styles.tagPicker}>
              {allCategories.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className={`${styles.tagChip} ${categories.has(c.label) ? styles.tagChipSelected : ''}`}
                  onClick={() => toggleCategory(c.label)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className={styles.hint}>Same list as Calendar Categories; the first one picked is the card label.</div>
          </div>

          <div className={styles.field}>
            <label className="adminLabel" htmlFor="body">Body</label>
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
