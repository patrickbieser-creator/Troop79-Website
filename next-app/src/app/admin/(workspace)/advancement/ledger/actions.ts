'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';
import type { LedgerKind } from '@/lib/supabase/types';

const VALID_KINDS: ReadonlySet<LedgerKind> = new Set<LedgerKind>([
  'rank_requirement',
  'rank_award',
  'merit_badge_requirement',
  'merit_badge_award',
  'attendance',
  'service_hours',
  'camping_nights',
  'hiking_miles',
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
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session) throw new Error('Not authenticated');
  return session;
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
