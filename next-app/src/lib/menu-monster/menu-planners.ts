import type { SupabaseClient } from '@supabase/supabase-js';

/** One active scout the "Planned by" pull-down offers: a person id and a display name, nothing else. */
export interface PlannerOption {
  personId: number;
  name: string;
}

/**
 * The troop's active scouts for the Planned by pull-down (Plans/Menu-Monster-Planned-By.md): scouts.active →
 * people.display_name (people are the spine; no name column is read off scouts), A to Z. Pass the service-role client.
 */
export async function loadActiveScoutOptionsWith(sb: SupabaseClient): Promise<PlannerOption[]> {
  const { data: scouts, error } = await sb.from('scouts').select('person_id').eq('active', true);
  if (error) throw new Error(`active scouts: ${error.message}`);
  const ids = (scouts ?? []).map((r) => r.person_id as number | null).filter((n): n is number => n != null);
  if (ids.length === 0) return [];
  const { data: people, error: pe } = await sb.from('people').select('id, display_name').in('id', ids);
  if (pe) throw new Error(`scout names: ${pe.message}`);
  return (people ?? [])
    .map((p) => ({ personId: p.id as number, name: ((p.display_name as string | null) ?? '').trim() }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}
