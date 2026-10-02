/**
 * Menu Monster — the admin-managed store list (mm_stores,
 * 20261003140000_mm_stores.sql). Replaces the hardcoded STORES constant.
 *
 * `mm_packages.store` stays plain text with no FK: a package keeps its store
 * name even when the store is retired. A rename therefore goes through the
 * `mm_rename_store` RPC, which renames the store and every package carrying
 * the old name in one transaction. A store a package uses can be retired but
 * not deleted; one with no packages can be deleted.
 *
 * Takes a SupabaseClient and an audit recorder (the price-history.ts shape)
 * so the same code runs from the admin server actions and from Vitest against
 * local Postgres. Audit summaries name the store (D-257); the old/new name
 * goes in `details`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import type { AuditEntry } from '@/lib/audit';

export const STORE_NAME_MAX = 40;

export interface Store {
  id: number;
  name: string;
  sortOrder: number;
  retiredAt: string | null;
  /** Packages whose `store` text equals this name (retired packages included). */
  packageCount: number;
}

export interface StoreResult {
  ok: boolean;
  error?: string;
  id?: number;
}

type Recorder = (entry: AuditEntry) => Promise<void>;

interface StoreRow {
  id: number;
  name: string;
  sort_order: number;
  retired_at: string | null;
}

async function loadRows(sb: SupabaseClient): Promise<StoreRow[]> {
  const { data, error } = await sb.from('mm_stores').select('id, name, sort_order, retired_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as StoreRow[];
}

/** Active stores first in order, retired ones greyed at the bottom. */
function arrange(rows: StoreRow[]): StoreRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.retired_at !== null) - Number(b.retired_at !== null) ||
      a.sort_order - b.sort_order ||
      a.id - b.id
  );
}

export async function listStoresWith(sb: SupabaseClient, opts: { includeRetired: boolean }): Promise<Store[]> {
  const rows = (await loadRows(sb)).filter((r) => opts.includeRetired || r.retired_at === null);
  const pkgs = await fetchAllRows<{ id: string; store: string | null }>((from, to) =>
    sb.from('mm_packages').select('id, store').not('store', 'is', null).order('id').range(from, to)
  );
  const counts = new Map<string, number>();
  for (const p of pkgs) counts.set(p.store as string, (counts.get(p.store as string) ?? 0) + 1);
  return arrange(rows).map((r) => ({
    id: r.id,
    name: r.name,
    sortOrder: r.sort_order,
    retiredAt: r.retired_at,
    packageCount: counts.get(r.name) ?? 0
  }));
}

/** Names of the active stores, in order — what the price book's selects offer. */
export async function listActiveStoreNamesWith(sb: SupabaseClient): Promise<string[]> {
  return (await listStoresWith(sb, { includeRetired: false })).map((s) => s.name);
}

function validName(raw: string, rows: StoreRow[], selfId?: number): { name: string; error?: string } {
  const name = String(raw ?? '').trim();
  if (!name) return { name, error: 'Give the store a name.' };
  if (name.length > STORE_NAME_MAX) return { name, error: `A store name can be at most ${STORE_NAME_MAX} characters.` };
  if (rows.some((r) => r.id !== selfId && r.name.toLowerCase() === name.toLowerCase())) {
    return { name, error: `There is already a store called "${rows.find((r) => r.name.toLowerCase() === name.toLowerCase())!.name}".` };
  }
  return { name };
}

export async function addStoreWith(sb: SupabaseClient, rawName: string, record: Recorder): Promise<StoreResult> {
  const rows = await loadRows(sb);
  const { name, error } = validName(rawName, rows);
  if (error) return { ok: false, error };
  const sortOrder = rows.reduce((max, r) => Math.max(max, r.sort_order), 0) + 10;
  const { data, error: dbErr } = await sb.from('mm_stores').insert({ name, sort_order: sortOrder }).select('id').single();
  if (dbErr) {
    return { ok: false, error: dbErr.code === '23505' ? `There is already a store called "${name}".` : dbErr.message };
  }
  const id = (data as { id: number }).id;
  await record({
    area: 'library',
    action: 'create',
    entityType: 'mm_store',
    entityId: id,
    summary: `Added Menu Monster store "${name}"`
  });
  return { ok: true, id };
}

export async function renameStoreWith(
  sb: SupabaseClient,
  id: number,
  rawName: string,
  record: Recorder
): Promise<StoreResult> {
  const rows = await loadRows(sb);
  const current = rows.find((r) => r.id === id);
  if (!current) return { ok: false, error: 'That store no longer exists.' };
  const { name, error } = validName(rawName, rows, id);
  if (error) return { ok: false, error };
  if (name === current.name) return { ok: true, id };
  const { data, error: dbErr } = await sb.rpc('mm_rename_store', { p_id: id, p_name: name });
  if (dbErr) return { ok: false, error: dbErr.message };
  if (data === 'duplicate') return { ok: false, error: `There is already a store called "${name}".` };
  if (data === 'missing') return { ok: false, error: 'That store no longer exists.' };
  if (data !== 'ok') return { ok: false, error: 'Could not rename the store.' };
  await record({
    area: 'library',
    action: 'update',
    entityType: 'mm_store',
    entityId: id,
    summary: `Renamed Menu Monster store "${name}"`,
    details: [{ field: 'Name', from: current.name, to: name }]
  });
  return { ok: true, id };
}

async function setRetired(sb: SupabaseClient, id: number, retired: boolean, record: Recorder): Promise<StoreResult> {
  const row = (await loadRows(sb)).find((r) => r.id === id);
  if (!row) return { ok: false, error: 'That store no longer exists.' };
  if ((row.retired_at !== null) === retired) return { ok: true, id };
  const { error } = await sb
    .from('mm_stores')
    .update({ retired_at: retired ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  await record({
    area: 'library',
    action: retired ? 'retire' : 'restore',
    entityType: 'mm_store',
    entityId: id,
    summary: `${retired ? 'Retired' : 'Restored'} Menu Monster store "${row.name}"`,
    details: [{ field: 'Status', from: retired ? 'Active' : 'Retired', to: retired ? 'Retired' : 'Active' }]
  });
  return { ok: true, id };
}

export const retireStoreWith = (sb: SupabaseClient, id: number, record: Recorder) => setRetired(sb, id, true, record);
export const restoreStoreWith = (sb: SupabaseClient, id: number, record: Recorder) => setRetired(sb, id, false, record);

/** Only a store no package uses may go; one in use is retired instead. */
export async function deleteStoreWith(sb: SupabaseClient, id: number, record: Recorder): Promise<StoreResult> {
  const row = (await loadRows(sb)).find((r) => r.id === id);
  if (!row) return { ok: false, error: 'That store no longer exists.' };
  const { count, error: countErr } = await sb
    .from('mm_packages')
    .select('id', { count: 'exact', head: true })
    .eq('store', row.name);
  if (countErr) return { ok: false, error: countErr.message };
  if ((count ?? 0) > 0) {
    return { ok: false, error: `"${row.name}" is used by ${count} package${count === 1 ? '' : 's'} — retire it instead.` };
  }
  const { error } = await sb.from('mm_stores').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  await record({
    area: 'library',
    action: 'delete',
    entityType: 'mm_store',
    entityId: id,
    summary: `Deleted Menu Monster store "${row.name}"`
  });
  return { ok: true, id };
}

/** Move an active store one place up or down; the active list is renumbered 10, 20, … */
export async function moveStoreWith(
  sb: SupabaseClient,
  id: number,
  direction: 'up' | 'down',
  record: Recorder
): Promise<StoreResult> {
  const rows = await loadRows(sb);
  const active = arrange(rows).filter((r) => r.retired_at === null);
  const at = active.findIndex((r) => r.id === id);
  if (at < 0) return { ok: false, error: 'That store is not in the active list.' };
  const to = direction === 'up' ? at - 1 : at + 1;
  if (to < 0 || to >= active.length) return { ok: true, id };
  const next = [...active];
  [next[at], next[to]] = [next[to]!, next[at]!];
  for (let i = 0; i < next.length; i++) {
    const order = (i + 1) * 10;
    if (next[i]!.sort_order === order) continue;
    const { error } = await sb.from('mm_stores').update({ sort_order: order }).eq('id', next[i]!.id);
    if (error) return { ok: false, error: error.message };
  }
  await record({
    area: 'library',
    action: 'update',
    entityType: 'mm_store',
    entityId: id,
    summary: `Moved Menu Monster store "${active[at]!.name}" ${direction}`,
    details: [{ field: 'Order', from: String(at + 1), to: String(to + 1) }]
  });
  return { ok: true, id };
}
