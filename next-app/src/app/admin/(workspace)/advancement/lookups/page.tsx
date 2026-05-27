/**
 * /admin/advancement/lookups — Reference tables. Each card has an editor:
 *   - Scouts: edit (modal) + add new
 *   - Leaders: edit (modal) + add new + delete (if no ledger references)
 *   - Merit Badges: edit (modal)
 *   - Internal Requirement Codes: read-only (catalog tree is tricky to edit
 *     inline; ships in a later slice)
 */

import { createAdminClient } from '@/lib/supabase/server';
import { LeaderEditor, type LeaderRow } from './leader-editor';
import { ScoutEditor, type ScoutRow, type ParentRow } from './scout-editor';
import { MbEditor, type MbRow, type CounselorRow, type EditReqNode } from './mb-editor';
import styles from './lookups.module.css';

interface MbReqRowFull {
  id: number;
  mb_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
}

function buildEditTree(rows: MbReqRowFull[]): EditReqNode[] {
  const byParent = new Map<number | null, MbReqRowFull[]>();
  for (const r of rows) {
    const list = byParent.get(r.parent_id) ?? [];
    list.push(r);
    byParent.set(r.parent_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  function build(parentId: number | null): EditReqNode[] {
    const kids = byParent.get(parentId) ?? [];
    return kids.map((k) => ({
      id: k.id,
      code: k.code,
      originalCode: k.code,
      label: k.label,
      complete_rule: k.complete_rule,
      complete_n: k.complete_n,
      children: build(k.id)
    }));
  }
  return build(null);
}

export const metadata = {
  title: 'Lookups & Admin — Troop 79'
};

interface ReqRow {
  source: 'rank' | 'mb';
  parentId: string;
  parentLabel: string;
  code: string;
  label: string;
}

async function loadLookups() {
  const supabase = createAdminClient();

  const [
    leadersRes,
    scoutsRes,
    parentsRes,
    mbsRes,
    counselorsRes,
    ranksRes,
    rankReqsRes,
    mbReqsRes,
    mbReqsFullRes
  ] = await Promise.all([
    supabase.from('leaders').select('*').order('code'),
    supabase
      .from('scouts')
      .select(
        'id, first_name, last_name, display_name, patrol, current_rank, bsa_member_id, active, inactive_reason, address_line1, address_line2, city, state, zip, phone, email, health_form_date'
      )
      .order('display_name'),
    supabase.from('scout_parents').select('*').order('sort_order'),
    supabase
      .from('merit_badges')
      .select('id, name, eagle, scoutbook_id, bsa_page_url, workbook_url')
      .order('name'),
    supabase
      .from('merit_badge_counselors')
      .select('mb_id, leader_code, sort_order')
      .order('mb_id')
      .order('sort_order'),
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('rank_id, code, label')
      .is('parent_id', null)
      .order('rank_id'),
    supabase
      .from('merit_badge_requirements')
      .select('mb_id, code, label')
      .is('parent_id', null)
      .order('mb_id'),
    supabase
      .from('merit_badge_requirements')
      .select('id, mb_id, parent_id, code, label, complete_rule, complete_n, sort_order')
      .order('mb_id')
      .order('sort_order')
  ]);

  // Group parents by scout
  const parentsByScout = new Map<string, ParentRow[]>();
  for (const p of (parentsRes.data ?? []) as ParentRow[]) {
    const list = parentsByScout.get(p.scout_id) ?? [];
    list.push(p);
    parentsByScout.set(p.scout_id, list);
  }
  // Group counselors by MB
  const counselorsByMb = new Map<string, CounselorRow[]>();
  for (const c of (counselorsRes.data ?? []) as CounselorRow[]) {
    const list = counselorsByMb.get(c.mb_id) ?? [];
    list.push(c);
    counselorsByMb.set(c.mb_id, list);
  }

  // Build MB requirement trees for the editor.
  type MbReqRowFull = {
    id: number;
    mb_id: string;
    parent_id: number | null;
    code: string;
    label: string;
    complete_rule: 'all' | 'any' | 'n-of';
    complete_n: number | null;
    sort_order: number;
  };
  const reqsByMb = new Map<string, MbReqRowFull[]>();
  for (const r of (mbReqsFullRes.data ?? []) as MbReqRowFull[]) {
    const list = reqsByMb.get(r.mb_id) ?? [];
    list.push(r);
    reqsByMb.set(r.mb_id, list);
  }
  const mbReqTrees = new Map<string, EditReqNode[]>();
  for (const [mbId, rows] of reqsByMb.entries()) {
    mbReqTrees.set(mbId, buildEditTree(rows));
  }

  const ranks = (ranksRes.data ?? []) as { id: string; display_name: string; sort_order: number }[];
  const rankLabels = new Map(ranks.map((r) => [r.id, r.display_name]));
  const mbs = (mbsRes.data ?? []) as MbRow[];
  const mbLabels = new Map(mbs.map((m) => [m.id, m.name]));

  const reqs: ReqRow[] = [
    ...((rankReqsRes.data ?? []) as { rank_id: string; code: string; label: string }[]).map((r) => ({
      source: 'rank' as const,
      parentId: r.rank_id,
      parentLabel: rankLabels.get(r.rank_id) ?? r.rank_id,
      code: r.code,
      label: r.label
    })),
    ...((mbReqsRes.data ?? []) as { mb_id: string; code: string; label: string }[]).map((r) => ({
      source: 'mb' as const,
      parentId: r.mb_id,
      parentLabel: mbLabels.get(r.mb_id) ?? r.mb_id,
      code: r.code,
      label: r.label
    }))
  ];

  return {
    leaders: (leadersRes.data ?? []) as LeaderRow[],
    scouts: (scoutsRes.data ?? []) as ScoutRow[],
    parentsByScout,
    mbs,
    counselorsByMb,
    mbReqTrees,
    ranks: ranks.map((r) => ({ id: r.id, display_name: r.display_name })),
    reqs
  };
}

export default async function LookupsPage() {
  const { leaders, scouts, parentsByScout, mbs, counselorsByMb, mbReqTrees, ranks, reqs } =
    await loadLookups();
  const leadersLite = leaders.map((l) => ({ code: l.code, name: l.name }));

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Lookups &amp; Admin</h1>
        <p>
          The editable Troop 79 taxonomy. Internal codes, BSA Member IDs, leader
          signoff initials, and the merit-badge catalog. Click <strong>Edit</strong>{' '}
          on any row to make changes; new scouts and leaders can be added with the
          buttons at the top of each card.
        </p>
      </div>

      <div className={styles.grid}>
        <Card
          title="Scouts & BSA IDs"
          sub={`${scouts.length} scouts · internal ID permanent · uncheck Active to age out (ledger history preserved)`}
        >
          <ScoutEditor rows={scouts} ranks={ranks} parentsByScout={parentsByScout} />
        </Card>

        <Card title="Adult Leaders (signoff initials)" sub={`${leaders.length} leaders`}>
          <LeaderEditor rows={leaders} />
        </Card>
      </div>

      <div className={styles.grid}>
        <Card title="Merit Badge Catalog" sub={`${mbs.length} merit badges · BSA Scoutbook IDs for export · assigned counselors`}>
          <MbEditor
            rows={mbs}
            leaders={leadersLite}
            counselorsByMb={counselorsByMb}
            reqTreesByMb={mbReqTrees}
          />
        </Card>

        <Card
          title="Internal Requirement Codes"
          sub={`${reqs.length} top-level codes · read-only (catalog tree editing ships in a later slice)`}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Label</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {reqs.slice(0, 50).map((r) => (
                <tr key={`${r.source}-${r.parentId}-${r.code}`}>
                  <td className={styles.codeCell}>{r.code}</td>
                  <td>{r.label}</td>
                  <td>
                    <span
                      className={`${styles.tag} ${
                        r.source === 'rank' ? styles.tagRank : styles.tagMb
                      }`}
                    >
                      {r.source === 'rank' ? 'Rank' : 'MB'}: {r.parentLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {reqs.length > 50 && (
            <p className={styles.summary}>
              Showing first 50 of {reqs.length}. Full tree edit ships in a
              later slice.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

function Card({
  title,
  sub,
  children
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.card}>
      <h3>{title}</h3>
      {sub && <p className={styles.cardSub}>{sub}</p>}
      {children}
    </div>
  );
}
