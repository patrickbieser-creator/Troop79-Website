/**
 * A scout's package on a price-book ingredient (release C, P2.3a). One RPC,
 * mm_add_scout_package, does the band check under a lock on the ingredient:
 * inside ±PRICE_BAND of the cheapest live usable book package's unit price (a
 * scout-added one never sets the basis — qa-lead: no downward ratchet) it is
 * live at once; outside, or with nothing to compare against, it is held for a
 * leader (only its scout's catalog carries it meanwhile). An identical package
 * already in the book is 'same' — nothing is added. Audited under `library`,
 * like every price-book change. `*With(supabase)` so Vitest runs it against
 * local Postgres; the action passes createAdminClient().
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditAs, type AuditActor } from '@/lib/audit';
import { publicScoutName } from '@/lib/scout-name';
import { PRICE_BAND } from './price-band';
import type { ScoutPackage } from './scout-packages';

export type AddPackageResult = { status: 'live' | 'held' | 'same'; id: string } | { status: 'cap' | 'invalid' };

export async function addScoutPackageWith(sb: SupabaseClient, actor: AuditActor, pkg: ScoutPackage): Promise<AddPackageResult> {
  if (actor.personId == null) return { status: 'invalid' };
  const { data, error } = await sb.rpc('mm_add_scout_package', {
    p_person: actor.personId,
    p_ingredient_id: pkg.ingredientId,
    p_pkg: { name: pkg.name, store: pkg.store, size: pkg.size, price: pkg.price },
    p_band: PRICE_BAND
  });
  if (error) {
    if (error.message.includes('MM_PACKAGE_CAP')) return { status: 'cap' };
    if (error.message.includes('MM_BAD_')) return { status: 'invalid' };
    throw new Error(`add scout package: ${error.message}`);
  }
  const res = data as { status: 'live' | 'held' | 'same'; id: string };
  if (res.status !== 'same') {
    const { data: ing } = await sb.from('mm_ingredients').select('name').eq('id', pkg.ingredientId).maybeSingle();
    await recordAuditAs(sb, actor, {
      area: 'library',
      action: res.status === 'held' ? 'package_held' : 'package_add',
      entityType: 'mm_package',
      entityId: res.id,
      summary: `${actor.label} added package "${pkg.name}" to ${(ing?.name as string | undefined) ?? pkg.ingredientId}${res.status === 'held' ? ' (waiting for a leader)' : ''}`
    });
  }
  return res;
}

/** A scout's package waiting for a leader, with what it was measured against. */
export interface HeldPackage {
  id: string;
  ingredientId: string;
  ingredientName: string;
  /** The ingredient's recipe unit, plural ("slices"): size and unit prices are in it. */
  unitMany: string;
  name: string;
  store: string | null;
  price: number;
  size: number;
  unitPrice: number;
  /** The cheapest live usable BOOK package's unit price (the band's basis — never a scout-added one); null = nothing to compare with. */
  cheapestUnitPrice: number | null;
  addedBy: string;
  heldAt: string;
}

/** Every held, unretired scout package, oldest first (few: 5 per scout at most). */
export async function listHeldPackagesWith(sb: SupabaseClient): Promise<HeldPackage[]> {
  const { data, error } = await sb
    .from('mm_packages')
    .select('id, ingredient_id, name, store, price, yield, held_at, added_by_person_id, mm_ingredients(name, unit_many)')
    .not('held_at', 'is', null)
    .is('retired_at', null)
    .order('held_at');
  if (error) throw new Error(`held packages: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    id: string; ingredient_id: string; name: string; store: string | null; price: number | string; yield: number | string; held_at: string;
    added_by_person_id: number | null; mm_ingredients: { name: string; unit_many: string } | null;
  }[];
  if (rows.length === 0) return [];
  const ingredientIds = [...new Set(rows.map((r) => r.ingredient_id))];
  const people = [...new Set(rows.flatMap((r) => (r.added_by_person_id == null ? [] : [r.added_by_person_id])))];
  const [{ data: live, error: e2 }, credits] = await Promise.all([
    sb.from('mm_packages').select('ingredient_id, price, yield').in('ingredient_id', ingredientIds).is('held_at', null).is('retired_at', null).is('added_by_person_id', null).gt('yield', 0),
    ownerCredits(sb, people)
  ]);
  if (e2) throw new Error(`held package basis: ${e2.message}`);
  const cheapest = new Map<string, number>();
  for (const p of live ?? []) {
    const u = Number(p.price) / Number(p.yield);
    const id = p.ingredient_id as string;
    if (!cheapest.has(id) || u < (cheapest.get(id) as number)) cheapest.set(id, u);
  }
  return rows.map((r) => ({
    id: r.id,
    ingredientId: r.ingredient_id,
    ingredientName: r.mm_ingredients?.name ?? r.ingredient_id,
    unitMany: r.mm_ingredients?.unit_many ?? '',
    name: r.name,
    store: r.store,
    price: Number(r.price),
    size: Number(r.yield),
    unitPrice: Number(r.price) / Number(r.yield),
    cheapestUnitPrice: cheapest.get(r.ingredient_id) ?? null,
    addedBy: (r.added_by_person_id != null && credits.get(r.added_by_person_id)) || 'A scout',
    heldAt: r.held_at
  }));
}

async function ownerCredits(sb: SupabaseClient, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const { data, error } = await sb.from('people').select('id, first_name, last_name').in('id', ids);
  if (error) throw new Error(`package credits: ${error.message}`);
  for (const p of data ?? []) out.set(p.id as number, publicScoutName({ first_name: (p.first_name as string) ?? '', last_name: (p.last_name as string) ?? '' }));
  return out;
}

/** Approve: the package joins the troop price book. False when it isn't held (already decided). The caller audits. */
export async function approveHeldPackageWith(sb: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await sb.from('mm_packages').update({ held_at: null }).eq('id', id).not('held_at', 'is', null).is('retired_at', null).select('id');
  if (error) throw new Error(`approve package: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Reject: deleted when nothing references it; retired (kept, out of every
 * catalog) when a price-history row or a menu's shopping choices / actuals
 * still name it. 'missing' when it isn't a held, unretired package.
 */
export async function rejectHeldPackageWith(sb: SupabaseClient, id: string): Promise<'deleted' | 'retired' | 'missing'> {
  const { data: row } = await sb.from('mm_packages').select('id').eq('id', id).not('held_at', 'is', null).is('retired_at', null).maybeSingle();
  if (!row) return 'missing';
  const { data: inUse, error: e1 } = await sb.rpc('mm_package_in_use', { p_id: id });
  if (e1) throw new Error(`reject package: ${e1.message}`);
  if (inUse === true) {
    const { error } = await sb.from('mm_packages').update({ retired_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(`reject package: ${error.message}`);
    return 'retired';
  }
  const { error } = await sb.from('mm_packages').delete().eq('id', id);
  if (error) throw new Error(`reject package: ${error.message}`);
  return 'deleted';
}
