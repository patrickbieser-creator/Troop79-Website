/**
 * Menu Monster gear — the reads and writes (Plans/Menu-Monster-Brands-Gear.md, release 2). Takes a
 * SupabaseClient so the same code runs from server actions and from Vitest against local Postgres; the mm_*
 * tables have RLS on with zero policies (D-239), so the client is always the service role.
 *
 * A menu's gear state (its extras and Packed ticks) lives beside the plan in mm_menus.gear_extras /
 * gear_packed and is written ONLY here — never by a menu save, and never bumping updated_at.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import {
  MAX_GEAR_NAME,
  cleanGearExtras,
  gearKey,
  gearText,
  parseGear,
  sanitizePacked,
  unknownGearNames,
  type GearHome,
  type GearItem,
  type MenuGearState
} from './gear';
import { cleanScoutText } from './scout-text';

interface GearRowDb {
  id: number;
  name: string;
  home: GearHome;
  per_person: boolean;
  retired_at: string | null;
}
const COLS = 'id, name, home, per_person, retired_at';
const toItem = (r: GearRowDb): GearItem => ({ id: r.id, name: r.name, home: r.home, perPerson: r.per_person, retiredAt: r.retired_at });
const HOMES: readonly GearHome[] = ['trailer', 'patrol_box', 'home'];
export const isGearHome = (v: unknown): v is GearHome => HOMES.includes(v as GearHome);

/** The troop's gear list, A to Z. Retired items only on request (admin). */
export async function listGearWith(sb: SupabaseClient, opts: { includeRetired?: boolean } = {}): Promise<GearItem[]> {
  let q = sb.from('mm_gear').select(COLS).order('name');
  if (!opts.includeRetired) q = q.is('retired_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`gear list: ${error.message}`);
  return ((data ?? []) as GearRowDb[]).map(toItem);
}

/** A menu's extras and Packed ticks; empty when the menu is gone. */
export async function loadMenuGearWith(sb: SupabaseClient, menuId: string): Promise<MenuGearState> {
  const { data, error } = await sb.from('mm_menus').select('gear_extras, gear_packed').eq('id', menuId).maybeSingle();
  if (error) throw new Error(`menu gear: ${error.message}`);
  return { extras: cleanGearExtras(data?.gear_extras), packed: sanitizePacked(data?.gear_packed) };
}

/**
 * Names the troop's list does not have yet join it at once (Patrick, 2026-10-03: scouts can add to the gear
 * list; leaders tidy it in admin). A name that exists retired is left retired. Never throws for a duplicate:
 * two scouts naming the same new thing at the same moment is fine.
 */
export async function ensureGearWith(sb: SupabaseClient, entries: readonly string[], personId: number | null): Promise<string[]> {
  if (entries.length === 0) return [];
  const all = await listGearWith(sb, { includeRetired: true });
  const fresh = unknownGearNames(entries, all);
  if (fresh.length === 0) return [];
  // One insert per name: the unique index is on lower(name), which an upsert cannot target, and a racing
  // duplicate (23505) must not lose the other names.
  for (const name of fresh) {
    const { error } = await sb.from('mm_gear').insert({ name, added_by_person_id: personId });
    if (error && error.code !== '23505') throw new Error(`add gear: ${error.message}`);
  }
  return fresh;
}

/** The owner's extras, replaced whole. Returns the stored list, or null when the menu is not theirs. */
export async function setGearExtrasWith(
  sb: SupabaseClient,
  menuId: string,
  ownerPersonId: number,
  extras: unknown,
  /** Who typed any new gear name: the owner, or a leader fixing the menu. */
  addedByPersonId: number = ownerPersonId
): Promise<string[] | null> {
  const clean = cleanGearExtras(extras);
  const { data, error } = await sb.from('mm_menus').update({ gear_extras: clean }).eq('id', menuId).eq('owner_person_id', ownerPersonId).select('id');
  if (error) throw new Error(`gear extras: ${error.message}`);
  if (!data?.length) return null;
  await ensureGearWith(sb, clean, addedByPersonId);
  return clean;
}

/** One Packed tick on or off (mm_set_gear_packed merges it atomically). False when the menu is gone. */
export async function setGearPackedWith(
  sb: SupabaseClient,
  menuId: string,
  item: { key: string; count: number; packed: boolean },
  actor: { personId: number | null; label: string }
): Promise<boolean> {
  const { data, error } = await sb.rpc('mm_set_gear_packed', {
    p_menu: menuId,
    p_key: gearKey(item.key),
    p_packed: item.packed,
    p_count: item.count,
    p_person: actor.personId,
    p_label: cleanScoutText(actor.label, 60)
  });
  if (error) {
    if (error.message.includes('MM_BAD_GEAR')) return false;
    throw new Error(`gear packed: ${error.message}`);
  }
  return data === true;
}

/* ---- Admin: the troop's list ------------------------------------------------------------------------- */

export interface GearAdminRow extends GearItem {
  /** Recipes whose gear names it (any count). */
  recipes: string[];
}

interface RecipeGearRow {
  id: string;
  name: string;
  equipment: string[] | null;
}

async function recipesWithGear(sb: SupabaseClient): Promise<RecipeGearRow[]> {
  return fetchAllRows<RecipeGearRow>((from, to) =>
    sb.from('mm_recipes').select('id, name, equipment').neq('equipment', '{}').order('id').range(from, to)
  );
}

/** Every item, retired ones last, with the recipes that use it. */
export async function listGearAdminWith(sb: SupabaseClient): Promise<GearAdminRow[]> {
  const [items, recipes] = await Promise.all([listGearWith(sb, { includeRetired: true }), recipesWithGear(sb)]);
  const usedBy = new Map<string, string[]>();
  for (const r of recipes) {
    for (const e of r.equipment ?? []) {
      const k = gearKey(parseGear(e).name);
      usedBy.set(k, [...(usedBy.get(k) ?? []), r.name]);
    }
  }
  return items
    .map((g) => ({ ...g, recipes: usedBy.get(gearKey(g.name)) ?? [] }))
    .sort((a, b) => Number(a.retiredAt != null) - Number(b.retiredAt != null) || a.name.localeCompare(b.name));
}

export type GearWrite = { ok: true; id?: number; merged?: boolean; recipes?: number } | { ok: false; error: string };

const cleanName = (raw: unknown) => parseGear(cleanScoutText(raw, 60)).name.slice(0, MAX_GEAR_NAME).trim();

export async function createGearWith(sb: SupabaseClient, input: { name: unknown; home: unknown; perPerson: unknown }, personId: number | null): Promise<GearWrite> {
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: 'Give it a name.' };
  if (!isGearHome(input.home)) return { ok: false, error: 'Pick where it lives.' };
  const all = await listGearWith(sb, { includeRetired: true });
  if (all.some((g) => gearKey(g.name) === gearKey(name))) return { ok: false, error: `“${name}” is already on the list.` };
  const { data, error } = await sb.from('mm_gear').insert({ name, home: input.home, per_person: input.perPerson === true, added_by_person_id: personId }).select('id').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as number };
}

/**
 * Rename, move or re-flag an item. A rename rewrites every recipe and menu extra that names it (counts kept),
 * so the Gear tab keeps adding the same thing up. Renaming onto a name the list already has MERGES the two:
 * the recipes move and this row is removed. Not one transaction: a failure midway reports the error and a
 * retry finishes the job (every step is idempotent). Packed ticks made under the old name are not carried over.
 */
export async function updateGearWith(sb: SupabaseClient, id: number, input: { name: unknown; home: unknown; perPerson: unknown }): Promise<GearWrite> {
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: 'Give it a name.' };
  if (!isGearHome(input.home)) return { ok: false, error: 'Pick where it lives.' };
  const all = await listGearWith(sb, { includeRetired: true });
  const current = all.find((g) => g.id === id);
  if (!current) return { ok: false, error: 'That item is gone.' };
  const twin = all.find((g) => g.id !== id && gearKey(g.name) === gearKey(name));

  let recipes = 0;
  if (gearKey(current.name) !== gearKey(name) || current.name !== name) {
    const from = gearKey(current.name);
    const rewrite = (entries: readonly string[]): string[] | null => {
      let touched = false;
      const out: string[] = [];
      const seen = new Set<string>();
      for (const e of entries) {
        const p = parseGear(e);
        const hit = gearKey(p.name) === from;
        const text = hit ? gearText(twin?.name ?? name, p.count) : e;
        if (hit) touched = true;
        const k = gearKey(parseGear(text).name);
        if (seen.has(k)) continue; // the recipe already named the target: keep one
        seen.add(k);
        out.push(text);
      }
      return touched ? out : null;
    };
    for (const r of await recipesWithGear(sb)) {
      const next = rewrite(r.equipment ?? []);
      if (!next) continue;
      const { error } = await sb.from('mm_recipes').update({ equipment: next }).eq('id', r.id);
      if (error) return { ok: false, error: error.message };
      recipes++;
    }
    const menus = await fetchAllRows<{ id: string; gear_extras: string[] }>((a, b) => sb.from('mm_menus').select('id, gear_extras').neq('gear_extras', '{}').order('id').range(a, b));
    for (const m of menus) {
      const next = rewrite(m.gear_extras ?? []);
      if (!next) continue;
      const { error } = await sb.from('mm_menus').update({ gear_extras: next }).eq('id', m.id);
      if (error) return { ok: false, error: error.message };
    }
  }

  if (twin) {
    const { error } = await sb.from('mm_gear').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: twin.id, merged: true, recipes };
  }
  const { error } = await sb.from('mm_gear').update({ name, home: input.home, per_person: input.perPerson === true }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id, recipes };
}

/** Retire (no longer offered; recipes that name it keep the word) or restore. */
export async function retireGearWith(sb: SupabaseClient, id: number, retired: boolean): Promise<GearWrite> {
  const { data, error } = await sb.from('mm_gear').update({ retired_at: retired ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  return data?.length ? { ok: true, id } : { ok: false, error: 'That item is gone.' };
}

/** Delete an item no recipe names. */
export async function deleteGearWith(sb: SupabaseClient, id: number): Promise<GearWrite> {
  const rows = await listGearAdminWith(sb);
  const row = rows.find((g) => g.id === id);
  if (!row) return { ok: false, error: 'That item is gone.' };
  if (row.recipes.length > 0) return { ok: false, error: `${row.recipes.length === 1 ? 'A recipe names' : `${row.recipes.length} recipes name`} it. Retire it instead, or rename it onto another item to merge them.` };
  const { error } = await sb.from('mm_gear').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}
