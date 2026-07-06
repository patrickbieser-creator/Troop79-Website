import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadArticlesByTag, articleTypeLabel, formatDateLong } from '@/lib/news-feed';
import type { ArticleCard } from '@/lib/news-feed';
import styles from '../../../_components/news-cards.module.css';

function catClass(type: ArticleCard['type']): string {
  if (type === 'news') return styles.catNews;
  if (type === 'event') return styles.catEvents;
  return styles.catRecognition;
}

export default async function TagArchivePage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);

  const { tag, rows, totalPages } = await loadArticlesByTag(slug, page);
  if (!tag) notFound();

  return (
    <>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>Tagged: {tag.name}</span>
      </div>
      <main className={styles.mainContent}>
        {rows.length === 0 ? (
          <p className={styles.empty}>No articles tagged &ldquo;{tag.name}&rdquo; yet.</p>
        ) : (
          <div className={styles.storyGrid} style={{ marginTop: 24 }}>
            {rows.map((a) => (
              <Link key={a.id} href={`/news/${a.slug}`} className={styles.storyCard}>
                {a.heroMedia && (
                  <div className={styles.storyCardImg}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.heroMedia.cdn_url} alt={a.heroMedia.alt_text ?? ''} />
                  </div>
                )}
                <div className={styles.storyCardBody}>
                  <span className={`${styles.catTag} ${catClass(a.type)}`}>{articleTypeLabel(a.type)}</span>
                  <h3 className={styles.cardHeadline}>{a.title}</h3>
                  {a.excerpt && <p className={styles.cardSummary}>{a.excerpt}</p>}
                  <p className={styles.cardMeta}>{formatDateLong(a.published_at ?? a.created_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className={styles.pager}>
            <Link
              href={`/tags/${slug}?page=${page - 1}`}
              className={`${styles.pagerBtn} ${page <= 1 ? styles.pagerBtnDisabled : ''}`}
              aria-disabled={page <= 1}
            >
              ← Newer
            </Link>
            <span>
              Page {page} of {totalPages}
            </span>
            <Link
              href={`/tags/${slug}?page=${page + 1}`}
              className={`${styles.pagerBtn} ${page >= totalPages ? styles.pagerBtnDisabled : ''}`}
              aria-disabled={page >= totalPages}
            >
              Older →
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
