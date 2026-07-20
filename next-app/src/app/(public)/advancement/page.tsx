/**
 * /advancement — Troop-wide advancement tracker.
 *
 * Server Component: fetches active scouts + scout_summary aggregate + ranks
 * in parallel, then composes the full page (stats strip, rank distribution,
 * MB Progress CTA, sortable/filterable roster, leader CTA).
 *
 * Subsequent chunks fill in each section; this scaffold loads the data,
 * renders the header, and stubs the rest.
 */

import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import type { Scout, ScoutSummaryRow, Rank } from '@/lib/supabase/types';
import { publicScoutName } from '@/lib/scout-name';
import styles from './advancement.module.css';
import { RosterTable, type RosterRow } from './roster-table';

// No Dynamic API is used here, so Next silently prerendered this page as
// static HTML at build time — same bug as /merit-badges (see that page's
// comment): a rank award, promotion, or any other advancement change
// wouldn't show up here until the next deploy rebuilds the page.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Advancement Tracker — Scout Troop 79',
  description:
    "Every Troop 79 scout's rank progress, merit badges, leadership, service hours, and camping nights."
};

interface AdvancementData {
  scouts: Scout[];
  summary: Map<string, ScoutSummaryRow>;
  ranks: Rank[];
}

async function loadData(): Promise<AdvancementData | null> {
  const supabase = createAdminClient();
  const [scoutsRes, summaryRes, ranksRes] = await Promise.all([
    supabase.from('scouts').select('*').eq('active', true).order('display_name'),
    supabase.from('scout_summary').select('*'),
    supabase.from('ranks').select('*').order('sort_order')
  ]);

  if (scoutsRes.error || summaryRes.error || ranksRes.error) {
    console.error('advancement load error:', scoutsRes.error, summaryRes.error, ranksRes.error);
    return null;
  }

  const summary = new Map<string, ScoutSummaryRow>();
  for (const row of (summaryRes.data ?? []) as ScoutSummaryRow[]) {
    summary.set(row.scout_id, row);
  }

  return {
    scouts: (scoutsRes.data ?? []) as Scout[],
    summary,
    ranks: (ranksRes.data ?? []) as Rank[]
  };
}

export default async function AdvancementPage() {
  const data = await loadData();

  return (
    <>
      <div className={styles.pageHeader}>
        <h1>Advancement Tracker</h1>
        <p className={styles.pageHeaderLede}>
          Every Troop 79 scout&rsquo;s rank progress, merit badges, leadership,
          service hours, and camping nights &mdash; the same record their
          parents, scoutmasters, and Boards of Review use. Tap any scout to
          open their full Clipboard report.
        </p>
        <div className={styles.pageHeaderRule} />
      </div>

      <main className={styles.main}>
        {!data ? (
          <p
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--text-meta)',
              fontStyle: 'italic'
            }}
          >
            Could not load advancement data. Try again later.
          </p>
        ) : (
          <>
            <StatsStrip data={data} />
            <SectionDivider label="Current Rank Distribution" />
            <RankGrid data={data} />
            <SectionDivider label="Merit Badge Progress" />
            <MbProgressCta />
            <SectionDivider label="Troop Roster" />
            <Roster data={data} />
            <LeaderCta />
          </>
        )}
      </main>
    </>
  );
}

function StatsStrip({ data }: { data: AdvancementData }) {
  let mb = 0,
    eagle = 0,
    nights = 0,
    service = 0;
  for (const s of data.scouts) {
    const row = data.summary.get(s.id);
    if (!row) continue;
    mb += row.mb_count;
    eagle += row.eagle_mb_count;
    nights += row.camping_nights;
    service += row.service_hours;
  }
  return (
    <div className={styles.statsStrip} aria-label="Troop-wide statistics">
      <Stat value={data.scouts.length} label="Active Scouts" />
      <Stat value={mb} label="Merit Badges Earned" />
      <Stat value={nights} label="Nights of Camping" />
      <Stat value={service} label="Service Hours" />
      <Stat value={eagle} label="Eagle-Required MBs" />
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statNum}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className={styles.sectionDivider}>
      <span className={styles.divLabel}>{label}</span>
      <span className={styles.divRule} aria-hidden="true" />
    </div>
  );
}

function buildRosterRows(data: AdvancementData): RosterRow[] {
  const rankIndex = new Map<string, { sort: number; label: string }>();
  data.ranks.forEach((r) =>
    rankIndex.set(r.id, { sort: r.sort_order, label: r.display_name })
  );
  return data.scouts.map((s) => {
    const sum = data.summary.get(s.id);
    const rank = s.current_rank ? rankIndex.get(s.current_rank) : null;
    return {
      id: s.id,
      displayName: s.display_name,
      publicName: publicScoutName(s),
      patrol: s.patrol,
      currentRank: s.current_rank,
      currentRankLabel: rank?.label ?? '—',
      mbCount: sum?.mb_count ?? 0,
      eagleMbCount: sum?.eagle_mb_count ?? 0,
      campingNights: sum?.camping_nights ?? 0,
      serviceHours: sum?.service_hours ?? 0,
      lastActivity: s.last_activity,
      rankSortIndex: rank?.sort ?? -1
    };
  });
}

function Roster({ data }: { data: AdvancementData }) {
  const rows = buildRosterRows(data);
  const patrols = Array.from(
    new Set(rows.map((r) => r.patrol).filter((p): p is string => Boolean(p)))
  ).sort();
  const rankOptions = data.ranks.map((r) => ({ id: r.id, label: r.display_name }));
  return <RosterTable rows={rows} rankOptions={rankOptions} patrols={patrols} />;
}

function LeaderCta() {
  return (
    <div className={styles.leaderCta}>
      <div>
        <h3>For Advancement Chairs &amp; Adult Leaders</h3>
        <p>
          Bulk entry, event roster check-ins, Court of Honor prep, Scoutbook
          export, and the universal ledger live in the Leader Workspace. Sign
          in to use them.
        </p>
      </div>
      <Link href="/admin/advancement" className={styles.leaderCtaLink}>
        Open Leader Workspace &rarr;
      </Link>
    </div>
  );
}

function MbProgressCta() {
  return (
    <Link href="/merit-badges" className={styles.mbCta}>
      <div className={styles.mbCtaInner}>
        <div>
          <div className={styles.mbCtaTitle}>See every merit badge &rarr;</div>
          <div className={styles.mbCtaLede}>
            Browse all 32 merit badges with current troop progress &mdash; who&rsquo;s
            earned each one, who&rsquo;s in the middle, requirement by requirement.
          </div>
        </div>
        <div className={styles.mbCtaPill}>Open Catalog</div>
      </div>
    </Link>
  );
}

function RankGrid({ data }: { data: AdvancementData }) {
  const counts = new Map<string, number>();
  for (const r of data.ranks) counts.set(r.id, 0);
  for (const s of data.scouts) {
    if (s.current_rank && counts.has(s.current_rank)) {
      counts.set(s.current_rank, counts.get(s.current_rank)! + 1);
    }
  }
  return (
    <div className={styles.rankGrid} aria-label="Rank distribution">
      {data.ranks.map((r) => {
        const n = counts.get(r.id) ?? 0;
        return (
          <div key={r.id} className={styles.rankTile}>
            <div className={styles.rankTileName}>{r.display_name}</div>
            <div className={styles.rankTileCount}>{n}</div>
            <div className={styles.rankTileSub}>{n === 1 ? 'scout' : 'scouts'}</div>
          </div>
        );
      })}
    </div>
  );
}
