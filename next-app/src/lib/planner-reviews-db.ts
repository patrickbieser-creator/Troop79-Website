/**
 * Suggestions' lead list, the reads (lib/planner-reviews holds the rules). Server-only, service role; the page and the
 * action gate. One pass: active scouts, their rank requirement codes (lib/meeting-board loadScoutProgress, paged past
 * PostgREST's cap), the catalog's rank trees, and the people who may sit a review: adults on the picker (the
 * Scoutmaster flagged from leaders.role) and active scouts with their rank.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { loadScoutProgress } from '@/lib/meeting-board';
import { boardName } from '@/lib/meeting-board-shared';
import { buildReqTree } from '@/lib/mb-helpers';
import { reviewCandidates, type ReviewCandidate, type Reviewer } from '@/lib/planner-reviews';

export interface ReviewData {
  candidates: ReviewCandidate[];
  pool: Reviewer[];
  ranks: { id: string; display_name: string; sort_order: number }[];
}

type ScoutRow = { id: string; person_id: number | null; display_name: string; current_rank: string | null };

export async function loadReviewData(sb: SupabaseClient, onlyPersonId?: number): Promise<ReviewData> {
  const catalog = await loadAdvancementCatalog();
  const [scoutsRes, adultsRes, leadersRes] = await Promise.all([
    sb.from('scouts').select('id, person_id, display_name, current_rank').eq('active', true).not('person_id', 'is', null),
    sb.from('person_directory').select('person_id').in('tab', ['leader', 'adult']).eq('in_picker', true),
    sb.from('leaders').select('person_id, role')
  ]);
  for (const r of [scoutsRes, adultsRes, leadersRes]) if (r.error) throw new Error(r.error.message);
  const scouts = (scoutsRes.data ?? []) as ScoutRow[];
  const order = new Map(catalog.ranks.map((r) => [r.id, r.sort_order]));
  const scoutmasters = new Set(((leadersRes.data ?? []) as { person_id: number | null; role: string | null }[]).filter((l) => l.person_id != null && /^scoutmaster$/i.test((l.role ?? '').trim())).map((l) => l.person_id!));

  const subjects = onlyPersonId == null ? scouts : scouts.filter((s) => s.person_id === onlyPersonId);
  const progress = await loadScoutProgress(sb, subjects.map((s) => s.id));
  const trees = new Map<string, ReturnType<typeof buildReqTree>>();
  const treeOf = (rankId: string) => {
    if (!trees.has(rankId)) trees.set(rankId, buildReqTree(catalog.rankRequirements.filter((r) => r.rank_id === rankId) as never));
    return trees.get(rankId)! as never;
  };
  const candidates = reviewCandidates(
    subjects.map((s) => ({ personId: s.person_id!, name: boardName(s.display_name), currentRank: s.current_rank, codes: progress.get(s.id)?.rankCodes ?? new Set<string>() })),
    catalog.ranks,
    treeOf
  );

  const adultIds = [...new Set(((adultsRes.data ?? []) as { person_id: number }[]).map((a) => a.person_id))];
  const names = adultIds.length ? await sb.from('people').select('id, display_name').in('id', adultIds) : { data: [], error: null };
  if (names.error) throw new Error(names.error.message);
  const nameOf = new Map(((names.data ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const adults: Reviewer[] = adultIds.map((id) => ({ personId: id, name: boardName(nameOf.get(id) ?? `Person ${id}`), kind: 'adult' as const, scoutmaster: scoutmasters.has(id) || undefined }));
  adults.sort((x, y) => Number(!!y.scoutmaster) - Number(!!x.scoutmaster) || x.name.localeCompare(y.name));
  const scoutReviewers: Reviewer[] = scouts
    .map((s) => ({ personId: s.person_id!, name: boardName(s.display_name), kind: 'scout' as const, rankOrder: s.current_rank ? (order.get(s.current_rank) ?? 0) : 0 }))
    .sort((x, y) => y.rankOrder - x.rankOrder || x.name.localeCompare(y.name));
  return { candidates, pool: [...adults, ...scoutReviewers], ranks: catalog.ranks };
}
