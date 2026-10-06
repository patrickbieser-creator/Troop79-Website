/**
 * Scout recipes — data (Plans/Menu-Monster-Scout-Workspace.md, Phase 4A).
 * `*With(supabase)` against the service role (D-239: mm_* has RLS on and zero
 * policies). Writes go through the security-definer RPCs from
 * 20261003150000_mm_scout_recipes.sql, which re-check ownership, the version
 * token, the cap and the text; this module maps their refusals to outcomes and
 * writes the audit rows (area 'library', as the scout via recordAuditAs).
 *
 * The actor is ALWAYS the verified scout resolved on the server (the action);
 * nothing here takes a person id from the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { typedInPayload, type NewIngredient } from './scout-ingredients';
import { recordAuditAs, type AuditActor } from '@/lib/audit';
import type { FoodGroup, MealSlot, RecipeStatus, RestrictionKey, Section } from './types';
import { creditFor, isScoutRecipeId, newScoutRecipeId, stepsFromText, stepsToText, type ScoutRecipeDraft, type ScoutRecipeLine } from './scout-recipes';

export type ScoutSaveResult =
  | { status: 'saved'; id: string; updatedAt: string; /** new:<key> → the x-<hex> id each typed-in became. */ ids: Record<string, string> }
  | { status: 'conflict' | 'not_found' | 'retired' | 'cap' | 'invalid' | 'not_ready' | 'ingredient_cap' | 'duplicate_ingredient' };
export type ScoutShareResult = { status: 'shared'; credit: string } | { status: 'not_found' | 'retired' | 'not_ready' };
export type ScoutDeleteResult = { status: 'deleted' } | { status: 'not_found' | 'shared' | 'in_use' };

export interface ScoutRecipeSummary {
  id: string;
  name: string;
  status: RecipeStatus;
  mealFit: MealSlot[];
  sharedAt: string | null;
  credit: string | null;
  updatedAt: string;
}

export interface StoredScoutRecipe {
  recipe: ScoutRecipeDraft & { id: string };
  status: RecipeStatus;
  credit: string | null;
  sharedAt: string | null;
  updatedAt: string;
}

const refusal = (message: string): ScoutSaveResult['status'] => {
  // A save racing a leader's match can deadlock (40P01): the scout just tries again.
  if (message.includes('MM_STALE') || message.includes('deadlock')) return 'conflict';
  if (message.includes('MM_NOT_YOURS')) return 'not_found';
  if (message.includes('MM_RETIRED')) return 'retired';
  if (message.includes('MM_RECIPE_CAP')) return 'cap';
  if (message.includes('MM_NOT_READY')) return 'not_ready';
  if (message.includes('MM_INGREDIENT_CAP')) return 'ingredient_cap';
  if (message.includes('MM_DUPLICATE_INGREDIENT')) return 'duplicate_ingredient';
  if (message.includes('MM_BAD_')) return 'invalid';
  throw new Error(`scout recipe: ${message}`);
};

async function audit(sb: SupabaseClient, actor: AuditActor, action: string, id: string, summary: string) {
  await recordAuditAs(sb, actor, { area: 'library', action, entityType: 'scout_recipe', entityId: id, summary });
}

/** Create (draft.id null) or update the scout's recipe. `expectedUpdatedAt` is the version the editor loaded (null for a new one). */
export async function saveScoutRecipeWith(
  sb: SupabaseClient,
  actor: AuditActor,
  draft: ScoutRecipeDraft,
  expectedUpdatedAt: string | null
): Promise<ScoutSaveResult> {
  if (actor.personId == null) return { status: 'not_found' };
  const isNew = draft.id == null;
  const id = draft.id ?? newScoutRecipeId();
  const { data, error } = await sb.rpc('mm_save_scout_recipe', {
    p_person: actor.personId,
    p_recipe: {
      id,
      name: draft.name,
      meal_fit: draft.mealFit,
      food_groups: draft.foodGroups,
      steps_md: stepsToText(draft.steps),
      origin_recipe_id: draft.originRecipeId,
      equipment: draft.equipment
    },
    p_lines: draft.lines.map((l) => ({ ingredient_id: l.ingredientId, qty_per_person: l.qtyPerPerson, unit_key: l.unitKey })),
    p_expected_updated_at: isNew ? null : expectedUpdatedAt,
    p_new_ingredients: draft.newIngredients.map(typedInPayload)
  });
  if (error) return { status: refusal(error.message) } as ScoutSaveResult;
  await audit(sb, actor, isNew ? 'create' : 'update', id, `${isNew ? 'wrote' : 'edited'} recipe "${draft.name}"`);
  // 4B returns { updated_at, ids }; 4A returned the timestamp alone (kept for the deploy window).
  const out = typeof data === 'string' ? { updated_at: data, ids: {} } : (data as { updated_at: string; ids: Record<string, string> });
  return { status: 'saved', id, updatedAt: out.updated_at, ids: out.ids ?? {} };
}

/** Share the scout's own recipe with the troop, freezing the "Sam K." credit from `people`. */
export async function shareScoutRecipeWith(sb: SupabaseClient, actor: AuditActor, id: string): Promise<ScoutShareResult> {
  if (actor.personId == null || !isScoutRecipeId(id)) return { status: 'not_found' };
  const { data: person, error: pErr } = await sb.from('people').select('first_name, last_name').eq('id', actor.personId).maybeSingle();
  if (pErr) throw new Error(`credit: ${pErr.message}`);
  if (!person) return { status: 'not_found' };
  const credit = creditFor(person as { first_name: string | null; last_name: string | null });
  const { error } = await sb.rpc('mm_share_scout_recipe', { p_person: actor.personId, p_id: id, p_label: credit });
  if (error) {
    if (error.message.includes('MM_NOT_READY')) return { status: 'not_ready' };
    if (error.message.includes('MM_RETIRED')) return { status: 'retired' };
    if (error.message.includes('MM_NOT_YOURS')) return { status: 'not_found' };
    throw new Error(`share recipe: ${error.message}`);
  }
  await audit(sb, actor, 'publish', id, `shared recipe ${id} with the troop as "${credit}"`);
  return { status: 'shared', credit };
}

/** Delete one of the scout's own never-shared drafts — refused while one of their menus uses it. */
export async function deleteScoutDraftWith(sb: SupabaseClient, actor: AuditActor, id: string): Promise<ScoutDeleteResult> {
  if (actor.personId == null || !isScoutRecipeId(id)) return { status: 'not_found' };
  // One transaction under the scout's save lock: ownership, never shared, no menu uses it (mm_delete_scout_draft).
  const { data: name, error } = await sb.rpc('mm_delete_scout_draft', { p_person: actor.personId, p_id: id });
  if (error) {
    if (error.message.includes('MM_IN_USE')) return { status: 'in_use' };
    if (error.message.includes('MM_SHARED')) return { status: 'shared' };
    if (error.message.includes('MM_NOT_YOURS')) return { status: 'not_found' };
    throw new Error(`delete recipe: ${error.message}`);
  }
  await audit(sb, actor, 'delete', id, `deleted draft recipe "${name as string}"`);
  return { status: 'deleted' };
}

/** The scout's own recipes, newest edit first. */
export async function listMyRecipesWith(sb: SupabaseClient, personId: number): Promise<ScoutRecipeSummary[]> {
  const { data, error } = await sb
    .from('mm_recipes')
    .select('id, name, status, meal_fit, shared_at, attribution_label, updated_at')
    .eq('author_person_id', personId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`my recipes: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    status: r.status as RecipeStatus,
    mealFit: (r.meal_fit ?? []) as MealSlot[],
    sharedAt: (r.shared_at as string | null) ?? null,
    credit: (r.attribution_label as string | null) ?? null,
    updatedAt: r.updated_at as string
  }));
}

/** One of the scout's own recipes, as the editor edits it, or null (missing or not theirs). */
export async function loadMyRecipeWith(sb: SupabaseClient, personId: number, id: string): Promise<StoredScoutRecipe | null> {
  if (!isScoutRecipeId(id)) return null;
  const { data: r, error } = await sb
    .from('mm_recipes')
    .select('id, name, status, meal_fit, food_groups, steps_md, origin_recipe_id, author_person_id, shared_at, attribution_label, equipment, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`load recipe: ${error.message}`);
  if (!r || r.author_person_id !== personId) return null;
  const { data: lines, error: lErr } = await sb
    .from('mm_recipe_lines')
    .select('ingredient_id, qty_per_person, unit_key')
    .eq('recipe_id', id)
    .order('position');
  if (lErr) throw new Error(`load lines: ${lErr.message}`);
  return {
    recipe: {
      id,
      name: r.name as string,
      mealFit: (r.meal_fit ?? []) as MealSlot[],
      foodGroups: (r.food_groups ?? []) as FoodGroup[],
      steps: stepsFromText(r.steps_md as string | null),
      lines: (lines ?? []).map((l): ScoutRecipeLine => ({ ingredientId: l.ingredient_id as string, qtyPerPerson: Number(l.qty_per_person), unitKey: (l.unit_key as string | null) ?? null })),
      originRecipeId: (r.origin_recipe_id as string | null) ?? null,
      newIngredients: [],
      equipment: (r.equipment ?? []) as string[]
    },
    status: r.status as RecipeStatus,
    credit: (r.attribution_label as string | null) ?? null,
    sharedAt: (r.shared_at as string | null) ?? null,
    updatedAt: r.updated_at as string
  };
}

/* ---- Leader side (admin › Menu Monster › Scout recipes) ------------------- */

export interface SharedScoutRecipe {
  id: string;
  name: string;
  status: RecipeStatus;
  credit: string | null;
  sharedAt: string;
  updatedAt: string;
  /** The author changed it after sharing (updated_at more than a second past shared_at) — live, with no review. */
  editedSinceShared: boolean;
}

/** Every recipe a scout has shared (never an unshared draft), newest share first. */
export async function listSharedScoutRecipesWith(sb: SupabaseClient, limit = 200): Promise<SharedScoutRecipe[]> {
  const { data, error } = await sb
    .from('mm_recipes')
    .select('id, name, status, attribution_label, shared_at, updated_at')
    .not('author_person_id', 'is', null)
    .not('shared_at', 'is', null)
    .order('shared_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`shared scout recipes: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    status: r.status as RecipeStatus,
    credit: (r.attribution_label as string | null) ?? null,
    sharedAt: r.shared_at as string,
    updatedAt: r.updated_at as string,
    editedSinceShared: Date.parse(r.updated_at as string) - Date.parse(r.shared_at as string) > 1000
  }));
}

/** One row of the admin Scout recipes list (Patrick, 2026-10-05: every scout recipe, shared or not, with who owns it and when). */
export interface ScoutRecipeRow {
  id: string;
  name: string;
  status: RecipeStatus;
  ownerPersonId: number;
  /** "Sam K." — the owner's public name; "Someone" once the person row is gone. */
  owner: string;
  credit: string | null;
  createdAt: string;
  updatedAt: string;
  /** null = a private draft the scout has not shared. */
  sharedAt: string | null;
  /** The author changed it after sharing (updated_at more than a second past shared_at) — live, with no review. */
  editedSinceShared: boolean;
}

/** Every recipe a scout wrote — shared ones AND unshared drafts — newest change first. */
export async function listScoutRecipesWith(sb: SupabaseClient, ownerName: (ids: number[]) => Promise<Map<number, string>>, limit = 500): Promise<ScoutRecipeRow[]> {
  const { data, error } = await sb
    .from('mm_recipes')
    .select('id, name, status, author_person_id, attribution_label, created_at, shared_at, updated_at')
    .not('author_person_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`scout recipes: ${error.message}`);
  const rows = data ?? [];
  const names = await ownerName(rows.map((r) => r.author_person_id as number));
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    status: r.status as RecipeStatus,
    ownerPersonId: r.author_person_id as number,
    owner: names.get(r.author_person_id as number) ?? 'Someone',
    credit: (r.attribution_label as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    sharedAt: (r.shared_at as string | null) ?? null,
    editedSinceShared: r.shared_at != null && Date.parse(r.updated_at as string) - Date.parse(r.shared_at as string) > 1000
  }));
}

/** A leader renames a scout recipe. Returns the old name, or null when it isn't a scout recipe. */
export async function renameScoutRecipeWith(sb: SupabaseClient, id: string, name: string): Promise<{ before: string } | null> {
  if (!isScoutRecipeId(id)) return null;
  const { data: row, error } = await sb.from('mm_recipes').select('name').eq('id', id).maybeSingle();
  if (error) throw new Error(`load recipe: ${error.message}`);
  if (!row) return null;
  const { error: uErr } = await sb.from('mm_recipes').update({ name, updated_at: new Date().toISOString() }).eq('id', id);
  if (uErr) throw new Error(`rename: ${uErr.message}`);
  return { before: row.name as string };
}

/** A leader's credit change on a shared scout recipe. Returns the old credit, or null when the recipe isn't a shared scout recipe. */
export async function setScoutRecipeCreditWith(sb: SupabaseClient, id: string, credit: string): Promise<{ before: string | null; name: string } | null> {
  if (!isScoutRecipeId(id)) return null;
  const { data: row, error } = await sb.from('mm_recipes').select('name, attribution_label, shared_at').eq('id', id).maybeSingle();
  if (error) throw new Error(`load recipe: ${error.message}`);
  if (!row || row.shared_at == null) return null;
  const { error: uErr } = await sb.from('mm_recipes').update({ attribution_label: credit }).eq('id', id);
  if (uErr) throw new Error(`credit: ${uErr.message}`);
  return { before: (row.attribution_label as string | null) ?? null, name: row.name as string };
}

/* ---- Typed-in ingredients, leader side (Phase 4B) ------------------------- */

export interface TypedInIngredient {
  id: string;
  name: string;
  unit: { key: string; one: string; many: string; kind: 'count' | 'volume' | 'weight' };
  avoid: RestrictionKey[];
  /** The scout's one package: price, size in the recipe unit, store. */
  pkg: { price: number; size: number | null; store: string | null } | null;
  /** "Sam K." — who typed it in. */
  addedBy: string;
  /** Names of the recipes that use it. */
  usedIn: string[];
  /** Its author asked for it to be added (public Ingredients tab) and nothing shared uses it: a leader may Reject it. */
  requested: boolean;
}

/** Typed-ins waiting for a leader, oldest first: revealed by a shared recipe or menu, or sent in from the public
 *  Ingredients tab (submitted_at). A private one nobody asked about never shows here. */
export async function listTypedInsWith(sb: SupabaseClient): Promise<TypedInIngredient[]> {
  const { data, error } = await sb
    .from('mm_ingredients')
    .select('id, name, unit_key, unit_one, unit_many, unit_kind, avoid, added_by_person_id, shared_at, submitted_at')
    .not('needs_match_at', 'is', null)
    .or('shared_at.not.is.null,submitted_at.not.is.null')
    .is('retired_at', null)
    .order('needs_match_at');
  if (error) throw new Error(`typed-in ingredients: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  const people = [...new Set(rows.map((r) => r.added_by_person_id as number))];
  const [pkgs, lines, names] = await Promise.all([
    sb.from('mm_packages').select('ingredient_id, price, yield, store').in('ingredient_id', ids).is('retired_at', null),
    sb.from('mm_recipe_lines').select('ingredient_id, recipe_id, mm_recipes(name, shared_at)').in('ingredient_id', ids),
    sb.from('people').select('id, first_name, last_name').in('id', people)
  ]);
  for (const r of [pkgs, lines, names]) if (r.error) throw new Error(`typed-in details: ${r.error.message}`);
  const credit = new Map((names.data ?? []).map((p) => [p.id as number, creditFor(p as { first_name: string | null; last_name: string | null })]));
  return rows.map((r) => {
    const p = (pkgs.data ?? []).find((x) => x.ingredient_id === r.id);
    return {
      id: r.id as string,
      name: r.name as string,
      unit: { key: r.unit_key as string, one: r.unit_one as string, many: r.unit_many as string, kind: r.unit_kind as TypedInIngredient['unit']['kind'] },
      avoid: (r.avoid ?? []) as RestrictionKey[],
      pkg: p ? { price: Number(p.price), size: p.yield == null ? null : Number(p.yield), store: (p.store as string | null) ?? null } : null,
      addedBy: credit.get(r.added_by_person_id as number) ?? 'A scout',
      requested: r.submitted_at != null && r.shared_at == null,
      usedIn: (lines.data ?? [])
        // Shared recipes only: a request may also sit in its author's private draft, whose name is not a leader's to read.
        .filter((l) => l.ingredient_id === r.id && (l.mm_recipes as unknown as { shared_at: string | null } | null)?.shared_at != null)
        .map((l) => (l.mm_recipes as unknown as { name: string } | null)?.name ?? (l.recipe_id as string))
    };
  });
}

/** A leader's match: every recipe line on the typed-in moves to `to` (1 typed-in unit = factor target units). */
export async function matchTypedInWith(sb: SupabaseClient, from: string, to: string, factor: number): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  const { data, error } = await sb.rpc('mm_match_ingredient', { p_from: from, p_to: to, p_factor: factor });
  if (error) {
    if (error.message.includes('MM_BAD_MATCH')) return { ok: false, error: error.message.replace(/^.*MM_BAD_MATCH: ?/, 'Can’t match: ') };
    throw new Error(`match ingredient: ${error.message}`);
  }
  return { ok: true, moved: Number(data) };
}

/** A leader keeps a typed-in as a new book ingredient: its store section and confirmed diets; it stops waiting. */
export async function keepTypedInWith(sb: SupabaseClient, id: string, section: Section, avoid: RestrictionKey[]): Promise<string | null> {
  // A request from the Ingredients tab was never revealed: keeping it is what puts it in everyone's catalog.
  const { data: row } = await sb.from('mm_ingredients').select('shared_at').eq('id', id).maybeSingle();
  const { data, error } = await sb
    .from('mm_ingredients')
    .update({ section, avoid, needs_match_at: null, shared_at: (row?.shared_at as string | null | undefined) ?? new Date().toISOString() })
    .eq('id', id)
    .not('needs_match_at', 'is', null)
    .or('shared_at.not.is.null,submitted_at.not.is.null')
    .is('retired_at', null)
    .select('name');
  if (error) throw new Error(`keep ingredient: ${error.message}`);
  return (data?.[0]?.name as string | undefined) ?? null;
}

export type SubmitIngredientResult = { status: 'added'; id: string } | { status: 'ingredient_cap' | 'duplicate_ingredient' | 'invalid' };

/**
 * A request to add an ingredient to the price book, from the public Ingredients
 * tab: a typed-in (same validator and 10-cap as a recipe's) marked submitted_at,
 * private to `personId` until a leader keeps, matches or rejects it. The caller
 * passes an already-sanitized NewIngredient.
 */
export async function submitIngredientWith(sb: SupabaseClient, personId: number, n: NewIngredient): Promise<SubmitIngredientResult> {
  const { data, error } = await sb.rpc('mm_submit_ingredient', { p_person: personId, p_new: typedInPayload(n) });
  if (error) {
    if (error.message.includes('MM_INGREDIENT_CAP')) return { status: 'ingredient_cap' };
    if (error.message.includes('MM_DUPLICATE_INGREDIENT')) return { status: 'duplicate_ingredient' };
    if (error.message.includes('MM_BAD_')) return { status: 'invalid' };
    throw new Error(`submit ingredient: ${error.message}`);
  }
  return { status: 'added', id: data as string };
}

/**
 * A leader's Reject of a request nothing shared uses (mm_reject_ingredient): it
 * stops waiting and, when nothing of its author's uses it, is removed at once —
 * so a rejected request never holds their 10-waiting cap or its name. One their
 * own recipe or menu uses stays a private typed-in. Returns its name, or null
 * when it is no longer a pending request.
 */
export async function rejectTypedInWith(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await sb.rpc('mm_reject_ingredient', { p_id: id });
  if (error) throw new Error(`reject ingredient: ${error.message}`);
  return (data as string | null) ?? null;
}

/** A scout's single food — one line, a typed-in ingredient a leader has not kept yet — as the leaders' Food & recipes search offers it. */
export interface ScoutFood {
  id: string;
  name: string;
  status: RecipeStatus;
  /** "Sam K." */
  owner: string;
  createdAt: string;
  mealFit: MealSlot[];
  /** Per person, in the ingredient's own unit. */
  amount: number;
  ingredientId: string;
  ingredientName: string;
  section: Section;
  avoid: RestrictionKey[];
  unit: TypedInIngredient['unit'];
  /** The scout's one package, when they typed a price and size. */
  pkg: TypedInIngredient['pkg'];
}

/**
 * Every scout recipe that is one typed-in ingredient still waiting on a leader — private drafts included, so the
 * leaders' search can find what a scout just added at the meal planner. `onlyId` narrows it to one recipe.
 */
export async function listScoutFoodsWith(sb: SupabaseClient, ownerName: (ids: number[]) => Promise<Map<number, string>>, onlyId?: string): Promise<ScoutFood[]> {
  let q = sb
    .from('mm_recipes')
    .select('id, name, status, author_person_id, created_at, meal_fit, mm_recipe_lines(ingredient_id, qty_per_person)')
    .not('author_person_id', 'is', null)
    .neq('status', 'retired')
    .order('created_at', { ascending: false })
    .limit(500);
  if (onlyId) q = q.eq('id', onlyId);
  const { data, error } = await q;
  if (error) throw new Error(`scout foods: ${error.message}`);
  type Line = { ingredient_id: string; qty_per_person: number | string };
  const single = (data ?? []).filter((r) => ((r.mm_recipe_lines as unknown as Line[]) ?? []).length === 1);
  const ingIds = [...new Set(single.map((r) => (r.mm_recipe_lines as unknown as Line[])[0].ingredient_id))].filter((i) => i.startsWith('x-'));
  if (ingIds.length === 0) return [];
  const { data: ings, error: iErr } = await sb
    .from('mm_ingredients')
    .select('id, name, section, avoid, unit_key, unit_one, unit_many, unit_kind')
    .in('id', ingIds)
    .not('needs_match_at', 'is', null)
    .is('retired_at', null);
  if (iErr) throw new Error(`scout foods: ${iErr.message}`);
  const waiting = new Map((ings ?? []).map((i) => [i.id as string, i]));
  const { data: pk, error: pErr } = await sb.from('mm_packages').select('ingredient_id, price, yield, store').in('ingredient_id', [...waiting.keys()]).is('retired_at', null);
  if (pErr) throw new Error(`scout foods: ${pErr.message}`);
  const mine = single.filter((r) => waiting.has((r.mm_recipe_lines as unknown as Line[])[0].ingredient_id));
  const names = await ownerName(mine.map((r) => r.author_person_id as number));
  return mine.map((r) => {
    const l = (r.mm_recipe_lines as unknown as Line[])[0];
    const ing = waiting.get(l.ingredient_id)!;
    return {
      id: r.id as string,
      name: r.name as string,
      status: r.status as RecipeStatus,
      owner: names.get(r.author_person_id as number) ?? 'Someone',
      createdAt: r.created_at as string,
      mealFit: (r.meal_fit ?? []) as MealSlot[],
      amount: Number(l.qty_per_person),
      ingredientId: l.ingredient_id,
      ingredientName: ing.name as string,
      section: ing.section as Section,
      avoid: (ing.avoid ?? []) as RestrictionKey[],
      unit: { key: ing.unit_key as string, one: ing.unit_one as string, many: ing.unit_many as string, kind: ing.unit_kind as TypedInIngredient['unit']['kind'] },
      pkg: (() => {
        const p = (pk ?? []).find((x) => x.ingredient_id === l.ingredient_id);
        return p ? { price: Number(p.price), size: p.yield == null ? null : Number(p.yield), store: (p.store as string | null) ?? null } : null;
      })()
    };
  });
}
