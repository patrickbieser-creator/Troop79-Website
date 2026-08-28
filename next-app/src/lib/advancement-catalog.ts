/**
 * The advancement CATALOG — ranks, rank/merit-badge requirement trees, and
 * skills. Cached across requests under the `advancement-catalog` tag: these
 * tables only change when a leader saves Lookups (updateMeritBadge,
 * createSkill/updateSkill/deleteSkill, updateReqCode — all in
 * `advancement/lookups/actions.ts`), yet the Agenda tab, the Ledger admin
 * screen, and the Leader Dashboard each used to re-read them fresh on every
 * navigation (Plans/Performance-Review-2026-08-27.md #11, #16).
 *
 * `merit_badges` rides along even though only three of the four named tables
 * were called out for item 11 — it's the same "only changes via Lookups"
 * shape (updateMeritBadge writes it in the same save as the requirement
 * tree), and item 16's Ledger/Dashboard both want it.
 *
 * Two layers, same pattern as `lib/site-settings.ts` / `lib/article-tokens-
 * server.ts`: `unstable_cache` keeps the shaped result across requests,
 * `cache()` dedupes within one request (a page that reads it more than once
 * shouldn't re-run the whole batch). The cached value is plain arrays of
 * plain objects only — Next serialises the cache entry as JSON, so no
 * Map/Set/Date can survive the round trip.
 *
 * Per-scout/live tables (scouts, ledger_active, leaders, leader_skills,
 * merit_badge_counselors, scout_instructors, mb_progress) are NOT here —
 * they change far more often and each caller still reads them fresh.
 */

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { ReqVenue, Skill } from '@/lib/supabase/types';

export interface CatalogRank {
  id: string;
  display_name: string;
  sort_order: number;
}

export interface CatalogRankRequirement {
  id: number;
  rank_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
  venue: ReqVenue;
  skill_id: string | null;
}

export interface CatalogMeritBadge {
  id: string;
  name: string;
  eagle: boolean;
}

export interface CatalogMeritBadgeRequirement {
  id: number;
  mb_id: string;
  parent_id: number | null;
  code: string;
  label: string;
  complete_rule: 'all' | 'any' | 'n-of';
  complete_n: number | null;
  sort_order: number;
  venue: ReqVenue;
}

export interface AdvancementCatalog {
  ranks: CatalogRank[];
  rankRequirements: CatalogRankRequirement[];
  meritBadges: CatalogMeritBadge[];
  meritBadgeRequirements: CatalogMeritBadgeRequirement[];
  skills: Skill[];
}

/**
 * The uncached fetch + shape, split out from the `unstable_cache` wrapper
 * below so it can be exercised directly against a real Supabase client in
 * tests — `unstable_cache` assumes a Next.js server/build context and hangs
 * outside one, the same reason `lib/site-settings.ts` /
 * `lib/article-tokens-server.ts` have no direct test of their own.
 */
export async function fetchAdvancementCatalog(
  supabase: ReturnType<typeof createAdminClient>
): Promise<AdvancementCatalog> {
  const [ranksRes, rankReqsRes, mbsRes, meritBadgeRequirements, skillsRes] = await Promise.all([
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('id, rank_id, parent_id, code, label, complete_rule, complete_n, sort_order, venue, skill_id'),
    supabase.from('merit_badges').select('id, name, eagle'),
    // ~1.7k rows — past the 1000-row PostgREST cap, so this one still
    // paginates even though it now runs once per cache fill instead of
    // once per Agenda-tab open.
    fetchAllRows<CatalogMeritBadgeRequirement>((from, to) =>
      supabase
        .from('merit_badge_requirements')
        .select('id, mb_id, parent_id, code, label, complete_rule, complete_n, sort_order, venue')
        .range(from, to)
    ),
    supabase.from('skills').select('id, name, youth_teachable, sort_order').order('sort_order')
  ]);

  return {
    ranks: (ranksRes.data ?? []) as CatalogRank[],
    rankRequirements: (rankReqsRes.data ?? []) as CatalogRankRequirement[],
    meritBadges: (mbsRes.data ?? []) as CatalogMeritBadge[],
    meritBadgeRequirements,
    skills: (skillsRes.data ?? []) as Skill[]
  };
}

const cachedCatalog = unstable_cache(
  () => fetchAdvancementCatalog(createAdminClient()),
  ['advancement-catalog'],
  // Hourly fallback: the populate-mb-requirements skill and prod psql write
  // these tables outside the app, where no updateTag() runs.
  { tags: ['advancement-catalog'], revalidate: 3600 }
);

export const loadAdvancementCatalog = cache((): Promise<AdvancementCatalog> => cachedCatalog());
