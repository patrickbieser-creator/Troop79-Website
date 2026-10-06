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
import { acknowledgePriceChangeWith, decidePriceWith, leaderSetPriceWith, type DecideOutcome } from '@/lib/menu-monster/price-history';
import { loadAuthoringCatalogWith } from '@/lib/menu-monster/catalog';
import { cleanScoutText, isScoutRecipeId } from '@/lib/menu-monster/scout-recipes';
import { keepTypedInWith, matchTypedInWith, rejectTypedInWith, renameScoutRecipeWith, setScoutRecipeCreditWith } from '@/lib/menu-monster/scout-recipes-store';
import { deleteMenuWith, duplicateMenuWith, loadMenuWith, renameMenuWith, setMenuOwnerWith, setMenuPatrolWith, setMenuSharedWith, MENU_LIMIT } from '@/lib/menu-monster/menus-store';
import { isMenuId } from '@/lib/menu-monster/menus';
import { approveHeldPackageWith, rejectHeldPackageWith } from '@/lib/menu-monster/scout-packages-store';
import { createGearWith, deleteGearWith, mergeGearWith, resolveGearWith, retireGearWith, storedRecipeGearWith, updateGearWith } from '@/lib/menu-monster/gear-store';
import { createBrandWith, mergeBrandWith, moveBrandWith, removeBrandWith, renameBrandWith, setBrandDietsWith, setPackageBrandWith, type BrandWrite, suggestRecipeBrandWith } from '@/lib/menu-monster/brands-store';
import {
  authoringOf,
  blockingIssues,
  changeUnitPlan,
  learnedConversion,
  learnedText,
  recipeIssues,
  slugId,
  variationsSummary,
  type ChangeUnitPlan,
  type RecipeAuthoring,
  type RecipeDraft
} from '@/lib/menu-monster/authoring';
import { compileRecipe, type BaseLine } from '@/lib/menu-monster/variations';
import { RESTRICTION_BY_KEY, UNITS, parseQty } from '@/lib/menu-monster/units';
import type { FoodGroup, Ingredient, MealSlot, Recipe, RecipeStatus, RestrictionKey, Section, Unit, Variation, VariationLine } from '@/lib/menu-monster/types';

export interface Result {
  ok: boolean;
  error?: string;
  /** The id a create produced. */
  id?: string;
  /** A package save that taught the ingredient a conversion: "1 oz = 0.2 cups". */
  learned?: string;
  /** A recipe save: gear names that are not on the master gear list, so were not kept. */
  dropped?: string[];
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

async function guardActor(): Promise<{ personId: number | null; label: string } | Result> {
  try {
    const actor = await requireCapability('library.moderate');
    return { personId: actor.personId, label: actor.label };
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
}

const RESTRICTION_KEYS: readonly RestrictionKey[] = ['gf', 'nut', 'dairy', 'veg'];
const SECTIONS: readonly Section[] = ['produce', 'dairy', 'meat', 'bakery', 'dry'];
const money = (n: number) => `$${n.toFixed(2)}`;
const SCOUT_OWNED = 'A scout shared this recipe, so it never goes back to a draft: retire it instead.';

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
/** The live recipes an ingredient is IN. Its own "served by itself" menu item is not one of them: that item
 *  is the food, and retires with it (migration 20261015100000, mm_food_link_follow). */
async function recipesUsing(supabase: ReturnType<typeof createAdminClient>, ingredientId: string): Promise<string[]> {
  const { data } = await supabase
    .from('mm_recipe_lines')
    .select('recipe_id, mm_recipes!inner(name, status, food_ingredient_id)')
    .eq('ingredient_id', ingredientId)
    .neq('mm_recipes.status', 'retired');
  const names = new Set<string>();
  for (const row of (data ?? []) as unknown as { mm_recipes: { name: string; food_ingredient_id: string | null } | null }[]) {
    if (row.mm_recipes && row.mm_recipes.food_ingredient_id !== ingredientId) names.add(row.mm_recipes.name);
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

/** A package saved with a size, a weight/volume label unit and a typed yield
 *  states the ingredient's conversion — save it when none bridges that unit yet
 *  (authoring.ts learnedConversion), so the next package gets its yield
 *  suggested and nobody enters it by hand. Best-effort: the package is already
 *  saved, and a failure here only means the conversion is typed later. */
async function rememberConversion(supabase: ReturnType<typeof createAdminClient>, value: PackageInput): Promise<string | undefined> {
  if (value.yield == null || value.soldSize == null || !value.soldUnit) return undefined;
  const [{ data: ing }, { data: rows }] = await Promise.all([
    supabase.from('mm_ingredients').select('id, name, unit_kind, unit_key, unit_one, unit_many, section').eq('id', value.ingredientId).maybeSingle(),
    supabase.from('mm_conversions').select('ingredient_id, from_unit, to_unit, factor, label').eq('ingredient_id', value.ingredientId)
  ]);
  const i = ing as { id: string; name: string; unit_kind: Unit['kind']; unit_key: string; unit_one: string; unit_many: string; section: Section } | null;
  if (!i) return undefined;
  const ingredient: Ingredient = {
    id: i.id,
    name: i.name,
    unit: { key: i.unit_key, one: i.unit_one, many: i.unit_many, kind: i.unit_kind },
    section: i.section,
    staple: false,
    avoid: [],
    retiredAt: null
  };
  const onFile = ((rows ?? []) as { ingredient_id: string; from_unit: string; to_unit: string; factor: number; label: string | null }[]).map((c) => ({
    ingredientId: c.ingredient_id,
    from: c.from_unit,
    to: c.to_unit,
    factor: Number(c.factor),
    label: c.label
  }));
  const learned = learnedConversion(ingredient, value.soldSize, value.soldUnit, value.yield, onFile, value.name);
  if (!learned) return undefined;
  const { data, error } = await supabase
    .from('mm_conversions')
    .insert({ ingredient_id: i.id, from_unit: learned.from, to_unit: learned.to, factor: learned.factor, label: cap(learned.label, MAX.label) })
    .select('id')
    .single();
  if (error) return undefined;
  const text = learnedText(learned, ingredient);
  await recordAudit({
    area: 'library',
    action: 'create',
    entityType: 'mm_conversion',
    entityId: (data as { id: number }).id,
    summary: `Remembered a Menu Monster conversion for ${i.id} from package "${value.name}": ${text}`
  });
  return text;
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
  const learned = await rememberConversion(supabase, value);
  revalidate();
  return { ok: true, id, learned };
}

export type PackageEdit = Pick<PackageInput, 'name' | 'store' | 'price' | 'yield' | 'yieldUnitLabel' | 'asOf' | 'note' | 'soldSize' | 'soldUnit' | 'noun'>;

export async function updatePackage(id: string, input: PackageEdit): Promise<Result> {
  const g = await guardActor();
  if ('ok' in g) return g;
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
      yield: value.yield,
      yield_unit_label: value.yieldUnitLabel,
      noun: value.noun,
      sold_size: value.soldSize,
      sold_unit: value.soldUnit,
      note: value.note
    })
    .eq('id', id);
  if (dbErr) return { ok: false, error: dbErr.message };

  // The price itself goes in ONE transaction with its history row and the band
  // anchor (mm_leader_set_price): a leader set it, so scout reports are banded
  // from here, and a failure can never leave a new price without history.
  const priceChanged = Math.round(Number(b.price) * 100) !== Math.round(value.price * 100) || (b.as_of ?? null) !== (value.asOf ?? null);
  if (priceChanged) {
    try {
      if (g.personId != null) {
        await leaderSetPriceWith(supabase, { packageId: id, newPrice: value.price, asOf: value.asOf, leaderId: g.personId });
      } else {
        // No person record to credit: no history row, so a plain update is atomic enough.
        const { error: priceErr } = await supabase
          .from('mm_packages')
          .update({ price: value.price, as_of: value.asOf, anchor_price: value.price, anchor_as_of: value.asOf })
          .eq('id', id);
        if (priceErr) throw new Error(priceErr.message);
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not save the price.' };
    }
  }

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
  const learned = await rememberConversion(supabase, value);
  revalidate();
  return { ok: true, learned };
}

/* ── Scout-reported prices (Phase 2 release B) ───────────────────────────── */

export interface PriceDecisionResult extends Result {
  outcome?: DecideOutcome;
  /** The history row to undo with (an applied price can be reverted). */
  historyId?: string;
}

const DECISION_ERROR: Partial<Record<DecideOutcome, string>> = {
  superseded: 'The price has changed since, so there is nothing to revert.',
  not_held: 'Someone already decided that one.',
  not_applied: 'That change was already reverted.',
  missing: 'That price report is gone.'
};

async function decidePrice(historyId: string, decision: 'apply' | 'dismiss' | 'revert'): Promise<PriceDecisionResult> {
  const g = await guardActor();
  if ('ok' in g) return g;
  if (g.personId == null) return { ok: false, error: 'Sign in with your own account to decide prices.' };
  let outcome: DecideOutcome;
  try {
    outcome = await decidePriceWith(createAdminClient(), { historyId, decision, decidedBy: g.personId }, recordAudit);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
  revalidate();
  const error = DECISION_ERROR[outcome];
  return error ? { ok: false, error, outcome } : { ok: true, outcome, historyId };
}

export async function applyHeldPrice(historyId: string): Promise<PriceDecisionResult> {
  return decidePrice(historyId, 'apply');
}

export async function dismissHeldPrice(historyId: string): Promise<PriceDecisionResult> {
  return decidePrice(historyId, 'dismiss');
}

export async function revertPriceChange(historyId: string): Promise<PriceDecisionResult> {
  return decidePrice(historyId, 'revert');
}

/** Seen: the change leaves the Price changes list (2026-10-05). */
export async function acknowledgePriceChange(historyId: string): Promise<Result> {
  const g = await guardActor();
  if ('ok' in g) return g;
  const done = await acknowledgePriceChangeWith(createAdminClient(), historyId, g.personId);
  if (!done) return { ok: false, error: 'That change is already off the list.' };
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
  // A scout's recipe stays theirs (mm_save_recipe never touches author, credit or shared_at), but a leader may
  // edit it too (Patrick, 2026-10-05 — the same rights leaders have on anyone's menu, D-327).
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
  const { data: rows } = await supabase.from('mm_recipes').select('id, status, sort_order, food_ingredient_id');
  const existing = ((rows ?? []) as { id: string; status: RecipeStatus; sort_order: number; food_ingredient_id: string | null }[]);
  const taken = new Set(existing.map((r) => r.id));
  const current = existing.find((r) => r.id === a.id);
  // A new item keeps a caller-chosen id only when it is a real slug — never the editor’s `__new__` placeholder.
  const id = current ? a.id : /^[a-z0-9][a-z0-9-]*$/i.test(a.id ?? "") && !taken.has(a.id) ? a.id : slugId(name, taken);
  const status: RecipeStatus = current ? current.status : 'draft';
  const sortOrder = current ? current.sort_order : Math.max(0, ...existing.map((r) => r.sort_order)) + 10;

  // qa-lead, 2026-09-08: a clean message beats a foreign-key error from a
  // stale page, and a PUBLISHED recipe must not quietly take a zero line
  // (the publish gate only runs at publish time).
  const { data: ingRows } = await supabase.from('mm_ingredients').select('id, name, retired_at, added_by_person_id');
  const ings = (ingRows ?? []) as { id: string; name: string; retired_at: string | null; added_by_person_id: number | null }[];
  const known = new Set(ings.map((r) => r.id));
  const unknown = compiled.find((l) => !known.has(l.ingredientId));
  if (unknown) return { ok: false, error: `Unknown ingredient "${unknown.ingredientId}" — reload the page and try again.` };
  // A menu item tied to its food is renamed WITH it (mm_save_recipe), so a new name here is a new name in
  // the Price book: refuse one another food already has, the same check a new food gets (qa-lead).
  const tiedFood = a.foodIngredientId !== undefined ? a.foodIngredientId : (current?.food_ingredient_id ?? null);
  if (tiedFood && compiled.length === 1 && compiled[0].ingredientId === tiedFood) {
    const clash = ings.find((i) => i.id !== tiedFood && !i.retired_at && i.added_by_person_id == null && i.name.trim().toLowerCase() === name.toLowerCase());
    if (clash) return { ok: false, error: `“${clash.name}” is already in the price book. Pick another name.` };
  }
  if (status === 'published') {
    const zero = compiled.findIndex((l) => !(l.qtyPerPerson > 0));
    if (zero >= 0) return { ok: false, error: `Line ${zero + 1}: the amount per person must be more than zero on a published item.` };
  }

  // Gear is picked from the master list (Patrick, 2026-10-05): each entry takes its spelling, anything else is
  // dropped and said so. A retired item stays only when this recipe already holds it.
  const gear = Array.isArray(a.gear) ? await resolveGearWith(supabase, a.gear, await storedRecipeGearWith(supabase, current ? a.id : null)) : null;

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
      sort_order: sortOrder,
      // Gear from the master list, A to Z; left out when the form didn't carry it (the RPC keeps the stored list).
      ...(gear ? { equipment: gear.kept } : {}),
      // The food it is, served by itself; left out when the form didn't carry it (the RPC keeps the stored link).
      ...(a.foodIngredientId !== undefined ? { food_ingredient_id: a.foodIngredientId } : {})
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
  return { ok: true, id, ...(gear && gear.dropped.length > 0 ? { dropped: gear.dropped } : {}) };
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
  // A SHARED scout recipe never goes back to draft (other scouts' menus hold it): retire it instead. An
  // unshared one is only ever a draft or retired — publishing is the scout's share.
  if (isScoutRecipeId(id)) {
    if (status === 'draft' && recipe.sharedAt) return { ok: false, error: SCOUT_OWNED };
    if (status === 'published' && !recipe.sharedAt) return { ok: false, error: 'A scout recipe goes live when the scout shares it; until then it is their draft.' };
  }
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
      sort_order: recipe.sortOrder + 1,
      equipment: recipe.equipment ?? []
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

/* ── A single food in one step ───────────────────────────────────────────── */

/**
 * What a single food is (Cookies, Apples, Bacon): an ingredient, one priced
 * package and — when it goes on the menu by itself — a one-line menu item,
 * "each person gets 2 cookies". The model keeps the three rows (the engine
 * reads only recipe lines, a menu holds only recipe ids); this is the one form
 * that writes them together so a leader never visits two tabs for one food.
 */
export interface FoodInput {
  ingredient: IngredientInput;
  /** The first package; `holds` is in the ingredient's own unit. null = price it later. */
  package: { name: string; store: string | null; price: number; holds: number; asOf: string | null } | null;
  /** null = an ingredient only (it goes into recipes, not on the menu by itself). */
  menu: { amount: string; mealFit: MealSlot[]; foodGroups: FoodGroup[] } | null;
}

export interface FoodResult extends Result {
  /** The menu item created, when one was asked for. */
  recipeId?: string;
  /** Created, but something still needs a leader (saved as a draft, no price yet). */
  note?: string;
}

/**
 * Everything is checked before the first write, so the later steps only fail
 * on a database error; if one does, the message says what was already saved.
 */
export async function createFood(input: FoodInput): Promise<FoodResult> {
  const denied = await guard();
  if (denied) return denied;
  const { value, error } = cleanIngredient(input.ingredient ?? {});
  if (error) return { ok: false, error };
  const unitError = validUnit(input.ingredient.unit);
  if (unitError) return { ok: false, error: unitError };

  const pkg = input.package;
  if (pkg) {
    if (!Number.isFinite(Number(pkg.price)) || Number(pkg.price) < 0) return { ok: false, error: 'Type what one package costs.' };
    if (!(Number(pkg.holds) > 0)) return { ok: false, error: `Type how many ${input.ingredient.unit.many.trim()} one package holds.` };
  }
  const menu = input.menu;
  let amount = 0;
  if (menu) {
    amount = parseQty(String(menu.amount ?? '').trim());
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Type how much each person gets — something like 2, ½ or 0.5.' };
    if (!Array.isArray(menu.mealFit) || menu.mealFit.length === 0) return { ok: false, error: 'Pick at least one meal it fits.' };
  }

  const supabase = createAdminClient();
  const [{ data: ings }, { data: recs }] = await Promise.all([
    supabase.from('mm_ingredients').select('name').is('retired_at', null).is('added_by_person_id', null),
    supabase.from('mm_recipes').select('name').neq('status', 'retired').is('author_person_id', null)
  ]);
  const same = (rows: unknown) => ((rows ?? []) as { name: string }[]).some((r) => r.name.trim().toLowerCase() === value.name.toLowerCase());
  if (same(ings)) return { ok: false, error: `“${value.name}” is already in the price book.` };
  if (menu && same(recs)) return { ok: false, error: `There is already a menu item called “${value.name}”.` };

  const made = await createIngredient(input.ingredient);
  if (!made.ok || !made.id) return made;
  const id = made.id;

  if (pkg) {
    const p = await createPackage({
      ingredientId: id,
      name: pkg.name?.trim() || value.name,
      store: pkg.store,
      price: Number(pkg.price),
      soldSize: null,
      soldUnit: null,
      yield: Number(pkg.holds),
      yieldUnitLabel: null,
      noun: 'pack',
      asOf: pkg.asOf,
      note: null
    });
    if (!p.ok) return { ok: false, id, error: `${value.name} is in the price book, but its package was not saved: ${p.error}` };
  }
  if (!menu) return { ok: true, id, ...(pkg ? {} : { note: `${value.name} has no price yet — add a package to make it usable.` }) };

  const saved = await saveRecipe({
    id: '',
    name: value.name,
    status: 'draft',
    mealFit: menu.mealFit,
    foodGroups: menu.foodGroups ?? [],
    camp: true,
    trail: false,
    method: 'no-cook',
    stepsMd: '',
    base: [{ ingredientId: id, amount: String(menu.amount).trim(), unitKey: null }],
    variations: [],
    // One entry: the menu item IS this food (the database keeps its name and retirement in step).
    foodIngredientId: id
  });
  if (!saved.ok || !saved.id) return { ok: false, id, error: `${value.name} is in the price book, but its menu item was not saved: ${saved.error}` };
  // No price yet is fine (2026-10-05): it goes on the menu now and shows as "not priced" until one is added.
  const live = await setRecipeStatus(saved.id, 'published');
  if (!live.ok) return { ok: true, id, recipeId: saved.id, note: `${value.name} is saved as a draft: ${live.error}` };
  return { ok: true, id, recipeId: saved.id, ...(pkg ? {} : { note: `${value.name} is on the menu with no price yet. Add one in the Price book when you have it.` }) };
}

/**
 * "On the menu by itself" for a food already in the Price book (single-food-entry plan, release 2): how many
 * each person gets and which meals it fits. The food's own tied menu item is created the first time, and
 * updated — or brought back from retired — after that, so there is only ever one. It publishes when it can;
 * a food with no price yet waits as a draft and the note says so.
 */
export async function putFoodOnMenu(ingredientId: string, input: { amount: string; mealFit: MealSlot[]; foodGroups: FoodGroup[] }): Promise<FoodResult> {
  const denied = await guard();
  if (denied) return denied;
  const amountText = String(input.amount ?? '').trim();
  const amount = parseQty(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Type how much each person gets — something like 2, ½ or 0.5.' };
  if (!Array.isArray(input.mealFit) || input.mealFit.length === 0) return { ok: false, error: 'Pick at least one meal it fits.' };

  const supabase = createAdminClient();
  const catalog = await loadAuthoringCatalogWith(supabase);
  const ing = catalog.ingredients.find((i) => i.id === ingredientId);
  if (!ing || ing.retiredAt) return { ok: false, error: 'That food is gone or retired.' };
  if (ing.needsMatch) return { ok: false, error: 'A scout typed this one in. Keep or match it first.' };

  const tied = catalog.recipes.find((r) => r.foodIngredientId === ingredientId);
  if (!tied) {
    const clash = catalog.recipes.find((r) => r.status !== 'retired' && r.authorPersonId == null && r.name.trim().toLowerCase() === ing.name.trim().toLowerCase());
    if (clash) return { ok: false, error: `There is already a menu item called “${clash.name}”. Open it under Food & recipes and use Make it a single food.` };
  }
  const base = tied ? authoringOf(tied) : null;
  const saved = await saveRecipe({
    id: tied?.id ?? '',
    name: ing.name,
    status: tied?.status ?? 'draft',
    camp: base?.camp ?? true,
    trail: base?.trail ?? false,
    method: base?.method ?? 'no-cook',
    stepsMd: base?.stepsMd ?? '',
    variations: (base?.variations ?? []).map((v) => ({ ...v, lines: [] })),
    mealFit: input.mealFit,
    foodGroups: input.foodGroups ?? [],
    base: [{ ingredientId, amount: amountText, unitKey: null }],
    foodIngredientId: ingredientId
  });
  if (!saved.ok || !saved.id) return saved;
  if (tied?.status === 'published') return { ok: true, id: ingredientId, recipeId: saved.id };
  // New, a draft, or coming back from retired: publish it if nothing blocks (a food with no price waits as a draft).
  const live = await setRecipeStatus(saved.id, 'published');
  if (live.ok) return { ok: true, id: ingredientId, recipeId: saved.id };
  if (tied?.status === 'retired') await setRecipeStatus(saved.id, 'draft');
  return { ok: true, id: ingredientId, recipeId: saved.id, note: `${ing.name} is saved as a draft: ${live.error}` };
}

/** Off the menu, still in the Price book: the tied menu item is retired (never deleted — saved menus may use it). */
export async function takeFoodOffMenu(ingredientId: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const { data } = await createAdminClient().from('mm_recipes').select('id').eq('food_ingredient_id', ingredientId).maybeSingle();
  const id = (data as { id: string } | null)?.id;
  if (!id) return { ok: false, error: 'It is not on the menu by itself.' };
  return setRecipeStatus(id, 'retired');
}

/* ── Scout recipes (Phase 4A) ────────────────────────────────────────────── */

/** A leader's change to a shared scout recipe's credit ("Recipe by …"). The scout's own edits never touch it. */
export async function setScoutRecipeCredit(id: string, credit: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const clean = cleanScoutText(credit, 40);
  if (!clean) return { ok: false, error: 'Enter the name the credit should show.' };
  const done = await setScoutRecipeCreditWith(createAdminClient(), id, clean);
  if (!done) return { ok: false, error: 'That isn’t a shared scout recipe.' };
  if (done.before !== clean) {
    await recordAudit({
      area: 'library',
      action: 'update',
      entityType: 'scout_recipe',
      entityId: id,
      summary: `Changed the credit on "${done.name}"`,
      details: [{ field: 'Credit', from: done.before ?? '', to: clean }]
    });
  }
  revalidate();
  return { ok: true };
}

/** A leader renames a scout's recipe (the Scout recipes tab, 2026-10-05). */
export async function renameScoutRecipe(id: string, name: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const clean = cap(name, MAX.name);
  if (!clean) return { ok: false, error: 'Give the recipe a name.' };
  const done = await renameScoutRecipeWith(createAdminClient(), id, clean);
  if (!done) return { ok: false, error: 'That isn’t a scout recipe.' };
  if (done.before !== clean) {
    await recordAudit({
      area: 'library',
      action: 'update',
      entityType: 'scout_recipe',
      entityId: id,
      summary: `Renamed "${done.before}" to "${clean}"`,
      details: [{ field: 'Name', from: done.before, to: clean }]
    });
  }
  revalidate();
  return { ok: true };
}

/* ── Menus (the admin Menus tab, 2026-10-05) ─────────────────────────────── */
// Leaders have full rights on anyone's menu (D-327). Each write goes through the menus store as the
// signed-in leader acting for the menu's owner, so the audit trail says who did it and whose menu it was.

const MENU_GONE = 'That menu is gone.';

async function menuOwner(id: string): Promise<{ actor: { personId: number | null; label: string }; ownerId: number } | Result> {
  const actor = await guardActor();
  if ('ok' in actor) return actor;
  if (!isMenuId(id)) return { ok: false, error: MENU_GONE };
  const menu = await loadMenuWith(createAdminClient(), id);
  if (!menu) return { ok: false, error: MENU_GONE };
  return { actor, ownerId: menu.ownerPersonId };
}

/** The owner's copy of the menu, whoever makes it. */
export async function duplicateMenu(id: string): Promise<Result> {
  const who = await menuOwner(id);
  if ('ok' in who) return who;
  const copy = await duplicateMenuWith(createAdminClient(), who.actor, id, who.ownerId);
  if (copy === MENU_LIMIT) return { ok: false, error: 'They already have as many menus as one person may keep. Delete one they don’t need to make room.' };
  if (!copy) return { ok: false, error: MENU_GONE };
  revalidate();
  return { ok: true, id: copy };
}

export async function renameMenu(id: string, name: string): Promise<Result> {
  const who = await menuOwner(id);
  if ('ok' in who) return who;
  const clean = name.trim().slice(0, 120);
  if (!clean) return { ok: false, error: 'Give the menu a name.' };
  const ok = await renameMenuWith(createAdminClient(), who.actor, id, clean, who.ownerId);
  if (!ok) return { ok: false, error: MENU_GONE };
  revalidate();
  return { ok: true };
}

/** Share with the troop, or stop sharing. */
export async function setMenuShared(id: string, on: boolean): Promise<Result> {
  const who = await menuOwner(id);
  if ('ok' in who) return who;
  const ok = await setMenuSharedWith(createAdminClient(), who.actor, id, on === true, who.ownerId);
  if (!ok) return { ok: false, error: MENU_GONE };
  revalidate();
  return { ok: true };
}

/** Hand a menu to a different owner (an active scout or a leader). */
export async function setMenuOwner(id: string, personId: number): Promise<Result> {
  const who = await menuOwner(id);
  if ('ok' in who) return who;
  if (!Number.isInteger(personId) || personId < 1) return { ok: false, error: 'Pick who it belongs to.' };
  const res = await setMenuOwnerWith(createAdminClient(), who.actor, id, personId);
  if (res === MENU_LIMIT) return { ok: false, error: 'They already have as many menus as one person may keep. Delete one they don’t need to make room.' };
  if (!res) return { ok: false, error: MENU_GONE };
  revalidate();
  return { ok: true };
}

/** The patrol a menu is credited to; blank clears it. */
export async function setMenuPatrol(id: string, patrol: string): Promise<Result> {
  const who = await menuOwner(id);
  if ('ok' in who) return who;
  const ok = await setMenuPatrolWith(createAdminClient(), who.actor, id, patrol);
  if (!ok) return { ok: false, error: MENU_GONE };
  revalidate();
  return { ok: true };
}

export async function deleteMenu(id: string): Promise<Result> {
  const who = await menuOwner(id);
  if ('ok' in who) return who;
  const ok = await deleteMenuWith(createAdminClient(), who.actor, id, who.ownerId);
  if (!ok) return { ok: false, error: MENU_GONE };
  revalidate();
  return { ok: true };
}

/* ── Typed-in ingredients (Phase 4B) ─────────────────────────────────────── */

/** Match a scout's typed-in to a book ingredient: 1 typed-in unit = `factor` target units. */
export async function matchScoutIngredient(from: string, to: string, factor: number): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  if (!Number.isFinite(factor) || factor <= 0) return { ok: false, error: 'Enter how many of the price-book unit one of theirs is.' };
  const sb = createAdminClient();
  const { data: pair } = await sb.from('mm_ingredients').select('id, name').in('id', [from, to]);
  const name = (id: string) => (pair ?? []).find((p) => p.id === id)?.name ?? id;
  const res = await matchTypedInWith(sb, from, to, factor);
  if (!res.ok) return res;
  await recordAudit({
    area: 'library',
    action: 'update',
    entityType: 'mm_ingredient',
    entityId: from,
    summary: `Matched scout ingredient "${name(from)}" to "${name(to)}" (${res.moved} recipe line${res.moved === 1 ? '' : 's'})`,
    details: [{ field: 'Matched to', from: name(from), to: `${name(to)} × ${factor}` }]
  });
  revalidate();
  return { ok: true };
}

/** Keep a scout's typed-in as a new book ingredient, with its section and confirmed diets. */
export async function keepScoutIngredient(id: string, section: Section, avoid: RestrictionKey[]): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  if (!SECTIONS.includes(section)) return { ok: false, error: 'Pick a store section.' };
  const clean = RESTRICTION_KEYS.filter((k) => avoid.includes(k));
  const name = await keepTypedInWith(createAdminClient(), id, section, clean);
  if (!name) return { ok: false, error: 'That ingredient isn’t waiting for a match any more.' };
  await recordAudit({
    area: 'library',
    action: 'update',
    entityType: 'mm_ingredient',
    entityId: id,
    summary: `Kept scout ingredient "${name}" as a new price-book ingredient`,
    details: [
      { field: 'Section', from: '', to: section },
      { field: 'Diets it doesn’t suit', from: '', to: clean.join(', ') || 'none' }
    ]
  });
  revalidate();
  return { ok: true };
}

/** Reject a request to add an ingredient (public Ingredients tab): it stays its author's own, and leaves the queue. */
export async function rejectScoutIngredient(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const name = await rejectTypedInWith(createAdminClient(), id);
  if (!name) return { ok: false, error: 'That ingredient isn’t waiting any more.' };
  await recordAudit({
    area: 'library',
    action: 'update',
    entityType: 'mm_ingredient',
    entityId: id,
    summary: `Rejected the request to add "${name}" to the Menu Monster price book`
  });
  revalidate();
  return { ok: true };
}

/* ── Brands (release 3 of Plans/Menu-Monster-Brands-Gear.md) ────────────── */

type BrandResult = Result & { note?: string };

/** Every brand action: the capability check, the store call, one audit row, revalidate. */
async function brandWrite(entityId: string, summary: string, write: () => Promise<BrandWrite>): Promise<BrandResult> {
  const denied = await guard();
  if (denied) return denied;
  const res = await write();
  if (!res.ok) return res;
  await recordAudit({ area: 'library', action: 'update', entityType: 'mm_brand', entityId, summary });
  revalidate();
  return { ok: true, note: res.note };
}

export async function createBrand(ingredientId: string, name: string): Promise<BrandResult> {
  return brandWrite(ingredientId, `Added the Menu Monster brand "${String(name).trim()}"`, () => createBrandWith(createAdminClient(), ingredientId, name));
}

export async function renameBrand(id: string, name: string): Promise<BrandResult> {
  return brandWrite(id, `Renamed a Menu Monster brand to "${String(name).trim()}"`, () => renameBrandWith(createAdminClient(), id, name));
}

/** A brand's own diet flags; null = the ingredient's. */
export async function setBrandDiets(id: string, avoid: RestrictionKey[] | null): Promise<BrandResult> {
  return brandWrite(id, 'Set a Menu Monster brand’s diet flags', () => setBrandDietsWith(createAdminClient(), id, avoid));
}

export async function mergeBrand(from: string, to: string): Promise<BrandResult> {
  return brandWrite(from, 'Merged a Menu Monster brand into another', () => mergeBrandWith(createAdminClient(), from, to));
}

export async function moveBrand(id: string, toIngredientId: string): Promise<BrandResult> {
  return brandWrite(id, 'Moved a Menu Monster brand to another ingredient', () => moveBrandWith(createAdminClient(), id, toIngredientId));
}

export async function removeBrand(id: string): Promise<BrandResult> {
  return brandWrite(id, 'Removed a Menu Monster brand', () => removeBrandWith(createAdminClient(), id));
}

export async function setPackageBrand(packageId: string, brandId: string | null, sizeLabel: string): Promise<BrandResult> {
  return brandWrite(packageId, 'Set a Menu Monster package’s brand and size', () => setPackageBrandWith(createAdminClient(), packageId, brandId, sizeLabel));
}

export interface BoughtInput extends PackageInput {
  /** An existing brand of the ingredient; null = no brand. Ignored when `newBrand` is typed. */
  brandId: string | null;
  /** A brand typed in the form: created under the ingredient, then given this package. */
  newBrand: string | null;
  /** The size as the label says it, without the brand ("26 oz"). */
  sizeLabel: string | null;
}

/**
 * "Add what you bought" (Patrick, 2026-10-05: "How is adding a package different than adding a brand?"). A
 * leader does one thing — Morton, 26 oz, Metro Market, $1.99 — so it is one action: the brand is made if it
 * was typed, the package is saved, and the package is put under the brand. A typed brand that fails (a
 * duplicate) stops before anything is saved; if the brand cannot be attached afterwards the package still
 * stands and the error says so.
 */
export async function addBought(input: BoughtInput): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const { brandId: pickedBrand, newBrand, sizeLabel, ...pkg } = input;
  const supabase = createAdminClient();

  let brandId = pickedBrand;
  const typed = newBrand?.trim();
  if (typed) {
    const made = await createBrandWith(supabase, pkg.ingredientId, typed);
    if (!made.ok) return { ok: false, error: made.error };
    brandId = made.id ?? null;
    await recordAudit({ area: 'library', action: 'update', entityType: 'mm_brand', entityId: pkg.ingredientId, summary: `Added the Menu Monster brand "${typed}"` });
  }

  const res = await createPackage(pkg);
  if (!res.ok || !res.id) return res;
  if (brandId || sizeLabel?.trim()) {
    const set = await setPackageBrandWith(supabase, res.id, brandId, sizeLabel ?? '');
    if (!set.ok) return { ok: false, id: res.id, error: `Saved ${pkg.name}, but could not set its brand: ${set.error}` };
    revalidate();
  }
  return res;
}

/** A leader sets (brandId null: clears) the brand a recipe suggests for one of its ingredients. */
export async function suggestRecipeBrand(recipeId: string, ingredientId: string, brandId: string | null): Promise<BrandResult> {
  return brandWrite(recipeId, brandId ? 'Set a Menu Monster recipe’s suggested brand' : 'Cleared a Menu Monster recipe’s suggested brand', async () => {
    const res = await suggestRecipeBrandWith(createAdminClient(), null, recipeId, ingredientId, brandId);
    return res === 'ok' ? { ok: true } : { ok: false, error: res === 'bad_brand' ? 'That brand is not one of this ingredient’s live brands, or the recipe no longer uses the ingredient.' : 'That recipe is gone. Reload the page.' };
  });
}

/* ── The troop's gear list (release 2 of Plans/Menu-Monster-Brands-Gear.md) ─ */

export interface GearInput {
  name: string;
  home: string;
  perPerson: boolean;
}

export async function createGear(input: GearInput): Promise<Result> {
  const who = await guardActor();
  if ('ok' in who) return who;
  const res = await createGearWith(createAdminClient(), input, who.personId);
  if (!res.ok) return res;
  await recordAudit({ area: 'library', action: 'create', entityType: 'mm_gear', entityId: String(res.id), summary: `Added "${input.name.trim()}" to the Menu Monster gear list` });
  revalidate();
  return { ok: true };
}

/** Rename / move / re-flag. A rename rewrites the recipes that name it; onto an existing name it merges. */
export async function updateGear(id: number, input: GearInput): Promise<Result & { note?: string }> {
  const denied = await guard();
  if (denied) return denied;
  const res = await updateGearWith(createAdminClient(), id, input);
  if (!res.ok) return res;
  const name = input.name.trim();
  const touched = res.recipes ? ` (${res.recipes} recipe${res.recipes === 1 ? '' : 's'} updated)` : '';
  await recordAudit({
    area: 'library',
    action: 'update',
    entityType: 'mm_gear',
    entityId: String(id),
    summary: res.merged ? `Merged a Menu Monster gear item into "${name}"${touched}` : `Saved Menu Monster gear item "${name}"${touched}`
  });
  revalidate();
  return { ok: true, note: res.merged ? `Merged into “${name}”${touched}.` : `Saved “${name}”${touched}.` };
}

/** Merge gear item `id` into `intoId`: recipes and menus that named it now name the target; `id` goes away. */
export async function mergeGear(id: number, intoId: number): Promise<Result & { note?: string }> {
  const denied = await guard();
  if (denied) return denied;
  const sb = createAdminClient();
  const { data: rows } = await sb.from('mm_gear').select('id, name').in('id', [id, intoId]);
  const nameOf = (x: number) => (rows ?? []).find((r) => r.id === x)?.name ?? String(x);
  const from = nameOf(id);
  const res = await mergeGearWith(sb, id, intoId);
  if (!res.ok) return res;
  const touched = res.recipes ? ` (${res.recipes} recipe${res.recipes === 1 ? '' : 's'} updated)` : '';
  await recordAudit({
    area: 'library',
    action: 'update',
    entityType: 'mm_gear',
    entityId: String(intoId),
    summary: `Merged Menu Monster gear item "${from}" into "${nameOf(intoId)}"${touched}`
  });
  revalidate();
  return { ok: true, note: `Merged “${from}” into “${nameOf(intoId)}”${touched}.` };
}

export async function setGearRetired(id: number, retired: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const res = await retireGearWith(createAdminClient(), id, retired);
  if (!res.ok) return res;
  await recordAudit({ area: 'library', action: retired ? 'retire' : 'update', entityType: 'mm_gear', entityId: String(id), summary: `${retired ? 'Retired' : 'Restored'} a Menu Monster gear item` });
  revalidate();
  return { ok: true };
}

export async function deleteGear(id: number): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const res = await deleteGearWith(createAdminClient(), id);
  if (!res.ok) return res;
  await recordAudit({ area: 'library', action: 'delete', entityType: 'mm_gear', entityId: String(id), summary: 'Deleted a Menu Monster gear item' });
  revalidate();
  return { ok: true };
}

/* ── Scout-added packages waiting for a leader (release C) ──────────────── */

/** Approve: a held scout package joins the troop price book. */
export async function approveHeldPackage(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = createAdminClient();
  const { data: row } = await supabase.from('mm_packages').select('name').eq('id', id).maybeSingle();
  if (!(await approveHeldPackageWith(supabase, id))) return { ok: false, error: 'Someone already decided that one.' };
  const name = (row as { name: string } | null)?.name ?? id;
  await recordAudit({ area: 'library', action: 'package_approve', entityType: 'mm_package', entityId: id, summary: `Approved a scout's Menu Monster package "${name}"` });
  revalidate();
  return { ok: true };
}

/** Reject: deleted, or retired when a menu or a price change still names it. */
export async function rejectHeldPackage(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = createAdminClient();
  const { data: row } = await supabase.from('mm_packages').select('name').eq('id', id).maybeSingle();
  const outcome = await rejectHeldPackageWith(supabase, id);
  if (outcome === 'missing') return { ok: false, error: 'Someone already decided that one.' };
  const name = (row as { name: string } | null)?.name ?? id;
  await recordAudit({ area: 'library', action: 'package_reject', entityType: 'mm_package', entityId: id, summary: `Rejected a scout's Menu Monster package "${name}" (${outcome})` });
  revalidate();
  return { ok: true };
}
