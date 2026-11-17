/**
 * A leader's pinned admin items (Plans/Completed/Admin-Portal-Nav.md phase 3), in `admin_pins`. Every function takes the
 * person id from the caller, which must be the signed-in actor's own (the server actions resolve it); nothing here
 * takes a person id from a browser.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { featureByKey } from './feature-registry';

/** How many pins one person may keep: the rail stays a rail. */
export const MAX_PINS = 12;

export type PinResult = { ok: true } | { ok: false; error: string };

/** The person's pin keys, in their order. Keys the registry no longer has are dropped here, not shown. */
export async function loadPinKeys(sb: SupabaseClient, personId: number): Promise<string[]> {
  const { data, error } = await sb
    .from('admin_pins')
    .select('feature_key, position')
    .eq('person_id', personId)
    .order('position')
    .order('created_at');
  if (error) throw new Error(`admin_pins read failed: ${error.message}`);
  return (data ?? []).map((r) => r.feature_key as string).filter((k) => featureByKey(k) != null);
}

export async function addPin(sb: SupabaseClient, personId: number, key: string): Promise<PinResult> {
  if (!featureByKey(key)) return { ok: false, error: 'That item can’t be pinned.' };
  const current = await loadPinKeys(sb, personId);
  if (current.includes(key)) return { ok: true };
  if (current.length >= MAX_PINS) return { ok: false, error: `You can pin up to ${MAX_PINS} items. Unpin one first.` };
  const { error } = await sb.from('admin_pins').upsert(
    { person_id: personId, feature_key: key, position: current.length },
    { onConflict: 'person_id,feature_key', ignoreDuplicates: true }
  );
  if (error) throw new Error(`admin_pins insert failed: ${error.message}`);
  return { ok: true };
}

export async function removePin(sb: SupabaseClient, personId: number, key: string): Promise<PinResult> {
  const { error } = await sb.from('admin_pins').delete().eq('person_id', personId).eq('feature_key', key);
  if (error) throw new Error(`admin_pins delete failed: ${error.message}`);
  return { ok: true };
}

/**
 * Edit pins' Save: the person's pins become exactly `keys`, in that order. Unknown keys, repeats and more than
 * MAX_PINS are refused, so a bad request changes nothing.
 */
export async function savePins(sb: SupabaseClient, personId: number, keys: readonly string[]): Promise<PinResult> {
  if (new Set(keys).size !== keys.length || keys.some((k) => !featureByKey(k))) {
    return { ok: false, error: 'That list can’t be saved. Reload and try again.' };
  }
  if (keys.length > MAX_PINS) return { ok: false, error: `You can pin up to ${MAX_PINS} items.` };
  const current = await loadPinKeys(sb, personId);
  const gone = current.filter((k) => !keys.includes(k));
  if (gone.length > 0) {
    const { error } = await sb.from('admin_pins').delete().eq('person_id', personId).in('feature_key', gone);
    if (error) throw new Error(`admin_pins delete failed: ${error.message}`);
  }
  if (keys.length > 0) {
    const { error } = await sb
      .from('admin_pins')
      .upsert(
        keys.map((feature_key, position) => ({ person_id: personId, feature_key, position })),
        { onConflict: 'person_id,feature_key' }
      );
    if (error) throw new Error(`admin_pins save failed: ${error.message}`);
  }
  return { ok: true };
}
