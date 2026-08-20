'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { syncCredit } from '@/lib/attendance-admin';
import { ledgerCodeFor, type CreditKind } from '@/lib/attendance-shared';

/**
 * The Audits section's one write path, shared by every check: backfilling
 * requirement rows a leader confirms were actually completed but never
 * logged. Same requireCapability('advancement.write')/createAdminClient() gate as every other
 * advancement actions file.
 */

interface Result {
  ok: boolean;
  error?: string;
  inserted: number;
}

interface MissingItem {
  code: string; // full ledger code, e.g. "tenderfoot-4a.3" or "second-class-1a"
  label: string;
}

export async function fillMissingRankRequirements(formData: FormData): Promise<Result> {
  let session;
  try {
    session = await requireCapability('advancement.write');
  } catch {
    return { ok: false, error: 'Not authenticated', inserted: 0 };
  }

  const scoutId = String(formData.get('scout_id') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim();
  const by = String(formData.get('by') ?? '').trim();
  const itemsJson = String(formData.get('items') ?? '[]');

  if (!scoutId) return { ok: false, error: 'Missing scout', inserted: 0 };
  if (!date) return { ok: false, error: 'Date is required', inserted: 0 };
  if (!by) return { ok: false, error: 'Signed-Off By is required', inserted: 0 };

  let items: MissingItem[];
  try {
    items = JSON.parse(itemsJson) as MissingItem[];
  } catch {
    return { ok: false, error: 'Items payload was malformed', inserted: 0 };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Select at least one requirement to fill in', inserted: 0 };
  }

  const supabase = createAdminClient();
  const rows = items.map((it) => ({
    scout_id: scoutId,
    date,
    kind: 'rank_requirement' as const,
    code: it.code,
    label: it.label,
    by,
    entered_by: session.label,
    entered_at: new Date().toISOString()
  }));

  const { error } = await supabase.from('ledger_entries').insert(rows);
  if (error) return { ok: false, error: error.message, inserted: 0 };

  revalidatePath('/admin/advancement/audits');
  revalidatePath('/admin/advancement/dashboard');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath(`/scouts/${scoutId}`);

  return { ok: true, inserted: rows.length };
}

interface ResolveResult {
  ok: boolean;
  error?: string;
  deleted: number;
}

/**
 * Duplicate-records fix: soft-deletes every row in a duplicate group except
 * the one the leader picked to keep — same audit trail (deleted_at/by/reason)
 * as a manual Universal Ledger delete, just applied to N-1 rows at once.
 */
export async function resolveDuplicateLedgerEntries(formData: FormData): Promise<ResolveResult> {
  let session;
  try {
    session = await requireCapability('advancement.write');
  } catch {
    return { ok: false, error: 'Not authenticated', deleted: 0 };
  }

  const keepId = Number(formData.get('keep_id'));
  const scoutId = String(formData.get('scout_id') ?? '').trim();
  const deleteIdsJson = String(formData.get('delete_ids') ?? '[]');
  if (!Number.isFinite(keepId) || keepId <= 0) {
    return { ok: false, error: 'Invalid record to keep', deleted: 0 };
  }

  let deleteIds: number[];
  try {
    deleteIds = JSON.parse(deleteIdsJson) as number[];
  } catch {
    return { ok: false, error: 'Malformed request', deleted: 0 };
  }
  if (!Array.isArray(deleteIds) || deleteIds.length === 0) {
    return { ok: false, error: 'Nothing to delete', deleted: 0 };
  }

  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from('ledger_entries')
    .update(
      {
        deleted_at: new Date().toISOString(),
        deleted_by: session.label,
        deleted_reason: `Duplicate — kept #${keepId} via Audits`
      },
      { count: 'exact' }
    )
    .in('id', deleteIds);
  if (error) return { ok: false, error: error.message, deleted: 0 };

  revalidatePath('/admin/advancement/audits');
  revalidatePath('/admin/advancement/dashboard');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  if (scoutId) revalidatePath(`/scouts/${scoutId}`);

  return { ok: true, deleted: count ?? deleteIds.length };
}

/**
 * Resolve actions for the Roll Call & Ledger Reconciliation check.
 *
 * The section stayed read-only for a while on the reasoning that there's no
 * obviously-right row to keep — a leader has to decide, not a button that
 * guesses. That's still true for credit_orphaned and qty_mismatch, so those
 * two offer BOTH choices rather than picking one; credit_missing and
 * date_drift each have exactly one right answer (write what Roll Call should
 * have written; follow the event's own date), so those resolve directly.
 *
 * credit_missing reuses syncCredit — the same write cascade Roll Call itself
 * calls — rather than a bespoke insert, so a resolved finding is
 * indistinguishable from one that never went wrong.
 */

const AUDIT_REVALIDATE_PATHS = [
  '/admin/advancement/audits',
  '/admin/advancement/dashboard',
  '/admin/advancement/ledger',
  '/admin/advancement/fast-entry'
] as const;

function revalidateAudits(scoutId?: string) {
  for (const p of AUDIT_REVALIDATE_PATHS) revalidatePath(p);
  if (scoutId) revalidatePath(`/scouts/${scoutId}`);
}

type ReconcileResult = { ok: boolean; error?: string };

/** credit_missing: write the credit Roll Call should have written. */
export async function resolveMissingCredit(formData: FormData): Promise<ReconcileResult> {
  let session;
  try {
    session = await requireCapability('advancement.write');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const calendarEntryId = Number(formData.get('calendar_entry_id'));
  const personId = Number(formData.get('person_id'));
  const qty = Number(formData.get('qty'));
  if (!Number.isFinite(calendarEntryId) || !Number.isFinite(personId)) {
    return { ok: false, error: 'Malformed request' };
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: 'Roll Call has no quantity recorded for this person — fix it there first.' };
  }

  const supabase = createAdminClient();
  const { data: entry } = await supabase
    .from('calendar_entries')
    .select('id, entry_date, title, category')
    .eq('id', calendarEntryId)
    .single();
  if (!entry) return { ok: false, error: 'Calendar entry no longer exists.' };
  const { data: cat } = await supabase
    .from('calendar_categories')
    .select('credit_kind')
    .eq('label', entry.category)
    .maybeSingle();
  const creditKind = (cat?.credit_kind ?? null) as CreditKind | null;

  const res = await syncCredit(
    supabase,
    { id: entry.id, entryDate: entry.entry_date, title: entry.title, creditKind, defaultQty: qty },
    personId,
    qty,
    session.label
  );
  if (!res.ok) return { ok: false, error: res.error };

  revalidateAudits();
  return { ok: true };
}

/** credit_orphaned, choice A: they really were there — add the attendance
 *  record Roll Call is missing, matching the credit that's already on file. */
export async function addAttendanceForOrphanedCredit(formData: FormData): Promise<ReconcileResult> {
  let session;
  try {
    session = await requireCapability('advancement.write');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const calendarEntryId = Number(formData.get('calendar_entry_id'));
  const personId = Number(formData.get('person_id'));
  const qty = Number(formData.get('qty'));
  if (!Number.isFinite(calendarEntryId) || !Number.isFinite(personId) || !Number.isFinite(qty)) {
    return { ok: false, error: 'Malformed request' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('event_attendance').upsert(
    {
      calendar_entry_id: calendarEntryId,
      person_id: personId,
      qty,
      source: 'manual',
      recorded_by: session.label
    },
    { onConflict: 'calendar_entry_id,person_id' }
  );
  if (error) return { ok: false, error: error.message };

  revalidateAudits();
  return { ok: true };
}

/** credit_orphaned, choice B: they weren't there after all — retire the
 *  credit. Soft delete, same trail as a manual Universal Ledger delete. */
export async function retireOrphanedCredit(formData: FormData): Promise<ReconcileResult> {
  let session;
  try {
    session = await requireCapability('advancement.write');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const ledgerEntryId = Number(formData.get('ledger_entry_id'));
  const scoutId = String(formData.get('scout_id') ?? '').trim();
  if (!Number.isFinite(ledgerEntryId) || ledgerEntryId <= 0) {
    return { ok: false, error: 'Malformed request' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ledger_entries')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: session.label,
      deleted_reason: 'No Roll Call attendance record for this event — resolved via Audits'
    })
    .eq('id', ledgerEntryId)
    .is('deleted_at', null);
  if (error) return { ok: false, error: error.message };

  revalidateAudits(scoutId || undefined);
  return { ok: true };
}

/** qty_mismatch: the leader picks which side is right; the other side is
 *  brought in line with it. Never averaged or guessed. */
export async function resolveQtyMismatch(formData: FormData): Promise<ReconcileResult> {
  try {
    await requireCapability('advancement.write');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const useSide = String(formData.get('use'));
  const ledgerEntryId = Number(formData.get('ledger_entry_id'));
  const calendarEntryId = Number(formData.get('calendar_entry_id'));
  const personId = Number(formData.get('person_id'));
  const rollCallQty = Number(formData.get('roll_call_qty'));
  const ledgerQty = Number(formData.get('ledger_qty'));
  if (
    (useSide !== 'roll_call' && useSide !== 'ledger') ||
    !Number.isFinite(ledgerEntryId) ||
    !Number.isFinite(calendarEntryId) ||
    !Number.isFinite(personId)
  ) {
    return { ok: false, error: 'Malformed request' };
  }

  const supabase = createAdminClient();
  if (useSide === 'roll_call') {
    if (!Number.isFinite(rollCallQty)) return { ok: false, error: 'Malformed request' };
    const { error } = await supabase.from('ledger_entries').update({ qty: rollCallQty }).eq('id', ledgerEntryId);
    if (error) return { ok: false, error: error.message };
  } else {
    if (!Number.isFinite(ledgerQty)) return { ok: false, error: 'Malformed request' };
    const { error } = await supabase
      .from('event_attendance')
      .update({ qty: ledgerQty })
      .eq('calendar_entry_id', calendarEntryId)
      .eq('person_id', personId);
    if (error) return { ok: false, error: error.message };
  }

  revalidateAudits();
  return { ok: true };
}

/** date_drift: the event's own date is always authoritative — the credit
 *  follows it, never the other way around. Recomputes `code` too, since a
 *  meeting's code embeds its date (ledgerCodeFor). */
export async function resolveDateDrift(formData: FormData): Promise<ReconcileResult> {
  try {
    await requireCapability('advancement.write');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const ledgerEntryId = Number(formData.get('ledger_entry_id'));
  const calendarEntryId = Number(formData.get('calendar_entry_id'));
  if (!Number.isFinite(ledgerEntryId) || !Number.isFinite(calendarEntryId)) {
    return { ok: false, error: 'Malformed request' };
  }

  const supabase = createAdminClient();
  const { data: entry } = await supabase
    .from('calendar_entries')
    .select('entry_date')
    .eq('id', calendarEntryId)
    .single();
  if (!entry) return { ok: false, error: 'Calendar entry no longer exists.' };

  const { data: ledgerRow } = await supabase
    .from('ledger_entries')
    .select('kind')
    .eq('id', ledgerEntryId)
    .single();
  const update: { date: string; code?: string } = { date: entry.entry_date };
  if (ledgerRow?.kind) {
    update.code = ledgerCodeFor(ledgerRow.kind as CreditKind, calendarEntryId, entry.entry_date);
  }

  const { error } = await supabase.from('ledger_entries').update(update).eq('id', ledgerEntryId);
  if (error) return { ok: false, error: error.message };

  revalidateAudits();
  return { ok: true };
}
