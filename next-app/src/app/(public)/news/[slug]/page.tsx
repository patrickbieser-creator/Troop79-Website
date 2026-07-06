import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadArticleBySlug, articleTypeLabel, formatDateLong, formatEventDateParts, formatEventDateTime } from '@/lib/news-feed';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import styles from './article-detail.module.css';

function catClass(type: string): string {
  if (type === 'news') return styles.catNews;
  if (type === 'event') return styles.catEvents;
  return styles.catRecognition;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadArticleBySlug(slug);
  if (!article) return {};
  return {
    title: `${article.title} — Troop 79`,
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
  const article = await loadArticleBySlug(slug);
  if (!article) notFound();

  const showRegister = article.type === 'event' && !!article.event_registration_url;

  return (
    <main className={styles.articlePage}>
      <div className={styles.articleHead}>
        <span className={`${styles.catTag} ${catClass(article.type)}`}>{articleTypeLabel(article.type)}</span>
        <h1 className={styles.articleHeadline}>{article.title}</h1>
        <p className={styles.articleByline}>
          By <strong>{article.author_name}</strong>
          <span className={styles.dot}>&middot;</span>
          {formatDateLong(article.published_at ?? article.created_at)}
        </p>
      </div>

      {article.type === 'event' && article.event_start && (
        <div className={styles.eventPanel}>
          <div className={styles.eventPanelWhen}>
            <div className={styles.eventPanelDateBlock}>
              <div className={styles.eMonth}>{formatEventDateParts(article.event_start).month}</div>
              <div className={styles.eDay}>{formatEventDateParts(article.event_start).day}</div>
            </div>
          </div>
          <div className={styles.eventPanelFacts}>
            <div className={styles.eventPanelRow}>
              <span className={styles.epLabel}>When</span>
              <span>{formatEventDateTime(article.event_start)}</span>
            </div>
            {article.event_end && (
              <div className={styles.eventPanelRow}>
                <span className={styles.epLabel}>Ends</span>
                <span>{formatEventDateTime(article.event_end)}</span>
              </div>
            )}
            {article.event_location && (
              <div className={styles.eventPanelRow}>
                <span className={styles.epLabel}>Where</span>
                <span>{article.event_location}</span>
              </div>
            )}
          </div>
          <div className={styles.eventPanelActions}>
            {showRegister ? (
              <a href={article.event_registration_url!} target="_blank" rel="noopener noreferrer" className={styles.btnRegister}>
                Register
              </a>
            ) : (
              <span className={styles.eventPanelNoreg}>No registration required</span>
            )}
          </div>
        </div>
      )}

      {article.heroMedia && (
        <div className={styles.articleHero}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={article.heroMedia.cdn_url} alt={article.heroMedia.alt_text ?? ''} />
        </div>
      )}

      <ArticleBody body={article.body} />

      {article.tags.length > 0 && (
        <div className={styles.tagRow}>
          {article.tags.map((t) => (
            <Link key={t.id} href={`/tags/${t.slug}`} className={styles.tagChip}>
              {t.name}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
