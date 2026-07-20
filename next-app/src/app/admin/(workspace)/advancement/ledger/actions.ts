'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import type { LedgerKind } from '@/lib/supabase/types';

const VALID_KINDS: ReadonlySet<LedgerKind> = new Set<LedgerKind>([
  'rank_requirement',
  'rank_award',
  'merit_badge_requirement',
  'merit_badge_award',
  'service_hours',
  'camping_nights',
  'hiking_miles',
  'day_outing',
  'fundraiser',
  'leadership',
  'award'
]);

/**
 * Ledger row actions. Because we don't have real Supabase Auth yet, these
 * mutations use the service-role client. The leader-session proxy already
 * gates /admin/* routes, so this is the same effective access control we'll
 * have once real auth + tightened RLS lands — just enforced at the route
 * layer instead of the DB layer for now.
 */

async function leaderInitials(): Promise<string> {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  return session?.leader ?? 'admin';
}

async function ensureLeader() {
  return requireRole(['leader']);
}

export async function archiveLedgerEntry(formData: FormData): Promise<void> {
  await ensureLeader();
  const id = Number(formData.get('id'));
  const reason = String(formData.get('reason') ?? '').trim() || null;
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid id');

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ledger_entries')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: await leaderInitials(),
      archived_reason: reason
    })
    .eq('id', id);
  if (error) throw new Error(`archive failed: ${error.message}`);
  revalidatePath('/admin/advancement/ledger');
}

export async function softDeleteLedgerEntry(formData: FormData): Promise<void> {
  await ensureLeader();
  const id = Number(formData.get('id'));
  const reason = String(formData.get('reason') ?? '').trim();
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid id');
  if (!reason) throw new Error('Reason required when deleting a ledger row.');

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ledger_entries')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: await leaderInitials(),
      deleted_reason: reason
    })
    .eq('id', id);
  if (error) throw new Error(`delete failed: ${error.message}`);
  revalidatePath('/admin/advancement/ledger');
}

interface UpdateResult {
  ok: boolean;
  error?: string;
}

/**
 * Updates the editable fields of a ledger entry: date, scout_id, kind, code,
 * label, by, qty, unit, notes. Audit columns (entered_*, archived_*,
 * deleted_*) are NOT touched — those are write-once or set by their own
 * dedicated actions.
 */
export async function updateLedgerEntry(formData: FormData): Promise<UpdateResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid id' };

  const date = String(formData.get('date') ?? '').trim();
  const scoutId = String(formData.get('scout_id') ?? '').trim();
  const kindRaw = String(formData.get('kind') ?? '').trim() as LedgerKind;
  const code = String(formData.get('code') ?? '').trim();
  const label = String(formData.get('label') ?? '').trim();
  const by = String(formData.get('by') ?? '').trim();
  const qtyRaw = String(formData.get('qty') ?? '1').trim();
  const unit = String(formData.get('unit') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();

  if (!date) return { ok: false, error: 'Date is required' };
  if (!scoutId) return { ok: false, error: 'Scout is required' };
  if (!VALID_KINDS.has(kindRaw)) return { ok: false, error: 'Invalid kind' };
  if (!code) return { ok: false, error: 'Code is required' };
  const qty = Number(qtyRaw);
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, error: 'Qty must be a number' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ledger_entries')
    .update({
      date,
      scout_id: scoutId,
      kind: kindRaw,
      code,
      label: label || null,
      by: by || null,
      qty,
      unit: unit || 'complete',
      notes: notes || null
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/admin/advancement/dashboard');
  return { ok: true };
}

interface BulkResult {
  ok: boolean;
  updated: number;
  error?: string;
}

function parseIds(formData: FormData): number[] {
  let ids: unknown;
  try {
    ids = JSON.parse(String(formData.get('ids') ?? '[]'));
  } catch {
    return [];
  }
  if (!Array.isArray(ids)) return [];
  return ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Bulk-edits the SAFE fields (date, scout_id, by, qty, unit, notes) across
 * many selected rows at once. Only the fields present in `patch` are
 * written, so the caller can change just the signer or just the date and
 * leave everything else per-row untouched. Kind, Code, and Description are
 * intentionally NOT bulk-editable — those stay one-row-at-a-time to avoid
 * clobbering row-specific data.
 */
export async function bulkUpdateLedgerEntries(formData: FormData): Promise<BulkResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, updated: 0, error: 'Not authenticated' };
  }

  const ids = parseIds(formData);
  if (ids.length === 0) return { ok: false, updated: 0, error: 'No rows selected' };

  let patchRaw: Record<string, unknown>;
  try {
    patchRaw = JSON.parse(String(formData.get('patch') ?? '{}')) as Record<string, unknown>;
  } catch {
    return { ok: false, updated: 0, error: 'Malformed patch' };
  }

  // Whitelist + validate each present field. Unknown keys (kind, code, label)
  // are ignored so they can never be bulk-written.
  const patch: Record<string, unknown> = {};
  if ('date' in patchRaw) {
    const date = String(patchRaw.date ?? '').trim();
    if (!date) return { ok: false, updated: 0, error: 'Date cannot be blank' };
    patch.date = date;
  }
  if ('scout_id' in patchRaw) {
    const scoutId = String(patchRaw.scout_id ?? '').trim();
    if (!scoutId) return { ok: false, updated: 0, error: 'Scout cannot be blank' };
    patch.scout_id = scoutId;
  }
  if ('by' in patchRaw) {
    patch.by = String(patchRaw.by ?? '').trim() || null;
  }
  if ('qty' in patchRaw) {
    const qty = Number(patchRaw.qty);
    if (!Number.isFinite(qty) || qty < 0) {
      return { ok: false, updated: 0, error: 'Qty must be a non-negative number' };
    }
    patch.qty = qty;
  }
  if ('unit' in patchRaw) {
    patch.unit = String(patchRaw.unit ?? '').trim() || 'complete';
  }
  if ('notes' in patchRaw) {
    patch.notes = String(patchRaw.notes ?? '').trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, updated: 0, error: 'No fields to change' };
  }

  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from('ledger_entries')
    .update(patch, { count: 'exact' })
    .in('id', ids);
  if (error) return { ok: false, updated: 0, error: error.message };

  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/admin/advancement/dashboard');
  return { ok: true, updated: count ?? ids.length };
}

/** Bulk archive — soft, reason optional (matches the single-row action). */
export async function bulkArchiveLedgerEntries(formData: FormData): Promise<BulkResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, updated: 0, error: 'Not authenticated' };
  }
  const ids = parseIds(formData);
  if (ids.length === 0) return { ok: false, updated: 0, error: 'No rows selected' };
  const reason = String(formData.get('reason') ?? '').trim() || null;

  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from('ledger_entries')
    .update(
      {
        archived_at: new Date().toISOString(),
        archived_by: await leaderInitials(),
        archived_reason: reason
      },
      { count: 'exact' }
    )
    .in('id', ids);
  if (error) return { ok: false, updated: 0, error: error.message };

  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/admin/advancement/dashboard');
  return { ok: true, updated: count ?? ids.length };
}

/** Bulk delete — soft, reason REQUIRED (matches the single-row action). */
export async function bulkDeleteLedgerEntries(formData: FormData): Promise<BulkResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, updated: 0, error: 'Not authenticated' };
  }
  const ids = parseIds(formData);
  if (ids.length === 0) return { ok: false, updated: 0, error: 'No rows selected' };
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) return { ok: false, updated: 0, error: 'A reason is required to delete.' };

  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from('ledger_entries')
    .update(
      {
        deleted_at: new Date().toISOString(),
        deleted_by: await leaderInitials(),
        deleted_reason: reason
      },
      { count: 'exact' }
    )
    .in('id', ids);
  if (error) return { ok: false, updated: 0, error: error.message };

  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/admin/advancement/dashboard');
  return { ok: true, updated: count ?? ids.length };
}

export async function restoreLedgerEntry(formData: FormData): Promise<void> {
  await ensureLeader();
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid id');

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ledger_entries')
    .update({
      archived_at: null,
      archived_by: null,
      archived_reason: null,
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null
    })
    .eq('id', id);
  if (error) throw new Error(`restore failed: ${error.message}`);
  revalidatePath('/admin/advancement/ledger');
}

interface ConfirmResult {
  ok: boolean;
  error?: string;
}

function revalidateAwardViews() {
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/records');
  revalidatePath('/admin/advancement/scoutbook-export');
}

/**
 * "Submitted to Scoutbook" and "Presented to scout" — two independent
 * human confirmations on a rank/MB/special-award row, same write-once
 * nullable-columns shape as archived_at/archived_by. Not tied to a specific
 * meeting or Court of Honor record: the troop presents awards at regular
 * meetings as well as COH, so this is deliberately just a "did it happen"
 * flag, not a link to an event.
 */
export async function setScoutbookSubmitted(formData: FormData): Promise<ConfirmResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid id' };
  const on = formData.get('on') === '1';

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ledger_entries')
    .update(
      on
        ? { scoutbook_submitted_at: new Date().toISOString(), scoutbook_submitted_by: await leaderInitials() }
        : { scoutbook_submitted_at: null, scoutbook_submitted_by: null }
    )
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidateAwardViews();
  return { ok: true };
}

export async function setPresented(formData: FormData): Promise<ConfirmResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid id' };
  const on = formData.get('on') === '1';

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('ledger_entries')
    .update(
      on
        ? { presented_at: new Date().toISOString(), presented_by: await leaderInitials() }
        : { presented_at: null, presented_by: null }
    )
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidateAwardViews();
  return { ok: true };
}

/** Bulk "mark as submitted" — the Scoutbook Export page's one-click action
 *  right after a successful upload, over every row in the current preview. */
export async function bulkSetScoutbookSubmitted(formData: FormData): Promise<BulkResult> {
  try {
    await ensureLeader();
  } catch {
    return { ok: false, updated: 0, error: 'Not authenticated' };
  }
  const ids = parseIds(formData);
  if (ids.length === 0) return { ok: false, updated: 0, error: 'No rows to mark' };

  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from('ledger_entries')
    .update(
      { scoutbook_submitted_at: new Date().toISOString(), scoutbook_submitted_by: await leaderInitials() },
      { count: 'exact' }
    )
    .in('id', ids);
  if (error) return { ok: false, updated: 0, error: error.message };

  revalidateAwardViews();
  return { ok: true, updated: count ?? ids.length };
}
