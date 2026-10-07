/**
 * Scout Workspace — read-side loaders for the menu pages (Plans/
 * Menu-Monster-Scout-Workspace.md, Phase 1 slice 4). `*With(supabase)` style
 * like menus-store.ts, so Vitest runs them against local Postgres and the
 * pages pass createAdminClient().
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
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

/** The roster's patrol names (active scouts), A to Z — what the resync tool copies into mm_patrols. */
export async function loadRosterPatrolNamesWith(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from('scouts').select('patrol').eq('active', true).not('patrol', 'is', null);
  if (error) throw new Error(`load patrols: ${error.message}`);
  return [...new Set(((data ?? []) as { patrol: string | null }[]).map((r) => (r.patrol ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * The Plan tab's patrol pull-down (Patrick, 2026-10-06): Menu Monster's own list, `mm_patrols`, in its sort order —
 * the roster's patrols then "Whole troop". A leader refreshes it from the roster with the admin tool
 * (resyncPatrolsWith); until the table has rows it falls back to the roster directly.
 */
export async function loadPatrolNamesWith(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from('mm_patrols').select('name, sort_order').order('sort_order').order('name');
  if (error) throw new Error(`load mm_patrols: ${error.message}`);
  if (data && data.length > 0) return data.map((r) => r.name as string);
  return [...(await loadRosterPatrolNamesWith(sb)), 'Whole troop'];
}

/** The "Resync patrol list from roster" tool: mm_patrols becomes the roster's patrols + "Whole troop". Returns what changed. */
export async function resyncPatrolsWith(sb: SupabaseClient): Promise<{ patrols: string[]; added: string[]; removed: string[]; removedMenus: Record<string, number> }> {
  const roster = await loadRosterPatrolNamesWith(sb);
  const wanted = [...roster, 'Whole troop'];
  const { data: cur, error } = await sb.from('mm_patrols').select('name');
  if (error) throw new Error(`load mm_patrols: ${error.message}`);
  const have = new Set((cur ?? []).map((r) => r.name as string));
  const added = wanted.filter((n) => !have.has(n));
  const removed = [...have].filter((n) => !wanted.includes(n));
  if (removed.length) {
    const { error: dErr } = await sb.from('mm_patrols').delete().in('name', removed);
    if (dErr) throw new Error(`mm_patrols delete: ${dErr.message}`);
  }
  const rows = wanted.map((name, i) => ({ name, sort_order: name === 'Whole troop' ? 1000 : i + 1, synced_at: new Date().toISOString() }));
  const { error: uErr } = await sb.from('mm_patrols').upsert(rows, { onConflict: 'name' });
  if (uErr) throw new Error(`mm_patrols upsert: ${uErr.message}`);
  const onMenus = await menuPatrolCountsWith(sb);
  const removedMenus: Record<string, number> = {};
  for (const n of removed) removedMenus[n] = onMenus.get(n) ?? 0;
  return { patrols: wanted, added, removed, removedMenus };
}

/** How many saved menus name each patrol (blank patrols are not counted). */
async function menuPatrolCountsWith(sb: SupabaseClient): Promise<Map<string, number>> {
  const rows = await fetchAllRows<{ patrol: string | null }>((from, to) => sb.from('mm_menus').select('patrol').not('patrol', 'is', null).order('id').range(from, to));
  const out = new Map<string, number>();
  for (const r of rows) if (r.patrol) out.set(r.patrol, (out.get(r.patrol) ?? 0) + 1);
  return out;
}

/** Patrol names that saved menus still carry but the list no longer has (a renamed roster patrol), A to Z, with menu counts. */
export async function loadMissingMenuPatrolsWith(sb: SupabaseClient): Promise<{ name: string; count: number }[]> {
  const [counts, listed] = await Promise.all([menuPatrolCountsWith(sb), loadPatrolNamesWith(sb)]);
  const have = new Set(listed);
  return [...counts.entries()].filter(([n]) => !have.has(n)).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The signed-in scout's own patrol (scouts.patrol by person_id), or null: the Plan tab's Patrol field starts there on a new menu. */
export async function loadScoutPatrolWith(sb: SupabaseClient, personId: number): Promise<string | null> {
  const { data, error } = await sb.from('scouts').select('patrol').eq('person_id', personId).maybeSingle();
  if (error) throw new Error(`load scout patrol: ${error.message}`);
  const name = ((data as { patrol: string | null } | null)?.patrol ?? '').trim();
  return name || null;
}

/** One overnight calendar entry as an outing (any status: the caller decides who may see it), or null. */
export async function loadOutingWith(sb: SupabaseClient, id: number): Promise<(Outing & { status: string }) | null> {
  const { data, error } = await sb.from('calendar_entries').select(`${COLS}, status`).eq('id', id).in('category', [...OUTING_CATEGORIES]).maybeSingle();
  if (error) throw new Error(`load outing: ${error.message}`);
  return data ? { ...toOuting(data as unknown as EntryRow), status: (data as unknown as { status: string }).status } : null;
}
