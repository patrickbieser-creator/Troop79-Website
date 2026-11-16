/**
 * Home's three bottom cards, moved from the retired Advancement dashboard (Plans/Admin-Portal-Nav.md decision 7):
 * Recent ledger activity, Likely ready for review, and Recent logins. Each is its own async server component, rendered
 * by Home inside its own <Suspense>, so the top of Home never waits on these reads (the ledger reads are heavy and
 * live). The scouts list and the catalog both cards need are read once per request (cache()).
 */
import { cache } from 'react';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import type { LedgerEntry, LedgerKind } from '@/lib/supabase/types';
import { loadRecentLogins, loadHouseholdsSignedInStats, type LoginMethod } from '@/lib/login-events';
import { fmtDate, fmtDateTime } from '@/lib/format-date';
import styles from '../advancement/dashboard/dashboard.module.css';

const RECENT_LIMIT = 10;
const LIKELY_READY_THRESHOLD = 0.6; // 60% of next-rank reqs done → surface

interface ScoutLite {
  id: string;
  display_name: string;
  current_rank: string | null;
  active: boolean;
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

const loadScouts = cache(async (): Promise<ScoutLite[]> => {
  const { data, error } = await createAdminClient().from('scouts').select('id, display_name, current_rank, active');
  if (error) throw new Error(`scouts read failed: ${error.message}`);
  return (data ?? []) as ScoutLite[];
});

function shortLabelFor(row: LedgerEntry, rankReqMap: Map<string, string>, rankNameMap: Map<string, string>, mbNameMap: Map<string, string>): string {
  switch (row.kind) {
    case 'rank_requirement':
      return rankReqMap.get(row.code) ?? row.label ?? row.code;
    case 'rank_award':
      return rankReqMap.get(`${row.code}-BoR`) ?? `Board of Review - ${rankNameMap.get(row.code) ?? row.code}`;
    case 'merit_badge_award': {
      const colon = row.code.indexOf(':');
      const id = colon >= 0 ? row.code.slice(colon + 1) : row.code;
      return mbNameMap.get(id) ?? row.label ?? row.code;
    }
    default:
      return row.label ?? row.code;
  }
}

export async function RecentLedgerCard() {
  const supabase = createAdminClient();
  const [scouts, catalog, recentRes] = await Promise.all([
    loadScouts(),
    loadAdvancementCatalog(),
    supabase
      .from('reportable_ledger')
      .select('*')
      .order('entered_at', { ascending: false, nullsFirst: false })
      .order('date', { ascending: false })
      .limit(RECENT_LIMIT)
  ]);
  const scoutName = new Map(scouts.map((s) => [s.id, s.display_name]));
  const rankReqShort = new Map(catalog.rankRequirements.filter((r) => r.parent_id === null).map((r) => [`${r.rank_id}-${r.code}`, r.label]));
  const rankName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));
  const mbName = new Map(catalog.meritBadges.map((m) => [m.id, m.name]));
  const rows = ((recentRes.data ?? []) as LedgerEntry[]).map((e) => ({
    id: e.id,
    date: e.date,
    scoutId: e.scout_id,
    scoutName: scoutName.get(e.scout_id) ?? e.scout_id,
    kindLabel: KIND_PRETTY[e.kind] ?? e.kind,
    shortLabel: shortLabelFor(e, rankReqShort, rankName, mbName),
    by: e.by
  }));

  return (
    <section className={styles.card} aria-labelledby="home-recent-ledger">
      <div className={styles.cardHeader}>
        <h2 id="home-recent-ledger">Recent ledger activity</h2>
        <Link href="/admin/advancement/ledger" className={styles.cardHeaderLink}>
          View all →
        </Link>
      </div>
      {rows.length === 0 ? (
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
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={styles.dateCell}>{fmtDate(r.date)}</td>
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
    </section>
  );
}

interface ReadyRow {
  scoutId: string;
  scoutName: string;
  nextRankLabel: string;
  completed: number;
  total: number;
  pct: number;
  remaining: string[];
}

export async function LikelyReadyCard() {
  const supabase = createAdminClient();
  const [scouts, catalog, rankReqLedger] = await Promise.all([
    loadScouts(),
    loadAdvancementCatalog(),
    // Unbounded past the ~1000-row PostgREST cap once the ledger grows: paginate.
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase.from('reportable_ledger').select('scout_id, code').eq('kind', 'rank_requirement').order('id').range(from, to)
    )
  ]);
  const ranks = catalog.ranks;
  const rankReqs = catalog.rankRequirements.filter((r) => r.parent_id === null);
  const ledgerByScout = new Map<string, Set<string>>();
  for (const l of rankReqLedger) {
    if (!ledgerByScout.has(l.scout_id)) ledgerByScout.set(l.scout_id, new Set());
    ledgerByScout.get(l.scout_id)!.add(l.code);
  }
  const catalogByRank = new Map<string, { code: string; label: string }[]>();
  for (const r of rankReqs) {
    if (!catalogByRank.has(r.rank_id)) catalogByRank.set(r.rank_id, []);
    catalogByRank.get(r.rank_id)!.push({ code: r.code, label: r.label });
  }
  const rows: ReadyRow[] = [];
  for (const s of scouts.filter((x) => x.active)) {
    const currentSort = ranks.find((r) => r.id === s.current_rank)?.sort_order ?? -1;
    const nextRank = ranks.find((r) => r.sort_order === currentSort + 1);
    if (!nextRank) continue;
    const reqs = catalogByRank.get(nextRank.id) ?? [];
    if (reqs.length === 0) continue;
    const codes = ledgerByScout.get(s.id) ?? new Set<string>();
    const done = reqs.filter((r) => codes.has(`${nextRank.id}-${r.code}`));
    const pct = done.length / reqs.length;
    if (pct < LIKELY_READY_THRESHOLD) continue;
    rows.push({
      scoutId: s.id,
      scoutName: s.display_name,
      nextRankLabel: nextRank.display_name,
      completed: done.length,
      total: reqs.length,
      pct,
      remaining: reqs.filter((r) => !codes.has(`${nextRank.id}-${r.code}`)).map((r) => `${r.code} ${r.label}`)
    });
  }
  rows.sort((a, b) => b.pct - a.pct || a.scoutName.localeCompare(b.scoutName));

  return (
    <section className={styles.card} aria-labelledby="home-likely-ready">
      <div className={styles.cardHeader}>
        <h2 id="home-likely-ready">Likely ready for review</h2>
      </div>
      <div className={styles.note}>
        <strong>Note:</strong> Ranks are never auto-awarded. These are scouts who&rsquo;ve checked most boxes for the next
        rank &mdash; verify with the official requirement list before scheduling a BoR.
      </div>
      {rows.length === 0 ? (
        <div className={styles.empty}>
          No scouts above the {Math.round(LIKELY_READY_THRESHOLD * 100)}% completion threshold for their next rank.
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
            {rows.map((r) => {
              const left = r.total - r.completed;
              const borOnly = left === 1 && r.remaining.some((x) => /\bBoR\b/.test(x));
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
                        // inline: dynamic — bar width is the computed percentage
                        style={{ width: `${Math.round(r.pct * 100)}%` }}
                      />
                    </span>
                    {`${r.completed}/${r.total}`}
                  </td>
                  <td className={styles.suggestedAction}>
                    {borOnly ? <span className={styles.suggestBor}>Schedule BoR</span> : `${left} requirement${left === 1 ? '' : 's'} left`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

const METHOD_LABEL: Record<LoginMethod, string> = {
  link: 'Email link',
  code: 'Code',
  passkey: 'Passkey',
  // Never a successful login: a Bugle-link resolve that found nobody (lib/signin-hint.ts); failed list only.
  hint: 'Bugle link'
};

export async function RecentLoginsCard() {
  const [recentLogins, households] = await Promise.all([
    loadRecentLogins(createAdminClient(), 15),
    loadHouseholdsSignedInStats(createAdminClient())
  ]);
  return (
    <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="home-recent-logins">
      <div className={styles.cardHeader}>
        <h2 id="home-recent-logins">Recent logins</h2>
        <Link href="/admin/reports/sign-ins" className={styles.cardHeaderLink}>
          View all →
        </Link>
      </div>
      <p className={styles.cardSubLine}>
        {households.signedIn} of {households.total} households have signed in at least once
      </p>
      {recentLogins.length === 0 ? (
        <div className={styles.empty}>No logins recorded yet.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Person</th>
              <th>Role</th>
              <th>Method</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {recentLogins.map((e) => (
              <tr key={e.id}>
                <td className={styles.dateCell}>{fmtDateTime(e.createdAt)}</td>
                <td className={styles.scoutCell}>
                  {e.personName ?? 'Unknown'}
                  {e.isFirstLogin && <span className={styles.kindPill}>First login</span>}
                  {e.sentByLeader && <span className={styles.cardSubLine}> via link sent by {e.sentByLeader}</span>}
                </td>
                <td>{e.roleSnapshot === 'leader' ? 'Leader' : 'Family'}</td>
                <td>
                  <span className={styles.kindPill}>{METHOD_LABEL[e.method]}</span>
                </td>
                <td>{e.deviceLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
