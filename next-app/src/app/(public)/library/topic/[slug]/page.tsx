/**
 * /library/topic/[slug] — one topic shelf. Post-kind resources (Sparkler
 * jokes, troop write-ups) render their markdown inline; everything else is a
 * link-out card. Pinned first, then webmaster order, then newest.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import type { LibraryTopic } from '@/lib/supabase/types';
import { loadPublishedFor } from '@/lib/library-data';
import { ResourceCard } from '../../_components/resource-card';
import styles from '../../library.module.css';

export const dynamic = 'force-dynamic';

export default async function LibraryTopicPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();

  const [{ data: topic }, resources] = await Promise.all([
    supabase.from('library_topics').select('*').eq('slug', slug).maybeSingle(),
    loadPublishedFor(createAdminClient(), 'topic', slug)
  ]);
  if (!topic) notFound();
  const shelf = topic as LibraryTopic;

  const suggestHref = `/library/submit?target=${encodeURIComponent(`topic:${slug}`)}`;

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/library">Resource Library</Link>
          <span className={styles.kickerSep}>·</span>
          Topic Shelf
        </p>
        <h1 className={styles.pageTitle}>
          {shelf.icon && (
            <span aria-hidden="true" style={{ marginRight: 12 }}>
              {shelf.icon}
            </span>
          )}
          {shelf.title}
        </h1>
        {shelf.blurb_md && <p className={styles.pageLede}>{shelf.blurb_md}</p>}
        <div className={styles.headRule} />
      </div>

      <main className={`${styles.main} ${styles.mainNarrow}`}>
        {resources.length === 0 ? (
          <div className={styles.emptyState}>
            This shelf is waiting for its first item.{' '}
            <Link href={suggestHref}>Suggest something for it →</Link>
          </div>
        ) : (
          <ul className={styles.resourceList}>
            {resources.map((res) => (
              <ResourceCard key={res.placement.id} resource={res} pinned={res.placement.pinned} />
            ))}
          </ul>
        )}

        <div className={styles.ctaBand}>
          <div className={styles.ctaBandText}>
            <h2 className={styles.ctaBandTitle}>Got something that belongs here?</h2>
            <p className={styles.ctaBandLede}>
              The webmaster reviews every suggestion before it&rsquo;s published — send it in
              even if you&rsquo;re not sure it fits.
            </p>
          </div>
          <Link className={styles.btnPrimary} href={suggestHref}>
            Suggest a Resource
          </Link>
        </div>
      </main>
    </>
  );
}
