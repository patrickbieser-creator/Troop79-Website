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
 * SECTION ORDER, and why: stats → scout grid → (scout switcher) → ONE
 * Requirements list. A parent or leader landing here gets the counts first,
 * exactly as the retired page led with. Every requirement row then carries
 * its own resources, counselor note, the selected scout's Done/Pending pill
 * and the per-row "I did this" / "Suggest a resource" actions
 * (Plans/Library-MB-Consolidation.md Phase 2, prototype rev 4, 2026-09-07).
 * The three sections that used to follow the tree — "Whole-badge resources",
 * a divider per top-level requirement with resources, and the "I did this"
 * radio picker (mb-proof-picker.tsx, retired) — are gone: study → do → claim
 * now happens on the row, not three scroll positions apart. The header's
 * jump link still lands on the list.
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
 * `?viewScout=` IS honoured here since 2026-09-07 (Plans/Library-MB-Consolidation.md,
 * Phase 1) — resolved through the same lib/library-viewer.ts chain the rank
 * pages use, so the URL value only ever selects among scouts the session is
 * already authorized to see. Phase 2 renders with it: a household with two
 * or more scouts gets the library's ScoutSwitcher under the grid and the
 * rows personalise to that one scout. The grid stays troop-wide, not
 * personalized.
 *
 * QUERY COUNT per request (perf item 18's discipline), Phase 1 vs before:
 *   Visitor — before: merit_badges (1, shared with generateMetadata) +
 *   merit_badge_requirements (1) + requirement_notes (1) + library_placements
 *   ×2 (whole badge, hand-rolled mb_req) + ledger_entries (1 per 1000 rows)
 *   + scouts (1) = 7. After: the same 7 — loadMbRequirementNotes replaces
 *   loadNarrative (one read now carries the badge narrative AND every
 *   per-requirement note), loadMbPageResources replaces loadPublishedFor +
 *   the hand-rolled query. With no session cookie resolveLibraryViewer and
 *   gateAudience issue nothing, and loadMbPendingSubmissions([]) returns
 *   without a query.
 *   Signed-in household — the 7 above + resolveLibraryViewer's own cost
 *   (the request-cached epoch check + household load the rank page already
 *   pays) + 1 requirement_submissions read scoped to the viewed scout.
 */
import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { MeritBadge, MeritBadgeRequirement, Scout } from '@/lib/supabase/types';
import { SCOUT_CORE_COLS } from '@/lib/scout-row';
import { buildReqTree, flattenLeaves, bsaPageUrl, workbookUrl } from '@/lib/mb-helpers';
import {
  foldLedger,
  gridGroups,
  mbStats,
  startedScouts,
  type MbLedgerRow
} from '@/lib/mb-scout-progress';
import { ArticleBody } from '@/lib/article-body/ArticleBody';
import { gateAudience } from '@/lib/family-access';
import { canClaimProof } from '@/lib/library';
import {
  loadMbPageResources,
  loadMbPendingSubmissions,
  loadMbRequirementNotes
} from '@/lib/library-data';
import { resolveLibraryViewer, viewerIsLeader } from '@/lib/library-viewer';
import { TrackedExternalLink } from '../../../_components/tracked-external-link';
import { ScoutSwitcher } from '../../_components/scout-switcher';
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
  params,
  searchParams
}: {
  params: Promise<{ mbId: string }>;
  searchParams: Promise<{ viewScout?: string }>;
}) {
  const { mbId } = await params;
  const { viewScout } = await searchParams;
  const supabase = createAdminClient();
  const isLeader = await viewerIsLeader();
  // Started here, awaited inside the Promise.all: the pending-proof read
  // depends on WHICH scout the viewer resolves to, so it chains off this
  // promise rather than serialising the whole page behind it.
  const viewerP = resolveLibraryViewer(supabase, viewScout);

  const [
    mb,
    reqsRes,
    notes,
    resources,
    ledgerRows,
    { data: scoutRows },
    viewer,
    pendingByLeaf
  ] = await Promise.all([
    loadMeritBadge(mbId),
    supabase.from('merit_badge_requirements').select('*').eq('mb_id', mbId),
    loadMbRequirementNotes(createAdminClient(), mbId),
    loadMbPageResources(createAdminClient(), mbId, isLeader),
    // Unbounded past the ~1000-row PostgREST cap once a badge accumulates
    // enough history across every scout — paginate (lib/supabase/paginate.ts).
    fetchAllRows<MbLedgerRow>((from, to) =>
      supabase
        .from('ledger_entries')
        .select('scout_id, kind, code, date')
        .or(`code.like.${mbId}-%,code.eq.MB:${mbId}`)
        .is('archived_at', null)
        .is('deleted_at', null)
        .range(from, to)
    ),
    supabase.from('scouts').select(SCOUT_CORE_COLS).eq('active', true).order('display_name'),
    viewerP,
    // Only the resolved viewer's OWN scout — never a guessed `?viewScout=`
    // (resolveLibraryViewer already refused anything outside the session's
    // household). A 'none' / 'proxy-available' viewer has no scout → no query.
    viewerP.then((v) =>
      loadMbPendingSubmissions(createAdminClient(), mbId, v.kind === 'scout' ? [v.scoutId] : [])
    )
  ]);
  if (!mb) notFound();

  const badge = mb;
  const narrative = notes.wholeBadge;
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

  let totalCount = resources.wholeBadge.length;
  for (const list of resources.byLeafCode.values()) totalCount += list.length;

  // ── Whose rows ──────────────────────────────────────────────────────────
  // The ONE scout the requirement rows personalise to — the same fold the
  // grid draws from, so a pill and a grid cell can never disagree.
  const selectedScoutId = viewer.kind === 'scout' ? viewer.scoutId : null;
  const doneDates = selectedScoutId ? byScout.get(selectedScoutId)?.dates : undefined;
  // "I did this" needs a scout in view AND either a verified identity or a
  // leader proxying as that scout (lib/library.ts canClaimProof — the page
  // twin of the proofSubmissionAllowedFor gate submit-proof/actions.ts
  // enforces; Patrick 2026-09-07 restored the proxy case, the claim is filed
  // on the scout's behalf and still reviewed). The OLD shared scout login
  // can't submit proof at all (Plans/Family-Identity-Auth.md Phase 0) — the
  // list says so once at the top instead of walking a scout to a form that
  // refuses them.
  const audience = await gateAudience();
  const canClaim = canClaimProof(viewer, audience);
  const scoutBlocked = audience === 'scout';

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
              {leaves.length > 0 && canClaim && (
                /* The claim lives on each requirement row now, below the
                   grid — the one action a family comes here to take still
                   needs a way down to the list. */
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

        {/* Directly under the grid, above the Requirements divider (Patrick,
            2026-09-07): a household with 2+ scouts gets the pull-down, one
            scout or a scout session the plain "Showing progress for" line,
            a visitor nothing. Navigates back to THIS page with ?viewScout=. */}
        <div className={s.switcherSlot}>
          <ScoutSwitcher viewer={viewer} basePath={`/library/mb/${mbId}`} />
        </div>

        <MbRequirementsTree
          mbId={mbId}
          nodes={reqTree}
          viewer={viewer}
          pendingByLeaf={pendingByLeaf}
          resources={resources}
          notes={notes.byLeafCode}
          doneDates={doneDates}
          canClaim={canClaim}
          scoutBlocked={scoutBlocked}
          anchorId={PROOF_ANCHOR}
        />
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
