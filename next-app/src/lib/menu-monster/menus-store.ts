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
import { MAX_MENUS_PER_SCOUT, MAX_REVIEW_NOTE, coverDays, foldShopping, sanitizeActuals, sanitizeFreeItems, sanitizeMenu, type Actuals, type Menu, type MenuContext, type MenuMeal } from './menus';
import { SHELF_DAYS, daysBefore, isPublic } from './menu-access';
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
  ownerPersonId: number;
  /** When the owner shared it with the troop; null = not shared. */
  sharedAt: string | null;
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
  /** When the owner shared it with the troop (Phase 3); null = not shared. */
  sharedAt: string | null;
  /** null = no outing linked; false = linked to an entry that is not published (then only owner, leaders and parents see it). */
  entryPublished: boolean | null;
  /** A leader's one review note (Phase 3), or null. */
  review: MenuReview | null;
}

export interface MenuReview {
  note: string;
  at: string;
  /** Null once that leader's person row is gone (ON DELETE SET NULL). */
  byPersonId: number | null;
}

/** A row on the shelf's "Shared with the troop" list and an outing's "Menus for this outing". */
export interface SharedMenuRow {
  id: string;
  name: string;
  ownerPersonId: number;
  /** "Sam K." — the public credit, the same for every viewer (Decision 12). */
  credit: string;
  calendarEntryId: number | null;
  outingTitle: string | null;
  mealCount: number;
  sharedAt: string;
}

/** The leader list's filters (Phase 3: the existing list, filtered in SQL — no second admin surface). */
export interface MenuFilters {
  scout?: number;
  outing?: number;
  shared?: boolean;
}

export { MAX_REVIEW_NOTE };

/** Returned instead of an id when the scout already keeps MAX_MENUS_PER_SCOUT menus. */
export const MENU_LIMIT = 'limit' as const;

export type SaveResult =
  | { status: 'saved'; updatedAt: string }
  | { status: 'conflict' }
  | { status: 'not_found' };

const COLUMNS = 'id, owner_person_id, name, context, calendar_entry_id, start_date, headcount, restrictions, budget_per_person_meal, day_count, shopping, actuals, free_items, meals, snapshot, created_at, updated_at, shared_at, review_note, reviewed_by_person_id, reviewed_at, calendar_entries(status)';

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
  shared_at: string | null;
  review_note: string | null;
  reviewed_by_person_id: number | null;
  reviewed_at: string | null;
  /** The linked entry, embedded through the FK; null when none is linked. */
  calendar_entries: { status: string } | null;
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

const toStored = (r: MenuRow): StoredMenu => ({
  id: r.id,
  ownerPersonId: r.owner_person_id,
  menu: fromRow(r),
  snapshot: r.snapshot ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  sharedAt: r.shared_at,
  entryPublished: r.calendar_entry_id == null ? null : r.calendar_entries?.status === 'published',
  review: r.review_note != null && r.reviewed_at != null ? { note: r.review_note, at: r.reviewed_at, byPersonId: r.reviewed_by_person_id } : null
});

async function audit(sb: SupabaseClient, actor: AuditActor, action: string, id: string, summary: string) {
  await recordAuditAs(sb, actor, { area: 'menus', action, entityType: 'menu', entityId: id, summary: `${actor.label} ${summary}` });
}

const SUMMARY_COLS = 'id, owner_person_id, name, context, calendar_entry_id, headcount, meals, updated_at, shared_at';

const toSummary = (r: Record<string, unknown>): MenuSummary => ({
  id: r.id as string,
  ownerPersonId: r.owner_person_id as number,
  name: r.name as string,
  context: r.context as MenuContext,
  calendarEntryId: (r.calendar_entry_id as number | null) ?? null,
  headcount: r.headcount as number,
  mealCount: Array.isArray(r.meals) ? r.meals.length : 0,
  updatedAt: r.updated_at as string,
  sharedAt: (r.shared_at as string | null) ?? null
});

/** The menus of one scout (My menus) or of several (a parent's scouts), most recently edited first. */
export async function listMenusWith(sb: SupabaseClient, owners: number | readonly number[]): Promise<MenuSummary[]> {
  const ids = typeof owners === 'number' ? [owners] : [...owners];
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from('mm_menus')
    .select(SUMMARY_COLS)
    .in('owner_person_id', ids)
    .order('updated_at', { ascending: false })
    .order('id');
  if (error) throw new Error(`list menus: ${error.message}`);
  return (data ?? []).map(toSummary);
}

/** Every scout's menus, most recently edited first — the leader read-only view,
 *  filtered in SQL. Paginated: the table is not scoped to one owner, so it can
 *  pass PostgREST's 1000-row cap. */
export async function listAllMenusWith(sb: SupabaseClient, filters: MenuFilters = {}): Promise<MenuSummary[]> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let q = sb.from('mm_menus').select(SUMMARY_COLS);
    if (filters.scout != null) q = q.eq('owner_person_id', filters.scout);
    if (filters.outing != null) q = q.eq('calendar_entry_id', filters.outing);
    if (filters.shared) q = q.not('shared_at', 'is', null);
    return q.order('updated_at', { ascending: false }).order('id').range(from, to);
  });
  return rows.map(toSummary);
}

/**
 * Shared menus, newest share first, with the owner's public credit.
 *   - no `outingId`: the shelf — shared, and either linked to a PUBLISHED entry
 *     that ended within SHELF_DAYS, or linked to nothing and shared within
 *     SHELF_DAYS (menu-access.ts onShelf is the spec). Filtered in the query,
 *     so a `limit` returns full pages.
 *   - `outingId`: that outing's menus ("Menus for this outing", the shelf's
 *     outing filter) — every one shared for it, no time limit, and none at all
 *     when the entry is not published.
 */
export async function listSharedMenusWith(
  sb: SupabaseClient,
  today: string,
  opts: { outingId?: number; limit?: number } = {}
): Promise<SharedMenuRow[]> {
  const cutoff = daysBefore(today, SHELF_DAYS);
  let entryIds: number[];
  if (opts.outingId != null) {
    const { data, error } = await sb.from('calendar_entries').select('id').eq('id', opts.outingId).eq('status', 'published');
    if (error) throw new Error(`shared menus outing: ${error.message}`);
    entryIds = (data ?? []).map((r) => r.id as number);
    if (entryIds.length === 0) return [];
  } else {
    const { data, error } = await sb
      .from('calendar_entries')
      .select('id')
      .eq('status', 'published')
      .or(`end_date.gte.${cutoff},and(end_date.is.null,entry_date.gte.${cutoff})`);
    if (error) throw new Error(`shelf outings: ${error.message}`);
    entryIds = (data ?? []).map((r) => r.id as number);
  }

  let q = sb
    .from('mm_menus')
    .select('id, owner_person_id, name, calendar_entry_id, meals, shared_at, calendar_entries(title)')
    .not('shared_at', 'is', null);
  if (opts.outingId != null) q = q.eq('calendar_entry_id', opts.outingId);
  else {
    const linked = entryIds.length > 0 ? `calendar_entry_id.in.(${entryIds.join(',')}),` : '';
    q = q.or(`${linked}and(calendar_entry_id.is.null,shared_at.gte.${cutoff})`);
  }
  q = q.order('shared_at', { ascending: false }).order('id');
  const { data, error } = await (opts.limit != null ? q.limit(opts.limit) : q);
  if (error) throw new Error(`shared menus: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    id: string;
    owner_person_id: number;
    name: string;
    calendar_entry_id: number | null;
    meals: unknown;
    shared_at: string;
    calendar_entries: { title: string } | null;
  }[];
  const credits = await ownerCreditNamesWith(sb, rows.map((r) => r.owner_person_id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerPersonId: r.owner_person_id,
    credit: credits.get(r.owner_person_id) ?? '',
    calendarEntryId: r.calendar_entry_id,
    outingTitle: r.calendar_entries?.title ?? null,
    mealCount: Array.isArray(r.meals) ? r.meals.length : 0,
    sharedAt: r.shared_at
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
  return toStored(data as unknown as MenuRow);
}

/** Several menus by id in ONE query (list rows; qa-lead: not one query per menu). Missing ids are skipped; order follows `ids`. */
export async function loadMenusWith(sb: SupabaseClient, ids: readonly string[]): Promise<StoredMenu[]> {
  if (ids.length === 0) return [];
  const { data, error } = await sb.from('mm_menus').select(COLUMNS).in('id', [...ids]);
  if (error) throw new Error(`load menus: ${error.message}`);
  const byId = new Map(((data ?? []) as unknown as MenuRow[]).map((r) => [r.id, toStored(r)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
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

/**
 * What the scout paid, saved on its own (Phase 2 release B): writes ONLY the
 * `actuals` column — and `snapshot` when `resnapshot` says one of the scout's
 * own reported prices was just applied, so their "prices changed" line does not
 * fire over their own change. It never touches `updated_at`: an open Plan tab
 * holds the version token and must not see a false conflict. The snapshot is
 * rebuilt from the LAST SAVED menu against the (fresh) catalog passed in.
 * The caller passes already-sanitized actuals; someone else's menu is not_found.
 */
export async function saveActualsWith(
  sb: SupabaseClient,
  actor: AuditActor,
  id: string,
  actuals: Actuals,
  catalog: Catalog,
  opts: { resnapshot?: boolean } = {}
): Promise<{ status: 'saved' | 'not_found' }> {
  const current = await loadMenuWith(sb, id);
  if (!current || current.ownerPersonId !== actor.personId) return { status: 'not_found' };
  const patch: { actuals: Actuals; snapshot?: MenuSnapshot } = { actuals };
  if (opts.resnapshot) patch.snapshot = buildSnapshot(current.menu, catalog);
  const { data, error } = await sb.from('mm_menus').update(patch).eq('id', id).eq('owner_person_id', actor.personId).select('id');
  if (error) throw new Error(`save actuals: ${error.message}`);
  return { status: data?.length ? 'saved' : 'not_found' };
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

/**
 * Share with the troop (`on`) or Stop sharing — the owner only. Re-sharing
 * resets shared_at (the shelf's clock). Never touches updated_at: an open Plan
 * tab keeps its version token. False when the menu isn't the actor's.
 */
export async function setMenuSharedWith(sb: SupabaseClient, actor: AuditActor, id: string, on: boolean): Promise<boolean> {
  const { data, error } = await sb
    .from('mm_menus')
    .update({ shared_at: on ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('owner_person_id', actor.personId)
    .select('name');
  if (error) throw new Error(`share menu: ${error.message}`);
  if (!data?.length) return false;
  const name = data[0].name as string;
  await audit(sb, actor, on ? 'share' : 'unshare', id, on ? `shared menu "${name}" with the troop` : `stopped sharing menu "${name}"`);
  return true;
}

/**
 * A leader's take-down: clears shared_at on any shared menu (scout text goes
 * public with no review, so an adult can pull it). The caller has checked the
 * actor is an admin viewer. False when the menu is missing or not shared.
 */
export async function hideMenuWith(sb: SupabaseClient, actor: AuditActor, id: string): Promise<boolean> {
  const { data, error } = await sb
    .from('mm_menus')
    .update({ shared_at: null })
    .eq('id', id)
    .not('shared_at', 'is', null)
    .select('name, owner_person_id');
  if (error) throw new Error(`hide menu: ${error.message}`);
  if (!data?.length) return false;
  const ownerId = data[0].owner_person_id as number;
  const owner = (await ownerCreditNamesWith(sb, [ownerId])).get(ownerId) ?? 'a scout';
  await audit(sb, actor, 'hide', id, `hid menu "${data[0].name as string}" by ${owner} from the shelf`);
  return true;
}

/**
 * A leader's one review note, replacing the last; blank clears it. The caller
 * has checked the actor is an admin viewer. No updated_at bump. False when the
 * menu is missing.
 */
export async function setReviewNoteWith(sb: SupabaseClient, actor: AuditActor, id: string, raw: string | null): Promise<boolean> {
  const note = (raw ?? '').trim().slice(0, MAX_REVIEW_NOTE);
  const patch = note
    ? { review_note: note, reviewed_at: new Date().toISOString(), reviewed_by_person_id: actor.personId }
    : { review_note: null, reviewed_at: null, reviewed_by_person_id: null };
  const { data, error } = await sb.from('mm_menus').update(patch).eq('id', id).select('name');
  if (error) throw new Error(`review note: ${error.message}`);
  if (!data?.length) return false;
  const name = data[0].name as string;
  await audit(sb, actor, 'review_note', id, note ? `left a review note on menu "${name}"` : `cleared the review note on menu "${name}"`);
  return true;
}

const recipeCount = (m: Menu) => m.meals.reduce((n, meal) => n + meal.recipeIds.length, 0);

/**
 * Copy another scout's SHARED menu (or one of the actor's own) into the
 * actor's menus. The copy is re-sanitized against the COPIER's catalog — a
 * recipe they can't see drops out and is counted — and starts unshared, with
 * no actuals, typed-in items or review note. `checkOuting` re-applies the
 * action's outing rule. Null when the source isn't copyable; MENU_LIMIT at the cap.
 */
export async function copyMenuWith(
  sb: SupabaseClient,
  actor: AuditActor,
  sourceId: string,
  catalog: Catalog,
  checkOuting: (menu: Menu) => Menu | Promise<Menu> = (m) => m
): Promise<{ id: string; droppedRecipes: number } | typeof MENU_LIMIT | null> {
  const src = await loadMenuWith(sb, sourceId);
  if (!src) return null;
  const own = src.ownerPersonId === actor.personId;
  if (!own && !isPublic(src)) return null;
  if (await atMenuLimit(sb, actor.personId)) return MENU_LIMIT;

  const clean = sanitizeMenu({ ...src.menu, actuals: {}, freeItems: [] }, catalog);
  const copy = await checkOuting({ ...clean, name: `Copy of ${src.menu.name}`.slice(0, 120) });
  const { data, error } = await sb
    .from('mm_menus')
    .insert({ ...toRow(copy, buildSnapshot(copy, catalog)), owner_person_id: actor.personId })
    .select('id')
    .single();
  if (error) throw new Error(`copy menu: ${error.message}`);
  const id = data.id as string;
  const from = own ? 'themselves' : ((await ownerCreditNamesWith(sb, [src.ownerPersonId])).get(src.ownerPersonId) ?? 'a scout');
  await audit(sb, actor, 'copy', id, `copied menu "${src.menu.name}" from ${from}`);
  return { id, droppedRecipes: recipeCount(src.menu) - recipeCount(clean) };
}
