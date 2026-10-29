'use server';

/**
 * "Would you like to update attendance?" (Build a Plan B8, kept by Meeting Planner III): after the meeting an editor
 * approves the checklist (lib/meeting-live loadAttendanceReview: the plan's scouts and teachers, Live's taps,
 * visitors). Only the differences are applied, against what Roll Call has NOW: `add` people not yet recorded are
 * recorded (ledger credit included); `remove` people still recorded are removed (credit retired first). Nobody is
 * removed unless named in `remove`. Everyone named must be on the checklist. Planner editors, the SPL included.
 */
import { revalidatePath } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { instantToCentral } from '@/lib/dates';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadEntryContext, recordAttendance, removeAttendance } from '@/lib/attendance-admin';
import { loadAttendanceReview, loadOverFacts } from '@/lib/meeting-live';
import { meetingIsOver } from '@/lib/meeting-live-shared';

export type RecordAttendanceResult = { ok: true; added: number; removed: number; failed: number } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const SAVE_FAILED = 'That didn’t save. Check your connection and try again.';
const NOT_OVER = 'Attendance is recorded once the meeting is over.';
const NOT_ON_LIST = 'Someone on that list isn’t on this meeting’s checklist. Reload and try again.';
const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 500 && v.every((n) => Number.isInteger(n) && n > 0);

export async function plannerRecordAttendanceAction(input: { entryId: number; add: number[]; remove: number[] }): Promise<RecordAttendanceResult> {
  if (!Number.isInteger(input?.entryId)) return fail('Malformed request');
  if (!isIdList(input.add) || !isIdList(input.remove)) return fail('Malformed request');
  const actor = await resolveAdminActor();
  if (!plannerAccess(actor).canEdit || actor?.personId == null) return fail('Only someone who can edit the Meeting Planner can do that.');
  const sb = createAdminClient();
  try {
    // A published troop meeting only: a crafted call can't reach a campout's Roll Call (B8 qa).
    const facts = await loadOverFacts(sb, input.entryId);
    if (!facts) return fail('That isn’t a troop meeting.');
    if (!meetingIsOver(facts, instantToCentral(new Date().toISOString()))) return fail(NOT_OVER);
    const review = await loadAttendanceReview(sb, facts.entryId, facts.date);
    const people = new Map(review.groups.flatMap((g) => g.people).map((p) => [p.personId, p]));
    if ([...input.add, ...input.remove].some((id) => !people.has(id))) return fail(NOT_ON_LIST);
    const ctx = await loadEntryContext(sb, facts.entryId);
    if (!ctx) return fail('That meeting is no longer on the calendar.');
    const toAdd = [...new Set(input.add)].filter((id) => !people.get(id)!.recorded);
    const toRemove = [...new Set(input.remove)].filter((id) => people.get(id)!.recorded && !input.add.includes(id));
    let added = 0;
    let removed = 0;
    let failed = 0;
    for (const id of toAdd) {
      const r = await recordAttendance(sb, ctx, id, null, 'manual', actor.label);
      if (r.ok) added++;
      else failed++;
    }
    for (const id of toRemove) {
      const r = await removeAttendance(sb, ctx, id, actor.label);
      if (r.ok) removed++;
      else failed++;
    }
    if (failed) console.error(`Record attendance for entry ${facts.entryId}: ${failed} not saved`);
    revalidatePath('/planner');
    return { ok: true, added, removed, failed };
  } catch {
    return fail(SAVE_FAILED);
  }
}

/**
 * No thanks (Patrick, 2026-10-29): the prompt goes away for this meeting, for every editor, and nothing is recorded.
 * Planner editors only, on a troop meeting that is over.
 */
export async function plannerDismissAttendanceAction(input: { entryId: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(input?.entryId)) return fail('Malformed request');
  const actor = await resolveAdminActor();
  if (!plannerAccess(actor).canEdit || actor?.personId == null) return fail('Only someone who can edit the Meeting Planner can do that.');
  const sb = createAdminClient();
  const facts = await loadOverFacts(sb, input.entryId);
  if (!facts) return fail('That isn’t a troop meeting.');
  if (!meetingIsOver(facts, instantToCentral(new Date().toISOString()))) return fail(NOT_OVER);
  const { error } = await sb
    .from('meeting_boards')
    .upsert({ calendar_entry_id: facts.entryId, attendance_dismissed_at: new Date().toISOString(), attendance_dismissed_by: actor.label.slice(0, 200), updated_at: new Date().toISOString() }, { onConflict: 'calendar_entry_id' });
  if (error) return fail(SAVE_FAILED);
  revalidatePath('/planner');
  return { ok: true };
}
