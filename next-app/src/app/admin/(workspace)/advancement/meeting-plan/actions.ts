'use server';

import { requireCapability } from '@/lib/require-capability';
import type { MeetingPlanPayload } from '@/lib/meeting-plan-types';
import { buildMeetingPlan } from '@/lib/meeting-suggest/engine';
import { loadEngineInput } from '@/lib/meeting-suggest/load-input';

interface GenerateResult {
  ok: boolean;
  payload?: MeetingPlanPayload;
  error?: string;
}

/**
 * Compute the ledger engine's suggestions for the given date — pure read + engine pass, no DB writes. By Scout and
 * Teaching Roster read it (Build a Plan B4: Publish to Site retired).
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
