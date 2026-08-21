import type { SupabaseClient } from '@supabase/supabase-js';
import { ledgerCodeFor, type CreditKind } from '@/lib/attendance-shared';

export interface CalendarEntryDependents {
  attendanceCount: number;
  creditCount: number;
  names: string[];
}

/**
 * Who/what would be affected by deleting this calendar entry — the dry-run
 * info shown before a destructive delete, same pattern as
 * `slotClaimants`/`questionAnswers` in event-signup-admin.ts.
 *
 * The two dependent tables have different, asymmetric fates on delete
 * (`20260814140000_roll_call_additive.sql`):
 *   - event_attendance.calendar_entry_id  ON DELETE CASCADE  — gone for good.
 *   - ledger_entries.calendar_entry_id    ON DELETE SET NULL — the credit
 *     survives, but loses its link to the event and drops out of the Roll
 *     Call/Ledger reconciliation audit's read (attendance-reconciliation.ts
 *     only reads rows where calendar_entry_id is not null).
 *
 * Found the hard way 2026-08-20: a deleted duplicate calendar entry silently
 * orphaned its ledger credit, which then looked like a stray "duplicate" row
 * in the Advancement Ledger and got bulk-deleted for real — wiping the actual
 * credit for the whole event roster. Both counts are surfaced here so a
 * leader sees the full blast radius before either fate can happen.
 */
export async function calendarEntryDependents(
  admin: SupabaseClient,
  calendarEntryId: number
): Promise<CalendarEntryDependents> {
  const [attendanceRes, creditRes] = await Promise.all([
    admin.from('event_attendance').select('person_id').eq('calendar_entry_id', calendarEntryId),
    admin
      .from('ledger_entries')
      .select('scout_id')
      .eq('calendar_entry_id', calendarEntryId)
      .is('deleted_at', null)
  ]);
  const attendance = (attendanceRes.data ?? []) as { person_id: number }[];
  const credits = (creditRes.data ?? []) as { scout_id: string }[];

  if (attendance.length === 0 && credits.length === 0) {
    return { attendanceCount: 0, creditCount: 0, names: [] };
  }

  const scoutIds = [...new Set(credits.map((c) => c.scout_id))];
  const { data: scoutData } = scoutIds.length
    ? await admin.from('scouts').select('id, person_id').in('id', scoutIds)
    : { data: [] as { id: string; person_id: number | null }[] };
  const personByScout = new Map(
    ((scoutData ?? []) as { id: string; person_id: number | null }[]).map((s) => [s.id, s.person_id])
  );

  const personIds = new Set<number>();
  for (const a of attendance) personIds.add(a.person_id);
  for (const pid of personByScout.values()) {
    if (pid != null) personIds.add(pid);
  }

  const { data: peopleData } = personIds.size
    ? await admin.from('people').select('id, display_name').in('id', [...personIds])
    : { data: [] as { id: number; display_name: string }[] };
  const nameByPerson = new Map(
    ((peopleData ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name])
  );

  const names = new Set<string>();
  for (const a of attendance) names.add(nameByPerson.get(a.person_id) ?? 'Unknown');
  for (const c of credits) {
    const pid = personByScout.get(c.scout_id);
    names.add((pid != null ? nameByPerson.get(pid) : undefined) ?? c.scout_id);
  }

  return {
    attendanceCount: attendance.length,
    creditCount: credits.length,
    names: [...names].sort()
  };
}

export interface CalendarEntryMergeConflict {
  table: 'event_signups' | 'meetings';
  detail: string;
}

export interface CalendarEntryMergePlan {
  keepId: number;
  loseId: number;
  attendanceMoved: number;
  attendanceSuperseded: number; // duplicate person already on keepId — dropped, not moved
  creditMoved: number;
  creditSuperseded: number; // duplicate scout already has active credit on keepId — soft-deleted, not moved
  resourcesMoved: number;
  signupMoved: boolean;
  meetingMoved: boolean;
  /** Non-empty means the merge cannot proceed — reported to the leader
   *  instead of guessed at. Matches the reconciliation audit's own posture
   *  (types.ts / page.tsx): when there's no obviously-right row to keep,
   *  a human decides, not a merge that silently picks one. */
  conflicts: CalendarEntryMergeConflict[];
}

interface EntryLite {
  id: number;
  entry_date: string;
  title: string;
}

async function loadEntry(admin: SupabaseClient, id: number): Promise<EntryLite | null> {
  const { data } = await admin.from('calendar_entries').select('id, entry_date, title').eq('id', id).single();
  return (data as EntryLite | null) ?? null;
}

/**
 * What merging `loseId` into `keepId` would do — the dry-run behind the
 * Merge action, same confirm=false-first shape as deleteCalendarEntry.
 *
 * calendar_entries has five dependents, and they don't all behave the same
 * way (`20260814140000_roll_call_additive.sql`):
 *   - event_resources: no uniqueness constraint — every row moves cleanly.
 *   - event_attendance: unique(calendar_entry_id, person_id) — a person
 *     already marked present on keepId can't gain a second row; loseId's
 *     row for them is superseded (dropped) instead of moved.
 *   - ledger_entries: unique(calendar_entry_id, scout_id) — same shape, but
 *     the loser's row is SOFT-deleted (never destroyed) rather than dropped,
 *     matching the Advancement Ledger's own delete semantics.
 *   - event_signups / meetings: unique per calendar_entry_id (at most one
 *     each). If BOTH entries have one, there is no right answer to guess —
 *     that's a conflict the leader resolves by hand first (remove the stray
 *     signup or agenda from whichever entry shouldn't keep it), same
 *     philosophy as the reconciliation audit staying read-only.
 */
export async function planCalendarEntryMerge(
  admin: SupabaseClient,
  keepId: number,
  loseId: number
): Promise<CalendarEntryMergePlan> {
  const conflicts: CalendarEntryMergeConflict[] = [];

  const [signupRes, meetingRes, attendanceKeepRes, attendanceLoseRes, creditKeepRes, creditLoseRes, resourcesRes] =
    await Promise.all([
      admin.from('event_signups').select('calendar_entry_id').in('calendar_entry_id', [keepId, loseId]),
      admin.from('meetings').select('calendar_entry_id').in('calendar_entry_id', [keepId, loseId]),
      admin.from('event_attendance').select('person_id').eq('calendar_entry_id', keepId),
      admin.from('event_attendance').select('person_id').eq('calendar_entry_id', loseId),
      admin.from('ledger_entries').select('scout_id').eq('calendar_entry_id', keepId).is('deleted_at', null),
      admin.from('ledger_entries').select('scout_id').eq('calendar_entry_id', loseId).is('deleted_at', null),
      admin.from('event_resources').select('id').eq('calendar_entry_id', loseId)
    ]);

  const signupIds = new Set(((signupRes.data ?? []) as { calendar_entry_id: number }[]).map((r) => r.calendar_entry_id));
  const meetingIds = new Set(((meetingRes.data ?? []) as { calendar_entry_id: number }[]).map((r) => r.calendar_entry_id));
  if (signupIds.has(keepId) && signupIds.has(loseId)) {
    conflicts.push({
      table: 'event_signups',
      detail: 'Both entries have their own signup — remove or reassign one manually before merging.'
    });
  }
  if (meetingIds.has(keepId) && meetingIds.has(loseId)) {
    conflicts.push({
      table: 'meetings',
      detail: 'Both entries have their own meeting agenda — remove or reassign one manually before merging.'
    });
  }

  const attendanceKeepSet = new Set(
    ((attendanceKeepRes.data ?? []) as { person_id: number }[]).map((r) => r.person_id)
  );
  const attendanceLose = (attendanceLoseRes.data ?? []) as { person_id: number }[];
  const attendanceSuperseded = attendanceLose.filter((a) => attendanceKeepSet.has(a.person_id)).length;

  const creditKeepSet = new Set(((creditKeepRes.data ?? []) as { scout_id: string }[]).map((r) => r.scout_id));
  const creditLose = (creditLoseRes.data ?? []) as { scout_id: string }[];
  const creditSuperseded = creditLose.filter((c) => creditKeepSet.has(c.scout_id)).length;

  return {
    keepId,
    loseId,
    attendanceMoved: attendanceLose.length - attendanceSuperseded,
    attendanceSuperseded,
    creditMoved: creditLose.length - creditSuperseded,
    creditSuperseded,
    resourcesMoved: (resourcesRes.data ?? []).length,
    signupMoved: signupIds.has(loseId) && !signupIds.has(keepId),
    meetingMoved: meetingIds.has(loseId) && !meetingIds.has(keepId),
    conflicts
  };
}

export type MergeResult = { ok: boolean; error?: string };

/**
 * Execute the merge. Recomputes and re-checks the plan itself rather than
 * trusting a plan object handed in from an earlier dry-run render — the
 * conflict check must be live at write time, not stale from whenever the
 * leader loaded the confirm dialog.
 */
export async function executeCalendarEntryMerge(
  admin: SupabaseClient,
  keepId: number,
  loseId: number,
  by: string
): Promise<MergeResult> {
  const plan = await planCalendarEntryMerge(admin, keepId, loseId);
  if (plan.conflicts.length > 0) {
    return { ok: false, error: plan.conflicts.map((c) => c.detail).join(' ') };
  }

  const keepEntry = await loadEntry(admin, keepId);
  if (!keepEntry) return { ok: false, error: 'The entry to keep no longer exists.' };

  // event_resources — no uniqueness, every row moves.
  {
    const { error } = await admin
      .from('event_resources')
      .update({ calendar_entry_id: keepId })
      .eq('calendar_entry_id', loseId);
    if (error) return { ok: false, error: `Could not move resources: ${error.message}` };
  }

  // event_signups / meetings — plan already guarantees at most one side has
  // one, so a blind reassign of whichever exists on loseId is safe.
  if (plan.signupMoved) {
    const { error } = await admin
      .from('event_signups')
      .update({ calendar_entry_id: keepId })
      .eq('calendar_entry_id', loseId);
    if (error) return { ok: false, error: `Could not move the signup: ${error.message}` };
  }
  if (plan.meetingMoved) {
    const { error } = await admin
      .from('meetings')
      .update({ calendar_entry_id: keepId })
      .eq('calendar_entry_id', loseId);
    if (error) return { ok: false, error: `Could not move the meeting agenda: ${error.message}` };
  }

  // event_attendance — drop the ones keepId already has, move the rest.
  {
    const { data: keepRows } = await admin
      .from('event_attendance')
      .select('person_id')
      .eq('calendar_entry_id', keepId);
    const keepPersonIds = ((keepRows ?? []) as { person_id: number }[]).map((r) => r.person_id);
    if (keepPersonIds.length > 0) {
      const { error } = await admin
        .from('event_attendance')
        .delete()
        .eq('calendar_entry_id', loseId)
        .in('person_id', keepPersonIds);
      if (error) return { ok: false, error: `Could not drop duplicate attendance: ${error.message}` };
    }
    const { error } = await admin
      .from('event_attendance')
      .update({ calendar_entry_id: keepId })
      .eq('calendar_entry_id', loseId);
    if (error) return { ok: false, error: `Could not move attendance: ${error.message}` };
  }

  // ledger_entries — soft-delete the ones keepId already holds active credit
  // for (same trail as a manual Advancement Ledger delete); repoint the rest to
  // keepId, refreshing date/label/code so they read as keepId's credit, not
  // a stale copy of the entry that's about to be gone.
  {
    const { data: keepRows } = await admin
      .from('ledger_entries')
      .select('scout_id')
      .eq('calendar_entry_id', keepId)
      .is('deleted_at', null);
    const keepScoutIds = new Set(((keepRows ?? []) as { scout_id: string }[]).map((r) => r.scout_id));

    const { data: loseRows } = await admin
      .from('ledger_entries')
      .select('id, scout_id, kind')
      .eq('calendar_entry_id', loseId)
      .is('deleted_at', null);
    const loseCredits = (loseRows ?? []) as { id: number; scout_id: string; kind: CreditKind }[];

    const supersedeIds = loseCredits.filter((c) => keepScoutIds.has(c.scout_id)).map((c) => c.id);
    if (supersedeIds.length > 0) {
      const { error } = await admin
        .from('ledger_entries')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: by,
          deleted_reason: `Duplicate — merged into calendar entry #${keepId} via Merge`
        })
        .in('id', supersedeIds);
      if (error) return { ok: false, error: `Could not supersede duplicate credit: ${error.message}` };
    }

    const toMove = loseCredits.filter((c) => !keepScoutIds.has(c.scout_id));
    for (const credit of toMove) {
      const { error } = await admin
        .from('ledger_entries')
        .update({
          calendar_entry_id: keepId,
          date: keepEntry.entry_date,
          label: keepEntry.title,
          code: ledgerCodeFor(credit.kind, keepId, keepEntry.entry_date)
        })
        .eq('id', credit.id);
      if (error) return { ok: false, error: `Could not move credit for ${credit.scout_id}: ${error.message}` };
    }
  }

  // Every live dependent has been repointed or resolved — the loser is now
  // safe to remove. Any already-soft-deleted ledger rows still carrying
  // loseId (e.g. earlier duplicate cleanup) just SET NULL, same as any other
  // delete; they're excluded from everything downstream already.
  const { error } = await admin.from('calendar_entries').delete().eq('id', loseId);
  if (error) return { ok: false, error: `Could not remove the merged entry: ${error.message}` };

  return { ok: true };
}
