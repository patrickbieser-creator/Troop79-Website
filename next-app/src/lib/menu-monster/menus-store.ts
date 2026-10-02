/**
 * Scout Workspace menu store (Plans/Menu-Monster-Scout-Workspace.md, Phase 1).
 *
 * Every function takes the Supabase client (the service role — mm_menus has
 * RLS on with zero policies, D-239) so Vitest can run it against local
 * Postgres; the server actions pass createAdminClient(). Every WRITE is
 * scoped by the actor's person id, which the action takes from the verified
 * scout session — never from the client — so a scout can only touch their
 * own menus. A miss on someone else's menu looks exactly like "not found".
 *
 * Callers pass an already-sanitized Menu (sanitizeMenu, menus.ts) and the live
 * catalog: every create and save builds the priced snapshot HERE, from the
 * merged shopping list, and stores it beside the menu — a snapshot is never
 * accepted from a client. Duplicate carries the source's snapshot over.
 * Audit: create / rename / duplicate / delete, one line each; edits to meal
 * contents are not audited (Phase 1 criteria — too chatty).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { publicScoutName } from '@/lib/scout-name';
import { recordAuditAs, type AuditActor } from '@/lib/audit';
import { MAX_MENUS_PER_SCOUT, coverDays, foldShopping, sanitizeActuals, sanitizeFreeItems, type Menu, type MenuContext, type MenuMeal } from './menus';
import { buildSnapshot, type MenuSnapshot } from './menu-snapshot';
import type { Catalog, RestrictionKey } from './types';

/** A row on My menus. */
export interface MenuSummary {
  id: string;
  name: string;
  context: MenuContext;
  calendarEntryId: number | null;
  headcount: number;
  mealCount: number;
  updatedAt: string;
  /** Set only by listAllMenusWith (the leader read-only view). */
  ownerPersonId?: number;
}

export interface StoredMenu {
  id: string;
  ownerPersonId: number;
  menu: Menu;
  createdAt: string;
  /** The priced list as of the last save; null for a row that never had one. */
  snapshot: MenuSnapshot | null;
  /** The version token a save hands back (compared, so a second tab can't silently overwrite). */
  updatedAt: string;
}

/** Returned instead of an id when the scout already keeps MAX_MENUS_PER_SCOUT menus. */
export const MENU_LIMIT = 'limit' as const;

export type SaveResult =
  | { status: 'saved'; updatedAt: string }
  | { status: 'conflict' }
  | { status: 'not_found' };

const COLUMNS = 'id, owner_person_id, name, context, calendar_entry_id, start_date, headcount, restrictions, budget_per_person_meal, day_count, shopping, actuals, free_items, meals, snapshot, created_at, updated_at';

interface MenuRow {
  id: string;
  owner_person_id: number;
  name: string;
  context: MenuContext;
  calendar_entry_id: number | null;
  start_date: string | null;
  headcount: number;
  restrictions: Record<RestrictionKey, number>;
  budget_per_person_meal: number | string;
  day_count: number;
  /** '{}' on rows from before slice 5; their choices sit inside meals[]. */
  shopping: unknown;
  actuals: unknown;
  free_items: unknown;
  meals: MenuMeal[];
  snapshot: MenuSnapshot | null;
  created_at: string;
  updated_at: string;
}

// actuals and free_items are deliberately NOT written here. Actuals (what the
// scout paid) feed the shared price book, so they get their own action with its
// own band check and never ride a menu save (Phase 2 design); free items join
// the write path with their editing UI in release C. Until then both only read
// back, and a duplicate starts without them.
const toRow = (m: Menu, snapshot: MenuSnapshot | null) => ({
  name: m.name,
  context: m.context,
  calendar_entry_id: m.calendarEntryId,
  start_date: m.startDate,
  headcount: m.headcount,
  restrictions: m.restrictions,
  budget_per_person_meal: m.budgetPerPersonMeal,
  day_count: m.dayCount,
  shopping: m.shopping,
  meals: m.meals,
  snapshot
});

const fromRow = (r: MenuRow): Menu => ({
  name: r.name,
  context: r.context,
  calendarEntryId: r.calendar_entry_id,
  startDate: r.start_date,
  headcount: r.headcount,
  restrictions: r.restrictions,
  // numeric comes back from PostgREST as a number or a string depending on precision.
  budgetPerPersonMeal: Number(r.budget_per_person_meal),
  // The column's default of 2 must never hide a meal saved on a later day.
  dayCount: coverDays(r.day_count, r.meals),
  // Menus saved before slice 5 kept package / quantity / bring-from-home on each meal.
  shopping: foldShopping(r.shopping, r.meals),
  // Same validation as a write: a hand-edited row can't smuggle a bad shape in.
  actuals: sanitizeActuals(r.actuals),
  freeItems: sanitizeFreeItems(r.free_items),
  // Meals saved before recipeEdits existed read as having none; the old
  // per-meal shopping fields are dropped (folded into the menu above).
  meals: r.meals.map((m) => {
    const { packageChoice: _p, qtyOverride: _q, lineSource: _l, ...rest } = m as MenuMeal & { packageChoice?: unknown; qtyOverride?: unknown; lineSource?: unknown };
    void _p; void _q; void _l;
    return { ...rest, recipeEdits: rest.recipeEdits ?? {} };
  })
});

async function audit(sb: SupabaseClient, actor: AuditActor, action: string, id: string, summary: string) {
  await recordAuditAs(sb, actor, { area: 'menus', action, entityType: 'menu', entityId: id, summary: `${actor.label} ${summary}` });
}

/** A scout's own menus, most recently edited first. */
export async function listMenusWith(sb: SupabaseClient, ownerPersonId: number): Promise<MenuSummary[]> {
  const { data, error } = await sb
    .from('mm_menus')
    .select('id, name, context, calendar_entry_id, headcount, meals, updated_at')
    .eq('owner_person_id', ownerPersonId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`list menus: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    context: r.context as MenuContext,
    calendarEntryId: (r.calendar_entry_id as number | null) ?? null,
    headcount: r.headcount as number,
    mealCount: Array.isArray(r.meals) ? r.meals.length : 0,
    updatedAt: r.updated_at as string
  }));
}

/** Every scout's menus, most recently edited first — the leader read-only view.
 *  Paginated: the table is not scoped to one owner, so it can pass PostgREST's 1000-row cap. */
export async function listAllMenusWith(sb: SupabaseClient): Promise<(MenuSummary & { ownerPersonId: number })[]> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    sb
      .from('mm_menus')
      .select('id, owner_person_id, name, context, calendar_entry_id, headcount, meals, updated_at')
      .order('updated_at', { ascending: false })
      .order('id')
      .range(from, to)
  );
  return rows.map((r) => ({
    id: r.id as string,
    ownerPersonId: r.owner_person_id as number,
    name: r.name as string,
    context: r.context as MenuContext,
    calendarEntryId: (r.calendar_entry_id as number | null) ?? null,
    headcount: r.headcount as number,
    mealCount: Array.isArray(r.meals) ? r.meals.length : 0,
    updatedAt: r.updated_at as string
  }));
}

/** Credit names for menu owners — first name + last initial from `people` (never the
 *  scouts/leaders tables), the public format used everywhere a scout's name shows. */
export async function ownerCreditNamesWith(sb: SupabaseClient, personIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(personIds)];
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const { data, error } = await sb.from('people').select('id, first_name, last_name').in('id', ids);
  if (error) throw new Error(`owner names: ${error.message}`);
  for (const p of data ?? []) out.set(p.id as number, publicScoutName({ first_name: (p.first_name as string) ?? '', last_name: (p.last_name as string) ?? '' }));
  return out;
}

/** One menu by id, or null. Reading is not owner-scoped: the caller decides
 *  who may see it (the owner; Phase 3 adds leaders, parents, shared). */
export async function loadMenuWith(sb: SupabaseClient, id: string): Promise<StoredMenu | null> {
  const { data, error } = await sb.from('mm_menus').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`load menu: ${error.message}`);
  if (!data) return null;
  const r = data as MenuRow;
  return { id: r.id, ownerPersonId: r.owner_person_id, menu: fromRow(r), snapshot: r.snapshot ?? null, createdAt: r.created_at, updatedAt: r.updated_at };
}

async function atMenuLimit(sb: SupabaseClient, ownerPersonId: number | null): Promise<boolean> {
  if (ownerPersonId == null) return false; // the insert itself refuses an ownerless row
  const { count, error } = await sb.from('mm_menus').select('id', { count: 'exact', head: true }).eq('owner_person_id', ownerPersonId);
  if (error) throw new Error(`count menus: ${error.message}`);
  return (count ?? 0) >= MAX_MENUS_PER_SCOUT;
}

/** The new menu's id, or MENU_LIMIT when the scout is at the cap. */
export async function createMenuWith(sb: SupabaseClient, actor: AuditActor, menu: Menu, catalog: Catalog): Promise<string> {
  if (await atMenuLimit(sb, actor.personId)) return MENU_LIMIT;
  const { data, error } = await sb
    .from('mm_menus')
    .insert({ ...toRow(menu, buildSnapshot(menu, catalog)), owner_person_id: actor.personId })
    .select('id')
    .single();
  if (error) throw new Error(`create menu: ${error.message}`);
  const id = data.id as string;
  await audit(sb, actor, 'create', id, `created menu "${menu.name}"`);
  return id;
}

/** Save over the version the scout loaded. A newer save in between is a
 *  conflict, not an overwrite; someone else's menu is not_found. */
export async function saveMenuWith(
  sb: SupabaseClient,
  actor: AuditActor,
  id: string,
  menu: Menu,
  expectedUpdatedAt: string,
  catalog: Catalog
): Promise<SaveResult> {
  const current = await loadMenuWith(sb, id);
  if (!current || current.ownerPersonId !== actor.personId) return { status: 'not_found' };
  const { data, error } = await sb
    .from('mm_menus')
    .update({ ...toRow(menu, buildSnapshot(menu, catalog)), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_person_id', actor.personId)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at');
  if (error) throw new Error(`save menu: ${error.message}`);
  if (!data?.length) return { status: 'conflict' };
  if (current.menu.name !== menu.name) await audit(sb, actor, 'rename', id, `renamed menu "${current.menu.name}" to "${menu.name}"`);
  return { status: 'saved', updatedAt: data[0].updated_at as string };
}

/** A copy of the scout's own menu, as a new menu. Null when it isn't theirs;
 *  MENU_LIMIT when the scout is at the cap. */
export async function duplicateMenuWith(sb: SupabaseClient, actor: AuditActor, id: string): Promise<string | null> {
  const src = await loadMenuWith(sb, id);
  if (!src || src.ownerPersonId !== actor.personId) return null;
  if (await atMenuLimit(sb, actor.personId)) return MENU_LIMIT;
  const { data, error } = await sb
    .from('mm_menus')
    .insert({ ...toRow({ ...src.menu, name: `Copy of ${src.menu.name}`.slice(0, 120) }, src.snapshot), owner_person_id: actor.personId })
    .select('id')
    .single();
  if (error) throw new Error(`duplicate menu: ${error.message}`);
  await audit(sb, actor, 'duplicate', data.id as string, `duplicated menu "${src.menu.name}"`);
  return data.id as string;
}

/** True when the scout's own menu was deleted. */
export async function deleteMenuWith(sb: SupabaseClient, actor: AuditActor, id: string): Promise<boolean> {
  const { data, error } = await sb
    .from('mm_menus')
    .delete()
    .eq('id', id)
    .eq('owner_person_id', actor.personId)
    .select('name');
  if (error) throw new Error(`delete menu: ${error.message}`);
  if (!data?.length) return false;
  await audit(sb, actor, 'delete', id, `deleted menu "${data[0].name as string}"`);
  return true;
}
