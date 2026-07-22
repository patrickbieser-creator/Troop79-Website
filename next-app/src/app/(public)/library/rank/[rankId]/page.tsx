/**
 * /library/rank/[rankId] — one rank's requirement list with resource counts.
 * A deep-linkable slice of the home drill (same data, same row rendering).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import type { Rank } from '@/lib/supabase/types';
import { publishedCountsByTarget } from '@/lib/library-data';
import { rankReqKey } from '@/lib/library';
import styles from '../../library.module.css';

export const dynamic = 'force-dynamic';

export default async function LibraryRankPage({
  params
}: {
  params: Promise<{ rankId: string }>;
}) {
  const { rankId } = await params;
  const supabase = createAdminClient();

  const [{ data: rank }, reqsRes, counts] = await Promise.all([
    supabase.from('ranks').select('*').eq('id', rankId).maybeSingle(),
    supabase
      .from('rank_requirements')
      .select('code, label')
      .eq('rank_id', rankId)
      .is('parent_id', null)
      .order('sort_order'),
    publishedCountsByTarget(createAdminClient())
  ]);
  if (!rank) notFound();

  const reqs = (reqsRes.data ?? []) as { code: string; label: string }[];
  const total = reqs.reduce(
    (sum, req) => sum + (counts.get(`rank_req:${rankReqKey(rankId, req.code)}`) ?? 0),
    0
  );

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/library">Resource Library</Link>
          <span className={styles.kickerSep}>·</span>
          {(rank as Rank).display_name}
        </p>
        <h1 className={styles.pageTitle}>{(rank as Rank).display_name} Resources</h1>
        <p className={styles.pageLede}>
          {total === 0
            ? 'Nothing shelved for this rank yet — pick a requirement and be the first to suggest something.'
            : `${total} resource${total === 1 ? '' : 's'} across this rank's requirements. Pick a requirement to see what the troop recommends.`}
        </p>
        <div className={styles.headRule} />
      </div>

      <main className={`${styles.main} ${styles.mainNarrow}`}>
        <div className={styles.rankItem}>
          <div className={styles.reqRows}>
            {reqs.map((req) => {
              const n = counts.get(`rank_req:${rankReqKey(rankId, req.code)}`) ?? 0;
              return (
                <Link
                  key={req.code}
                  className={`${styles.reqRow} ${n > 0 ? styles.reqRowHasStuff : ''}`}
                  href={`/library/rank/${rankId}/${encodeURIComponent(req.code)}`}
                >
                  <span className={`${styles.reqTag} ${styles.reqTagGhost}`}>{req.code}</span>
                  <span className={styles.reqLabel}>{req.label}</span>
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
      </main>
    </>
  );
}
