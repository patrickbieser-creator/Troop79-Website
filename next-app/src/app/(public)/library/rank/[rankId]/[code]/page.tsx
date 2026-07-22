/**
 * /library/rank/[rankId]/[code] — one requirement's landing page: the
 * leader-written narrative, curated resources, live troop context, and (until
 * proof submission ships in Phase 2) a suggest-a-resource CTA.
 *
 * target_key is the '{rankId}-{code}' composite — same as ledger_entries.code
 * (never bare code; "9a" repeats across ranks).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import type { Rank } from '@/lib/supabase/types';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { loadNarrative, loadPublishedFor } from '@/lib/library-data';
import { rankReqKey } from '@/lib/library';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { ResourceCard } from '../../../_components/resource-card';
import styles from '../../../library.module.css';

export const dynamic = 'force-dynamic';

interface ReqRow {
  id: number;
  code: string;
  label: string;
  parent_id: number | null;
  sort_order: number;
}

export default async function LibraryRequirementPage({
  params
}: {
  params: Promise<{ rankId: string; code: string }>;
}) {
  const { rankId, code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);
  const supabase = createAdminClient();
  const targetKey = rankReqKey(rankId, code);

  const [{ data: rank }, reqsRes, narrative, resources] = await Promise.all([
    supabase.from('ranks').select('*').eq('id', rankId).maybeSingle(),
    supabase
      .from('rank_requirements')
      .select('id, code, label, parent_id, sort_order')
      .eq('rank_id', rankId)
      .order('sort_order'),
    loadNarrative(createAdminClient(), 'rank_req', targetKey),
    loadPublishedFor(createAdminClient(), 'rank_req', targetKey)
  ]);
  if (!rank) notFound();

  const reqs = (reqsRes.data ?? []) as ReqRow[];
  const node = reqs.find((r) => r.code === code);
  if (!node) notFound();

  const children = reqs
    .filter((r) => r.parent_id === node.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const isLeaf = children.length === 0;

  // Live troop context — who has this requirement signed off (leaf codes
  // only; parent codes have no direct ledger rows). Names never render here:
  // counts only, this is a public page.
  let haveCount: number | null = null;
  let activeCount: number | null = null;
  if (isLeaf) {
    const [ledgerRows, activeRes] = await Promise.all([
      fetchAllRows<{ scout_id: string }>((from, to) =>
        supabase
          .from('ledger_active')
          .select('scout_id')
          .eq('kind', 'rank_requirement')
          .eq('code', targetKey)
          .range(from, to)
      ),
      supabase.from('scouts').select('id').eq('active', true)
    ]);
    const activeIds = new Set(((activeRes.data ?? []) as { id: string }[]).map((s) => s.id));
    haveCount = new Set(ledgerRows.map((r) => r.scout_id).filter((id) => activeIds.has(id))).size;
    activeCount = activeIds.size;
  }

  // Prev/next among top-level codes of this rank.
  const topCodes = reqs.filter((r) => r.parent_id === null);
  const idx = topCodes.findIndex((r) => r.code === code);
  const prev = idx > 0 ? topCodes[idx - 1] : null;
  const next = idx >= 0 && idx < topCodes.length - 1 ? topCodes[idx + 1] : null;

  const suggestHref = `/library/submit?target=${encodeURIComponent(`rank_req:${targetKey}`)}`;

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/library">Resource Library</Link>
          <span className={styles.kickerSep}>·</span>
          <Link href={`/library/rank/${rankId}`}>{(rank as Rank).display_name}</Link>
          <span className={styles.kickerSep}>·</span>
          Requirement {code}
        </p>
        <h1 className={styles.pageTitle} style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span className={`${styles.reqTag} ${styles.reqTagLarge}`}>{code}</span>
          <span style={{ flex: 1, minWidth: 260 }}>{node.label}</span>
        </h1>
        <p className={styles.pageLede} style={{ fontSize: 13, marginTop: 6 }}>
          Paraphrased — confirm exact wording against the current handbook at sign-off.
        </p>
        <div className={styles.headRule} />
      </div>

      <main className={`${styles.main} ${styles.mainNarrow}`}>
        {narrative && (
          <div className={styles.narrative}>
            <ArticleBody body={narrative.narrative_md} />
            {narrative.updated_by && (
              <p className={styles.narrativeCredit}>
                Written by <strong>{narrative.updated_by}</strong> · updated{' '}
                {new Date(narrative.updated_at).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric'
                })}
              </p>
            )}
          </div>
        )}

        {isLeaf && haveCount !== null && activeCount !== null && (
          <div className={styles.contextStrip} aria-label="Troop progress on this requirement">
            <div className={styles.ctxCell}>
              <div className={`${styles.ctxNum} ${styles.ctxNumForest}`}>{haveCount}</div>
              <div className={styles.ctxLabel}>Scouts have it</div>
            </div>
            <div className={styles.ctxCell}>
              <div className={`${styles.ctxNum} ${styles.ctxNumBark}`}>
                {Math.max(activeCount - haveCount, 0)}
              </div>
              <div className={styles.ctxLabel}>Still need it</div>
            </div>
            <div className={styles.ctxCell}>
              <div className={styles.ctxNum}>{resources.length}</div>
              <div className={styles.ctxLabel}>Resources here</div>
            </div>
          </div>
        )}

        {children.length > 0 && (
          <>
            <div className={styles.sectionDivider}>
              <span className={styles.divLabel}>Parts of this requirement</span>
              <span className={styles.divRule} aria-hidden="true" />
            </div>
            <div className={styles.rankItem}>
              <div className={styles.reqRows}>
                {children.map((child) => (
                  <Link
                    key={child.code}
                    className={styles.reqRow}
                    href={`/library/rank/${rankId}/${encodeURIComponent(child.code)}`}
                  >
                    <span className={`${styles.reqTag} ${styles.reqTagGhost}`}>{child.code}</span>
                    <span className={styles.reqLabel}>{child.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}

        <div className={styles.sectionDivider}>
          <span className={styles.divLabel}>Resources</span>
          <span className={styles.divRule} aria-hidden="true" />
          <Link className={styles.divLink} href={suggestHref}>
            Suggest one →
          </Link>
        </div>

        {resources.length === 0 ? (
          <div className={styles.emptyState}>
            Nothing shelved for this requirement yet. Found a great video, article, or
            document for it? <Link href={suggestHref}>Be the first to suggest one →</Link>
          </div>
        ) : (
          <ul className={styles.resourceList}>
            {resources.map((res) => (
              <ResourceCard key={res.placement.id} resource={res} pinned={res.placement.pinned} />
            ))}
          </ul>
        )}

        <nav className={styles.siblingNav} aria-label="Neighboring requirements">
          {prev && (
            <Link href={`/library/rank/${rankId}/${encodeURIComponent(prev.code)}`}>
              ← {prev.code}
            </Link>
          )}
          <span className={styles.siblingSpacer} />
          {next && (
            <Link href={`/library/rank/${rankId}/${encodeURIComponent(next.code)}`}>
              {next.code} →
            </Link>
          )}
        </nav>
      </main>
    </>
  );
}
