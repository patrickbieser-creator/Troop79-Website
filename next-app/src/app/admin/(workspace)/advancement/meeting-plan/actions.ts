'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import type { MeetingPlanPayload } from '@/lib/meeting-plan-types';
import { retargetPlan } from '@/lib/meeting-plan-publish';
import { buildMeetingPlan } from './engine';
import { loadEngineInput } from './load-input';
import { loadBoardStamp } from '@/lib/meeting-board';

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
    await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const meetingDate = String(formData.get('meetingDate') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim() || 'Troop Meeting';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return { ok: false, error: 'Pick a meeting date' };
  }

  const loaded = await loadEngineInput(meetingDate, title);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  return { ok: true, payload: buildMeetingPlan(loaded.input) };
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
    session = await requireCapability('meeting_plan.use');
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

  // The date the leader had selected when they hit Publish WINS over the one
  // baked into the payload. A plan is a reusable suggestion, so generating for
  // one date and publishing for another is legitimate; what was not legitimate
  // was publishing under the generated date while the field showed a different
  // one. See lib/meeting-plan-publish.ts.
  const selectedDate = String(formData.get('meetingDate') ?? '').trim();
  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    return { ok: false, error: 'Pick a meeting date' };
  }
  payload = retargetPlan(payload, selectedDate);

  const supabase = createAdminClient();
  const { error } = await supabase.from('meeting_plans').upsert(
    {
      meeting_date: payload.meetingDate,
      title: payload.title,
      status: 'published',
      payload,
      generated_at: payload.generatedAt,
      generated_by: session.label ?? null
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
    await requireCapability('meeting_plan.use');
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

export type BoardSettingsResult = { ok: true } | { ok: false; error: string };

/** The RPC's own messages are written for leaders; anything else (a constraint, a dropped connection) is not shown raw. */
const BOARD_KNOWN = /^(That meeting isn’t|That meeting has passed|Only troop meetings|Choose rank|Teaching blocks are|Choose the badge|That badge)/;

/**
 * This Sunday's board settings (Phase 3a): rank with 1-3 teaching blocks, merit badge with its badge (stations are
 * Phase 3b), or closed. One RPC (meeting_set_board) validates and upserts; picks are never touched.
 */
export async function setMeetingBoardAction(input: { entryId: number; mode: string; mbId: string | null; blockCount: number }): Promise<BoardSettingsResult> {
  let actor;
  try {
    actor = await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  // meeting_plan.use is also in the youth_leader bundle (SPL / PL): the board's mode is an adult leader's call, the
  // same line on-behalf entry draws.
  if (actor.subjectKind === 'scout') return { ok: false, error: 'Only an adult leader can change the board.' };
  if (!input || !Number.isInteger(input.entryId) || typeof input.mode !== 'string') return { ok: false, error: 'Malformed request' };
  const { error } = await createAdminClient().rpc('meeting_set_board', {
    p_entry: input.entryId,
    p_mode: input.mode,
    p_mb_id: input.mode === 'merit_badge' ? (input.mbId ?? null) : null,
    p_block_count: Number.isInteger(input.blockCount) ? input.blockCount : null
  });
  if (error) return { ok: false, error: BOARD_KNOWN.test(error.message) ? error.message : 'Couldn’t save the board. Try again.' };
  revalidatePath('/admin/advancement/meeting-plan');
  revalidatePath('/member/meeting');
  revalidatePath('/member');
  return { ok: true };
}

/**
 * This Sunday tab (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md): the board's version stamp, polled every
 * ~10 s; the tab refreshes only when it changes.
 */
export async function boardStampAction(entryId: number): Promise<{ ok: true; stamp: string } | { ok: false; error: string }> {
  try {
    await requireCapability('meeting_plan.use');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  if (!Number.isInteger(entryId)) return { ok: false, error: 'Malformed request' };
  try {
    return { ok: true, stamp: await loadBoardStamp(createAdminClient(), entryId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Stamp failed' };
  }
}
