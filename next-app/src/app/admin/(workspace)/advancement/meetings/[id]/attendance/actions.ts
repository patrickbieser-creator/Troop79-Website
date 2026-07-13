'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';

type ActionResult = { ok: boolean; error?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RollCallPayload {
  meetingId: number;
  meetingDate: string;
  meetingTitle: string;
  scoutIds: string[];
  leaderCodes: string[];
  /** Leader code stored in the ledger's `by` column. Optional. */
  recordedBy: string | null;
}

/**
 * Replace-on-save roll call for one meeting.
 *
 * Scouts: ledger rows (kind='meeting_attendance', code='MTG:<date>').
 * Newly checked scouts get an insert; unchecked scouts get their row
 * soft-deleted (standard ledger integrity — recoverable via Show Hidden).
 *
 * Leaders: upsert into meeting_attendance_leaders with status='attended'
 * (upgrading a future 'committed' signup in place); unchecking hard-deletes
 * only 'attended' rows — 'committed' rows are plan data and survive roll call.
 */
export async function saveRollCall(payload: RollCallPayload): Promise<ActionResult> {
  const session = await requireRole(['leader']);
  const { meetingId, meetingDate, scoutIds, leaderCodes } = payload;
  if (!meetingId || !DATE_RE.test(meetingDate)) return { ok: false, error: 'Malformed roll call.' };

  const supabase = createAdminClient();
  const code = `MTG:${meetingDate}`;
  const now = new Date().toISOString();

  // ── scouts (ledger) ──────────────────────────────────────────────────────
  const { data: existing, error: readErr } = await supabase
    .from('ledger_active')
    .select('id, scout_id')
    .eq('kind', 'meeting_attendance')
    .eq('code', code);
  if (readErr) return { ok: false, error: readErr.message };

  const existingByScout = new Map((existing ?? []).map((r) => [r.scout_id as string, r.id as number]));
  const checked = new Set(scoutIds);

  const inserts = scoutIds
    .filter((id) => !existingByScout.has(id))
    .map((scout_id) => ({
      scout_id,
      date: meetingDate,
      kind: 'meeting_attendance',
      code,
      label: payload.meetingTitle || 'Troop Meeting',
      by: payload.recordedBy,
      qty: 1,
      unit: 'meeting',
      entered_by: session.leader
    }));
  if (inserts.length > 0) {
    const { error } = await supabase.from('ledger_entries').insert(inserts);
    if (error) return { ok: false, error: error.message };
  }

  const removeIds = (existing ?? [])
    .filter((r) => !checked.has(r.scout_id as string))
    .map((r) => r.id as number);
  if (removeIds.length > 0) {
    const { error } = await supabase
      .from('ledger_entries')
      .update({ deleted_at: now, deleted_by: session.leader, deleted_reason: 'Unchecked at roll call' })
      .in('id', removeIds);
    if (error) return { ok: false, error: error.message };
  }

  // ── leaders (meeting_attendance_leaders) ─────────────────────────────────
  if (leaderCodes.length > 0) {
    const { error } = await supabase
      .from('meeting_attendance_leaders')
      .upsert(
        leaderCodes.map((leader_code) => ({
          meeting_date: meetingDate,
          leader_code,
          status: 'attended'
        })),
        { onConflict: 'meeting_date,leader_code' }
      );
    if (error) return { ok: false, error: error.message };
  }
  {
    let del = supabase
      .from('meeting_attendance_leaders')
      .delete()
      .eq('meeting_date', meetingDate)
      .eq('status', 'attended');
    if (leaderCodes.length > 0) {
      del = del.not('leader_code', 'in', `(${leaderCodes.map((c) => `"${c}"`).join(',')})`);
    }
    const { error } = await del;
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath('/admin/advancement/meetings');
  revalidatePath(`/admin/advancement/meetings/${meetingId}`);
  revalidatePath(`/admin/advancement/meetings/${meetingId}/attendance`);
  revalidatePath('/admin/advancement/meetings/report');
  return { ok: true };
}
