/**
 * /admin/advancement/mb-progress/[mbId] — Admin drill-in for one MB.
 *
 * Scout × leaf-requirement grid with **clickable cells** — each cell links
 * to /admin/advancement/fast-entry?scout=…&mb=…&req=… so the leader can
 * sign off the missing req in one click. Filled cells (green ■) are also
 * clickable (they reopen Fast Entry to confirm + optionally undo).
 *
 * Also shows the catalog counselor list for the badge (from the new
 * merit_badge_counselors table) and the full requirement tree below.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  buildReqTree,
  flattenLeaves,
  topLevelCodeOf,
  bsaPageUrl,
  workbookUrl,
  type ReqNode
} from '@/lib/mb-helpers';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type {
  MeritBadge,
  MeritBadgeRequirement,
  Scout
} from '@/lib/supabase/types';
import styles from '../mb-progress.module.css';

const RANK_LABEL: Record<string, string> = {
  scout: 'Scout',
  tenderfoot: 'TF',
  'second-class': '2C',
  'first-class': '1C',
  star: 'Star',
  life: 'Life',
  eagle: 'Eagle'
};

export async function generateMetadata({
  params
}: {
  params: Promise<{ mbId: string }>;
}) {
  const { mbId } = await params;
  const supabase = await createClient();
  const { data: mb } = await supabase
    .from('merit_badges')
    .select('name')
    .eq('id', mbId)
    .maybeSingle();
  return {
    title: mb ? `${(mb as { name: string }).name} · MB Progress · Troop 79` : 'MB Progress'
  };
}

async function loadDetail(mbId: string) {
  const supabase = await createClient();
  const [mbRes, reqsRes, ledgerRows, scoutsRes, activeCountRes, counselorsRes, leadersRes] =
    await Promise.all([
      supabase.from('merit_badges').select('*').eq('id', mbId).maybeSingle(),
      supabase.from('merit_badge_requirements').select('*').eq('mb_id', mbId),
      // Unbounded past the ~1000-row PostgREST cap once a badge accumulates
      // enough history across every scout — paginate (lib/supabase/paginate.ts).
      fetchAllRows<{ scout_id: string; kind: string; code: string }>((from, to) =>
        supabase
          .from('ledger_entries')
          .select('scout_id, kind, code')
          .or(`code.like.${mbId}-%,code.eq.MB:${mbId}`)
          .is('archived_at', null)
          .is('deleted_at', null)
          .range(from, to)
      ),
      supabase.from('scouts').select('*').eq('active', true).order('display_name'),
      supabase.from('scouts').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase
        .from('merit_badge_counselors')
        .select('leader_code, sort_order')
        .eq('mb_id', mbId)
        .order('sort_order'),
      supabase.from('leaders').select('code, name')
    ]);

  if (!mbRes.data) return null;
  const mb = mbRes.data as MeritBadge;

  const reqTree = buildReqTree((reqsRes.data ?? []) as MeritBadgeRequirement[]);
  const leaves = flattenLeaves(reqTree);

  const byScout = new Map<string, { awarded: boolean; codes: Set<string> }>();
  for (const e of ledgerRows) {
    const slot = byScout.get(e.scout_id) ?? { awarded: false, codes: new Set<string>() };
    if (e.kind === 'merit_badge_award' && e.code === `MB:${mbId}`) {
      slot.awarded = true;
    } else if (e.code.startsWith(`${mbId}-`)) {
      slot.codes.add(e.code.slice(mbId.length + 1));
    }
    byScout.set(e.scout_id, slot);
  }

  const allScouts = (scoutsRes.data ?? []) as Scout[];
  const startedScouts = allScouts.filter((s) => byScout.has(s.id));

  const leaderNameByCode = new Map<string, string>();
  for (const l of (leadersRes.data ?? []) as { code: string; name: string }[]) {
    leaderNameByCode.set(l.code, l.name);
  }
  const counselors = ((counselorsRes.data ?? []) as { leader_code: string; sort_order: number }[]).map(
    (c) => ({
      code: c.leader_code,
      name: leaderNameByCode.get(c.leader_code) ?? c.leader_code
    })
  );

  return {
    mb,
    reqTree,
    leaves,
    allScouts,
    startedScouts,
    byScout,
    totalActive: activeCountRes.count ?? 0,
    counselors
  };
}

export default async function MbProgressDetailPage({
  params
}: {
  params: Promise<{ mbId: string }>;
}) {
  const { mbId } = await params;
  const data = await loadDetail(mbId);
  if (!data) notFound();

  const { mb, reqTree, leaves, startedScouts, byScout, totalActive, counselors } = data;
  const completedCount = startedScouts.filter((s) => byScout.get(s.id)!.awarded).length;
  const partialCount = startedScouts.length - completedCount;
  const notStarted = Math.max(totalActive - startedScouts.length, 0);

  // Group leaves by top-level parent code so the header can show parent spans.
  const groupOf = new Map<string, string>();
  for (const leaf of leaves) {
    const top = topLevelCodeOf(reqTree, leaf.code);
    if (top) groupOf.set(leaf.code, top);
  }
  const groups: { topCode: string; topLabel: string; leaves: ReqNode[] }[] = [];
  for (const top of reqTree) {
    const myLeaves = leaves.filter((l) => groupOf.get(l.code) === top.code);
    if (myLeaves.length > 0) {
      groups.push({ topCode: top.code, topLabel: top.label, leaves: myLeaves });
    }
  }

  return (
    <>
      <Link href="/admin/advancement/mb-progress" className={styles.backLink}>
        ← All Merit Badges
      </Link>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitle}>
          <h1>
            {mb.name}
            {mb.eagle && <span className={styles.eagleTag} style={{ marginLeft: 10 }}>Eagle</span>}
          </h1>
          <div className={styles.detailMeta}>
            Catalog id <code>{mb.id}</code>
            {mb.scoutbook_id && (
              <>
                {' · '}Scoutbook id <code>{mb.scoutbook_id}</code>
              </>
            )}
            {' · '}
            <Link
              href={`/admin/advancement/lookups`}
              style={{ color: 'var(--admin-navy)', textDecoration: 'underline' }}
            >
              Edit catalog
            </Link>
          </div>
        </div>
        <div className={styles.detailLinks}>
          <Link href={bsaPageUrl(mb)} className={styles.detailLink} target="_blank">
            BSA Page ↗
          </Link>
          <Link href={workbookUrl(mb)} className={styles.detailLink} target="_blank">
            Workbook ↗
          </Link>
        </div>
      </div>

      <div className={styles.statsStrip}>
        <Stat n={completedCount} label="Earned" />
        <Stat n={partialCount} label="In Progress" />
        <Stat n={notStarted} label="Not Started" />
        <Stat n={totalActive} label="Active Scouts" />
      </div>

      <div className={styles.counselors}>
        <div className={styles.counselorsLabel}>Registered counselors</div>
        {counselors.length === 0 ? (
          <span className={styles.counselorEmpty}>
            None assigned yet. Edit via Lookups &amp; Admin → Merit Badge Catalog → this badge.
          </span>
        ) : (
          <span className={styles.counselorList}>
            {counselors.map((c) => `${c.code} — ${c.name}`).join(' · ')}
          </span>
        )}
      </div>

      {startedScouts.length === 0 ? (
        <div
          style={{
            padding: '40px 24px',
            textAlign: 'center',
            fontStyle: 'italic',
            color: 'var(--admin-gray-500)',
            border: '1px solid var(--admin-gray-200)',
            borderRadius: 4,
            background: 'var(--admin-white)'
          }}
        >
          No scout has started this merit badge yet.
        </div>
      ) : (
        <>
          <p className={styles.legend}>
            <span className={styles.cellDone}>■</span> = signed off,{' '}
            <span className={styles.cellEmpty}>□</span> = not yet,{' '}
            <span className={styles.cellAwarded}>★</span> = full badge earned.
            Sign off requirements via Fast Entry.
          </p>
          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <thead>
                <tr className={styles.gridHead}>
                  <th rowSpan={2} className={styles.scoutCellHead}>Scout</th>
                  <th className={styles.awardCellHead}>Award</th>
                  {groups.map((g) => (
                    <th
                      key={`grp-${g.topCode}`}
                      colSpan={g.leaves.length}
                      title={g.topLabel}
                      className={styles.groupHeaderTop}
                    >
                      {g.topCode}
                    </th>
                  ))}
                </tr>
                <tr>
                  {/* Award's row-2 band — matches .codeHeader's sizing so the
                      combined height of the two stacked Award cells equals a
                      Req-group column's height exactly, instead of a
                      rowSpan={2} cell leaving mismatched blank space. */}
                  <th className={styles.awardSubCellHead} aria-hidden="true" />
                  {leaves.map((l) => (
                    <th key={`code-${l.code}`} className={styles.codeHeader} title={l.label}>
                      {leafShortCode(l.code)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {startedScouts.map((s) => {
                  const slot = byScout.get(s.id)!;
                  return (
                    <tr key={s.id}>
                      <td className={styles.scoutCell}>
                        <Link
                          href={`/scouts/${s.id}`}
                          className={styles.scoutLink}
                        >
                          {s.display_name}
                        </Link>
                        {s.current_rank && (
                          <span className={styles.scoutRank}>
                            {RANK_LABEL[s.current_rank] ?? s.current_rank}
                          </span>
                        )}
                      </td>
                      <td
                        className={`${styles.cellAward} ${slot.awarded ? styles.cellAwarded : styles.cellNotAwarded}`}
                        title={`${s.display_name} — ${slot.awarded ? 'badge awarded' : 'not yet awarded'}`}
                      >
                        {slot.awarded ? '★' : '☆'}
                      </td>
                      {leaves.map((l) => {
                        const done = slot.codes.has(l.code);
                        return (
                          <td
                            key={l.code}
                            className={`${styles.cellCode} ${done ? styles.cellDone : styles.cellEmpty}`}
                            title={`${s.display_name} — ${l.code} ${l.label}${done ? ' · signed off' : ''}`}
                          >
                            {done ? '■' : '□'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className={styles.reqList}>
        <h3>Requirements</h3>
        {flattenForList(reqTree).map((row) => (
          <div
            key={`${row.code}-${row.depth}`}
            className={`${styles.reqRow} ${row.depth > 0 ? styles.reqSub : ''}`}
          >
            <span className={styles.reqCode}>{row.code}</span>
            <span className={styles.reqLabel}>{row.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statValue}>{n}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function leafShortCode(fullCode: string): string {
  // The leaf's display code in the grid. For "2.1" → "1"; for "2a" → "2a"
  // (sub-numeric); just show the trailing piece for clarity.
  return fullCode;
}

function flattenForList(
  tree: ReqNode[],
  depth = 0
): { code: string; label: string; depth: number }[] {
  const out: { code: string; label: string; depth: number }[] = [];
  for (const n of tree) {
    out.push({ code: n.code, label: n.label, depth });
    if (n.children && n.children.length) out.push(...flattenForList(n.children, depth + 1));
  }
  return out;
}
