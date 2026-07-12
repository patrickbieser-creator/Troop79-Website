'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { Skill } from '@/lib/supabase/types';
import type { MeetingPlanPayload } from '@/lib/meeting-plan-types';
import { buildMeetingPlan, type EngineInput, type EngineMbReqRow, type EngineRankReqRow } from './engine';

async function ensureLeader() {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session) throw new Error('Not authenticated');
  return session;
}

interface GenerateResult {
  ok: boolean;
  payload?: MeetingPlanPayload;
  error?: string;
}

/**
 * Compute a meeting plan for the given date — pure read + engine pass, no
 * DB writes. The leader reviews the result and publishes it separately.
 */
export async function generatePlan(formData: FormData): Promise<GenerateResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const meetingDate = String(formData.get('meetingDate') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim() || 'Troop Meeting';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return { ok: false, error: 'Pick a meeting date' };
  }

  const supabase = createAdminClient();

  const [
    scoutsRes,
    ranksRes,
    rankReqsRes,
    mbsRes,
    mbReqRows,
    mbProgressRes,
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
    supabase.from('mb_progress').select('mb_id, scout_id, awarded, has_any_req'),
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
    supabase.from('leaders').select('code, name, role'),
    supabase.from('leader_skills').select('leader_code, skill_id'),
    supabase.from('merit_badge_counselors').select('mb_id, leader_code'),
    supabase.from('scout_instructors').select('scout_id, skill_id')
  ]);

  const firstError =
    scoutsRes.error ??
    ranksRes.error ??
    rankReqsRes.error ??
    mbsRes.error ??
    mbProgressRes.error ??
    skillsRes.error ??
    leadersRes.error ??
    leaderSkillsRes.error ??
    counselorsRes.error ??
    scoutInstructorsRes.error;
  if (firstError) {
    return { ok: false, error: firstError.message };
  }

  const input: EngineInput = {
    meetingDate,
    title,
    generatedAt: new Date().toISOString(),
    scouts: (scoutsRes.data ?? []) as EngineInput['scouts'],
    ranks: (ranksRes.data ?? []) as EngineInput['ranks'],
    rankReqs: (rankReqsRes.data ?? []) as EngineRankReqRow[],
    mbs: (mbsRes.data ?? []) as EngineInput['mbs'],
    mbReqs: mbReqRows,
    mbProgress: (mbProgressRes.data ?? []) as EngineInput['mbProgress'],
    rankReqLedger: rankReqLedgerRows,
    mbReqLedger: mbReqLedgerRows,
    skills: (skillsRes.data ?? []) as Skill[],
    leaders: (leadersRes.data ?? []) as EngineInput['leaders'],
    leaderSkills: (leaderSkillsRes.data ?? []) as EngineInput['leaderSkills'],
    counselors: (counselorsRes.data ?? []) as EngineInput['counselors'],
    scoutInstructors: (scoutInstructorsRes.data ?? []) as EngineInput['scoutInstructors']
  };

  return { ok: true, payload: buildMeetingPlan(input) };
}

interface PublishResult {
  ok: boolean;
  error?: string;
}

/**
 * Publish a generated plan as the snapshot for its meeting date (one snapshot
 * per date — regenerating and republishing replaces it).
 */
export async function publishPlan(formData: FormData): Promise<PublishResult> {
  let session;
  try {
    session = await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const raw = String(formData.get('payload') ?? '');
  let payload: MeetingPlanPayload;
  try {
    payload = JSON.parse(raw) as MeetingPlanPayload;
  } catch {
    return { ok: false, error: 'Plan payload was malformed' };
  }
  if (!payload || payload.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(payload.meetingDate)) {
    return { ok: false, error: 'Plan payload was malformed' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_plans').upsert(
    {
      meeting_date: payload.meetingDate,
      title: payload.title,
      status: 'published',
      payload,
      generated_at: payload.generatedAt,
      generated_by: session.leader ?? null
    },
    { onConflict: 'meeting_date' }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/meeting-plan');
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}

/** Remove a published snapshot (e.g., meeting theme changed to an MB night). */
export async function unpublishPlan(formData: FormData): Promise<PublishResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const meetingDate = String(formData.get('meetingDate') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return { ok: false, error: 'Missing meeting date' };
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_plans').delete().eq('meeting_date', meetingDate);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/meeting-plan');
  revalidatePath('/admin/advancement/meeting-plan');
  return { ok: true };
}
