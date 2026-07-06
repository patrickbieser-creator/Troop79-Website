/**
 * /scouts/[id] — Per-scout Clipboard report.
 *
 * Server Component. Loads everything via lib/scout-detail.ts (one parallel
 * fetch), then composes the page: header, metrics, rank timeline, the
 * three-column Clipboard, MB + activities, leadership + service.
 *
 * Designed to be printable: the "Print PDF" button triggers window.print()
 * and the @media print rules hide chrome (see scout-detail.module.css).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  loadScoutDetail,
  mbIdFromAwardCode,
  mbIdFromReqCode,
  type ScoutDetail,
  type RankReqCatalogRow
} from '@/lib/scout-detail';
import {
  buildReqTree,
  isGroupSatisfied,
  flattenLeaves,
  optionalityNote,
  type ReqNode
} from '@/lib/mb-helpers';
import type { LedgerEntry, MeritBadgeRequirement } from '@/lib/supabase/types';
import { PrintButton } from './print-button';
import styles from './scout-detail.module.css';

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadScoutDetail(id);
  if (!detail) return { title: 'Scout not found — Scout Troop 79' };
  return { title: `${detail.scout.display_name} — Advancement — Scout Troop 79` };
}

export default async function ScoutClipboardPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadScoutDetail(id);
  if (!detail) notFound();

  return (
    <>
      <ScoutHeader detail={detail} />
      <main className={styles.main}>
        <MetricsStrip detail={detail} />
        <SectionDivider label="Rank Progression" />
        <RankTimeline detail={detail} />
        <Clipboard detail={detail} />
        <SectionDivider label="Merit Badges & Activities" />
        <div className={styles.twoCol}>
          <MeritBadgesPanel detail={detail} />
          <ActivitiesPanel detail={detail} />
        </div>
        <SectionDivider label="Leadership & Service" />
        <div className={styles.twoCol}>
          <LeadershipPanel detail={detail} />
          <ServicePanel detail={detail} />
        </div>
        <MbInProgressSection detail={detail} />
      </main>
    </>
  );
}

function ScoutHeader({ detail }: { detail: ScoutDetail }) {
  const { scout } = detail;
  const rankLabel =
    detail.ranks.find((r) => r.id === scout.current_rank)?.display_name ?? '—';

  const metaParts: React.ReactNode[] = [
    <span key="rank">
      <strong>{rankLabel}</strong> rank
    </span>
  ];
  if (scout.patrol) {
    metaParts.push(<span key="patrol">{scout.patrol} Patrol</span>);
  }
  if (scout.bsa_member_id) {
    metaParts.push(<span key="bsa">BSA ID {scout.bsa_member_id}</span>);
  } else {
    metaParts.push(
      <span key="bsa" className={styles.noBsa}>
        no BSA ID on file
      </span>
    );
  }
  if (scout.joined_date) {
    metaParts.push(<span key="joined">Joined {longDate(scout.joined_date)}</span>);
  }

  return (
    <div className={styles.scoutHeader}>
      <div>
        <div className={styles.scoutId}>Scout Clipboard</div>
        <div className={styles.scoutNameBig}>{scout.display_name}</div>
        <div className={styles.scoutMeta}>
          {metaParts.map((node, i) => (
            <span key={i}>
              {i > 0 && <span className={styles.metaSep}>·</span>}
              {node}
            </span>
          ))}
        </div>
      </div>
      <div className={`${styles.scoutActions} ${styles.printHide}`}>
        <PrintButton className={styles.btnAction} />
        <Link
          href="/advancement"
          className={`${styles.btnAction} ${styles.btnPrimary}`}
        >
          &larr; All Scouts
        </Link>
      </div>
    </div>
  );
}

function MetricsStrip({ detail }: { detail: ScoutDetail }) {
  const { scout, summary, ranks, ledger } = detail;
  const currentRankLabel =
    ranks.find((r) => r.id === scout.current_rank)?.display_name ?? '—';
  const currentRankSort =
    ranks.find((r) => r.id === scout.current_rank)?.sort_order ?? -1;
  // "Ranks earned" counts everything at-or-below the current rank.
  const ranksEarned =
    currentRankSort >= 0
      ? ranks.filter((r) => r.sort_order <= currentRankSort).length
      : 0;
  const mbCount = summary?.mb_count ?? 0;
  const eagleMbCount = summary?.eagle_mb_count ?? 0;
  const campingNights = summary?.camping_nights ?? 0;
  const serviceHours = summary?.service_hours ?? 0;
  const activityCount =
    ledger.campingNights.length +
    ledger.hikingMiles.length +
    ledger.dayOuting.length +
    ledger.fundraiser.length;
  const projectCount = ledger.serviceHours.length;
  const hikingMiles = ledger.hikingMiles.reduce((sum, e) => sum + (e.qty ?? 0), 0);
  const leadershipTerms = ledger.leadership.length;

  return (
    <div className={styles.metricsStrip}>
      <Metric
        label="Current Rank"
        value={currentRankLabel}
        sub={`${ranksEarned} rank${ranksEarned === 1 ? '' : 's'} earned`}
      />
      <Metric
        label="Merit Badges"
        value={mbCount}
        sub={`${eagleMbCount} Eagle-required`}
      />
      <Metric
        label="Camping Nights"
        value={campingNights}
        sub={`across ${activityCount} activit${activityCount === 1 ? 'y' : 'ies'}`}
      />
      <Metric
        label="Service Hours"
        value={serviceHours}
        sub={`${projectCount} project${projectCount === 1 ? '' : 's'}`}
      />
      <Metric label="Hiking Miles" value={hikingMiles} sub="recorded" />
      <Metric
        label="Leadership"
        value={leadershipTerms}
        sub={`term${leadershipTerms === 1 ? '' : 's'}`}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  sub
}: {
  label: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue}>{value}</div>
      <div className={styles.metricSub}>{sub}</div>
    </div>
  );
}

function SectionDivider({
  label,
  meta
}: {
  label: string;
  meta?: string;
}) {
  return (
    <div className={styles.sectionDivider}>
      <span className={styles.divLabel}>{label}</span>
      <span className={styles.divRule} aria-hidden="true" />
      {meta && <span className={styles.divMeta}>{meta}</span>}
    </div>
  );
}

function RankTimeline({ detail }: { detail: ScoutDetail }) {
  const { scout, ranks } = detail;
  // scout.current_rank is the highest rank already AWARDED (trigger-derived
  // from rank_award ledger rows — see recompute_scout_current_rank), not the
  // rank being worked toward. -1 when no rank_award exists yet, meaning the
  // scout hasn't earned even the first rank and is working toward ranks[0].
  const currentIdx = ranks.findIndex((r) => r.id === scout.current_rank);
  const inProgressIdx = currentIdx + 1;
  return (
    <div className={styles.rankTimeline}>
      {ranks.map((r, idx) => {
        const isEarned = idx <= currentIdx;
        const isInProgress = idx === inProgressIdx;
        const cls = isEarned
          ? styles.earned
          : isInProgress
            ? styles.current
            : styles.unattempted;
        return (
          <div key={r.id} className={`${styles.rankStep} ${cls}`}>
            {(isEarned || isInProgress) && (
              <div className={styles.pin}>{isEarned ? '✓' : '★'}</div>
            )}
            <div className={styles.rankStepName}>{r.display_name}</div>
            <div className={styles.rankStepDate}>
              {isEarned ? 'Earned' : isInProgress ? 'In progress' : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** How many NEW merit badges (beyond the previous rank's cumulative total)
 *  each rank requires — split into Eagle-required vs. other/elective.
 *  Star: 6 total (4 Eagle-required). Life: 5 more (3 Eagle-required,
 *  cumulative 9/7). Eagle: 10 more (6 Eagle-required, cumulative 21/13) —
 *  confirmed against troop convention, not the stock BSA text. */
const MB_QUOTAS: Record<string, { eagle: number; other: number }> = {
  star: { eagle: 4, other: 2 },
  life: { eagle: 3, other: 2 },
  eagle: { eagle: 6, other: 4 }
};

/** Buckets a scout's earned merit badges into Star/Life/Eagle by award date
 *  (oldest first), filling each rank's quota before spilling into the next.
 *  The Eagle bucket is uncapped, so a scout who's earned more than the
 *  minimum still sees every extra badge — nothing silently dropped. */
function buildMbRankBuckets(
  detail: ScoutDetail
): Map<string, { eagleRows: MbDisplayRow[]; otherRows: MbDisplayRow[] }> {
  const rows = buildMbRows(detail); // already sorted oldest -> newest
  const eagleRows = rows.filter((r) => r.eagle);
  const otherRows = rows.filter((r) => !r.eagle);
  const order = ['star', 'life', 'eagle'] as const;
  const buckets = new Map<string, { eagleRows: MbDisplayRow[]; otherRows: MbDisplayRow[] }>();
  let eIdx = 0;
  let oIdx = 0;
  order.forEach((rankId, i) => {
    const isLast = i === order.length - 1;
    const quota = MB_QUOTAS[rankId];
    const eSlice = isLast ? eagleRows.slice(eIdx) : eagleRows.slice(eIdx, eIdx + quota.eagle);
    const oSlice = isLast ? otherRows.slice(oIdx) : otherRows.slice(oIdx, oIdx + quota.other);
    eIdx += eSlice.length;
    oIdx += oSlice.length;
    buckets.set(rankId, { eagleRows: eSlice, otherRows: oSlice });
  });
  return buckets;
}

function Clipboard({ detail }: { detail: ScoutDetail }) {
  // Index the scout's earned rank entries by `${rank}-${reqCode}` so the
  // catalog rows can look up date/leader. Two ledger kinds feed this map:
  //   - rank_requirement: code is already `<rank>-<reqCode>` (e.g. "tenderfoot-2c")
  //   - rank_award: code is just the rank slug ("tenderfoot"); the catalog
  //     models the BoR as a synthetic requirement row with code "BoR", so we
  //     re-key these as `<rank>-BoR` for the same lookup.
  const ledgerByCode = new Map<string, LedgerEntry>();
  for (const e of detail.ledger.rankRequirements) {
    ledgerByCode.set(e.code, e);
  }
  for (const e of detail.ledger.rankAwards) {
    ledgerByCode.set(`${e.code}-BoR`, e);
  }
  // Group catalog rows by rank, then build each rank's parent/child tree so
  // grouped requirements (First Aid, Fitness, Lashings — tracked as
  // unofficial sub-skills) can render their breakdown. Same buildReqTree
  // used by the public MB detail page — see lib/mb-helpers.ts.
  const rowsByRank = new Map<string, RankReqCatalogRow[]>();
  for (const r of detail.rankReqs) {
    const list = rowsByRank.get(r.rank_id) ?? [];
    list.push(r);
    rowsByRank.set(r.rank_id, list);
  }
  const catalogByRank = new Map<string, ReqNode<RankReqCatalogRow>[]>();
  for (const [rankId, rows] of rowsByRank) {
    catalogByRank.set(rankId, buildReqTree(rows));
  }
  // Show every rank that has any catalog entries — the same set for every
  // scout, so a "needs to do" report is complete.
  const ranksToShow = detail.ranks.filter((r) => (catalogByRank.get(r.id)?.length ?? 0) > 0);
  const mbBuckets = buildMbRankBuckets(detail);
  const todayShort = new Date().toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  });

  // Fixed two-row-of-three layout: top row is Scout/Tenderfoot/Second Class,
  // bottom row is First Class / (Star+Life stacked) / Eagle. Star and Life
  // share the middle-bottom cell (see .rankBlockStack) instead of Life
  // spilling into a third row on its own.
  const byId = new Map(ranksToShow.map((r) => [r.id, r]));
  const renderBlock = (rankId: string, gapAbove?: boolean) => {
    const r = byId.get(rankId);
    if (!r) return null;
    return (
      <RankBlock
        key={r.id}
        rankId={r.id}
        label={r.display_name}
        catalog={catalogByRank.get(r.id) ?? []}
        ledgerByCode={ledgerByCode}
        mbBucket={mbBuckets.get(r.id)}
        gapAbove={gapAbove}
      />
    );
  };

  return (
    <>
      <SectionDivider
        label="Rank Requirements (The Clipboard)"
        meta={`${ranksToShow.length} rank section${
          ranksToShow.length === 1 ? '' : 's'
        } · printable · hover for full text`}
      />
      <div className={styles.clipboard}>
        <div className={styles.clipboardHeader}>
          <span className={styles.chName}>{detail.scout.display_name}</span>
          <span className={styles.chDate}>{todayShort}</span>
        </div>
        <div className={styles.rankColumns}>
          {renderBlock('scout')}
          {renderBlock('tenderfoot')}
          {renderBlock('second-class')}
          {renderBlock('first-class')}
          <div className={styles.rankBlockStack}>
            {renderBlock('star')}
            {renderBlock('life', true)}
          </div>
          {renderBlock('eagle')}
        </div>
      </div>
    </>
  );
}

function RankBlock({
  rankId,
  label,
  catalog,
  ledgerByCode,
  mbBucket,
  gapAbove
}: {
  rankId: string;
  label: string;
  catalog: ReqNode<RankReqCatalogRow>[];
  ledgerByCode: Map<string, LedgerEntry>;
  mbBucket?: { eagleRows: MbDisplayRow[]; otherRows: MbDisplayRow[] };
  gapAbove?: boolean;
}) {
  const mbQuota = MB_QUOTAS[rankId];
  return (
    <div className={`${styles.rankBlock} ${gapAbove ? styles.rankBlockGapAbove : ''}`.trim()}>
      <div
        className={`${styles.rankBlockTitle} ${gapAbove ? styles.rankBlockTitleBordered : ''}`.trim()}
      >
        {label}
      </div>
      {catalog.length === 0 ? (
        <div className={styles.miniEmpty}>No requirements catalogued.</div>
      ) : (
        catalog.map((req) => (
          <RankReqRows
            key={`${rankId}-${req.code}`}
            rankId={rankId}
            req={req}
            ledgerByCode={ledgerByCode}
          />
        ))
      )}
      {/* Computed Eagle-required / other merit badge breakdown, appended
          below the numbered requirement checklist (not in place of req "3",
          which stays as the leader's manual signoff). */}
      {mbQuota && mbBucket && <MbQuotaSection quota={mbQuota} bucket={mbBucket} />}
    </div>
  );
}

function MbQuotaSection({
  quota,
  bucket
}: {
  quota: { eagle: number; other: number };
  bucket: { eagleRows: MbDisplayRow[]; otherRows: MbDisplayRow[] };
}) {
  return (
    <>
      <MbQuotaGroup label="Eagle Merit Badges" rows={bucket.eagleRows} quota={quota.eagle} />
      <MbQuotaGroup label="Other Merit Badges" rows={bucket.otherRows} quota={quota.other} />
    </>
  );
}

/** Heading shows the live earned/quota fraction rather than a fixed quota
 *  number — a scout who's earned more than the minimum (common, since the
 *  Eagle bucket is uncapped) would otherwise see a heading that undercounts
 *  the rows listed beneath it. */
function MbQuotaGroup({
  label,
  rows,
  quota
}: {
  label: string;
  rows: MbDisplayRow[];
  quota: number;
}) {
  const met = rows.length >= quota;
  return (
    <>
      <div
        className={`${styles.miniSectionHeading} ${met ? '' : styles.miniSectionHeadingOpen}`.trim()}
      >
        <span>{label}</span>
        <span className={styles.miniSectionCount}>
          {rows.length}/{quota}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className={styles.miniRow}>
          <span>{shortDate(r.date)}</span>
          <span>{r.by ?? ''}</span>
          <span className={styles.miniRowLabel}>{r.name}</span>
        </div>
      ))}
      {/* Reserve one blank line per unfilled quota slot, same as an unearned
          numbered requirement row — so the space for what's still needed is
          visible, not just what's already been earned. */}
      {Array.from({ length: Math.max(0, quota - rows.length) }).map((_, i) => (
        <div key={`blank-${i}`} className={`${styles.miniRow} ${styles.miniRowUnearned}`}>
          <span />
          <span />
          <span className={styles.miniRowLabel}>&nbsp;</span>
        </div>
      ))}
    </>
  );
}

/** One catalog requirement's row(s). Plain leaves render a single row as
 *  before. Grouped requirements (First Aid, Fitness, Lashings — the troop's
 *  own unofficial sub-skill breakdown; Fast Entry signs these off child by
 *  child, never at the parent's own code) render a rolled-up parent row plus
 *  one indented sub-row per skill, always — so partial progress is visible
 *  and nothing appears to silently vanish once it's fully signed off. */
function RankReqRows({
  rankId,
  req,
  ledgerByCode
}: {
  rankId: string;
  req: ReqNode<RankReqCatalogRow>;
  ledgerByCode: Map<string, LedgerEntry>;
}) {
  const isBor =
    req.code.toLowerCase() === 'bor' || /board of review/i.test(req.label);

  if (req.children.length === 0) {
    const ledger = ledgerByCode.get(`${rankId}-${req.code}`);
    const earned = !!ledger;
    const fullText = ledger?.label ?? req.label;
    return (
      <div
        title={fullText}
        className={
          `${styles.miniRow} ${isBor ? styles.bor : ''} ${earned ? '' : styles.miniRowUnearned}`.trim()
        }
      >
        <span>{earned ? shortDate(ledger!.date) : ''}</span>
        <span>{earned ? (ledger!.by ?? '') : ''}</span>
        <span className={styles.miniRowLabel}>
          <span className={styles.reqCode}>{req.code}</span>
          {req.label}
        </span>
      </div>
    );
  }

  // Grouped requirement — roll up completion across the sub-skills. No
  // ledger row is ever written at the parent's own code, so "earned" and the
  // displayed date/by are derived from the children.
  const childEntries = req.children.map((c) => ({
    node: c,
    ledger: ledgerByCode.get(`${rankId}-${c.code}`)
  }));
  const doneCount = childEntries.filter((c) => c.ledger).length;
  const total = req.children.length;
  const earned = isGroupSatisfied(req.complete_rule, req.complete_n, doneCount, total);
  // Latest date among completed children = when the group was actually
  // finished (the "as of" date a real ledger row would otherwise carry).
  const latest = childEntries.reduce<LedgerEntry | null>((best, c) => {
    if (!c.ledger) return best;
    if (!best || (c.ledger.date ?? '') > (best.date ?? '')) return c.ledger;
    return best;
  }, null);

  return (
    <>
      <div
        title={req.label}
        className={`${styles.miniRow} ${earned ? '' : styles.miniRowUnearned}`.trim()}
      >
        <span>{earned && latest ? shortDate(latest.date) : ''}</span>
        <span>{earned && latest ? (latest.by ?? '') : ''}</span>
        <span className={styles.miniRowLabel}>
          <span className={styles.reqCode}>{req.code}</span>
          {req.label}
          <span className={styles.reqFraction}>
            {doneCount}/{total}
          </span>
        </span>
      </div>
      {childEntries.map(({ node, ledger }) => {
        const childEarned = !!ledger;
        const fullText = ledger?.label ?? node.label;
        return (
          <div
            key={`${rankId}-${node.code}`}
            title={fullText}
            className={
              `${styles.miniSubRow} ${childEarned ? '' : styles.miniRowUnearned}`.trim()
            }
          >
            <span>{childEarned ? shortDate(ledger!.date) : ''}</span>
            <span>{childEarned ? (ledger!.by ?? '') : ''}</span>
            <span className={styles.miniRowLabel}>{node.label}</span>
          </div>
        );
      })}
    </>
  );
}

interface MbDisplayRow {
  id: number;
  date: string | null;
  by: string | null;
  name: string;
  eagle: boolean;
}

function buildMbRows(detail: ScoutDetail): MbDisplayRow[] {
  return detail.ledger.meritBadgeAwards
    .map((e) => {
      const mbId = mbIdFromAwardCode(e.code);
      const catalog = mbId ? detail.mbCatalog.get(mbId) : null;
      return {
        id: e.id,
        date: e.date,
        by: e.by,
        name: catalog?.name ?? e.label ?? e.code,
        eagle: catalog?.eagle ?? false
      };
    })
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

function MeritBadgesPanel({ detail }: { detail: ScoutDetail }) {
  const mbRows = buildMbRows(detail);
  const eagle = mbRows.filter((r) => r.eagle);
  const other = mbRows.filter((r) => !r.eagle);
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Merit Badges</div>
      <div className={styles.panelMeta}>
        {mbRows.length} total · {eagle.length} Eagle-required · sorted oldest →
        newest
      </div>
      {eagle.length > 0 && (
        <>
          <div className={styles.panelSectionTitle}>Eagle-Required (★)</div>
          {eagle.map((r) => (
            <MbRowEl key={r.id} row={r} eagle />
          ))}
        </>
      )}
      {other.length > 0 && (
        <>
          <div className={styles.panelSectionTitle}>Other Merit Badges</div>
          {other.map((r) => (
            <MbRowEl key={r.id} row={r} eagle={false} />
          ))}
        </>
      )}
      {mbRows.length === 0 && (
        <div className={styles.emptyLine}>No merit badges recorded yet.</div>
      )}
      <div className={styles.legend}>
        <span className={styles.legendStar}>★</span> = Eagle-required merit badge
      </div>
    </div>
  );
}

function MbRowEl({ row, eagle }: { row: MbDisplayRow; eagle: boolean }) {
  return (
    <div className={`${styles.mbRow} ${eagle ? styles.mbEagle : ''}`.trim()}>
      <span>{shortDate(row.date)}</span>
      <span>{row.by ?? ''}</span>
      <span className={styles.mbName}>{row.name}</span>
    </div>
  );
}

function ActivitiesPanel({ detail }: { detail: ScoutDetail }) {
  // Merge every activity-like ledger kind into one list, sorted.
  type ActRow = {
    id: number;
    date: string | null;
    type: string;
    title: string;
    notes: string | null;
  };
  const acts: ActRow[] = [
    ...detail.ledger.campingNights.map((e) => ({
      id: e.id,
      date: e.date,
      type: 'Campout',
      title: `${e.label ?? e.code} (${e.qty} night${e.qty === 1 ? '' : 's'})`,
      notes: e.notes
    })),
    ...detail.ledger.hikingMiles.map((e) => ({
      id: e.id,
      date: e.date,
      type: 'Hike',
      title: `${e.label ?? e.code} (${e.qty} mi)`,
      notes: e.notes
    })),
    ...detail.ledger.dayOuting.map((e) => ({
      id: e.id,
      date: e.date,
      type: 'Day Outing',
      title: e.label ?? e.code,
      notes: e.notes
    })),
    ...detail.ledger.fundraiser.map((e) => ({
      id: e.id,
      date: e.date,
      type: 'Fundraiser',
      title: e.label ?? e.code,
      notes: e.notes
    }))
  ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Activities</div>
      <div className={styles.panelMeta}>
        {acts.length} activit{acts.length === 1 ? 'y' : 'ies'} on record
      </div>
      {acts.length === 0 ? (
        <div className={styles.emptyLine}>No activities recorded yet.</div>
      ) : (
        acts.map((a) => (
          <div key={`${a.type}-${a.id}`} className={styles.actRow}>
            <span>{shortDate(a.date)}</span>
            <span>{a.type}</span>
            <span>
              {a.title}
              {a.notes && (
                <span style={{ color: 'var(--text-meta)' }}> {a.notes}</span>
              )}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function LeadershipPanel({ detail }: { detail: ScoutDetail }) {
  const rows = [...detail.ledger.leadership].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '')
  );
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Leadership</div>
      <div className={styles.panelMeta}>
        {rows.length} position term{rows.length === 1 ? '' : 's'} · counts toward
        rank requirements
      </div>
      {rows.length === 0 ? (
        <div className={styles.emptyLine}>No leadership positions yet.</div>
      ) : (
        rows.map((e) => (
          <div key={e.id} className={styles.leadershipRow}>
            <span className={styles.dateRange}>
              {shortDate(e.date)} – present
            </span>
            <span>{e.label ?? e.code}</span>
            <span className={styles.tagCurrent}>Current</span>
          </div>
        ))
      )}
    </div>
  );
}

function ServicePanel({ detail }: { detail: ScoutDetail }) {
  const rows = [...detail.ledger.serviceHours].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '')
  );
  const totalHrs = rows.reduce((sum, e) => sum + (e.qty ?? 0), 0);
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Service Projects</div>
      <div className={styles.panelMeta}>
        {rows.length} project{rows.length === 1 ? '' : 's'} · {totalHrs} total
        hours
      </div>
      {rows.length === 0 ? (
        <div className={styles.emptyLine}>No service projects yet.</div>
      ) : (
        rows.map((e) => (
          <div key={e.id} className={styles.serviceRow}>
            <span className={styles.dateCell}>{shortDate(e.date)}</span>
            <span>{e.label ?? e.code}</span>
            <span className={styles.hoursCell}>
              {e.qty} hr{e.qty === 1 ? '' : 's'}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

interface MbInProgressCard {
  mbId: string;
  name: string;
  eagle: boolean;
  tree: ReqNode<MeritBadgeRequirement>[];
  totalLeaves: number;
  completedLeaves: number;
  /** Raw ledger rows, used only when this badge has no authored catalog
   *  (tree/totalLeaves come back empty) — falls back to a flat list. */
  rawRows: LedgerEntry[];
}

function MbInProgressSection({ detail }: { detail: ScoutDetail }) {
  const awardedMbIds = new Set(
    detail.ledger.meritBadgeAwards.map((e) => mbIdFromAwardCode(e.code)).filter((x): x is string => !!x)
  );
  const reqsByMbId = new Map<string, LedgerEntry[]>();
  for (const e of detail.ledger.meritBadgeRequirements) {
    const mbId = mbIdFromReqCode(e.code);
    if (!mbId || awardedMbIds.has(mbId)) continue;
    const list = reqsByMbId.get(mbId) ?? [];
    list.push(e);
    reqsByMbId.set(mbId, list);
  }

  const catalogRowsByMbId = new Map<string, MeritBadgeRequirement[]>();
  for (const r of detail.mbReqCatalog) {
    const list = catalogRowsByMbId.get(r.mb_id) ?? [];
    list.push(r);
    catalogRowsByMbId.set(r.mb_id, list);
  }

  const ledgerByCode = new Map<string, LedgerEntry>();
  for (const e of detail.ledger.meritBadgeRequirements) ledgerByCode.set(e.code, e);

  const cards: MbInProgressCard[] = [...reqsByMbId.keys()].map((mbId) => {
    const cat = detail.mbCatalog.get(mbId);
    const tree = buildReqTree(catalogRowsByMbId.get(mbId) ?? []);
    const leaves = flattenLeaves(tree);
    const completedLeaves = leaves.filter((l) => ledgerByCode.has(`${mbId}-${l.code}`)).length;
    return {
      mbId,
      name: cat?.name ?? mbId,
      eagle: cat?.eagle ?? false,
      tree,
      totalLeaves: leaves.length,
      completedLeaves,
      rawRows: reqsByMbId.get(mbId) ?? []
    };
  });

  cards.sort((a, b) => {
    const pctA = a.totalLeaves ? a.completedLeaves / a.totalLeaves : 0;
    const pctB = b.totalLeaves ? b.completedLeaves / b.totalLeaves : 0;
    return pctB - pctA || a.name.localeCompare(b.name);
  });

  return (
    <>
      <SectionDivider
        label="Merit Badges In Progress"
        meta={`${cards.length} badge${cards.length === 1 ? '' : 's'}`}
      />
      {cards.length === 0 ? (
        <div className={styles.emptyLine}>No merit badges in progress right now.</div>
      ) : (
        <div className={styles.mbAccordion}>
          {cards.map((c) => (
            <details key={c.mbId} className={styles.mbDetails}>
              <summary className={styles.mbSummary}>
                <span className={styles.mbSummaryName}>
                  {c.name}
                  {c.eagle && <span className={styles.mbEagleStar}> ★</span>}
                </span>
                <span className={styles.mbSummaryProgress}>
                  {c.totalLeaves > 0
                    ? `${c.completedLeaves} / ${c.totalLeaves} complete`
                    : `${c.rawRows.length} entr${c.rawRows.length === 1 ? 'y' : 'ies'} logged`}
                </span>
              </summary>
              <div className={styles.mbTreeWrap}>
                {c.totalLeaves > 0 ? (
                  <MbReqTree nodes={c.tree} mbId={c.mbId} ledgerByCode={ledgerByCode} depth={0} />
                ) : (
                  // No authored catalog for this badge — list the raw entries directly.
                  c.rawRows
                    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
                    .map((e) => (
                      <div key={e.id} className={styles.mbReqRow}>
                        <span className={styles.mbReqCheck} aria-hidden="true">
                          ✓
                        </span>
                        <span className={styles.mbReqCode}>{e.code.split('-').slice(1).join('-')}</span>
                        <span className={styles.mbReqLabel}>{e.label ?? e.code}</span>
                        <span className={styles.mbReqMeta}>
                          {shortDate(e.date)}
                          {e.by ? ` · ${e.by}` : ''}
                          {e.notes && <em className={styles.mbReqNotes}> — {e.notes}</em>}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

function MbReqTree({
  nodes,
  mbId,
  ledgerByCode,
  depth
}: {
  nodes: ReqNode<MeritBadgeRequirement>[];
  mbId: string;
  ledgerByCode: Map<string, LedgerEntry>;
  depth: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isLeaf = node.children.length === 0;
        const indent = depth * 16;
        if (isLeaf) {
          const entry = ledgerByCode.get(`${mbId}-${node.code}`);
          const done = !!entry;
          return (
            <div
              key={node.id}
              style={{ marginLeft: indent }}
              className={`${styles.mbReqRow} ${done ? '' : styles.mbReqRowOpen}`.trim()}
            >
              {done && (
                <span className={styles.mbReqCheck} aria-hidden="true">
                  ✓
                </span>
              )}
              <span className={styles.mbReqCode}>{node.code}</span>
              <span className={styles.mbReqLabel}>{node.label}</span>
              {entry && (
                <span className={styles.mbReqMeta}>
                  {shortDate(entry.date)}
                  {entry.by ? ` · ${entry.by}` : ''}
                  {entry.notes && <em className={styles.mbReqNotes}> — {entry.notes}</em>}
                </span>
              )}
            </div>
          );
        }
        const note = optionalityNote(node);
        return (
          <div key={node.id} style={{ marginLeft: indent }} className={styles.mbReqGroup}>
            <div className={styles.mbReqGroupHeader}>
              <span className={styles.mbReqCode}>{node.code}</span>
              <span className={styles.mbReqLabel}>{node.label}</span>
              {note && <span className={styles.mbReqNote}>{note}</span>}
            </div>
            <MbReqTree nodes={node.children} mbId={mbId} ledgerByCode={ledgerByCode} depth={depth + 1} />
          </div>
        );
      })}
    </>
  );
}

function shortDate(s: string | null): string {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
}

function longDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}
