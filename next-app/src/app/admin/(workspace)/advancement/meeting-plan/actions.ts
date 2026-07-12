'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import type { MeetingPlanPayload } from '@/lib/meeting-plan-types';
import { buildMeetingPlan } from './engine';
import { loadEngineInput } from './load-input';

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
