/**
 * Scout Workspace — read-side loaders for the menu pages (Plans/
 * Menu-Monster-Scout-Workspace.md, Phase 1 slice 4). `*With(supabase)` style
 * like menus-store.ts, so Vitest runs them against local Postgres and the
 * pages pass createAdminClient().
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Outing } from './menu-view';

/** The calendar categories a menu can be tied to: the overnight kinds. */
export const OUTING_CATEGORIES = ['Campout / Overnight', 'Summer Camp', 'High Adventure'] as const;

const COLS = 'id, title, entry_date, end_date, category';

interface EntryRow {
  id: number;
  title: string;
  entry_date: string;
  end_date: string | null;
  category: string;
}

const toOuting = (r: EntryRow): Outing => ({
  id: r.id,
  title: r.title,
  startDate: r.entry_date,
  endDate: r.end_date ?? r.entry_date,
  category: r.category
});

/**
 * The Outing pulldown: published, on-calendar, still-upcoming overnight
 * entries (an entry ends on coalesce(end_date, entry_date), and one ending
 * today is still on), plus the entries the menu is already linked to even
 * once they are past. A draft entry is never offered — and never reaches a
 * scout through a stale link either, because linked ids pass the same
 * published filter. Ordered by date.
 */
export async function loadOutingsWith(sb: SupabaseClient, today: string, linkedIds: readonly number[] = []): Promise<Outing[]> {
  const { data: upcoming, error } = await sb
    .from('calendar_entries')
    .select(COLS)
    .eq('status', 'published')
    .eq('on_calendar', true)
    .in('category', [...OUTING_CATEGORIES])
    .or(`end_date.gte.${today},and(end_date.is.null,entry_date.gte.${today})`)
    .order('entry_date', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`load outings: ${error.message}`);
  const rows = (upcoming ?? []) as EntryRow[];

  const have = new Set(rows.map((r) => r.id));
  const missing = linkedIds.filter((id) => !have.has(id));
  if (missing.length > 0) {
    const { data: linked, error: e2 } = await sb.from('calendar_entries').select(COLS).eq('status', 'published').in('id', missing);
    if (e2) throw new Error(`load linked outings: ${e2.message}`);
    rows.push(...((linked ?? []) as EntryRow[]));
    rows.sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.id - b.id);
  }
  return rows.map(toOuting);
}
