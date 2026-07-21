/**
 * /admin/advancement/dashboard — Leader Dashboard.
 *
 * Operational overview for the advancement chair. Numbers update from the
 * universal ledger. Mirrors the prototype's Dashboard screen.
 *
 * Server Component. Loads everything in parallel.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { requireRole } from '@/lib/require-role';
import type { LedgerEntry, LedgerKind } from '@/lib/supabase/types';
import { loadAttentionCategories } from './attention-items';
import styles from './dashboard.module.css';

const RECENT_LIMIT = 10;
const LIKELY_READY_THRESHOLD = 0.6; // 60% of next-rank reqs done → surface

interface ScoutLite {
  id: string;
  display_name: string;
  current_rank: string | null;
  bsa_member_id: string | null;
  active: boolean;
}

interface RankLite {
  id: string;
  display_name: string;
  sort_order: number;
}

interface RecentRow {
  id: number;
  date: string | null;
  scoutId: string;
  scoutName: string;
  kind: LedgerKind;
  kindLabel: string;
  shortLabel: string;
  by: string | null;
}

interface ReadyRow {
  scoutId: string;
  scoutName: string;
  currentRankLabel: string;
  nextRankLabel: string;
  completed: number;
  total: number;
  pct: number;
  remaining: string[];
}

const KIND_PRETTY: Record<LedgerKind, string> = {
  rank_requirement: 'Rank req',
  rank_award: 'Rank',
  merit_badge_requirement: 'MB req',
  merit_badge_award: 'MB',
  service_hours: 'Service',
  camping_nights: 'Campout',
  hiking_miles: 'Hike',
  day_outing: 'Day Outing',
  fundraiser: 'Fundraiser',
  leadership: 'Leader',
  award: 'Award',
  meeting_attendance: 'Meeting'
};

export const metadata = {
  title: 'Leader Dashboard — Troop 79'
};

async function loadDashboard() {
  const supabase = createAdminClient();
  const [
    scoutsRes,
    ranksRes,
    rankReqsRes,
    rankReqLedger,
    mbCatRes,
    recentRes,
    activeLedgerCountRes,
    cohRes
  ] = await Promise.all([
    supabase.from('scouts').select('id, display_name, current_rank, bsa_member_id, active'),
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('rank_id, code, label')
      .is('parent_id', null),
    // Unbounded past the ~1000-row PostgREST cap once the ledger grows —
    // paginate rather than silently see a partial slice (see lib/supabase/paginate.ts).
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code')
        .eq('kind', 'rank_requirement')
        .range(from, to)
    ),
    supabase.from('merit_badges').select('id, name'),
    supabase
      .from('ledger_active')
      .select('*')
      .order('entered_at', { ascending: false, nullsFirst: false })
      .order('date', { ascending: false })
      .limit(RECENT_LIMIT),
    supabase.from('ledger_active').select('id', { count: 'exact', head: true }),
    supabase.from('coh_history').select('date').order('date', { ascending: false }).limit(1)
  ]);

  const scouts = (scoutsRes.data ?? []) as ScoutLite[];
  const activeScouts = scouts.filter((s) => s.active);
  const ranks = (ranksRes.data ?? []) as RankLite[];
  const rankReqs = (rankReqsRes.data ?? []) as Array<{
    rank_id: string;
    code: string;
    label: string;
  }>;
  const mbMap = new Map<string, string>();
  for (const m of (mbCatRes.data ?? []) as Array<{ id: string; name: string }>) {
    mbMap.set(m.id, m.name);
  }
  const recent = (recentRes.data ?? []) as LedgerEntry[];
  const totalLedger = activeLedgerCountRes.count ?? 0;
  const lastCohDate = (cohRes.data?.[0]?.date as string | undefined) ?? null;

  // ── Stats ──────────────────────────────────────────────────────────
  const missingBsa = activeScouts.filter((s) => !s.bsa_member_id).length;
  // COH Candidates: rank_award + merit_badge_award entries since the last COH.
  let cohCandidates = 0;
  if (lastCohDate) {
    const sinceRes = await supabase
      .from('ledger_active')
      .select('id', { count: 'exact', head: true })
      .gt('date', lastCohDate)
      .in('kind', ['rank_award', 'merit_badge_award']);
    cohCandidates = sinceRes.count ?? 0;
  } else {
    // No COH history yet — count everything that would go in the first one.
    const allRes = await supabase
      .from('ledger_active')
      .select('id', { count: 'exact', head: true })
      .in('kind', ['rank_award', 'merit_badge_award']);
    cohCandidates = allRes.count ?? 0;
  }

  // ── Recent activity ────────────────────────────────────────────────
  const scoutMap = new Map<string, string>();
  for (const s of scouts) scoutMap.set(s.id, s.display_name);
  const rankReqShortByKey = new Map<string, string>();
  for (const r of rankReqs) rankReqShortByKey.set(`${r.rank_id}-${r.code}`, r.label);
  const rankNameById = new Map<string, string>();
  for (const r of ranks) rankNameById.set(r.id, r.display_name);

  const recentRows: RecentRow[] = recent.map((e) => ({
    id: e.id,
    date: e.date,
    scoutId: e.scout_id,
    scoutName: scoutMap.get(e.scout_id) ?? e.scout_id,
    kind: e.kind,
    kindLabel: KIND_PRETTY[e.kind] ?? e.kind,
    shortLabel: shortLabelFor(e, rankReqShortByKey, rankNameById, mbMap),
    by: e.by
  }));

  // ── Likely Ready for Review ────────────────────────────────────────
  // For each active scout, find their next rank (sort_order = current+1, or
  // 'scout' if no current_rank). Compute completion of that rank's top-level
  // requirements based on rank_requirement ledger codes (`<rank>-<code>`).

  // Index ledger reqs by scout → set of req-codes (already prefixed with rank).
  const ledgerByScout = new Map<string, Set<string>>();
  for (const l of rankReqLedger) {
    if (!ledgerByScout.has(l.scout_id)) ledgerByScout.set(l.scout_id, new Set());
    ledgerByScout.get(l.scout_id)!.add(l.code);
  }
  // Group rank_requirements catalog by rank_id.
  const catalogByRank = new Map<string, Array<{ code: string; label: string }>>();
  for (const r of rankReqs) {
    if (!catalogByRank.has(r.rank_id)) catalogByRank.set(r.rank_id, []);
    catalogByRank.get(r.rank_id)!.push({ code: r.code, label: r.label });
  }

  const readyRows: ReadyRow[] = [];
  for (const s of activeScouts) {
    const currentSort =
      ranks.find((r) => r.id === s.current_rank)?.sort_order ?? -1;
    const nextRank = ranks.find((r) => r.sort_order === currentSort + 1);
    if (!nextRank) continue; // already at Eagle (or unknown — skip)
    const reqs = catalogByRank.get(nextRank.id) ?? [];
    if (reqs.length === 0) continue;
    const scoutCodes = ledgerByScout.get(s.id) ?? new Set<string>();
    const completed = reqs.filter((r) => scoutCodes.has(`${nextRank.id}-${r.code}`));
    const pct = completed.length / reqs.length;
    if (pct < LIKELY_READY_THRESHOLD) continue;
    const remaining = reqs
      .filter((r) => !scoutCodes.has(`${nextRank.id}-${r.code}`))
      .map((r) => `${r.code} ${r.label}`);
    readyRows.push({
      scoutId: s.id,
      scoutName: s.display_name,
      currentRankLabel:
        rankNameById.get(s.current_rank ?? '') ?? '— (no rank)',
      nextRankLabel: nextRank.display_name,
      completed: completed.length,
      total: reqs.length,
      pct,
      remaining
    });
  }
  // Sort by completion descending, then name.
  readyRows.sort((a, b) => b.pct - a.pct || a.scoutName.localeCompare(b.scoutName));

  return {
    stats: {
      activeScouts: activeScouts.length,
      totalLedger,
      cohCandidates,
      missingBsa,
      lastCohDate
    },
    recentRows,
    readyRows
  };
}

function shortLabelFor(
  row: LedgerEntry,
  rankReqMap: Map<string, string>,
  rankNameMap: Map<string, string>,
  mbNameMap: Map<string, string>
): string {
  switch (row.kind) {
    case 'rank_requirement': {
      const s = rankReqMap.get(row.code);
      if (s) return s;
      return row.label ?? row.code;
    }
    case 'rank_award': {
      const s = rankReqMap.get(`${row.code}-BoR`);
      if (s) return s;
      const rn = rankNameMap.get(row.code) ?? row.code;
      return `Board of Review - ${rn}`;
    }
    case 'merit_badge_award': {
      const colon = row.code.indexOf(':');
      const id = colon >= 0 ? row.code.slice(colon + 1) : row.code;
      return mbNameMap.get(id) ?? row.label ?? row.code;
    }
    default:
      return row.label ?? row.code;
  }
}

function shortDate(s: string | null): string {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
}

export default async function DashboardPage() {
  await requireRole(['leader']);
  const [data, attentionCategories] = await Promise.all([loadDashboard(), loadAttentionCategories()]);

  return (
    <>
      <div className={styles.attentionCard}>
        <h3>Needs Attention</h3>
        {attentionCategories.length === 0 ? (
          <p className={styles.attentionEmpty}>All caught up — nothing awaiting review.</p>
        ) : (
          attentionCategories.map((cat) => (
            <div key={cat.key} className={styles.attentionGroup}>
              <div className={styles.attentionGroupLabel}>
                {cat.label} ({cat.items.length})
              </div>
              <ul className={styles.attentionList}>
                {cat.items.map((item, i) => (
                  <li key={i}>
                    <Link href={item.href}>{item.label}</Link>
                    <span className={styles.attentionMeta}>{item.meta}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className={styles.pageTitle}>
        <div>
          <h1>Leader Dashboard</h1>
          <p>
            Operational overview for the advancement chair. Numbers update
            from the universal ledger.
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/admin/advancement/ledger" className={styles.btn}>
            View Ledger
          </Link>
          <Link href="/admin/advancement/lookups" className={styles.btn}>
            Lookups
          </Link>
        </div>
      </div>

      <div className={styles.stats}>
        <Stat
          label="Active Scouts"
          value={data.stats.activeScouts}
          sub="across all patrols"
        />
        <Stat
          label="Ledger Entries"
          value={data.stats.totalLedger}
          sub="live entries on the ledger"
        />
        <Stat
          label="COH Candidates"
          value={data.stats.cohCandidates}
          sub={
            data.stats.lastCohDate
              ? `since ${data.stats.lastCohDate}`
              : 'no prior COH on file'
          }
        />
        <Stat
          label="Missing BSA IDs"
          value={data.stats.missingBsa}
          sub="blocks Scoutbook export"
          warn={data.stats.missingBsa > 0}
        />
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h3>Recent Ledger Activity</h3>
            <Link href="/admin/advancement/ledger" className={styles.cardHeaderLink}>
              View all →
            </Link>
          </div>
          {data.recentRows.length === 0 ? (
            <div className={styles.empty}>No ledger entries yet.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Scout</th>
                  <th>Entry</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRows.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.dateCell}>{shortDate(r.date)}</td>
                    <td className={styles.scoutCell}>
                      <Link href={`/scouts/${r.scoutId}`}>{r.scoutName}</Link>
                    </td>
                    <td>
                      <span className={styles.kindPill}>{r.kindLabel}</span>
                      <span className={styles.entryDesc}>{r.shortLabel}</span>
                    </td>
                    <td>{r.by ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h3>Likely Ready for Review</h3>
          </div>
          <div className={styles.note}>
            <strong>Note:</strong> Ranks are never auto-awarded. These are
            scouts who&rsquo;ve checked most boxes for the next rank &mdash;
            verify with the official requirement list before scheduling a BoR.
          </div>
          {data.readyRows.length === 0 ? (
            <div className={styles.empty}>
              No scouts above the {Math.round(LIKELY_READY_THRESHOLD * 100)}%
              completion threshold for their next rank.
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Scout</th>
                  <th>Next Rank</th>
                  <th>Progress</th>
                  <th>Suggested Action</th>
                </tr>
              </thead>
              <tbody>
                {data.readyRows.map((r) => {
                  const pctLabel = `${r.completed}/${r.total}`;
                  const remainingCount = r.total - r.completed;
                  const borOnly =
                    remainingCount === 1 &&
                    r.remaining.some((s) => /\bBoR\b/.test(s));
                  return (
                    <tr key={r.scoutId}>
                      <td className={styles.scoutCell}>
                        <Link href={`/scouts/${r.scoutId}`}>{r.scoutName}</Link>
                      </td>
                      <td>{r.nextRankLabel}</td>
                      <td>
                        <span className={styles.progress}>
                          <span
                            className={styles.progressFill}
                            style={{ width: `${Math.round(r.pct * 100)}%` }}
                          />
                        </span>
                        {pctLabel}
                      </td>
                      <td className={styles.suggestedAction}>
                        {borOnly ? (
                          <span className={styles.suggestBor}>Schedule BoR</span>
                        ) : (
                          `${remainingCount} requirement${remainingCount === 1 ? '' : 's'} left`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  warn
}: {
  label: string;
  value: number | string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={`${styles.statValue} ${warn ? styles.statValueWarn : ''}`}>
        {value}
      </div>
      <div className={styles.statSub}>{sub}</div>
    </div>
  );
}
