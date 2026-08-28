import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/server';

/** One row of the `person_directory` view — a 3-CTE union of scouts, leaders
 *  and adults, one row per person (Plans/Performance-Review-2026-08-27.md #17). */
export interface PersonDirectoryRow {
  person_id: number;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  bsa_member_id: string | null;
  scout_id: string | null;
  inactive_reason: string | null;
  roles: string;
  tab: 'active_scout' | 'inactive_scout' | 'leader' | 'adult';
  in_picker: boolean;
  active: boolean;
  person_inactive_reason: string | null;
}

/**
 * The whole directory, read once per request. Three call sites each ran their
 * own `select` against `person_directory` — the roster page (every row), the
 * signup roster's "who can I add" list (active only), and the Money tab's
 * "paid by" picker (active adults only) — for the same underlying rows
 * (Plan-of-record item 17, 2026-08-27). `cache()` collapses repeat calls
 * within one render to a single round trip; callers filter/project in memory
 * for their own narrower need rather than re-querying.
 */
export const loadPersonDirectory = cache(async function loadPersonDirectory(): Promise<PersonDirectoryRow[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('person_directory').select('*').order('display_name');
  return (data ?? []) as unknown as PersonDirectoryRow[];
});

/** O(1) person_id → row lookup. Replaces `rows.find(p => p.person_id === id)`
 *  called inside a loop over another table (was O(rows × loop) — the roster
 *  page did this once per household membership). */
export function indexDirectory<T extends { person_id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.person_id, r]));
}
