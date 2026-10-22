/**
 * The planner's Has/Needs tab, its one read (Build a Plan B7, Plans/Build-A-Plan.md). Server-only, service role; the
 * page gates (planner View). Ported from Admin's /admin/advancement/has-needs, which keeps its own copy until Patrick
 * approves this one and it retires.
 *
 * One load, every part in parallel, and the split runs on the client (lib/has-needs), so ticking costs nothing:
 *   - the requirement trees from the shared advancement catalog (cached hourly), the four lower ranks and every badge
 *     with a loaded tree;
 *   - the active scouts, one read, without test people (people.is_test: Charlie Walters and friends; qa-lead, B7);
 *   - the ledger's requirement rows and the awarded badges, paged past PostgREST's 1000-row cap (fetchAllRows). AWARD
 *     IMPLIES LEAVES: an awarded badge credits every one of its leaves (withAwardedBadgeLeaves), as on the Admin page;
 *   - for a seed holder only (the add hook), the next meetings and ONE read of what is already on their plans.
 * Pinned by tests/planner-has-needs-db.test.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { buildReqTree } from '@/lib/mb-helpers';
import { loadAdvancementCatalog, type AdvancementCatalog, type CatalogMeritBadgeRequirement } from '@/lib/advancement-catalog';
import { withAwardedBadgeLeaves, type HasNeedsScout } from '@/lib/has-needs';
import { toPickerTree, type PickerBadge, type PickerRank } from '@/lib/has-needs-picker';

/** The four lower ranks: their requirements are worked on at meetings; Star and up are positions and badges. */
const TARGET_RANK_IDS = ['scout', 'tenderfoot', 'second-class', 'first-class'];

export interface HasNeedsMeeting {
  entryId: number;
  date: string;
}

export interface HasNeedsPage {
  ranks: PickerRank[];
  badges: PickerBadge[];
  scouts: HasNeedsScout[];
  /** Every rank in order, for the rank on each row and the rank filter. */
  allRanks: { id: string; name: string }[];
  /** Seed holders: the meetings an add can go to (the next ones, open). Empty for everyone else. */
  meetings: HasNeedsMeeting[];
  /** Seed holders: each of those meetings' plan keys, by entry id. */
  onPlan: Record<number, string[]>;
}

export async function loadHasNeedsPage(
  sb: SupabaseClient,
  deps: { canSeed: boolean; loadCatalog?: () => Promise<AdvancementCatalog>; loadMeetings?: () => Promise<HasNeedsMeeting[]> }
): Promise<HasNeedsPage> {
  const plans = async (): Promise<{ meetings: HasNeedsMeeting[]; onPlan: Record<number, string[]> }> => {
    if (!deps.canSeed || !deps.loadMeetings) return { meetings: [], onPlan: {} };
    const meetings = await deps.loadMeetings();
    if (!meetings.length) return { meetings, onPlan: {} };
    const { data, error } = await sb
      .from('meeting_topics')
      .select('calendar_entry_id, topic_key')
      .in(
        'calendar_entry_id',
        meetings.map((m) => m.entryId)
      );
    if (error) throw new Error(error.message);
    const onPlan: Record<number, string[]> = Object.fromEntries(meetings.map((m) => [m.entryId, [] as string[]]));
    for (const r of (data ?? []) as { calendar_entry_id: number; topic_key: string }[]) onPlan[r.calendar_entry_id]?.push(r.topic_key);
    return { meetings, onPlan };
  };

  const [catalog, scoutsRes, ledgerRows, awardedRows, plan] = await Promise.all([
    (deps.loadCatalog ?? loadAdvancementCatalog)(),
    sb.from('scouts').select('id, first_name, display_name, current_rank, people(is_test)').eq('active', true),
    fetchAllRows<{ scout_id: string; code: string; kind: string }>((from, to) =>
      sb.from('ledger_active').select('scout_id, code, kind').in('kind', ['rank_requirement', 'merit_badge_requirement']).order('id').range(from, to)
    ),
    fetchAllRows<{ scout_id: string; mb_id: string }>((from, to) =>
      sb.from('mb_progress').select('scout_id, mb_id').eq('awarded', true).order('mb_id').order('scout_id').range(from, to)
    ),
    plans()
  ]);
  if (scoutsRes.error) throw new Error(scoutsRes.error.message);

  const rankSort = new Map(catalog.ranks.map((r) => [r.id, r.sort_order]));
  const rankName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));

  const rowsByRank = new Map<string, typeof catalog.rankRequirements>();
  for (const row of catalog.rankRequirements) {
    if (!TARGET_RANK_IDS.includes(row.rank_id) || row.code.toLowerCase() === 'bor') continue;
    rowsByRank.set(row.rank_id, [...(rowsByRank.get(row.rank_id) ?? []), row]);
  }
  const ranks: PickerRank[] = TARGET_RANK_IDS.filter((id) => rowsByRank.has(id)).map((id) => ({
    id,
    name: rankName.get(id) ?? id,
    tree: toPickerTree(buildReqTree(rowsByRank.get(id)!))
  }));

  const rowsByMb = new Map<string, CatalogMeritBadgeRequirement[]>();
  for (const row of catalog.meritBadgeRequirements) {
    const list = rowsByMb.get(row.mb_id) ?? [];
    list.push(row);
    rowsByMb.set(row.mb_id, list);
  }
  const badges: PickerBadge[] = catalog.meritBadges
    .filter((mb) => (rowsByMb.get(mb.id) ?? []).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((mb) => ({ id: mb.id, name: mb.name, eagle: mb.eagle, tree: toPickerTree(buildReqTree(rowsByMb.get(mb.id)!)) }));

  // Bare leaf codes per badge (no row names it as parent), for award-implies-leaves.
  const leafCodesByMb = new Map<string, string[]>();
  for (const [mbId, rows] of rowsByMb) {
    const parents = new Set(rows.map((r) => r.parent_id).filter((p): p is number => p != null));
    leafCodesByMb.set(
      mbId,
      rows.filter((r) => !parents.has(r.id)).map((r) => r.code)
    );
  }

  // Ledger codes are already `${id}-${code}` composites, so the kind's prefix makes lib/has-needs's key.
  const keysByScout = new Map<string, Set<string>>();
  for (const row of ledgerRows) {
    const set = keysByScout.get(row.scout_id) ?? new Set<string>();
    set.add(`${row.kind === 'merit_badge_requirement' ? 'mb' : 'rank'}:${row.code}`);
    keysByScout.set(row.scout_id, set);
  }
  const awardedByScout = new Map<string, string[]>();
  for (const row of awardedRows) awardedByScout.set(row.scout_id, [...(awardedByScout.get(row.scout_id) ?? []), row.mb_id]);

  type ScoutRow = { id: string; first_name: string; display_name: string; current_rank: string | null; people: { is_test: boolean } | { is_test: boolean }[] | null };
  const isTest = (r: ScoutRow) => (Array.isArray(r.people) ? r.people[0]?.is_test : r.people?.is_test) === true;
  const scouts: HasNeedsScout[] = ((scoutsRes.data ?? []) as unknown as ScoutRow[]).filter((r) => !isTest(r)).map((s) => ({
    id: s.id,
    firstName: s.first_name,
    displayName: s.display_name,
    currentRank: s.current_rank,
    rankSortOrder: s.current_rank ? (rankSort.get(s.current_rank) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER,
    heldKeys: [...withAwardedBadgeLeaves(keysByScout.get(s.id) ?? [], awardedByScout.get(s.id) ?? [], leafCodesByMb)]
  }));

  return {
    ranks,
    badges,
    scouts,
    allRanks: [...catalog.ranks].sort((a, b) => a.sort_order - b.sort_order).map((r) => ({ id: r.id, name: r.display_name })),
    ...plan
  };
}
