/**
 * Who is YOUTH (Plans/Webelos-On-The-Roster.md, 2026-11-12): an active scout OR a Webelos. A Webelos is a scouts
 * row with is_webelos = true AND active = false, so the old adult test "no ACTIVE scouts row" (or person_directory
 * tab !== 'active_scout') called them an adult. Every adult pool, teacher check and sign-in rule reads youth from
 * here instead. A Webelos never signs in with their own address; a parent signs in for them.
 *
 * Plain module (no 'use client', no next/*): server loaders and tests import it alike.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST `or` filter on `scouts`: the rows that make a person youth. */
export const YOUTH_SCOUTS_FILTER = 'active.eq.true,is_webelos.eq.true';

/** person_directory tabs that are youth (an inactive scout who left is neither youth nor, here, an adult pool). */
export function isYouthTab(tab: string): boolean {
  return tab === 'active_scout' || tab === 'webelos';
}

/** The person ids of active scouts and Webelos — limited to `personIds` when given. */
export async function youthPersonIds(sb: SupabaseClient, personIds?: readonly number[]): Promise<Set<number>> {
  const out = new Set<number>();
  const read = async (ids?: number[]) => {
    let q = sb.from('scouts').select('person_id').or(YOUTH_SCOUTS_FILTER).not('person_id', 'is', null);
    if (ids) q = q.in('person_id', ids);
    const { data, error } = await q;
    if (error) throw new Error(`youth: ${error.message}`);
    for (const r of (data ?? []) as { person_id: number | null }[]) if (r.person_id != null) out.add(r.person_id);
  };
  if (!personIds) {
    // The whole youth roster is well under PostgREST's 1000-row cap (~30 scouts plus the next Webelos den).
    await read();
    return out;
  }
  const ids = [...new Set(personIds)];
  for (let i = 0; i < ids.length; i += 200) await read(ids.slice(i, i + 200));
  return out;
}

export interface ScoutSwitchOption {
  personId: number;
  name: string;
}

/**
 * A proxy viewer's "view as a scout" list: every active scout and every Webelos (labelled "(Webelos)"), A to Z.
 * A Webelos family is a troop family now; a leader with proxy rights sees it as the family would.
 */
export async function loadScoutSwitchOptions(sb: SupabaseClient): Promise<ScoutSwitchOption[]> {
  const { data, error } = await sb
    .from('scouts')
    .select('person_id, display_name, is_webelos')
    .or(YOUTH_SCOUTS_FILTER)
    .not('person_id', 'is', null)
    .order('display_name');
  if (error) throw new Error(`scout options: ${error.message}`);
  return ((data ?? []) as { person_id: number; display_name: string; is_webelos: boolean }[]).map((s) => ({
    personId: s.person_id,
    name: s.is_webelos ? `${s.display_name} (Webelos)` : s.display_name
  }));
}
