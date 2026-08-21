/**
 * /library/rank/[rankId] — one rank's requirement list with resource counts.
 * A deep-linkable slice of the home drill (same data, same row rendering).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import type { Rank } from '@/lib/supabase/types';
import { publishedCountsByTarget, loadScoutRankProgress } from '@/lib/library-data';
import { rankReqKey, withViewScout } from '@/lib/library';
import { resolveLibraryViewer, viewerIsLeader } from '@/lib/library-viewer';
import { ScoutSwitcher } from '../../_components/scout-switcher';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import styles from '../../library.module.css';

export const dynamic = 'force-dynamic';

export default async function LibraryRankPage({
  params,
  searchParams
}: {
  params: Promise<{ rankId: string }>;
  searchParams: Promise<{ viewScout?: string }>;
}) {
  const { rankId } = await params;
  const { viewScout } = await searchParams;
  const supabase = createAdminClient();
  const viewer = await resolveLibraryViewer(supabase, viewScout);

  const [{ data: rank }, reqsRes, counts, rankProgress] = await Promise.all([
    supabase.from('ranks').select('*').eq('id', rankId).maybeSingle(),
    supabase
      .from('rank_requirements')
      .select('code, label')
      .eq('rank_id', rankId)
      .is('parent_id', null)
      .order('sort_order'),
    publishedCountsByTarget(createAdminClient(), await viewerIsLeader()),
    viewer.kind === 'scout' ? loadScoutRankProgress(supabase, viewer.scoutId) : Promise.resolve(null)
  ]);
  if (!rank) notFound();

  const viewScoutId = viewer.kind === 'scout' ? viewer.scoutId : undefined;
  const reqs = (reqsRes.data ?? []) as { code: string; label: string }[];
  const total = reqs.reduce(
    (sum, req) => sum + (counts.get(`rank_req:${rankReqKey(rankId, req.code)}`) ?? 0),
    0
  );

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link href="/library">Resource Library</Link>
            <KickerSep />
            {(rank as Rank).display_name}
          </>
        }
        title={`${(rank as Rank).display_name} Resources`}
        lede={
          total === 0
            ? 'Nothing shelved for this rank yet — pick a requirement and be the first to suggest something.'
            : `${total} resource${total === 1 ? '' : 's'} across this rank's requirements. Pick a requirement to see what the troop recommends.`
        }
      />

      <PageShell>
        <ScoutSwitcher viewer={viewer} />
        <div className={styles.rankItem}>
          <div className={styles.reqRows}>
            {reqs.map((req) => {
              const key = rankReqKey(rankId, req.code);
              const n = counts.get(`rank_req:${key}`) ?? 0;
              const doneDate = rankProgress?.get(key) ?? null;
              return (
                <Link
                  key={req.code}
                  className={`${styles.reqRow} ${n > 0 ? styles.reqRowHasStuff : ''}`}
                  href={withViewScout(
                    `/library/rank/${rankId}/${encodeURIComponent(req.code)}`,
                    viewScoutId
                  )}
                >
                  <span className={`${styles.reqTag} ${styles.reqTagGhost}`}>{req.code}</span>
                  <span className={styles.reqLabel}>{req.label}</span>
                  {doneDate && (
                    <span className={styles.reqDoneBadge}>
                      ✓{' '}
                      {new Date(doneDate).toLocaleDateString('en-US', {
                        month: 'short',
                        year: 'numeric'
                      })}
                    </span>
                  )}
                  {n > 0 ? (
                    <span className={styles.reqResCount}>
                      {n} resource{n === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className={`${styles.reqResCount} ${styles.reqResCountZero}`}>—</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </PageShell>
    </>
  );
}
