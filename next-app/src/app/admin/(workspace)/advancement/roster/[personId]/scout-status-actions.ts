'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { INACTIVE_REASON_LABEL, type InactiveReason } from '@/lib/supabase/types';

/**
 * A scout's Active/Inactive status on its own (Plans/Person-Editor-Rethink.md
 * Phase 1). `updateScout` in lookups/actions.ts folds the flag into the
 * whole-form save with every other field, which is exactly the seam Patrick
 * tripped on: the identical job was built two different ways depending on
 * which editor you were in (adults: an immediate two-step; scouts: one
 * bottom Save). The record page's Status card calls this for a scout and
 * `setPersonActive` for an adult — same flow, same audit shape.
 *
 * Mirrors updateScout's rules: a reason is REQUIRED when marking inactive
 * and must come from the fixed list (lib/supabase/types InactiveReason);
 * reactivating clears it. The audit row carries the Status/Reason from→to
 * in `details` (display labels, not codes); the summary names fields only
 * (D-257).
 */

interface Result {
  ok: boolean;
  error?: string;
}

const VALID_REASONS = new Set<string>(Object.keys(INACTIVE_REASON_LABEL));

function reasonLabel(code: string | null): string {
  if (!code) return '—';
  return INACTIVE_REASON_LABEL[code as InactiveReason] ?? code;
}

function revalidateAll() {
  // Same fan-out as updateScout — everything that lists scouts by status.
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/admin/advancement/roster');
  revalidatePath('/admin/advancement/dashboard');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath('/advancement');
}

export async function setScoutActive(scoutId: string, active: boolean, reason?: string): Promise<Result> {
  try {
    await requireCapability('roster.manage');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = scoutId.trim();
  if (!id) return { ok: false, error: 'Scout ID is required' };

  const inactiveReason = active ? null : (reason?.trim() || null);
  if (!active && !inactiveReason) {
    return { ok: false, error: 'A reason is required when marking the scout inactive.' };
  }
  if (inactiveReason && !VALID_REASONS.has(inactiveReason)) {
    return { ok: false, error: `Invalid inactive reason: ${inactiveReason}` };
  }

  const supabase = createAdminClient();
  const { data: existing, error: fetchErr } = await supabase
    .from('scouts')
    .select('active, inactive_reason')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!existing) return { ok: false, error: 'Scout not found' };
  const was = existing as { active: boolean; inactive_reason: string | null };

  const { error } = await supabase
    .from('scouts')
    .update({ active, inactive_reason: inactiveReason })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    area: 'roster',
    action: 'update',
    entityType: 'scout',
    entityId: id,
    summary: `Set scout ${id} ${active ? 'active' : 'inactive'} — Status, Reason`,
    details: [
      { field: 'Status', from: was.active ? 'Active' : 'Inactive', to: active ? 'Active' : 'Inactive' },
      { field: 'Reason', from: reasonLabel(was.inactive_reason), to: reasonLabel(inactiveReason) }
    ]
  });

  revalidateAll();
  return { ok: true };
}
