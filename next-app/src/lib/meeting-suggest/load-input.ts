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
    teachingSkillsRes,
    counselorsRes
  ] = await Promise.all([
    loadAdvancementCatalog(),
    supabase
      .from('scouts')
      .select('id, display_name, patrol, current_rank, person_id, graduation_year, junior_leader_override')
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
          .order('mb_id').order('scout_id').range(from, to)
    ),
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code')
        .eq('kind', 'rank_requirement')
        .order('id').range(from, to)
    ),
    fetchAllRows<{ scout_id: string; code: string }>((from, to) =>
      supabase
        .from('ledger_active')
        .select('scout_id, code')
        .eq('kind', 'merit_badge_requirement')
        .order('id').range(from, to)
    ),
    supabase.from('leaders').select('code, name, role, is_person, person_id'),
    supabase.from('teaching_skills').select('person_id, skill_id'),
    supabase.from('merit_badge_counselors').select('mb_id, person_id, leader_code').order('sort_order')
  ]);

  const firstError =
    scoutsRes.error ??
    leadersRes.error ??
    teachingSkillsRes.error ??
    counselorsRes.error;
  if (firstError) {
    return { ok: false, error: firstError.message };
  }

  // The engine's adult pool (Phase 0a, keyed to people): every person with a teaching skill or a counselor badge who is
  // not an ACTIVE scout — leaders and parents alike. A youth leader's initials belong to their scout person, so they
  // stay a scout until they age out (Plans/Retire-Roster-Contact-Columns.md). Non-person sources (Summer Camp) never
  // teach, but may counsel a badge: they ride in as counselorSources.
  const activeScoutPersonIds = new Set(
    ((scoutsRes.data ?? []) as { person_id: number | null }[])
      .map((s) => s.person_id)
      .filter((id): id is number => id != null)
  );
  const teachingSkills = (teachingSkillsRes.data ?? []) as EngineInput['teachingSkills'];
  const counselors = (counselorsRes.data ?? []) as EngineInput['counselors'];
  const adultIds = [...new Set([...teachingSkills.map((t) => t.person_id), ...counselors.map((c) => c.person_id)])].filter(
    (id): id is number => id != null && !activeScoutPersonIds.has(id)
  );
  const { data: peopleRows, error: peopleError } = adultIds.length
    ? await supabase.from('people').select('id, display_name').in('id', adultIds)
    : { data: [], error: null };
  if (peopleError) return { ok: false, error: peopleError.message };
  const roleByPerson = new Map(
    ((leadersRes.data ?? []) as { role: string | null; is_person: boolean; person_id: number | null }[])
      .filter((l) => l.is_person && l.person_id != null)
      .map((l) => [l.person_id as number, l.role])
  );
  const counselorSources = ((leadersRes.data ?? []) as { code: string; name: string; is_person: boolean }[])
    .filter((l) => !l.is_person)
    .map((l) => ({ code: l.code, name: l.name }));
  const adults: EngineInput['adults'] = ((peopleRows ?? []) as { id: number; display_name: string }[]).map((p) => ({
    personId: p.id,
    name: p.display_name,
    role: roleByPerson.get(p.id) ?? null
  }));

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
    adults,
    teachingSkills,
    counselors,
    counselorSources,
    requirementClasses: catalog.requirementClasses ?? []
  };

  return { ok: true, input };
}
