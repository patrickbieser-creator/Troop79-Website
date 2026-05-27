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
  type ScoutDetail,
  type RankReqCatalogRow
} from '@/lib/scout-detail';
import type { LedgerEntry } from '@/lib/supabase/types';
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
    ledger.attendance.length +
    ledger.campingNights.length +
    ledger.hikingMiles.length;
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
  const currentIdx = ranks.findIndex((r) => r.id === scout.current_rank);
  return (
    <div className={styles.rankTimeline}>
      {ranks.map((r, idx) => {
        const isCurrent = idx === currentIdx;
        const isEarned = currentIdx >= 0 && idx < currentIdx;
        const cls = isCurrent
          ? styles.current
          : isEarned
            ? styles.earned
            : styles.unattempted;
        return (
          <div key={r.id} className={`${styles.rankStep} ${cls}`}>
            {(isEarned || isCurrent) && (
              <div className={styles.pin}>{isCurrent ? '★' : '✓'}</div>
            )}
            <div className={styles.rankStepName}>{r.display_name}</div>
            <div className={styles.rankStepDate}>
              {isCurrent ? 'In progress' : isEarned ? 'Earned' : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
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
  // Group catalog rows by rank for the 3-column render.
  const catalogByRank = new Map<string, RankReqCatalogRow[]>();
  for (const r of detail.rankReqs) {
    const list = catalogByRank.get(r.rank_id) ?? [];
    list.push(r);
    catalogByRank.set(r.rank_id, list);
  }
  // Show every rank that has any catalog entries — the same set for every
  // scout, so a "needs to do" report is complete.
  const ranksToShow = detail.ranks.filter((r) => (catalogByRank.get(r.id)?.length ?? 0) > 0);
  const todayShort = new Date().toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  });

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
          {ranksToShow.map((r) => (
            <RankBlock
              key={r.id}
              rankId={r.id}
              label={r.display_name}
              catalog={catalogByRank.get(r.id) ?? []}
              ledgerByCode={ledgerByCode}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function RankBlock({
  rankId,
  label,
  catalog,
  ledgerByCode
}: {
  rankId: string;
  label: string;
  catalog: RankReqCatalogRow[];
  ledgerByCode: Map<string, LedgerEntry>;
}) {
  return (
    <div className={styles.rankBlock}>
      <div className={styles.rankBlockTitle}>{label}</div>
      {catalog.length === 0 ? (
        <div className={styles.miniEmpty}>No requirements catalogued.</div>
      ) : (
        catalog.map((req) => {
          const ledger = ledgerByCode.get(`${rankId}-${req.code}`);
          const earned = !!ledger;
          const isBor =
            req.code.toLowerCase() === 'bor' || /board of review/i.test(req.label);
          const fullText = ledger?.label ?? req.label;
          return (
            <div
              key={`${rankId}-${req.code}`}
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
        })
      )}
    </div>
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
  // Merge attendance + camping_nights + hiking_miles into one list, sorted.
  type ActRow = {
    id: number;
    date: string | null;
    type: string;
    title: string;
    notes: string | null;
  };
  const acts: ActRow[] = [
    ...detail.ledger.attendance.map((e) => ({
      id: e.id,
      date: e.date,
      type: 'Event',
      title: e.label ?? e.code,
      notes: e.notes
    })),
    ...detail.ledger.campingNights.map((e) => ({
      id: e.id,
      date: e.date,
      type: 'Camping',
      title: `${e.label ?? e.code} (${e.qty} night${e.qty === 1 ? '' : 's'})`,
      notes: e.notes
    })),
    ...detail.ledger.hikingMiles.map((e) => ({
      id: e.id,
      date: e.date,
      type: 'Hike',
      title: `${e.label ?? e.code} (${e.qty} mi)`,
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
