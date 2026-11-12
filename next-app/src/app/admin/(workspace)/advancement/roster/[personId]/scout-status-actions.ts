'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { INACTIVE_REASON_LABEL, type InactiveReason } from '@/lib/supabase/types';
import { expirePeopleLists } from '@/lib/people-lists';
import { resolveAdminActor } from '@/lib/admin-actor';

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
  // The planner caches the roster and teacher pool (lib/people-lists); expired when this action ends.
  expirePeopleLists();
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

/** A real calendar day as YYYY-MM-DD, on or after 1900 (2026-02-31 is not). */
function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso >= '1900-01-01';
}

/**
 * Cross a Webelos over into the troop (Plans/Webelos-On-The-Roster.md): one
 * transaction in cross_over_webelos — active scout, crossover day stamped, BSA
 * ID saved if given, the Scout rank awarded if its requirements were all done
 * as a Webelos, and the audit row. Same ID; every tracked entry now counts.
 */
export async function crossOverWebelos(scoutId: string, onDate: string, bsaMemberId: string): Promise<Result> {
  expirePeopleLists();
  try {
    await requireCapability('roster.manage');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = scoutId.trim();
  if (!id) return { ok: false, error: 'Scout ID is required' };
  if (!isRealDate(onDate)) return { ok: false, error: 'Pick the crossover date.' };
  const bsa = bsaMemberId.trim();
  if (bsa && !/^\d{6,12}$/.test(bsa)) return { ok: false, error: 'A BSA member ID is 6–12 digits.' };

  const actor = await resolveAdminActor();
  const { error } = await createAdminClient().rpc('cross_over_webelos', {
    p_scout_id: id,
    p_on: onDate,
    p_bsa_member_id: bsa || null,
    p_actor_person_id: actor?.personId ?? null,
    p_actor_label: actor?.label ?? 'system'
  });
  if (error) {
    if (error.message.includes('NOT_A_WEBELOS')) return { ok: false, error: 'This scout has already crossed over.' };
    if (error.message.includes('bsa_member_id')) return { ok: false, error: 'That BSA member ID is already on someone else’s record.' };
    console.error('crossOverWebelos', id, error.message);
    return { ok: false, error: 'The crossover could not be saved. Nothing was changed.' };
  }
  revalidateAll();
  return { ok: true };
}

/** Undo a crossover made by mistake: back to Webelos, and the Scout rank the crossover awarded goes with it. */
export async function undoCrossOver(scoutId: string): Promise<Result> {
  expirePeopleLists();
  try {
    await requireCapability('roster.manage');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const id = scoutId.trim();
  if (!id) return { ok: false, error: 'Scout ID is required' };
  const actor = await resolveAdminActor();
  const { error } = await createAdminClient().rpc('undo_cross_over', {
    p_scout_id: id,
    p_actor_person_id: actor?.personId ?? null,
    p_actor_label: actor?.label ?? 'system'
  });
  if (error) {
    const known: [string, string][] = [
      ['NOT_CROSSED_OVER', 'This scout did not cross over here, so there is nothing to undo.'],
      ['UNDO_SCOUT_LEFT', 'This scout is no longer active, so the crossover stays.'],
      [
        'UNDO_HAS_TROOP_ADVANCEMENT',
        'This scout has advancement recorded after crossing over, so the crossover can’t be undone.'
      ]
    ];
    const hit = known.find(([code]) => error.message.includes(code));
    if (hit) return { ok: false, error: hit[1] };
    console.error('undoCrossOver', id, error.message);
    return { ok: false, error: 'The undo could not be saved. Nothing was changed.' };
  }
  revalidateAll();
  return { ok: true };
}
