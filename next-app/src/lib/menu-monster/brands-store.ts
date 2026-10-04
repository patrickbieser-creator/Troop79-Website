/**
 * Menu Monster brands — the writes (Plans/Menu-Monster-Brands-Gear.md, release 3;
 * 20261008100000_mm_brands.sql). Takes a SupabaseClient (always the service role: the mm_* tables have RLS on
 * with zero policies) so the same code runs from server actions and from Vitest against local Postgres.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Brand, RestrictionKey } from './types';
import { cleanScoutText } from './scout-text';

interface BrandRow {
  id: string;
  ingredient_id: string;
  name: string;
  avoid: string[] | null;
  retired_at: string | null;
}
const COLS = 'id, ingredient_id, name, avoid, retired_at';
const DIETS: readonly RestrictionKey[] = ['gf', 'nut', 'dairy', 'veg'];

const toBrand = (r: BrandRow, isNew: boolean): Brand => ({
  id: r.id,
  ingredientId: r.ingredient_id,
  name: r.name,
  avoid: r.avoid == null ? null : (r.avoid as RestrictionKey[]),
  ...(isNew ? { isNew: true } : {}),
  retiredAt: r.retired_at
});

export type AddBrandResult = { status: 'ok'; brand: Brand; created: boolean } | { status: 'invalid' | 'cap' | 'ingredient' };

/** A typed brand: the live brand that already matches (case and punctuation ignored), or a new one — live at once. */
export async function addBrandWith(sb: SupabaseClient, personId: number, ingredientId: string, name: string): Promise<AddBrandResult> {
  let { data, error } = await sb.rpc('mm_add_brand', { p_person: personId, p_ingredient: ingredientId, p_name: name });
  // A leader's create / rename / move takes no lock and can land between the function's look and its insert:
  // the second look then finds the brand that won.
  if (error?.code === '23505') ({ data, error } = await sb.rpc('mm_add_brand', { p_person: personId, p_ingredient: ingredientId, p_name: name }));
  if (error) {
    if (error.message.includes('MM_BRAND_CAP')) return { status: 'cap' };
    if (error.message.includes('MM_BAD_BRAND')) return { status: 'ingredient' };
    if (error.message.includes('MM_BAD_TEXT') || error.message.includes('MM_SIGN_IN_REQUIRED')) return { status: 'invalid' };
    throw new Error(`add brand: ${error.message}`);
  }
  const res = data as { id: string; created: boolean };
  const { data: row, error: readErr } = await sb.from('mm_brands').select(COLS).eq('id', res.id).single();
  if (readErr) throw new Error(`add brand read: ${readErr.message}`);
  const { count } = await sb.from('mm_packages').select('id', { count: 'exact', head: true }).eq('brand_id', res.id).is('retired_at', null).not('yield', 'is', null);
  return { status: 'ok', brand: toBrand(row as BrandRow, (count ?? 0) === 0), created: res.created === true };
}

/* ---- Admin: tidy the troop's brands ----------------------------------------------------------------- */

export type BrandWrite = { ok: true; note?: string } | { ok: false; error: string };

async function liveBrand(sb: SupabaseClient, id: string): Promise<BrandRow | null> {
  const { data } = await sb.from('mm_brands').select(COLS).eq('id', id).maybeSingle();
  return (data as BrandRow | null) ?? null;
}

/** A leader's new brand under an ingredient (the same matching rule as a typed one). */
export async function createBrandWith(sb: SupabaseClient, ingredientId: string, rawName: unknown): Promise<BrandWrite & { id?: string }> {
  const name = cleanScoutText(rawName, 60);
  if (!name) return { ok: false, error: 'Give the brand a name.' };
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!key) return { ok: false, error: 'Give the brand a name with letters or numbers in it.' };
  const { data: same } = await sb.from('mm_brands').select('id, name').eq('ingredient_id', ingredientId).eq('match_key', key).is('retired_at', null);
  if (same?.length) return { ok: false, error: `“${same[0].name}” is already a brand of this ingredient.` };
  const id = `b-${key.slice(0, 40)}-${Math.random().toString(16).slice(2, 8)}`;
  const { error } = await sb.from('mm_brands').insert({ id, ingredient_id: ingredientId, name });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

/** Rename a brand. Onto another live brand of the same ingredient it is refused: merge them instead. */
export async function renameBrandWith(sb: SupabaseClient, id: string, rawName: unknown): Promise<BrandWrite> {
  const name = cleanScoutText(rawName, 60);
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!name || !key) return { ok: false, error: 'Give the brand a name.' };
  const row = await liveBrand(sb, id);
  if (!row) return { ok: false, error: 'That brand is gone.' };
  const { data: same } = await sb.from('mm_brands').select('id, name').eq('ingredient_id', row.ingredient_id).eq('match_key', key).is('retired_at', null).neq('id', id);
  if (same?.length) return { ok: false, error: `“${same[0].name}” is already a brand of this ingredient. Use Merge to combine them.` };
  const { error } = await sb.from('mm_brands').update({ name }).eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** A brand's own diet flags (null = the ingredient's). Leaders only — it is a safety setting. */
export async function setBrandDietsWith(sb: SupabaseClient, id: string, avoid: unknown): Promise<BrandWrite> {
  const value = avoid == null ? null : DIETS.filter((d) => Array.isArray(avoid) && avoid.includes(d));
  const { data, error } = await sb.from('mm_brands').update({ avoid: value }).eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  return data?.length ? { ok: true } : { ok: false, error: 'That brand is gone.' };
}

/** One brand into another of the same ingredient (mm_merge_brand): packages move; menus follow the alias. */
export async function mergeBrandWith(sb: SupabaseClient, from: string, to: string): Promise<BrandWrite> {
  const { data, error } = await sb.rpc('mm_merge_brand', { p_from: from, p_to: to });
  if (error) {
    if (error.message.includes('MM_BAD_MERGE')) return { ok: false, error: 'Those two can’t be merged: pick another brand of the same ingredient.' };
    return { ok: false, error: error.message };
  }
  const n = Number(data);
  return { ok: true, note: `${n} package${n === 1 ? '' : 's'} moved.` };
}

/**
 * Move a brand to another ingredient (a scout typed "Froot Loops" under Bacon). Only a brand with no packages
 * moves: a package's yield is in its ingredient's own unit, so it cannot follow. Menus that chose it under the
 * old ingredient go back to any brand there.
 */
export async function moveBrandWith(sb: SupabaseClient, id: string, toIngredientId: string): Promise<BrandWrite> {
  const row = await liveBrand(sb, id);
  if (!row || row.retired_at) return { ok: false, error: 'That brand is gone.' };
  if (row.ingredient_id === toIngredientId) return { ok: false, error: 'It is already there.' };
  const { count } = await sb.from('mm_packages').select('id', { count: 'exact', head: true }).eq('brand_id', id);
  if ((count ?? 0) > 0) return { ok: false, error: 'This brand has packages with sizes in this ingredient’s unit, so it can’t move. Retire it here and add it under the other ingredient.' };
  const key = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const { data: same } = await sb.from('mm_brands').select('id').eq('ingredient_id', toIngredientId).eq('match_key', key).is('retired_at', null);
  if (same?.length) return { ok: false, error: 'That ingredient already has this brand. Remove this one instead.' };
  const { error } = await sb.from('mm_brands').update({ ingredient_id: toIngredientId }).eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Remove a brand (Patrick: an adult can always remove one). With no packages the row is deleted; with
 * packages it is retired and they stay in the price book with no brand. Either way it leaves every chooser,
 * and a menu that chose it goes back to any brand.
 */
export async function removeBrandWith(sb: SupabaseClient, id: string): Promise<BrandWrite> {
  const row = await liveBrand(sb, id);
  if (!row) return { ok: false, error: 'That brand is gone.' };
  const { count } = await sb.from('mm_packages').select('id', { count: 'exact', head: true }).eq('brand_id', id);
  if ((count ?? 0) === 0) {
    const { error } = await sb.from('mm_brands').delete().eq('id', id);
    return error ? { ok: false, error: error.message } : { ok: true, note: `Removed “${row.name}”.` };
  }
  // Retire first: if the second step fails the brand is already out of every chooser, and a retry finishes it.
  const { error: rErr } = await sb.from('mm_brands').update({ retired_at: new Date().toISOString() }).eq('id', id);
  if (rErr) return { ok: false, error: rErr.message };
  const { error } = await sb.from('mm_packages').update({ brand_id: null }).eq('brand_id', id);
  return error ? { ok: false, error: error.message } : { ok: true, note: `Removed “${row.name}”. Its ${count === 1 ? 'package stays' : `${count} packages stay`} in the price book with no brand.` };
}

/** Which brand a package is a size of, and its size without the brand ("12 oz"). null brand = no brand. */
export async function setPackageBrandWith(sb: SupabaseClient, packageId: string, brandId: string | null, sizeLabel: unknown): Promise<BrandWrite> {
  const size = cleanScoutText(sizeLabel, 60) || null;
  const { data: pkg } = await sb.from('mm_packages').select('ingredient_id').eq('id', packageId).maybeSingle();
  if (!pkg) return { ok: false, error: 'That package is gone.' };
  if (brandId != null) {
    const b = await liveBrand(sb, brandId);
    if (!b || b.retired_at || b.ingredient_id !== pkg.ingredient_id) return { ok: false, error: 'Pick a brand of this ingredient.' };
  }
  const { error } = await sb.from('mm_packages').update({ brand_id: brandId, size_label: size }).eq('id', packageId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Live brands someone typed in on a menu within the last `days` days of `today` ('YYYY-MM-DD'), newest first. */
export function recentTypedBrands(brands: readonly Brand[], today: string, days: number): Brand[] {
  const [y, m, d] = today.split('-').map(Number);
  const since = new Date(Date.UTC(y, m - 1, d - days)).toISOString();
  return brands
    .filter((b) => b.addedBy != null && !b.retiredAt && (b.createdAt ?? '') >= since)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export type SuggestResult = 'ok' | 'not_found' | 'not_yours' | 'bad_brand';

/**
 * Set (or with brandId null, clear) the brand a recipe suggests for one of its ingredients.
 * personId = the author making the change; null = a leader (the caller has checked the capability).
 */
export async function suggestRecipeBrandWith(sb: SupabaseClient, personId: number | null, recipeId: string, ingredientId: string, brandId: string | null): Promise<SuggestResult> {
  const { data, error } = await sb.rpc('mm_suggest_recipe_brand', { p_recipe: recipeId, p_person: personId, p_ingredient: ingredientId, p_brand: brandId });
  if (error) {
    if (error.message.includes('MM_NOT_YOURS')) return 'not_yours';
    if (error.message.includes('MM_BAD_BRAND')) return 'bad_brand';
    throw new Error(`suggest brand: ${error.message}`);
  }
  return data === true ? 'ok' : 'not_found';
}
