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
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCalendarCategories } from '@/lib/calendar';
import { creditRuleFor, defaultQtyFor } from '@/lib/attendance-shared';
import {
  adoptLegacyCredit,
  retireCredit,
  scoutIdFor,
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

async function loadEntryContext(entryId: number): Promise<EntryContext | null> {
  const supabase = createAdminClient();
  const [{ data: entry }, categories] = await Promise.all([
    supabase
      .from('calendar_entries')
      .select('id, entry_date, end_date, category, title')
      .eq('id', entryId)
      .maybeSingle(),
    loadCalendarCategories()
  ]);
  if (!entry) return null;

  const rule = creditRuleFor(categories, entry.category as string);
  return {
    id: entry.id as number,
    entryDate: entry.entry_date as string,
    title: entry.title as string,
    creditKind: rule.creditKind,
    defaultQty: defaultQtyFor(
      rule.creditKind,
      entry.entry_date as string,
      (entry.end_date as string) ?? null
    )
  };
}

export async function markAttended(
  entryId: number,
  personId: number,
  qty?: number | null,
  source: 'manual' | 'signup' = 'manual'
): Promise<Result> {
  const session = await requireRole(['leader']);
  const ctx = await loadEntryContext(entryId);
  if (!ctx) return { ok: false, error: 'That entry no longer exists.' };

  const supabase = createAdminClient();
  const effectiveQty = qty ?? ctx.defaultQty;

  const { error: attErr } = await supabase.from('event_attendance').upsert(
    {
      calendar_entry_id: entryId,
      person_id: personId,
      qty: effectiveQty,
      source,
      recorded_by: session.leader
    },
    { onConflict: 'calendar_entry_id,person_id' }
  );
  if (attErr) return { ok: false, error: attErr.message };

  /*
   * Adopt any pre-Roll-Call credit BEFORE writing our own. The retired meetings
   * screen wrote MTG:<date> rows with no calendar_entry_id; syncCredit keys on
   * that column, so without this the first Roll Call of a meeting somebody was
   * already checked into would insert a second row for the same scout and date.
   */
  try {
    const scoutId = await scoutIdFor(supabase, personId);
    if (scoutId) await adoptLegacyCredit(supabase, ctx, scoutId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const creditResult = await syncCredit(supabase, ctx, personId, effectiveQty, session.leader);
  revalidateRollCall(entryId);
  return creditResult;
}

export async function markAbsent(entryId: number, personId: number): Promise<Result> {
  const session = await requireRole(['leader']);
  const ctx = await loadEntryContext(entryId);
  if (!ctx) return { ok: false, error: 'That entry no longer exists.' };

  const supabase = createAdminClient();

  /*
   * CREDIT FIRST, then attendance — the reverse of the obvious order.
   *
   * A failure part-way must leave attendance-without-credit (loud: the scout is
   * visibly short and the reconciliation audit says so), never
   * credit-without-attendance (quiet: a scout holds credit for an event they
   * were removed from). Deleting the attendance row first would produce exactly
   * the failure this design exists to avoid — flagged by qa-lead.
   */
  const creditResult = await retireCredit(supabase, ctx, personId, session.leader);
  if (!creditResult.ok) return creditResult;

  const { error } = await supabase
    .from('event_attendance')
    .delete()
    .eq('calendar_entry_id', entryId)
    .eq('person_id', personId);
  if (error) return { ok: false, error: error.message };

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
  const session = await requireRole(['leader']);
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

  const result = await syncCredit(supabase, ctx, personId, qty, session.leader);
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
  await requireRole(['leader']);
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

  let added = 0;
  const problems: string[] = [];
  for (const personId of personIds) {
    const res = await markAttended(entryId, personId, null, 'signup');
    if (res.ok) added += 1;
    else problems.push(res.error ?? 'unknown');
  }
  revalidateRollCall(entryId);
  return problems.length
    ? { ok: true, added, error: `${added} added; ${problems.length} failed.` }
    : { ok: true, added };
}
