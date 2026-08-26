import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadArticleBySlug, loadArticlePreviewBySlug, formatDateLong } from '@/lib/news-feed';
import { actorHas, resolveAdminActor } from '@/lib/admin-actor';
import { articleCategoryLabel } from '@/lib/feed-logic';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import styles from './article-detail.module.css';
import { JsonLd } from '@/app/_components/json-ld';
import { createAdminClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/site-url';
import { loadSeoSettings, articleJsonLd, breadcrumbJsonLd } from '@/lib/seo';

/**
 * Public lookup first; if it misses and the visitor can write news (identity
 * session with news.write — the legacy leader cookie died 2026-08-16),
 * fall back to the any-status preview (the editor's "Preview (unpublished)"
 * button). Anyone else gets the same 404 a guessed slug always got.
 */
async function loadForVisitor(slug: string): Promise<{ article: Awaited<ReturnType<typeof loadArticleBySlug>>; preview: boolean }> {
  const article = await loadArticleBySlug(slug);
  if (article) return { article, preview: false };
  if (!actorHas(await resolveAdminActor(), 'news.write')) return { article: null, preview: false };
  return { article: await loadArticlePreviewBySlug(slug), preview: true };
}

function catClass(type: string): string {
  if (type === 'news') return styles.catNews;
  return styles.catRecognition;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { article, preview } = await loadForVisitor(slug);
  if (!article) return {};
  return {
    title: `${article.title} — Troop 79`,
    ...(preview ? { robots: { index: false, follow: false } } : {}),
    description: article.excerpt ?? undefined,
    openGraph: {
      title: article.title,
      description: article.excerpt ?? undefined,
      images: article.heroMedia ? [{ url: article.heroMedia.cdn_url }] : undefined
    }
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { article, preview } = await loadForVisitor(slug);
  if (!article) notFound();

  /* Article structured data (2026-08-22) — the node that lets a story appear
     as a real article rather than an untyped page, and carries the byline and
     publish date that a bare <h1> does not. */
  const seoSettings = await loadSeoSettings(createAdminClient());
  const origin = siteUrl();

  return (
    <main className={styles.articlePage}>
      <JsonLd
        data={[
          articleJsonLd(
            {
              slug: article.slug,
              title: article.title,
              excerpt: article.excerpt,
              published_at: article.published_at ?? article.created_at,
              author_name: article.author_name,
              image_url: article.heroMedia?.cdn_url ?? null
            },
            seoSettings,
            origin
          ),
          breadcrumbJsonLd(
            [
              { name: 'Home', path: '/' },
              { name: 'News & Events', path: '/news' },
              { name: article.title, path: `/news/${article.slug}` }
            ],
            origin
          )
        ]}
      />
      {preview && (
        <p className={styles.previewNotice} role="status">
          Preview — this post is <strong>{article.status}</strong> and not visible to the public.
        </p>
      )}
      <div className={styles.articleHead}>
        <span className={`${styles.catTag} ${catClass(article.type)}`}>{articleCategoryLabel(article.categories)}</span>
        <h1 className={styles.articleHeadline}>{article.title}</h1>
        <p className={styles.articleByline}>
          By <strong>{article.author_name}</strong>
          <span className={styles.dot}>&middot;</span>
          {formatDateLong(article.published_at ?? article.created_at)}
        </p>
      </div>

      {/* The event info panel is gone (Event→News promotion): events are
          calendar entries promoted into the feed, and their page is
          /events/[id] with the live signup — an article never carries event
          fields anymore. */}

      {article.heroMedia && (
        <div className={styles.articleHero}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={article.heroMedia.cdn_url} alt={article.heroMedia.alt_text ?? ''} />
        </div>
      )}

      <ArticleBody body={article.body} />

      {article.categories.length > 0 && (
        <div className={styles.tagRow}>
          {article.categories.map((t) => (
            <Link key={t.slug} href={`/category/${t.slug}`} className={styles.tagChip}>
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
