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
import type { Skill } from '@/lib/supabase/types';
import type { EngineInput, EngineMbReqRow, EngineRankReqRow } from './engine';

export type LoadEngineInputResult =
  | { ok: true; input: EngineInput }
  | { ok: false; error: string };

export async function loadEngineInput(meetingDate: string, title: string): Promise<LoadEngineInputResult> {
  const supabase = createAdminClient();

  const [
    scoutsRes,
    ranksRes,
    rankReqsRes,
    mbsRes,
    mbReqRows,
    mbProgressRows,
    rankReqLedgerRows,
    mbReqLedgerRows,
    skillsRes,
    leadersRes,
    leaderSkillsRes,
    counselorsRes,
    scoutInstructorsRes
  ] = await Promise.all([
    supabase
      .from('scouts')
      .select('id, display_name, patrol, current_rank')
      .eq('active', true)
      .order('display_name'),
    supabase.from('ranks').select('id, display_name, sort_order').order('sort_order'),
    supabase
      .from('rank_requirements')
      .select('id, rank_id, parent_id, code, label, complete_rule, complete_n, sort_order, venue, skill_id'),
    supabase.from('merit_badges').select('id, name, eagle'),
    fetchAllRows<EngineMbReqRow>((from, to) =>
      supabase
        .from('merit_badge_requirements')
        .select('id, mb_id, parent_id, code, label, complete_rule, complete_n, sort_order, venue')
        .range(from, to)
    ),
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
    supabase.from('skills').select('id, name, youth_teachable, sort_order').order('sort_order'),
    supabase.from('leaders').select('code, name, role, is_person, scout_id'),
    supabase.from('leader_skills').select('leader_code, skill_id'),
    supabase.from('merit_badge_counselors').select('mb_id, leader_code'),
    supabase.from('scout_instructors').select('scout_id, skill_id')
  ]);

  const firstError =
    scoutsRes.error ??
    ranksRes.error ??
    rankReqsRes.error ??
    mbsRes.error ??
    skillsRes.error ??
    leadersRes.error ??
    leaderSkillsRes.error ??
    counselorsRes.error ??
    scoutInstructorsRes.error;
  if (firstError) {
    return { ok: false, error: firstError.message };
  }

  // The engine's leader pool is ADULTS: exclude non-person sign-off sources
  // (Camp, Clinic, ...) and youth leaders — initials linked to an ACTIVE
  // scout. Once that scout ages out, the same initials rejoin this pool.
  const activeScoutIds = new Set(((scoutsRes.data ?? []) as { id: string }[]).map((s) => s.id));
  const adultLeaders = (
    (leadersRes.data ?? []) as { code: string; name: string; role: string | null; is_person: boolean; scout_id: string | null }[]
  )
    .filter((l) => l.is_person && !(l.scout_id && activeScoutIds.has(l.scout_id)))
    .map(({ code, name, role }) => ({ code, name, role }));

  const input: EngineInput = {
    meetingDate,
    title,
    generatedAt: new Date().toISOString(),
    scouts: (scoutsRes.data ?? []) as EngineInput['scouts'],
    ranks: (ranksRes.data ?? []) as EngineInput['ranks'],
    rankReqs: (rankReqsRes.data ?? []) as EngineRankReqRow[],
    mbs: (mbsRes.data ?? []) as EngineInput['mbs'],
    mbReqs: mbReqRows,
    mbProgress: mbProgressRows as EngineInput['mbProgress'],
    rankReqLedger: rankReqLedgerRows,
    mbReqLedger: mbReqLedgerRows,
    skills: (skillsRes.data ?? []) as Skill[],
    leaders: adultLeaders as EngineInput['leaders'],
    leaderSkills: (leaderSkillsRes.data ?? []) as EngineInput['leaderSkills'],
    counselors: (counselorsRes.data ?? []) as EngineInput['counselors'],
    scoutInstructors: (scoutInstructorsRes.data ?? []) as EngineInput['scoutInstructors']
  };

  return { ok: true, input };
}
