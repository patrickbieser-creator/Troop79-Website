/**
 * Assembles the EngineInput the meeting-plan engine consumes — the 13-query
 * fan-out formerly inlined in actions.ts::generatePlan. Extracted so the
 * Meetings editor's candidate tray can compute suggestions for a meeting
 * date without duplicating the data assembly (Plans/Meetings-Page.md).
 *
 * Pure read: no DB writes, no auth — callers gate access themselves.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import type { EngineInput } from './engine';

export type LoadEngineInputResult =
  | { ok: true; input: EngineInput }
  | { ok: false; error: string };

export async function loadEngineInput(meetingDate: string, title: string): Promise<LoadEngineInputResult> {
  const supabase = createAdminClient();

  // CATALOG half (ranks, rank/MB requirement trees, merit badges, skills) —
  // only changes when a leader saves Lookups, so it comes from the shared
  // `advancement-catalog` cache instead of its own 5-query fan-out on every
  // Agenda-tab open (Plans/Performance-Review-2026-08-27.md #11). The
  // per-scout half below (ledger, mb_progress, and the roster/teacher
  // tables) stays live.
  const [
    catalog,
    scoutsRes,
    mbProgressRows,
    rankReqLedgerRows,
    mbReqLedgerRows,
    leadersRes,
    leaderSkillsRes,
    counselorsRes,
    scoutInstructorsRes
  ] = await Promise.all([
    loadAdvancementCatalog(),
    supabase
      .from('scouts')
      .select('id, display_name, patrol, current_rank, person_id')
      .eq('active', true)
      .order('display_name'),
    // mb_progress is roughly (badges-in-progress × scouts) and can climb past
    // the 1000-row cap as the troop's badge activity grows — paginate so the
    // planner never runs on a silently-truncated progress set.
    fetchAllRows<{ mb_id: string; scout_id: string; awarded: boolean; has_any_req: boolean }>(
      (from, to) =>
        supabase
          .from('mb_progress')
          .select('mb_id, scout_id, awarded, has_any_req')
          .range(from, to)
    ),
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code')
        .eq('kind', 'rank_requirement')
        .range(from, to)
    ),
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code')
        .eq('kind', 'merit_badge_requirement')
        .range(from, to)
    ),
    supabase.from('leaders').select('code, name, role, is_person, person_id'),
    supabase.from('leader_skills').select('leader_code, skill_id'),
    supabase.from('merit_badge_counselors').select('mb_id, leader_code'),
    supabase.from('scout_instructors').select('scout_id, skill_id')
  ]);

  const firstError =
    scoutsRes.error ??
    leadersRes.error ??
    leaderSkillsRes.error ??
    counselorsRes.error ??
    scoutInstructorsRes.error;
  if (firstError) {
    return { ok: false, error: firstError.message };
  }

  // The engine's leader pool is ADULTS: exclude non-person sign-off sources
  // (Camp, Clinic, ...) and youth leaders — initials linked to an ACTIVE
  // scout's person_id. Once that scout ages out, the same initials rejoin
  // this pool (Plans/Retire-Roster-Contact-Columns.md).
  const activeScoutPersonIds = new Set(
    ((scoutsRes.data ?? []) as { person_id: number | null }[])
      .map((s) => s.person_id)
      .filter((id): id is number => id != null)
  );
  const adultLeaders = (
    (leadersRes.data ?? []) as { code: string; name: string; role: string | null; is_person: boolean; person_id: number | null }[]
  )
    .filter((l) => l.is_person && !(l.person_id != null && activeScoutPersonIds.has(l.person_id)))
    .map(({ code, name, role }) => ({ code, name, role }));

  const input: EngineInput = {
    meetingDate,
    title,
    generatedAt: new Date().toISOString(),
    scouts: (scoutsRes.data ?? []) as EngineInput['scouts'],
    ranks: catalog.ranks,
    rankReqs: catalog.rankRequirements,
    mbs: catalog.meritBadges,
    mbReqs: catalog.meritBadgeRequirements,
    mbProgress: mbProgressRows as EngineInput['mbProgress'],
    rankReqLedger: rankReqLedgerRows,
    mbReqLedger: mbReqLedgerRows,
    skills: catalog.skills,
    leaders: adultLeaders as EngineInput['leaders'],
    leaderSkills: (leaderSkillsRes.data ?? []) as EngineInput['leaderSkills'],
    counselors: (counselorsRes.data ?? []) as EngineInput['counselors'],
    scoutInstructors: (scoutInstructorsRes.data ?? []) as EngineInput['scoutInstructors']
  };

  return { ok: true, input };
}
