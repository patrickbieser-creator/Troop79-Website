/**
 * /admin/advancement/fast-entry — Fast Entry.
 *
 * Two equivalent workflows:
 *   - Scout-First: one scout, many requirements signed off at once.
 *   - Requirement-First: one requirement, many scouts who completed it.
 *
 * Both share the tabbed RequirementPicker. Below them is Today's Audit Tape
 * — a live feed of every ledger row entered today.
 *
 * Server Component fetches the catalogs (scouts, leaders, ranks, MBs,
 * rank_requirements) and seeds the Client cards.
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { LedgerEntry } from '@/lib/supabase/types';
import { ScoutFirstCard } from './scout-first-card';
import { ReqFirstCard } from './req-first-card';
import { AuditTape, type TapeRow } from './audit-tape';
import type { CatalogPayload } from './picker-types';
import styles from './fast-entry.module.css';

export const metadata = {
  title: 'Fast Entry — Troop 79'
};

async function loadFastEntry(): Promise<{
  catalog: CatalogPayload;
  scouts: { id: string; display_name: string; current_rank: string | null }[];
  leaders: { code: string; name: string }[];
  tape: TapeRow[];
}> {
  const supabase = createAdminClient();

  // Today's tape = rows whose `entered_at` falls in today's *local* calendar
  // day. Catches every signoff that was keyed in today, regardless of the
  // historical signoff date on the row. Local-day bounds (not UTC) so the
  // tape doesn't roll over until local midnight.
  const now = new Date();
  const localStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  );
  const localEnd = new Date(localStart);
  localEnd.setDate(localEnd.getDate() + 1);
  const startOfDay = localStart.toISOString();
  const endISO = localEnd.toISOString();

  const [
    scoutsRes,
    leadersRes,
    ranksRes,
    rankReqsRes,
    mbsRes,
    mbReqsRes,
    eventsRes,
    serviceProjectsRes,
    leadershipPositionsRes,
    tapeRes
  ] = await Promise.all([
    supabase
      .from('scouts')
      .select('id, display_name, current_rank')
      .eq('active', true)
      .order('display_name'),
    supabase.from('leaders').select('code, name').order('code'),
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('id, rank_id, parent_id, code, label, complete_rule, complete_n, sort_order')
      .order('rank_id')
      .order('sort_order'),
    supabase.from('merit_badges').select('id, name, eagle').order('name'),
    supabase
      .from('merit_badge_requirements')
      .select('id, mb_id, parent_id, code, label, complete_rule, complete_n, sort_order')
      .order('mb_id')
      .order('sort_order'),
    supabase.from('events').select('id, name, default_kind, start_date').order('name'),
    supabase.from('service_projects').select('id, name').order('name'),
    supabase.from('leadership_positions').select('id, name').order('name'),
    supabase
      .from('ledger_active')
      .select('*')
      .gte('entered_at', startOfDay)
      .lt('entered_at', endISO)
      .order('entered_at', { ascending: false })
  ]);

  const scouts = (scoutsRes.data ?? []) as {
    id: string;
    display_name: string;
    current_rank: string | null;
  }[];
  const leaders = (leadersRes.data ?? []) as { code: string; name: string }[];
  const ranks = (ranksRes.data ?? []) as {
    id: string;
    display_name: string;
    sort_order: number;
  }[];
  type RankReqRow = {
    id: number;
    rank_id: string;
    parent_id: number | null;
    code: string;
    label: string;
    complete_rule: 'all' | 'any' | 'n-of';
    complete_n: number | null;
    sort_order: number;
  };
  type MbReqRow = {
    id: number;
    mb_id: string;
    parent_id: number | null;
    code: string;
    label: string;
    complete_rule: 'all' | 'any' | 'n-of';
    complete_n: number | null;
    sort_order: number;
  };
  const rankReqs = (rankReqsRes.data ?? []) as RankReqRow[];
  const mbs = (mbsRes.data ?? []) as { id: string; name: string; eagle: boolean }[];
  const mbReqs = (mbReqsRes.data ?? []) as MbReqRow[];
  const events = (eventsRes.data ?? []) as {
    id: number;
    name: string;
    default_kind: import('@/lib/supabase/types').LedgerKind | null;
    start_date: string | null;
  }[];
  const serviceProjects = (serviceProjectsRes.data ?? []) as { id: number; name: string }[];
  const leadershipPositions = (leadershipPositionsRes.data ?? []) as { id: number; name: string }[];
  const tapeRows = (tapeRes.data ?? []) as LedgerEntry[];

  // Build trees per rank + per MB.
  function buildTree<T extends { id: number; parent_id: number | null; sort_order: number; code: string; label: string; complete_rule: 'all' | 'any' | 'n-of'; complete_n: number | null }>(rows: T[]): import('./picker-types').ReqTreeNode[] {
    const byId = new Map<number, T>();
    const childrenByParent = new Map<number | null, T[]>();
    for (const r of rows) {
      byId.set(r.id, r);
      const key = r.parent_id;
      const list = childrenByParent.get(key) ?? [];
      list.push(r);
      childrenByParent.set(key, list);
    }
    for (const list of childrenByParent.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order);
    }
    function build(parentId: number | null): import('./picker-types').ReqTreeNode[] {
      const kids = childrenByParent.get(parentId) ?? [];
      return kids.map((k) => ({
        code: k.code,
        label: k.label,
        complete_rule: k.complete_rule,
        complete_n: k.complete_n,
        children: build(k.id)
      }));
    }
    return build(null);
  }
  const rankTreeByRank = new Map<string, import('./picker-types').ReqTreeNode[]>();
  for (const r of ranks) {
    const rowsForRank = rankReqs.filter((rr) => rr.rank_id === r.id);
    rankTreeByRank.set(r.id, buildTree(rowsForRank));
  }
  const mbTreeByMb = new Map<string, import('./picker-types').ReqTreeNode[]>();
  for (const m of mbs) {
    const rowsForMb = mbReqs.filter((mr) => mr.mb_id === m.id);
    mbTreeByMb.set(m.id, buildTree(rowsForMb));
  }

  const scoutMap = new Map(scouts.map((s) => [s.id, s.display_name]));
  // For audit-tape short-label lookup we want the top-level rank req label.
  // Build a flat map keyed `<rank>-<code>` for top-level entries.
  const rankShortByKey = new Map<string, string>();
  for (const r of rankReqs) {
    if (r.parent_id === null) rankShortByKey.set(`${r.rank_id}-${r.code}`, r.label);
  }
  const rankNameById = new Map(ranks.map((r) => [r.id, r.display_name]));
  const mbNameById = new Map(mbs.map((m) => [m.id, m.name]));

  const tape: TapeRow[] = tapeRows.map((e) => ({
    id: e.id,
    date: e.date,
    enteredAt: e.entered_at,
    scoutId: e.scout_id,
    scoutName: scoutMap.get(e.scout_id) ?? e.scout_id,
    kind: e.kind,
    code: e.code,
    label: e.label,
    by: e.by,
    qty: e.qty,
    unit: e.unit,
    shortLabel: shortLabelFor(e, rankShortByKey, rankNameById, mbNameById)
  }));

  const catalog: CatalogPayload = {
    ranks: ranks.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      requirements: rankTreeByRank.get(r.id) ?? []
    })),
    mbs: mbs.map((m) => ({
      id: m.id,
      name: m.name,
      eagle: m.eagle,
      requirements: mbTreeByMb.get(m.id) ?? []
    })),
    events,
    serviceProjects,
    leadershipPositions
  };

  return { catalog, scouts, leaders, tape };
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

export default async function FastEntryPage() {
  const { catalog, scouts, leaders, tape } = await loadFastEntry();

  return (
    <>
      <div className={styles.pageTitle}>
        <h1>Fast Entry</h1>
        <p>
          Two equivalent workflows. Use <strong>Scout-First</strong> when one
          scout knocked out several requirements; use{' '}
          <strong>Requirement-First</strong> when many scouts completed the
          same requirement at the same activity.
        </p>
      </div>

      <div className={styles.twoCol}>
        <ScoutFirstCard scouts={scouts} leaders={leaders} catalog={catalog} />
        <ReqFirstCard scouts={scouts} leaders={leaders} catalog={catalog} />
      </div>

      <AuditTape tape={tape} />
    </>
  );
}
