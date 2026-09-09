'use server';

/**
 * Menu Monster leader tools — the writes (Plans/Menu-Monster-Leader-Tools.md).
 *
 * Every action re-checks `library.moderate` (the Librarian bundle — the
 * planner is a Library shelf, so its catalog is Library content), writes
 * with the service role (the mm_* tables have RLS on with zero policies,
 * D-239), and records to the content audit trail (area `library`). The two
 * multi-row writes — a recipe's row + lines, and an ingredient's unit change
 * — go through the RPCs in 20260908120000_menu_monster_leader_tools.sql so
 * they are one transaction each.
 *
 * Publish is enforced HERE, not by the disabled button: setRecipeStatus
 * re-runs recipeIssues() on the saved recipe and refuses the first blocking
 * issue (tech-lead, 2026-09-08).
 */

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit, type AuditDetail } from '@/lib/audit';
import { loadAuthoringCatalogWith } from '@/lib/menu-monster/catalog';
import {
  blockingIssues,
  changeUnitPlan,
  recipeIssues,
  slugId,
  variationsSummary,
  type ChangeUnitPlan,
  type RecipeAuthoring,
  type RecipeDraft
} from '@/lib/menu-monster/authoring';
import { compileRecipe, type BaseLine } from '@/lib/menu-monster/variations';
import { RESTRICTION_BY_KEY, UNITS, parseQty } from '@/lib/menu-monster/units';
import type { Recipe, RecipeStatus, RestrictionKey, Section, Unit, Variation, VariationLine } from '@/lib/menu-monster/types';

export interface Result {
  ok: boolean;
  error?: string;
  /** The id a create produced. */
  id?: string;
}

const PATHS = ['/admin/library/menu-monster', '/library/topic/menu-monster'];
function revalidate() {
  for (const p of PATHS) revalidatePath(p);
}

async function guard(): Promise<Result | null> {
  try {
    await requireCapability('library.moderate');
    return null;
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
}

const RESTRICTION_KEYS: readonly RestrictionKey[] = ['gf', 'nut', 'dairy', 'veg'];
const SECTIONS: readonly Section[] = ['produce', 'dairy', 'meat', 'bakery', 'dry'];
const money = (n: number) => `$${n.toFixed(2)}`;

/* ── Ingredients ─────────────────────────────────────────────────────────── */

export interface IngredientInput {
  name: string;
  unit: Unit;
  section: Section;
  staple: boolean;
  avoid: RestrictionKey[];
}

/** A unit a leader may give an ingredient: a named volume/weight/count unit
 *  from the table, or the per-ingredient count noun ('count' + one/many). */
function validUnit(u: Unit): string | null {
  if (!u.one?.trim() || !u.many?.trim()) return 'Say what one is called and what several are called.';
  if (u.kind === 'count') {
    if (u.key !== 'count' && UNITS[u.key]?.kind !== 'count') return 'That is not a count unit.';
    return null;
  }
  if (UNITS[u.key]?.kind !== u.kind) return `${u.key} is not a ${u.kind} unit.`;
  return null;
}

/** Free-text caps (qa-lead, 2026-09-08) — the editors enforce the same maxLength. */
const MAX = { name: 80, product: 120, store: 40, note: 200, steps: 600, method: 40, label: 120 } as const;
const cap = (s: string, n: number) => s.trim().slice(0, n);

function cleanIngredient(input: Partial<IngredientInput>): { value: Omit<IngredientInput, 'unit'>; error?: string } {
  const name = cap(String(input.name ?? ''), MAX.name);
  const section = input.section as Section;
  const avoid = (input.avoid ?? []).filter((k): k is RestrictionKey => RESTRICTION_KEYS.includes(k));
  const value = { name, section, staple: !!input.staple, avoid };
  if (!name) return { value, error: 'Give the ingredient a name.' };
  if (!SECTIONS.includes(section)) return { value, error: 'Pick a store section.' };
  return { value };
}

export async function createIngredient(input: IngredientInput): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const { value, error } = cleanIngredient(input);
  if (error) return { ok: false, error };
  const unitError = validUnit(input.unit);
  if (unitError) return { ok: false, error: unitError };

  const supabase = createAdminClient();
  const { data: ids } = await supabase.from('mm_ingredients').select('id');
  const id = slugId(value.name, new Set(((ids ?? []) as { id: string }[]).map((r) => r.id)));
  const { error: dbErr } = await supabase.from('mm_ingredients').insert({
    id,
    name: value.name,
    unit_kind: input.unit.kind,
    unit_key: input.unit.key,
    unit_one: input.unit.one.trim(),
    unit_many: input.unit.many.trim(),
    section: value.section,
    staple: value.staple,
    avoid: value.avoid
  });
  if (dbErr) return { ok: false, error: dbErr.message };

  await recordAudit({
    area: 'library',
    action: 'create',
    entityType: 'mm_ingredient',
    entityId: id,
    summary: `Created Menu Monster ingredient "${value.name}"`
  });
  revalidate();
  return { ok: true, id };
}

export async function updateIngredient(id: string, input: Omit<IngredientInput, 'unit'>): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const { value, error } = cleanIngredient(input);
  if (error) return { ok: false, error };

  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from('mm_ingredients')
    .select('name, section, staple, avoid')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'That ingredient is gone.' };
  const b = before as { name: string; section: string; staple: boolean; avoid: string[] };

  const { error: dbErr } = await supabase
    .from('mm_ingredients')
    .update({ name: value.name, section: value.section, staple: value.staple, avoid: value.avoid })
    .eq('id', id);
  if (dbErr) return { ok: false, error: dbErr.message };

  const details: AuditDetail[] = [];
  if (b.name !== value.name) details.push({ field: 'Name', from: b.name, to: value.name });
  if (b.section !== value.section) details.push({ field: 'Section', from: b.section, to: value.section });
  if (b.staple !== value.staple) details.push({ field: 'Patrol box', from: String(b.staple), to: String(value.staple) });
  if (b.avoid.join(',') !== value.avoid.join(','))
    details.push({ field: 'Warn', from: b.avoid.join(', ') || '—', to: value.avoid.join(', ') || '—' });
  await recordAudit({
    area: 'library',
    action: 'update',
    entityType: 'mm_ingredient',
    entityId: id,
    summary: `Updated Menu Monster ingredient "${value.name}"`,
    details
  });
  revalidate();
  return { ok: true };
}

/** The non-retired recipes whose lines use this ingredient. */
async function recipesUsing(supabase: ReturnType<typeof createAdminClient>, ingredientId: string): Promise<string[]> {
  const { data } = await supabase
    .from('mm_recipe_lines')
    .select('recipe_id, mm_recipes!inner(name, status)')
    .eq('ingredient_id', ingredientId)
    .neq('mm_recipes.status', 'retired');
  const names = new Set<string>();
  for (const row of (data ?? []) as unknown as { mm_recipes: { name: string } | null }[]) {
    if (row.mm_recipes) names.add(row.mm_recipes.name);
  }
  return [...names].sort();
}

export async function retireIngredient(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = createAdminClient();
  const using = await recipesUsing(supabase, id);
  if (using.length > 0) {
    return { ok: false, error: `Still used by ${using.join(', ')} — retire or edit those first.` };
  }
  const { data: row } = await supabase.from('mm_ingredients').select('name').eq('id', id).maybeSingle();
  const { error } = await supabase.from('mm_ingredients').update({ retired_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    area: 'library',
    action: 'retire',
    entityType: 'mm_ingredient',
    entityId: id,
    summary: `Retired Menu Monster ingredient "${(row as { name: string } | null)?.name ?? id}"`,
    details: [{ field: 'Status', from: 'Active', to: 'Retired' }]
  });
  revalidate();
  return { ok: true };
}

export async function restoreIngredient(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = createAdminClient();
  const { data: row } = await supabase.from('mm_ingredients').select('name').eq('id', id).maybeSingle();
  const { error } = await supabase.from('mm_ingredients').update({ retired_at: null }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    area: 'library',
    action: 'restore',
    entityType: 'mm_ingredient',
    entityId: id,
    summary: `Restored Menu Monster ingredient "${(row as { name: string } | null)?.name ?? id}"`,
    details: [{ field: 'Status', from: 'Retired', to: 'Active' }]
  });
  revalidate();
  return { ok: true };
}

/**
 * Change an ingredient's recipe unit. The plan (authoring.ts changeUnitPlan)
 * is recomputed here from the live catalog — the client's preview is only a
 * preview — and applied by the RPC in one transaction.
 */
export async function changeIngredientUnit(id: string, newUnit: Unit): Promise<Result & { plan?: ChangeUnitPlan }> {
  const denied = await guard();
  if (denied) return denied;
  const unitError = validUnit(newUnit);
  if (unitError) return { ok: false, error: unitError };

  const supabase = createAdminClient();
  const catalog = await loadAuthoringCatalogWith(supabase);
  const ingredient = catalog.ingredients.find((i) => i.id === id);
  if (!ingredient) return { ok: false, error: 'That ingredient is gone.' };
  const packages = catalog.packages.filter((p) => p.ingredientId === id && !p.retiredAt);
  const lines = catalog.recipes
    .filter((r) => r.status !== 'retired')
    .flatMap((r) => r.lines.filter((l) => l.ingredientId === id).map((l) => ({ recipeId: r.id, recipeName: r.name, unitKey: l.unitKey })));
  const plan = changeUnitPlan(ingredient, newUnit, packages, lines, catalog.conversions);

  const { error } = await supabase.rpc('mm_change_ingredient_unit', {
    p_ingredient_id: id,
    p_unit: { kind: newUnit.kind, key: newUnit.key, one: newUnit.one.trim(), many: newUnit.many.trim() },
    p_package_yields: plan.packages.map((p) => ({ id: p.id, yield: p.yield, yield_unit_label: p.yieldUnitLabel })),
    p_pin_unit: plan.pinUnit
  });
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    area: 'library',
    action: 'update',
    entityType: 'mm_ingredient',
    entityId: id,
    summary: `Changed the recipe unit of Menu Monster ingredient "${ingredient.name}"`,
    details: [
      { field: 'Unit', from: ingredient.unit.many, to: newUnit.many.trim() },
      { field: 'Packages converted', from: '—', to: String(plan.packages.filter((p) => p.converted).length) },
      { field: 'Lines pinned', from: '—', to: String(plan.pinnedLines.length) }
    ]
  });
  revalidate();
  return { ok: true, plan };
}

/* ── Conversions ─────────────────────────────────────────────────────────── */

export async function addConversion(
  ingredientId: string,
  input: { from: string; to: string; factor: number; label: string | null }
): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const from = input.from.trim();
  const to = input.to.trim();
  if (!from || !to) return { ok: false, error: 'Name both units.' };
  if (from === to) return { ok: false, error: 'The two units must differ.' };
  if (!(input.factor > 0)) return { ok: false, error: 'The factor must be more than zero.' };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('mm_conversions')
    .insert({ ingredient_id: ingredientId, from_unit: cap(from, MAX.store), to_unit: cap(to, MAX.store), factor: input.factor, label: input.label ? cap(input.label, MAX.label) || null : null })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    area: 'library',
    action: 'create',
    entityType: 'mm_conversion',
    entityId: (data as { id: number }).id,
    summary: `Added a Menu Monster conversion for ${ingredientId}: 1 ${from} = ${input.factor} ${to}`
  });
  revalidate();
  return { ok: true, id: String((data as { id: number }).id) };
}

export async function deleteConversion(id: number): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from('mm_conversions')
    .select('ingredient_id, from_unit, to_unit, factor')
    .eq('id', id)
    .maybeSingle();
  const { error } = await supabase.from('mm_conversions').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  const r = row as { ingredient_id: string; from_unit: string; to_unit: string; factor: number } | null;
  await recordAudit({
    area: 'library',
    action: 'delete',
    entityType: 'mm_conversion',
    entityId: id,
    summary: r
      ? `Removed a Menu Monster conversion for ${r.ingredient_id}: 1 ${r.from_unit} = ${r.factor} ${r.to_unit}`
      : `Removed Menu Monster conversion ${id}`
  });
  revalidate();
  return { ok: true };
}

/* ── Packages ────────────────────────────────────────────────────────────── */

export interface PackageInput {
  ingredientId: string;
  name: string;
  store: string | null;
  price: number;
  soldSize: number | null;
  soldUnit: string | null;
  /** In the ingredient's recipe unit; null = unusable until typed. */
  yield: number | null;
  /** Why it is unusable — the unit the label is in. */
  yieldUnitLabel: string | null;
  noun: string;
  /** 'YYYY-MM-DD'. */
  asOf: string | null;
  note: string | null;
}

function cleanPackage(input: Partial<PackageInput>): { value: PackageInput; error?: string } {
  const value: PackageInput = {
    ingredientId: String(input.ingredientId ?? ''),
    name: cap(String(input.name ?? ''), MAX.product),
    store: input.store ? cap(input.store, MAX.store) || null : null,
    price: Number(input.price),
    soldSize: input.soldSize == null || input.soldSize === ('' as unknown) ? null : Number(input.soldSize),
    soldUnit: input.soldUnit?.trim() || null,
    yield: input.yield == null ? null : Number(input.yield),
    yieldUnitLabel: input.yieldUnitLabel?.trim() || null,
    noun: String(input.noun ?? '').trim() || 'pack',
    asOf: input.asOf?.trim() || null,
    note: input.note ? cap(input.note, MAX.note) || null : null
  };
  if (!value.ingredientId) return { value, error: 'Pick an ingredient.' };
  if (!value.name) return { value, error: 'Type the product name as it reads on the label.' };
  if (!Number.isFinite(value.price) || value.price < 0) return { value, error: 'Type the price.' };
  if (value.yield != null && !(value.yield > 0)) return { value, error: 'The yield must be more than zero — or leave it blank.' };
  if (value.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf)) return { value, error: 'The price date must be a calendar day.' };
  if (value.yield == null && !value.yieldUnitLabel) value.yieldUnitLabel = value.soldUnit ?? 'label size';
  if (value.yield != null) value.yieldUnitLabel = null;
  return { value };
}

export async function createPackage(input: PackageInput): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const { value, error } = cleanPackage(input);
  if (error) return { ok: false, error };

  const supabase = createAdminClient();
  const { data: ids } = await supabase.from('mm_packages').select('id');
  const id = slugId(`p-${value.name}`, new Set(((ids ?? []) as { id: string }[]).map((r) => r.id)));
  const { error: dbErr } = await supabase.from('mm_packages').insert({
    id,
    ingredient_id: value.ingredientId,
    name: value.name,
    store: value.store,
    price: value.price,
    yield: value.yield,
    yield_unit_label: value.yieldUnitLabel,
    noun: value.noun,
    sold_size: value.soldSize,
    sold_unit: value.soldUnit,
    note: value.note,
    as_of: value.asOf
  });
  if (dbErr) return { ok: false, error: dbErr.message };

  await recordAudit({
    area: 'library',
    action: 'create',
    entityType: 'mm_package',
    entityId: id,
    summary: `Added Menu Monster package "${value.name}" (${value.ingredientId})`,
    details: [{ field: 'Price', from: '—', to: money(value.price) }]
  });
  revalidate();
  return { ok: true, id };
}

export type PackageEdit = Pick<PackageInput, 'name' | 'store' | 'price' | 'yield' | 'yieldUnitLabel' | 'asOf' | 'note' | 'soldSize' | 'soldUnit' | 'noun'>;

export async function updatePackage(id: string, input: PackageEdit): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from('mm_packages')
    .select('ingredient_id, name, store, price, yield, yield_unit_label, noun, sold_size, sold_unit, note, as_of')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'That package is gone.' };
  const b = before as {
    ingredient_id: string; name: string; store: string | null; price: number; yield: number | null;
    yield_unit_label: string | null; noun: string; sold_size: number | null; sold_unit: string | null;
    note: string | null; as_of: string | null;
  };
  const { value, error } = cleanPackage({ ...input, ingredientId: b.ingredient_id });
  if (error) return { ok: false, error };

  const { error: dbErr } = await supabase
    .from('mm_packages')
    .update({
      name: value.name,
      store: value.store,
      price: value.price,
      yield: value.yield,
      yield_unit_label: value.yieldUnitLabel,
      noun: value.noun,
      sold_size: value.soldSize,
      sold_unit: value.soldUnit,
      note: value.note,
      as_of: value.asOf
    })
    .eq('id', id);
  if (dbErr) return { ok: false, error: dbErr.message };

  const details: AuditDetail[] = [];
  if (Number(b.price) !== value.price) details.push({ field: 'Price', from: money(Number(b.price)), to: money(value.price) });
  if ((b.as_of ?? '') !== (value.asOf ?? '')) details.push({ field: 'Price as of', from: b.as_of ?? '—', to: value.asOf ?? '—' });
  const by = b.yield == null ? null : Number(b.yield);
  if (by !== value.yield) details.push({ field: 'Yield', from: by == null ? '—' : String(by), to: value.yield == null ? '—' : String(value.yield) });
  if (b.name !== value.name) details.push({ field: 'Name', from: b.name, to: value.name });
  if ((b.store ?? '') !== (value.store ?? '')) details.push({ field: 'Store', from: b.store ?? '—', to: value.store ?? '—' });
  if ((b.note ?? '') !== (value.note ?? '')) details.push({ field: 'Note', from: b.note ?? '—', to: value.note ?? '—' });
  await recordAudit({
    area: 'library',
    action: 'update',
    entityType: 'mm_package',
    entityId: id,
    summary: `Updated Menu Monster package "${value.name}" (${b.ingredient_id})`,
    details
  });
  revalidate();
  return { ok: true };
}

async function setPackageRetired(id: string, retired: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = createAdminClient();
  const { data: row } = await supabase.from('mm_packages').select('name').eq('id', id).maybeSingle();
  const { error } = await supabase
    .from('mm_packages')
    .update({ retired_at: retired ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  const name = (row as { name: string } | null)?.name ?? id;
  await recordAudit({
    area: 'library',
    action: retired ? 'retire' : 'restore',
    entityType: 'mm_package',
    entityId: id,
    summary: `${retired ? 'Retired' : 'Restored'} Menu Monster package "${name}"`,
    details: [{ field: 'Status', from: retired ? 'Active' : 'Retired', to: retired ? 'Retired' : 'Active' }]
  });
  revalidate();
  return { ok: true };
}

export async function retirePackage(id: string): Promise<Result> {
  return setPackageRetired(id, true);
}

export async function restorePackage(id: string): Promise<Result> {
  return setPackageRetired(id, false);
}

/* ── Recipes ─────────────────────────────────────────────────────────────── */

/** The saved recipe as a draft, for the server-side publish gate. */
function draftOf(r: Recipe): RecipeDraft {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    mealFit: r.mealFit,
    foodGroups: r.foodGroups,
    camp: r.camp,
    trail: r.trail,
    method: r.method,
    stepsMd: r.stepsMd ?? '',
    lines: r.lines.map((l) => ({
      ingredientId: l.ingredientId,
      amount: String(l.qtyPerPerson),
      unitKey: l.unitKey,
      servesRule: l.servesRule,
      servesRestrictions: l.servesRestrictions
    }))
  };
}

/**
 * Save a recipe: its row, its COMPILED lines, and the authoring diffs, in one
 * transaction (mm_save_recipe v2). A DRAFT may carry issues — that is what
 * drafts are for — except the ones the tables cannot hold: a line with no
 * ingredient, an amount that is not a number, a base ingredient listed twice
 * (the unique index), a change that points at nothing. Status is not changed
 * here (setRecipeStatus is the only status writer); a new recipe starts as a
 * draft.
 */
export async function saveRecipe(a: RecipeAuthoring): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const name = cap(a.name, MAX.name);
  if (!name) return { ok: false, error: 'Give the menu item a name.' };

  const amountOf = (raw: string, where: string): { q?: number; error?: string } => {
    const t = raw.trim();
    if (!t) return { error: `${where}: type an amount per person.` };
    const q = parseQty(t);
    if (!Number.isFinite(q) || q < 0) return { error: `${where}: '${t}' isn't a number. Type something like ½, 1/2 or 0.5.` };
    return { q };
  };

  const base: BaseLine[] = [];
  const seen = new Set<string>();
  for (const [i, l] of a.base.entries()) {
    if (!l.ingredientId) return { ok: false, error: `Line ${i + 1}: pick an ingredient.` };
    if (seen.has(l.ingredientId)) return { ok: false, error: `Line ${i + 1}: that ingredient already has a line — combine them.` };
    seen.add(l.ingredientId);
    const { q, error } = amountOf(l.amount, `Line ${i + 1}`);
    if (error) return { ok: false, error };
    base.push({ ingredientId: l.ingredientId, qtyPerPerson: q as number, unitKey: l.unitKey || null });
  }

  const variations: Variation[] = [];
  const seenR = new Set<string>();
  for (const v of a.variations) {
    if (!RESTRICTION_KEYS.includes(v.restriction)) return { ok: false, error: 'Unknown restriction.' };
    if (seenR.has(v.restriction)) return { ok: false, error: `Two ${v.restriction} variations — keep one.` };
    seenR.add(v.restriction);
    if (!['nothing', 'substituted', 'unsuitable'].includes(v.state)) return { ok: false, error: 'Unknown variation state.' };
    const label = RESTRICTION_BY_KEY[v.restriction].label;
    const lines: VariationLine[] = [];
    if (v.state === 'substituted') {
      for (const [i, l] of v.lines.entries()) {
        const where = `${label}, change ${i + 1}`;
        if (!['swap', 'leave_out', 'add'].includes(l.op)) return { ok: false, error: `${where}: unknown change.` };
        const needsBase = l.op === 'swap' || l.op === 'leave_out';
        const needsIn = l.op === 'swap' || l.op === 'add';
        if (needsBase && (!l.baseIngredientId || !seen.has(l.baseIngredientId))) return { ok: false, error: `${where}: the base line it changes is gone.` };
        let q: number | null = null;
        if (needsIn) {
          if (!l.ingredientId) return { ok: false, error: `${where}: pick the ingredient.` };
          const r = amountOf(l.amount, where);
          if (r.error) return { ok: false, error: r.error };
          q = r.q as number;
        }
        lines.push({
          op: l.op,
          baseIngredientId: needsBase ? l.baseIngredientId : null,
          ingredientId: needsIn ? l.ingredientId : null,
          qtyPerPerson: q,
          unitKey: needsIn ? l.unitKey || null : null
        });
      }
    }
    variations.push({ restriction: v.restriction, state: v.state, note: cap(v.note ?? '', MAX.note) || null, lines });
  }

  const compiled = compileRecipe<number>(base, variations);

  const supabase = createAdminClient();
  const { data: rows } = await supabase.from('mm_recipes').select('id, status, sort_order');
  const existing = ((rows ?? []) as { id: string; status: RecipeStatus; sort_order: number }[]);
  const taken = new Set(existing.map((r) => r.id));
  const current = existing.find((r) => r.id === a.id);
  const id = current ? a.id : a.id && !taken.has(a.id) ? a.id : slugId(name, taken);
  const status: RecipeStatus = current ? current.status : 'draft';
  const sortOrder = current ? current.sort_order : Math.max(0, ...existing.map((r) => r.sort_order)) + 10;

  // qa-lead, 2026-09-08: a clean message beats a foreign-key error from a
  // stale page, and a PUBLISHED recipe must not quietly take a zero line
  // (the publish gate only runs at publish time).
  const { data: ingRows } = await supabase.from('mm_ingredients').select('id');
  const known = new Set(((ingRows ?? []) as { id: string }[]).map((r) => r.id));
  const unknown = compiled.find((l) => !known.has(l.ingredientId));
  if (unknown) return { ok: false, error: `Unknown ingredient "${unknown.ingredientId}" — reload the page and try again.` };
  if (status === 'published') {
    const zero = compiled.findIndex((l) => !(l.qtyPerPerson > 0));
    if (zero >= 0) return { ok: false, error: `Line ${zero + 1}: the amount per person must be more than zero on a published item.` };
  }

  const { error } = await supabase.rpc('mm_save_recipe', {
    p_recipe: {
      id,
      name,
      status,
      meal_fit: a.mealFit,
      food_groups: a.foodGroups,
      camp: a.camp,
      trail: a.trail,
      method: a.method ? cap(a.method, MAX.method) : null,
      steps_md: cap(a.stepsMd ?? '', MAX.steps),
      sort_order: sortOrder
    },
    p_lines: compiled.map((l) => ({
      ingredient_id: l.ingredientId,
      qty_per_person: l.qtyPerPerson,
      unit_key: l.unitKey,
      serves_rule: l.servesRule,
      serves_restrictions: l.servesRestrictions
    })),
    p_variations: variations.map((v) => ({
      restriction: v.restriction,
      state: v.state,
      note: v.note,
      lines: v.lines.map((l) => ({
        op: l.op,
        base_ingredient_id: l.baseIngredientId,
        ingredient_id: l.ingredientId,
        qty_per_person: l.qtyPerPerson,
        unit_key: l.unitKey
      }))
    }))
  });
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    area: 'library',
    action: current ? 'update' : 'create',
    entityType: 'mm_recipe',
    entityId: id,
    summary: `${current ? 'Saved' : 'Created'} Menu Monster menu item "${name}"`,
    details: [
      { field: 'Ingredient lines', from: '—', to: String(compiled.length) },
      { field: 'Variations', from: '—', to: variationsSummary(a.variations) }
    ]
  });
  revalidate();
  return { ok: true, id };
}

const STATUS_LABEL: Record<RecipeStatus, string> = { draft: 'Draft', published: 'Published', retired: 'Retired' };

export async function setRecipeStatus(id: string, status: RecipeStatus): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  if (!(status in STATUS_LABEL)) return { ok: false, error: 'Unknown status.' };

  const supabase = createAdminClient();
  const catalog = await loadAuthoringCatalogWith(supabase);
  const recipe = catalog.recipes.find((r) => r.id === id);
  if (!recipe) return { ok: false, error: 'That menu item is gone.' };
  if (status === 'published') {
    const blocking = blockingIssues(recipeIssues(draftOf(recipe), catalog));
    if (blocking.length > 0) return { ok: false, error: blocking[0].text };
  }

  const { error } = await supabase
    .from('mm_recipes')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    area: 'library',
    action: status === 'published' ? 'publish' : status === 'retired' ? 'retire' : 'update',
    entityType: 'mm_recipe',
    entityId: id,
    summary: `${STATUS_LABEL[status]} Menu Monster menu item "${recipe.name}"`.replace(/^Published/, 'Published').replace(/^Draft/, 'Restored as draft'),
    details: [{ field: 'Status', from: STATUS_LABEL[recipe.status], to: STATUS_LABEL[status] }]
  });
  revalidate();
  return { ok: true };
}

export async function duplicateRecipe(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = createAdminClient();
  const catalog = await loadAuthoringCatalogWith(supabase);
  const recipe = catalog.recipes.find((r) => r.id === id);
  if (!recipe) return { ok: false, error: 'That menu item is gone.' };
  const taken = new Set(catalog.recipes.map((r) => r.id));
  const newId = slugId(`${recipe.name} copy`, taken);
  const name = `${recipe.name} (copy)`;
  const { error } = await supabase.rpc('mm_save_recipe', {
    p_recipe: {
      id: newId,
      name,
      status: 'draft',
      meal_fit: recipe.mealFit,
      food_groups: recipe.foodGroups,
      camp: recipe.camp,
      trail: recipe.trail,
      method: recipe.method,
      steps_md: recipe.stepsMd,
      sort_order: recipe.sortOrder + 1
    },
    p_lines: recipe.lines.map((l) => ({
      ingredient_id: l.ingredientId,
      qty_per_person: l.qtyPerPerson,
      unit_key: l.unitKey,
      serves_rule: l.servesRule,
      serves_restrictions: l.servesRestrictions
    })),
    p_variations: (recipe.variations ?? []).map((v) => ({
      restriction: v.restriction,
      state: v.state,
      note: v.note,
      lines: v.lines.map((l) => ({
        op: l.op,
        base_ingredient_id: l.baseIngredientId,
        ingredient_id: l.ingredientId,
        qty_per_person: l.qtyPerPerson,
        unit_key: l.unitKey
      }))
    }))
  });
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    area: 'library',
    action: 'create',
    entityType: 'mm_recipe',
    entityId: newId,
    summary: `Duplicated Menu Monster menu item "${recipe.name}" as "${name}"`
  });
  revalidate();
  return { ok: true, id: newId };
}
