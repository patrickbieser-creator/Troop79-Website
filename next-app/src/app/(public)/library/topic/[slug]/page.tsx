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
import { viewerIsLeader } from '@/lib/library-viewer';
import { ResourceCard } from '../../_components/resource-card';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { EmptyState } from '@/app/_components/empty-state';
import { Button } from '@/app/_components/button';
import styles from '../../library.module.css';

export const dynamic = 'force-dynamic';

export default async function LibraryTopicPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();
  const isLeader = await viewerIsLeader();

  const [{ data: topic }, resources] = await Promise.all([
    supabase.from('library_topics').select('*').eq('slug', slug).maybeSingle(),
    loadPublishedFor(createAdminClient(), 'topic', slug, isLeader)
  ]);
  if (!topic) notFound();
  const shelf = topic as LibraryTopic;

  const suggestHref = `/library/submit?target=${encodeURIComponent(`topic:${slug}`)}`;

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link href="/library">Resource Library</Link>
            <KickerSep />
            Topic Shelf
          </>
        }
        title={
          <>
            {shelf.icon && (
              <span aria-hidden="true" style={{ marginRight: 12 }}>
                {shelf.icon}
              </span>
            )}
            {shelf.title}
          </>
        }
        lede={shelf.blurb_md || undefined}
      />

      <PageShell>
        {resources.length === 0 ? (
          <EmptyState>
            This shelf is waiting for its first item.{' '}
            <Link href={suggestHref}>Suggest something for it →</Link>
          </EmptyState>
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
          <Button variant="primary" href={suggestHref}>
            Suggest a Resource
          </Button>
        </div>
      </PageShell>
    </>
  );
}
