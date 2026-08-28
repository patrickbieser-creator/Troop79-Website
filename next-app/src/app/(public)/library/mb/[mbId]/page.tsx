/**
 * /library/mb/[mbId] — ONE page per merit badge: what the badge asks, who in
 * the troop has done it, what helps, and how to claim it.
 *
 * MERGED 2026-08-22. This page used to be resources-only, and a separate
 * tracker at /merit-badges/[mbId] carried the stats, the scout grid and the
 * requirement list. Patrick: "everything that is on the individual merit badge
 * display should be relocated into the library for each merit badge and placed
 * thoughtfully above where the current 'I did this' functionality exists so
 * that the library is the one place where you go for merit badges, not two
 * different places." The tracker route is retired; this is the only one.
 *
 * SECTION ORDER, and why: stats → scout grid → requirements → resources →
 * "I did this". A parent or leader landing here gets the counts first, exactly
 * as the retired page led with. A scout gets study → do → claim: what the
 * badge asks, what helps, then the claim at the end, next to the requirement
 * labels it asks them to pick from. The picker is no longer the top of the
 * page, so the header carries an anchor jump to it.
 *
 * SCOUT DATA NOW RENDERS HERE — this file previously promised it never would
 * (a 2026-08-07 note, when the page was resources-only and personalization was
 * deliberately kept off it). That is no longer true and the note is gone
 * rather than left to contradict the code. Patrick confirmed the reversal on
 * 2026-08-22: troop-wide progress, scouts shown as first name + last initial
 * (publicScoutName). The audience did not change — this page and the retired
 * tracker were both fully public — but the promise did, so it is recorded
 * here instead of discovered later.
 *
 * `?viewScout=` is still dropped. The grid is troop-wide, not personalized;
 * highlighting the viewing scout's row is a separate decision Patrick parked.
 */
import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { MeritBadge, MeritBadgeRequirement, Scout } from '@/lib/supabase/types';
import { SCOUT_CORE_COLS } from '@/lib/scout-row';
import { buildReqTree, flattenLeaves, topLevelCodeOf, bsaPageUrl, workbookUrl } from '@/lib/mb-helpers';
import {
  foldLedger,
  gridGroups,
  mbStats,
  startedScouts,
  type MbLedgerRow
} from '@/lib/mb-scout-progress';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { gateAudience } from '@/lib/family-access';
import { loadNarrative, loadPublishedFor, type PlacedResource } from '@/lib/library-data';
import { viewerIsLeader } from '@/lib/library-viewer';
import { TrackedExternalLink } from '../../../_components/tracked-external-link';
import { ResourceCard } from '../../_components/resource-card';
import MbProofPicker from './mb-proof-picker';
import { MbScoutGrid } from './mb-scout-grid';
import { MbRequirementsTree } from './mb-requirements-tree';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { SectionDivider } from '@/app/_components/section-divider';
import { EmptyState } from '@/app/_components/empty-state';
import styles from '../../library.module.css';
import { fmtMonthYear } from '@/lib/format-date';
import s from './mb-tracker.module.css';

export const dynamic = 'force-dynamic';

/**
 * The one `merit_badges` row this route needs, `cache()`-wrapped (perf item
 * 18, 2026-08-27) so generateMetadata and the page component — which used to
 * each run their own `.eq('id', mbId).maybeSingle()` — share one query per
 * request. React's request-scoped `cache()`, not `unstable_cache`: this stays
 * force-dynamic on purpose (a fresh proof or a rank change must show without
 * waiting on a tag), so nothing here survives past the one request.
 */
const loadMeritBadge = cache(async (mbId: string): Promise<MeritBadge | null> => {
  const { data } = await createAdminClient().from('merit_badges').select('*').eq('id', mbId).maybeSingle();
  return data as MeritBadge | null;
});

/** The badge name in the tab — this page had no metadata export at all before
 *  the merge, so every badge rendered as an untitled tab. Carries forward the
 *  retired tracker's title/description intent. */
export async function generateMetadata({
  params
}: {
  params: Promise<{ mbId: string }>;
}): Promise<Metadata> {
  const { mbId } = await params;
  const badge = await loadMeritBadge(mbId);
  if (!badge) return { title: 'Merit Badge — Scout Troop 79' };
  return {
    title: `${badge.name} — Merit Badge — Scout Troop 79`,
    description: `${badge.name}${badge.eagle ? ' (Eagle-required)' : ''} — requirements, troop progress, and the resources Troop 79 recommends.`
  };
}

const PROOF_ANCHOR = 'i-did-this';

export default async function LibraryMbPage({
  params
}: {
  params: Promise<{ mbId: string }>;
}) {
  const { mbId } = await params;
  const supabase = createAdminClient();
  const isLeader = await viewerIsLeader();

  const [
    mb,
    reqsRes,
    narrative,
    badgeResources,
    reqPlacementsRes,
    ledgerRows,
    { data: scoutRows }
  ] = await Promise.all([
    loadMeritBadge(mbId),
    supabase.from('merit_badge_requirements').select('*').eq('mb_id', mbId),
    loadNarrative(createAdminClient(), 'mb', mbId),
    loadPublishedFor(createAdminClient(), 'mb', mbId, isLeader),
    // All published resources placed on any of this badge's requirements.
    // Hand-rolled rather than loadPublishedFor (one query for every
    // requirement at once) — so it carries the visibility filter itself.
    supabase
      .from('library_placements')
      .select('id, pinned, sort_order, target_kind, target_key, library_resources!inner(*)')
      .eq('target_kind', 'mb_req')
      .like('target_key', `${mbId}-%`)
      .eq('library_resources.status', 'published')
      .in('library_resources.visibility', isLeader ? ['public', 'leaders'] : ['public'])
      .order('pinned', { ascending: false })
      .order('sort_order'),
    // Unbounded past the ~1000-row PostgREST cap once a badge accumulates
    // enough history across every scout — paginate (lib/supabase/paginate.ts).
    fetchAllRows<MbLedgerRow>((from, to) =>
      supabase
        .from('ledger_entries')
        .select('scout_id, kind, code')
        .or(`code.like.${mbId}-%,code.eq.MB:${mbId}`)
        .is('archived_at', null)
        .is('deleted_at', null)
        .range(from, to)
    ),
    supabase.from('scouts').select(SCOUT_CORE_COLS).eq('active', true).order('display_name')
  ]);
  if (!mb) notFound();

  const badge = mb;
  const reqTree = buildReqTree((reqsRes.data ?? []) as MeritBadgeRequirement[]);
  const leaves = flattenLeaves(reqTree);

  // ── Tracker (all four decisions live in lib/mb-scout-progress.ts) ────────
  const byScout = foldLedger(ledgerRows, mbId);
  const activeScouts = (scoutRows ?? []) as unknown as Scout[];
  const started = startedScouts(activeScouts, byScout);
  // totalActive used to be its own `count: exact, head: true` round trip on
  // the same `scouts … eq('active', true)` filter as activeScouts above — its
  // length IS that count, so the second query was dropped (perf item 18).
  const stats = mbStats(started, byScout, activeScouts.length);
  const groups = gridGroups(reqTree, leaves);

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
  for (const leaf of leaves) {
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
      <PageHeader
        kicker={
          <>
            <Link href="/library">Resource Library</Link>
            <KickerSep />
            Merit Badge
          </>
        }
        title={
          <>
            {badge.name}
            {badge.eagle && <span className={s.eagleTagLarge}>Eagle</span>}
          </>
        }
        lede={
          <>
            {/* Explicit {' '} — a bare space after a {expr} container is dropped
                when the following text wraps (AGENTS.md's JSX gotcha; this
                shipped as "Electivemerit badge" for one render). */}
            {badge.eagle ? 'Eagle-required' : 'Elective'}{' '}
            merit badge &mdash; requirements, troop progress, and{' '}
            {totalCount === 0
              ? 'nothing shelved yet (be the first to suggest something)'
              : `${totalCount} resource${totalCount === 1 ? '' : 's'} the troop recommends`}
            .
            <span className={s.actionRow}>
              <ExternLink href={bsaPageUrl(badge)} mbId={mbId} linkType="official">
                Official BSA page ↗
              </ExternLink>
              <ExternLink href={workbookUrl(badge)} mbId={mbId} linkType="workbook">
                Workbook (PDF) ↗
              </ExternLink>
              {proofGroups.length > 0 && (
                /* The proof picker moved to the bottom of the page, so the one
                   action a scout comes here to take needs a way down to it. */
                <a href={`#${PROOF_ANCHOR}`} className={`${s.actionLink} ${s.actionLinkForest}`}>
                  Done with a requirement? I did this ↓
                </a>
              )}
            </span>
          </>
        }
      />

      <PageShell>
        {narrative && (
          <div className={styles.narrative}>
            <ArticleBody body={narrative.narrative_md} />
            {narrative.updated_by && (
              <p className={styles.narrativeCredit}>
                Written by <strong>{narrative.updated_by}</strong> · updated{' '}
                {fmtMonthYear(narrative.updated_at)}
              </p>
            )}
          </div>
        )}

        <div className={s.statStrip}>
          <Stat label="Earned" n={stats.earned} tone={s.statForest} />
          <Stat label="In Progress" n={stats.inProgress} tone={s.statNavy} />
          <Stat label="Not Started" n={stats.notStarted} tone={s.statMeta} />
          <Stat label="Active Scouts" n={stats.totalActive} tone={s.statNavy} />
        </div>

        <SectionDivider label="Scout Progress" />
        {started.length === 0 ? (
          <EmptyState>No scouts have started this merit badge yet.</EmptyState>
        ) : (
          <MbScoutGrid scouts={started} byScout={byScout} leaves={leaves} groups={groups} />
        )}

        <SectionDivider label="Requirements" />
        <div className={s.reqCard}>
          <p className={s.reqDisclaimer}>
            From the official BSA merit badge pamphlet — wording is paraphrased here. Confirm
            against the current pamphlet for sign-off.
          </p>
          <MbRequirementsTree nodes={reqTree} depth={0} />
        </div>

        <SectionDivider
          label="Whole-badge resources"
          link={<Link href={suggestHref}>Suggest one →</Link>}
        />
        {badgeResources.length === 0 ? (
          <EmptyState>
            Nothing shelved for the badge overall yet.{' '}
            <Link href={suggestHref}>Suggest the first one →</Link>
          </EmptyState>
        ) : (
          <ul className={styles.resourceList}>
            {badgeResources.map((res) => (
              <ResourceCard key={res.placement.id} resource={res} pinned={res.placement.pinned} />
            ))}
          </ul>
        )}

        {topGroups.map((group) => (
          <div key={group.top.code}>
            <SectionDivider
              label={
                <>
                  Requirement {group.top.code} — {group.top.label.slice(0, 60)}
                  {group.top.label.length > 60 ? '…' : ''}
                </>
              }
            />
            <ul className={styles.resourceList}>
              {group.resources.map((res) => (
                <ResourceCard key={res.placement.id} resource={res} pinned={res.placement.pinned} />
              ))}
            </ul>
          </div>
        ))}

        {proofGroups.length > 0 && (
          <div id={PROOF_ANCHOR}>
            <MbProofPicker mbId={mbId} groups={proofGroups} scoutBlocked={audience === 'scout'} />
          </div>
        )}
      </PageShell>
    </>
  );
}

function ExternLink({
  href,
  mbId,
  linkType,
  children
}: {
  href: string;
  mbId: string;
  linkType: 'official' | 'workbook';
  children: React.ReactNode;
}) {
  return (
    <TrackedExternalLink
      href={href}
      event="outbound_bsa_click"
      params={{ mb_id: mbId, link_type: linkType }}
      className={s.actionLink}
    >
      {children}
    </TrackedExternalLink>
  );
}

function Stat({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div className={s.stat}>
      <div className={`${s.statNum} ${tone}`}>{n}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}
