/**
 * /library/mb/[mbId] — one merit badge's library page. Whole-badge resources
 * (target 'mb':mbId) first, then per-requirement groups ('mb_req':
 * '{mbId}-{code}') anchored under their top-level requirement — NOT one page
 * per requirement node (1,700+ nodes; the badge is the right granularity).
 *
 * Deliberately NOT personalized (Patrick's 2026-08-07 ask, and the requirement
 * rows here aren't an accordion — grouped under plain section headers, per
 * this file's own header above). The MB GRID on /library home shows
 * completion highlighting instead (lib/library-viewer.ts,
 * loadScoutMbAwardMap); a `?viewScout=` param reaching this page from that
 * grid is simply dropped, not a leak — no scout data renders either way.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import type { MeritBadge, MeritBadgeRequirement } from '@/lib/supabase/types';
import { buildReqTree, topLevelCodeOf } from '@/lib/mb-helpers';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { flattenLeaves } from '@/lib/mb-helpers';
import { gateAudience } from '@/lib/family-access';
import { loadNarrative, loadPublishedFor, type PlacedResource } from '@/lib/library-data';
import { ResourceCard } from '../../_components/resource-card';
import MbProofPicker from './mb-proof-picker';
import styles from '../../library.module.css';

export const dynamic = 'force-dynamic';

export default async function LibraryMbPage({
  params
}: {
  params: Promise<{ mbId: string }>;
}) {
  const { mbId } = await params;
  const supabase = createAdminClient();

  const [{ data: mb }, reqsRes, narrative, badgeResources, reqPlacementsRes] = await Promise.all([
    supabase.from('merit_badges').select('*').eq('id', mbId).maybeSingle(),
    supabase.from('merit_badge_requirements').select('*').eq('mb_id', mbId),
    loadNarrative(createAdminClient(), 'mb', mbId),
    loadPublishedFor(createAdminClient(), 'mb', mbId),
    // All published resources placed on any of this badge's requirements.
    supabase
      .from('library_placements')
      .select('id, pinned, sort_order, target_kind, target_key, library_resources!inner(*)')
      .eq('target_kind', 'mb_req')
      .like('target_key', `${mbId}-%`)
      .eq('library_resources.status', 'published')
      .order('pinned', { ascending: false })
      .order('sort_order')
  ]);
  if (!mb) notFound();

  const badge = mb as MeritBadge;
  const reqTree = buildReqTree((reqsRes.data ?? []) as MeritBadgeRequirement[]);

  // Group requirement-level resources by their TOP-LEVEL requirement code so
  // a resource on 'robotics-4a' shows under "Requirement 4".
  type PlacementRow = {
    id: number;
    pinned: boolean;
    sort_order: number;
    target_kind: 'mb_req';
    target_key: string;
    library_resources: PlacedResource;
  };
  const byTopCode = new Map<string, PlacedResource[]>();
  for (const row of (reqPlacementsRes.data ?? []) as unknown as PlacementRow[]) {
    const reqCode = row.target_key.slice(mbId.length + 1);
    const topCode = topLevelCodeOf(reqTree, reqCode) ?? reqCode;
    const list = byTopCode.get(topCode) ?? [];
    list.push({
      ...row.library_resources,
      placement: {
        id: row.id,
        pinned: row.pinned,
        sort_order: row.sort_order,
        target_kind: row.target_kind,
        target_key: row.target_key
      }
    });
    byTopCode.set(topCode, list);
  }
  const topGroups = reqTree
    .map((top) => ({ top, resources: byTopCode.get(top.code) ?? [] }))
    .filter((g) => g.resources.length > 0);

  // Phase 2 (Plans/Resource-Library.md) — proof groups are independent of
  // which top-level requirements happen to have resources yet (topGroups
  // above), so every leaf in the catalog is reachable here even on a badge
  // page with nothing shelved.
  const leavesByTop = new Map<string, { code: string; label: string }[]>();
  for (const leaf of flattenLeaves(reqTree)) {
    const top = topLevelCodeOf(reqTree, leaf.code) ?? leaf.code;
    const list = leavesByTop.get(top) ?? [];
    list.push({ code: leaf.code, label: leaf.label });
    leavesByTop.set(top, list);
  }
  const proofGroups = reqTree.map((top) => ({
    code: top.code,
    label: top.label,
    leaves: leavesByTop.get(top.code) ?? []
  }));

  const totalCount =
    badgeResources.length + topGroups.reduce((sum, g) => sum + g.resources.length, 0);
  const suggestHref = `/library/submit?target=${encodeURIComponent(`mb:${mbId}`)}`;
  // A scout-login session can't submit proof at all (Plans/Family-Identity-Auth.md
  // Phase 0) — MbProofPicker needs to know so it can explain that instead of
  // walking a scout through a picker that will refuse them at the end.
  const audience = await gateAudience();

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>
          <Link href="/library">Resource Library</Link>
          <span className={styles.kickerSep}>·</span>
          Merit Badge
        </p>
        <h1 className={styles.pageTitle}>{badge.name}</h1>
        <p className={styles.pageLede}>
          {totalCount === 0
            ? 'Nothing shelved for this badge yet — be the first to suggest something.'
            : `${totalCount} resource${totalCount === 1 ? '' : 's'} the troop recommends for this badge.`}{' '}
          For requirements and troop progress, see the{' '}
          <Link
            href={`/merit-badges/${mbId}`}
            style={{ color: 'var(--navy)', fontWeight: 700, fontStyle: 'normal' }}
          >
            badge tracker page
          </Link>
          .
        </p>
        <div className={styles.headRule} />
      </div>

      <main className={styles.main}>
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

        {proofGroups.length > 0 && (
          <MbProofPicker mbId={mbId} groups={proofGroups} scoutBlocked={audience === 'scout'} />
        )}

        <div className={styles.sectionDivider}>
          <span className={styles.divLabel}>Whole-badge resources</span>
          <span className={styles.divRule} aria-hidden="true" />
          <Link className={styles.divLink} href={suggestHref}>
            Suggest one →
          </Link>
        </div>
        {badgeResources.length === 0 ? (
          <div className={styles.emptyState}>
            Nothing shelved for the badge overall yet.{' '}
            <Link href={suggestHref}>Suggest the first one →</Link>
          </div>
        ) : (
          <ul className={styles.resourceList}>
            {badgeResources.map((res) => (
              <ResourceCard key={res.placement.id} resource={res} pinned={res.placement.pinned} />
            ))}
          </ul>
        )}

        {topGroups.map((group) => (
          <div key={group.top.code}>
            <div className={styles.sectionDivider}>
              <span className={styles.divLabel}>
                Requirement {group.top.code} — {group.top.label.slice(0, 60)}
                {group.top.label.length > 60 ? '…' : ''}
              </span>
              <span className={styles.divRule} aria-hidden="true" />
            </div>
            <ul className={styles.resourceList}>
              {group.resources.map((res) => (
                <ResourceCard key={res.placement.id} resource={res} pinned={res.placement.pinned} />
              ))}
            </ul>
          </div>
        ))}
      </main>
    </>
  );
}
