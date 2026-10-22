'use server';

/**
 * Roll Call writes.
 *
 * The cascade itself lives in `lib/attendance-admin.ts` so it can be tested
 * directly — qa-lead found a credit-duplication bug in this logic that a green
 * test suite had missed precisely because it was unreachable inside a server
 * action. This file is now the thin authenticated shell around it.
 */

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import {
  loadEntryContext as loadContext,
  recordAttendance,
  removeAttendance,
  seedAttendance,
  syncCredit,
  type EntryContext,
  type Result
} from '@/lib/attendance-admin';

function revalidateRollCall(entryId: number) {
  revalidatePath(`/admin/calendar/${entryId}/roll-call`);
  revalidatePath(`/admin/calendar/${entryId}`);
  revalidatePath('/admin/advancement/meetings');
  revalidatePath('/admin/advancement/audits');
}

/** The entry's context with the service-role client (lib/attendance-admin, shared with Meeting Live). */
async function loadEntryContext(entryId: number): Promise<EntryContext | null> {
  return loadContext(createAdminClient(), entryId);
}

export async function markAttended(
  entryId: number,
  personId: number,
  qty?: number | null,
  source: 'manual' | 'signup' = 'manual'
): Promise<Result> {
  const session = await requireCapability('advancement.write');
  const ctx = await loadEntryContext(entryId);
  if (!ctx) return { ok: false, error: 'That entry no longer exists.' };

  const result = await recordAttendance(createAdminClient(), ctx, personId, qty ?? null, source, session.label);
  revalidateRollCall(entryId);
  return result;
}

export async function markAbsent(entryId: number, personId: number): Promise<Result> {
  const session = await requireCapability('advancement.write');
  const ctx = await loadEntryContext(entryId);
  if (!ctx) return { ok: false, error: 'That entry no longer exists.' };

  // CREDIT FIRST, then attendance (the ordering rule in lib/attendance-admin): a failure part-way leaves
  // attendance-without-credit, never credit-without-attendance.
  const result = await removeAttendance(createAdminClient(), ctx, personId, session.label);
  if (!result.ok) return result;

  revalidateRollCall(entryId);
  return { ok: true };
}

/** Per-person quantity — the "came Saturday only" case. Zero nights still
 *  counts as an activity, a distinction the ledger alone cannot make. */
export async function setAttendanceQty(
  entryId: number,
  personId: number,
  qty: number
): Promise<Result> {
  const session = await requireCapability('advancement.write');
  const ctx = await loadEntryContext(entryId);
  if (!ctx) return { ok: false, error: 'That entry no longer exists.' };
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, error: 'Quantity must be zero or more.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('event_attendance')
    .update({ qty })
    .eq('calendar_entry_id', entryId)
    .eq('person_id', personId);
  if (error) return { ok: false, error: error.message };

  const result = await syncCredit(supabase, ctx, personId, qty, session.label);
  revalidateRollCall(entryId);
  return result;
}

/**
 * Seed the roll call from the signup's "yes" list in one step.
 *
 * Seeded rows are marked `source='signup'` for provenance only — they are
 * edited and removed exactly like hand-added ones, and the signup itself is
 * never touched by anything on this screen.
 */
export async function seedFromSignup(entryId: number): Promise<Result & { added?: number }> {
  const session = await requireCapability('advancement.write');
  const ctx = await loadEntryContext(entryId);
  if (!ctx) return { ok: false, error: 'That entry no longer exists.' };
  const supabase = createAdminClient();

  const { data: signup } = await supabase
    .from('event_signups')
    .select('id')
    .eq('calendar_entry_id', entryId)
    .maybeSingle();
  if (!signup) return { ok: false, error: 'This entry has no signup to seed from.' };

  const { data: entries } = await supabase
    .from('signup_entries')
    .select('person_id')
    .eq('event_signup_id', signup.id)
    .eq('status', 'yes');

  const personIds = (entries ?? [])
    .map((e) => e.person_id as number | null)
    .filter((id): id is number => id != null);

  // One authenticated context for the whole list, batched writes, one
  // revalidation — not a markAttended() round per name
  // (Plans/Performance-Review-2026-08-27.md #5).
  const { added, problems } = await seedAttendance(supabase, ctx, personIds, session.label);
  revalidateRollCall(entryId);
  return problems.length
    ? { ok: true, added, error: `${added} added; ${problems.length} failed.` }
    : { ok: true, added };
}
