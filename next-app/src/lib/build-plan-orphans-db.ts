/**
 * Build a Plan B9: the orphan count's one read. Server-only, service role; the page gates access.
 *
 * Reuses what the page already has: the plan's keys, and the cached engine read (Suggestions mode's, passed in). Adds
 * exactly ONE scoutCandidatesMany over the universe (the plan's keys plus every suggested key), so the round trips
 * don't grow with the plan, the scouts or the suggestions (pinned in build-plan-orphans-db.test.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdvancementCatalog } from '@/lib/advancement-catalog';
import type { SuggestionsData } from '@/lib/build-plan-suggest';
import { orphanUniverse, orphansData, type OrphansData } from '@/lib/build-plan-orphans';
import { scoutCandidatesMany } from '@/lib/meeting-invites-send';

export async function loadOrphans(
  sb: SupabaseClient,
  entryId: number,
  planKeys: readonly string[],
  suggestions: Pick<SuggestionsData, 'cards' | 'scouts'>,
  deps: { loadCatalog?: () => Promise<AdvancementCatalog> } = {}
): Promise<OrphansData> {
  const keys = orphanUniverse(planKeys, suggestions);
  const cands = await scoutCandidatesMany(sb, { entryId, keys }, deps);
  if (!cands.ok) throw new Error(cands.error);
  return orphansData(cands.eligible, cands.byKey, suggestions, keys);
}
