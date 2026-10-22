/**
 * The Meeting Planner's slow-changing lists, cached across requests (perf, 2026-10-22; shaped like
 * lib/advancement-catalog.ts): who the active scouts are, the teacher pool's directory rows (adults in the picker,
 * active scouts with what decides a Junior Leader, their names, teaching skills and counselor badges), the leader ids,
 * and which calendar categories are meetings. Each render and poll of /planner used to read them again.
 *
 * - Tags: `people-lists` and `meeting-categories`. Every app writer of what they hold calls expirePeopleLists() /
 *   expireMeetingCategories() (guard: tests/people-lists-cache.test.ts). A scout's rank follows the ledger through the
 *   rank triggers, so ledger writers expire `people-lists` too.
 * - Hourly fallback (`revalidate: 3600`) for writes outside the app (prod psql, a birthday ageing someone out).
 * - Values are JSON only (arrays, never a Map or Set: unstable_cache would hand back `{}`).
 * - Never cached here: picks, answers, teachers, ledger progress, and nothing derived from the match (D-426).
 * - unstable_cache hangs in vitest outside a Next request, so the fetchers are exported for tests and the loaders that
 *   take these lists fall back to reading the database when none are passed.
 */
import { cache } from 'react';
import { revalidateTag, unstable_cache, updateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { JuniorLeaderOverride } from '@/lib/participant-class';
import type { BoardScout } from '@/lib/meeting-board';

export const PEOPLE_LISTS_TAG = 'people-lists';
export const MEETING_CATEGORIES_TAG = 'meeting-categories';

export interface PoolScoutRow {
  id: string;
  person_id: number;
  display_name: string;
  current_rank: string | null;
  graduation_year: number | null;
  junior_leader_override: JuniorLeaderOverride;
}

export interface PoolPersonRow {
  id: number;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
}

/** The teacher pool's directory side for 'all' (lib/meeting-board-supply loadTeacherPeople). */
export interface TeacherPoolRows {
  /** person_directory: leader or adult tab, in the picker. */
  adults: number[];
  /** Active scouts with a person record, by display name (also the board's scouts). */
  scouts: PoolScoutRow[];
  /** Names of every adult and active scout above. */
  people: PoolPersonRow[];
  skills: { person_id: number; skill_id: string }[];
  counselors: { person_id: number; mb_id: string }[];
}

export interface PeopleLists {
  pool: TeacherPoolRows;
  /** person_directory: leader tab, in the picker (who is a leader on the board). */
  leaderIds: number[];
}

export interface PlannerLists extends PeopleLists {
  /** Calendar category labels that behave as a meeting. */
  meetingLabels: string[];
}

export async function fetchPeopleLists(sb: SupabaseClient): Promise<PeopleLists> {
  const [dir, scouts] = await Promise.all([
    fetchAllRows<{ person_id: number; tab: string }>((from, to) =>
      sb.from('person_directory').select('person_id, tab').in('tab', ['leader', 'adult']).eq('in_picker', true).order('person_id').range(from, to)
    ),
    fetchAllRows<PoolScoutRow>((from, to) =>
      sb
        .from('scouts')
        .select('id, person_id, display_name, current_rank, graduation_year, junior_leader_override')
        .eq('active', true)
        .not('person_id', 'is', null)
        .order('display_name')
        .order('id')
        .range(from, to)
    )
  ]);
  const ids = [...new Set([...dir.map((d) => d.person_id), ...scouts.map((s) => s.person_id)])];
  const [people, skills, counselors] = ids.length
    ? await Promise.all([
        fetchAllRows<PoolPersonRow>((from, to) => sb.from('people').select('id, display_name, first_name, last_name, gender').in('id', ids).order('id').range(from, to)),
        fetchAllRows<{ person_id: number; skill_id: string }>((from, to) =>
          sb.from('teaching_skills').select('person_id, skill_id').in('person_id', ids).order('person_id').order('skill_id').range(from, to)
        ),
        fetchAllRows<{ person_id: number; mb_id: string }>((from, to) => sb.from('merit_badge_counselors').select('person_id, mb_id').in('person_id', ids).order('id').range(from, to))
      ])
    : [[], [], []];
  return {
    pool: { adults: dir.map((d) => d.person_id), scouts, people, skills, counselors },
    leaderIds: dir.filter((d) => d.tab === 'leader').map((d) => d.person_id)
  };
}

export async function fetchMeetingLabels(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from('calendar_categories').select('label').eq('behavior', 'meeting').order('label');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { label: string }[]).map((c) => c.label);
}

// Made on first use, not at import: the writers import this file for expire*(), and their tests mock next/cache
// without unstable_cache.
let cachedPeople: (() => Promise<PeopleLists>) | null = null;
let cachedLabels: (() => Promise<string[]>) | null = null;

/** The planner's lists, from the cross-request cache (one fill per hour or per write). */
export const loadPlannerLists = cache(async (): Promise<PlannerLists> => {
  cachedPeople ??= unstable_cache(() => fetchPeopleLists(createAdminClient()), [PEOPLE_LISTS_TAG], { tags: [PEOPLE_LISTS_TAG], revalidate: 3600 });
  cachedLabels ??= unstable_cache(() => fetchMeetingLabels(createAdminClient()), [MEETING_CATEGORIES_TAG], { tags: [MEETING_CATEGORIES_TAG], revalidate: 3600 });
  const [people, meetingLabels] = await Promise.all([cachedPeople(), cachedLabels()]);
  return { ...people, meetingLabels };
});

/** The board's scouts (lib/meeting-board loadBoardScouts) from the cached pool: same rows, same order. */
export function boardScoutsOf(lists: Pick<PeopleLists, 'pool'>): BoardScout[] {
  return lists.pool.scouts.map((s) => ({ personId: s.person_id, scoutId: s.id, name: s.display_name, currentRank: s.current_rank }));
}

/** Expire a tag now: updateTag in a Server Action; elsewhere (a route handler) revalidateTag with immediate expiry.
 *  Outside any request (a script) there is nothing to expire, and the hourly fallback covers it. */
function expire(tag: string) {
  try {
    updateTag(tag);
  } catch {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      // No request context.
    }
  }
}

/** A write to people, scouts, roles, teaching skills, counselor badges, or the ledger (a scout's rank). */
export function expirePeopleLists() {
  expire(PEOPLE_LISTS_TAG);
}

/** A write to calendar_categories. */
export function expireMeetingCategories() {
  expire(MEETING_CATEGORIES_TAG);
}
