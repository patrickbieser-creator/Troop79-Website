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
import { MAX_MENUS_PER_SCOUT, MAX_REVIEW_NOTE, coverDays, foldShopping, sanitizeActuals, sanitizeMenu, type Actuals, type Menu, type MenuContext, type MenuMeal } from './menus';
import { SHELF_DAYS, daysBefore, isPublic } from './menu-access';
import { typedInIdsIn, typedInPayload, type NewIngredient } from './scout-ingredients';
import { loadPatrolNamesWith } from './menus-data';
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
  /** The patrol it is credited to, when said. */
  patrol: string | null;
  createdAt: string;
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
  /** Set while the latest save of the plan was a leader's, not the owner's (2026-10-05); the owner's next save clears it. */
  leaderEdit: { at: string; byPersonId: number | null } | null;
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
  /** The patrol the menu is for, when said. */
  patrol: string | null;
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

const COLUMNS = 'id, owner_person_id, name, context, calendar_entry_id, start_date, headcount, restrictions, budget_per_person_meal, day_count, patrol, shopping, actuals, meals, snapshot, created_at, updated_at, shared_at, review_note, reviewed_by_person_id, reviewed_at, leader_edited_at, leader_edited_by_person_id, calendar_entries(status)';

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
  patrol?: string | null;
  /** '{}' on rows from before slice 5; their choices sit inside meals[]. */
  shopping: unknown;
  actuals: unknown;
  meals: MenuMeal[];
  snapshot: MenuSnapshot | null;
  created_at: string;
  updated_at: string;
  shared_at: string | null;
  review_note: string | null;
  reviewed_by_person_id: number | null;
  reviewed_at: string | null;
  leader_edited_at?: string | null;
  leader_edited_by_person_id?: number | null;
  /** The linked entry, embedded through the FK; null when none is linked. */
  calendar_entries: { status: string } | null;
}

// actuals are deliberately NOT written here. What the scout paid feeds the
// shared price book, so it gets its own action with its own band check and
// never rides a menu save (Phase 2 design); a duplicate starts without it.
// Typed-in ingredients are real mm_ingredients rows (release C reuses 4B), so
// a menu only names them in its meals' recipeEdits.
const toRow = (m: Menu, snapshot: MenuSnapshot | null) => ({
  name: m.name,
  context: m.context,
  calendar_entry_id: m.calendarEntryId,
  start_date: m.startDate,
  headcount: m.headcount,
  restrictions: m.restrictions,
  budget_per_person_meal: m.budgetPerPersonMeal,
  day_count: m.dayCount,
  patrol: m.patrol ?? null,
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
  ...(r.patrol ? { patrol: r.patrol } : {}),
  // Menus saved before slice 5 kept package / quantity / bring-from-home on each meal.
  shopping: foldShopping(r.shopping, r.meals),
  // Same validation as a write: a hand-edited row can't smuggle a bad shape in.
  actuals: sanitizeActuals(r.actuals),
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
  review: r.review_note != null && r.reviewed_at != null ? { note: r.review_note, at: r.reviewed_at, byPersonId: r.reviewed_by_person_id } : null,
  leaderEdit: r.leader_edited_at ? { at: r.leader_edited_at, byPersonId: r.leader_edited_by_person_id ?? null } : null
});

async function audit(sb: SupabaseClient, actor: AuditActor, action: string, id: string, summary: string) {
  await recordAuditAs(sb, actor, { area: 'menus', action, entityType: 'menu', entityId: id, summary: `${actor.label} ${summary}` });
}

const SUMMARY_COLS = 'id, owner_person_id, name, context, calendar_entry_id, headcount, meals, patrol, created_at, updated_at, shared_at';

const toSummary = (r: Record<string, unknown>): MenuSummary => ({
  id: r.id as string,
  ownerPersonId: r.owner_person_id as number,
  name: r.name as string,
  context: r.context as MenuContext,
  calendarEntryId: (r.calendar_entry_id as number | null) ?? null,
  headcount: r.headcount as number,
  mealCount: Array.isArray(r.meals) ? r.meals.length : 0,
  patrol: (r.patrol as string | null) ?? null,
  createdAt: r.created_at as string,
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
  opts: { outingId?: number; limit?: number; /** An outing's crew sees its unshared menus too (menu-access.ts 'crew'). */ includeUnshared?: boolean } = {}
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
    .select('id, owner_person_id, name, calendar_entry_id, meals, shared_at, patrol, calendar_entries(title)');
  if (!(opts.includeUnshared && opts.outingId != null)) q = q.not('shared_at', 'is', null);
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
    shared_at: string | null;
    patrol: string | null;
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
    sharedAt: r.shared_at ?? '',
    patrol: r.patrol ?? null
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

/**
 * Save over the version that was loaded. A newer save in between is a conflict, not an overwrite; someone
 * else's menu is not_found.
 *
 * `asLeader` (the caller has already established the actor is a leader — menu-actions.ts): the actor is not
 * the owner and saves anyway (Patrick, 2026-10-05: leaders fix scout menus before the shopping trip). The
 * owner never changes; the row is marked as leader-edited so the owner is told, every such save is audited,
 * and the owner's typed-in ingredients are left alone. The owner's own save clears the mark.
 */
export async function saveMenuWith(
  sb: SupabaseClient,
  actor: AuditActor,
  id: string,
  menu: Menu,
  expectedUpdatedAt: string,
  catalog: Catalog,
  opts: { asLeader?: boolean } = {}
): Promise<SaveResult> {
  const current = await loadMenuWith(sb, id);
  if (!current) return { status: 'not_found' };
  const own = current.ownerPersonId === actor.personId;
  if (!own && !opts.asLeader) return { status: 'not_found' };
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('mm_menus')
    .update({
      ...toRow(menu, buildSnapshot(menu, catalog)),
      updated_at: now,
      leader_edited_at: own ? null : now,
      leader_edited_by_person_id: own ? null : actor.personId
    })
    .eq('id', id)
    .eq('owner_person_id', current.ownerPersonId)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at');
  if (error) throw new Error(`save menu: ${error.message}`);
  if (!data?.length) return { status: 'conflict' };
  if (current.menu.name !== menu.name) await audit(sb, actor, 'rename', id, `renamed menu "${current.menu.name}" to "${menu.name}"`);
  if (own) await dropOrphanTypedIns(sb, actor);
  else await audit(sb, actor, 'update', id, `edited menu "${menu.name}" as a leader (it belongs to person ${current.ownerPersonId})`);
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

/**
 * `ownerId` on the writes below: whose menu it is. It defaults to the actor (someone acting on their own
 * menu). A LEADER working on a scout's menu passes the scout's id (the caller — menu-actions.ts menuWriter —
 * has established they are a leader): the row is found and written as the owner's, the copy / the typed-in
 * clean-up / the reveal are the owner's, and the audit row still names the leader who did it.
 */
const asLeaderNote = (actor: AuditActor, ownerId: number | null) => (ownerId !== actor.personId ? ` as a leader (it belongs to person ${ownerId})` : '');

/** A copy of the owner's menu, as a new menu of the owner's. Null when it isn't theirs;
 *  MENU_LIMIT when the owner is at the cap. */
export async function duplicateMenuWith(sb: SupabaseClient, actor: AuditActor, id: string, ownerId: number | null = actor.personId): Promise<string | null> {
  const src = await loadMenuWith(sb, id);
  if (!src || src.ownerPersonId !== ownerId) return null;
  if (await atMenuLimit(sb, ownerId)) return MENU_LIMIT;
  const { data, error } = await sb
    .from('mm_menus')
    .insert({ ...toRow({ ...src.menu, name: `Copy of ${src.menu.name}`.slice(0, 120) }, src.snapshot), owner_person_id: ownerId })
    .select('id')
    .single();
  if (error) throw new Error(`duplicate menu: ${error.message}`);
  await audit(sb, actor, 'duplicate', data.id as string, `duplicated menu "${src.menu.name}"${asLeaderNote(actor, ownerId)}`);
  return data.id as string;
}

/**
 * A new name for the owner's menu (the admin Menus tab, 2026-10-05). Bumps updated_at: an open Plan tab of it
 * is told on its next save, the same as any other edit. False when the menu isn't the owner's.
 */
export async function renameMenuWith(sb: SupabaseClient, actor: AuditActor, id: string, name: string, ownerId: number | null = actor.personId): Promise<boolean> {
  const { data, error } = await sb
    .from('mm_menus')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_person_id', ownerId)
    .select('id');
  if (error) throw new Error(`rename menu: ${error.message}`);
  if (!data?.length) return false;
  await audit(sb, actor, 'rename', id, `renamed a menu to "${name}"${asLeaderNote(actor, ownerId)}`);
  return true;
}

/** Someone a leader may hand a menu to: an active scout, a leader, or a parent in an active household. */
export interface MenuOwnerCandidate {
  personId: number;
  name: string;
  kind: 'scout' | 'leader' | 'parent';
}

/**
 * The candidate rule: active scouts, leaders, and parents. A parent is an active, unmerged person who belongs
 * (household_members) to a household that an active scout belongs to, and is not already a scout or leader.
 * Each group is A to Z by name; scouts and leaders win over parent when a person is both.
 */
export async function listMenuOwnerCandidatesWith(sb: SupabaseClient): Promise<MenuOwnerCandidate[]> {
  const [scouts, leaders] = await Promise.all([
    sb.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null),
    sb.from('leaders').select('person_id').not('person_id', 'is', null)
  ]);
  if (scouts.error) throw new Error(`scouts: ${scouts.error.message}`);
  if (leaders.error) throw new Error(`leaders: ${leaders.error.message}`);
  const kinds = new Map<number, MenuOwnerCandidate['kind']>();
  // An active household is one a currently active scout belongs to (household_members is the link).
  const scoutIds = (scouts.data ?? []).map((r) => r.person_id as number);
  const householdIds = new Set<number>();
  for (let i = 0; i < scoutIds.length; i += 200) {
    const rows = await fetchAllRows<{ household_id: number }>((from, to) => sb.from('household_members').select('household_id').in('person_id', scoutIds.slice(i, i + 200)).order('household_id').range(from, to));
    for (const r of rows) householdIds.add(r.household_id);
  }
  const houses = [...householdIds];
  const parentIds: number[] = [];
  for (let i = 0; i < houses.length; i += 200) {
    const members = await fetchAllRows<{ person_id: number }>((from, to) => sb.from('household_members').select('person_id').in('household_id', houses.slice(i, i + 200)).order('person_id').range(from, to));
    parentIds.push(...members.map((m) => m.person_id));
  }
  const live = new Set<number>();
  for (let i = 0; i < parentIds.length; i += 200) {
    const { data, error } = await sb.from('people').select('id').in('id', parentIds.slice(i, i + 200)).eq('active', true).is('merged_into_person_id', null);
    if (error) throw new Error(`parents: ${error.message}`);
    for (const r of data ?? []) live.add(r.id as number);
  }
  for (const id of live) kinds.set(id, 'parent');
  for (const r of leaders.data ?? []) kinds.set(r.person_id as number, 'leader');
  for (const r of scouts.data ?? []) kinds.set(r.person_id as number, 'scout');
  const names = await ownerCreditNamesWith(sb, [...kinds.keys()]);
  return [...kinds.entries()]
    .map(([personId, kind]) => ({ personId, kind, name: names.get(personId) ?? `Person ${personId}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A leader hands a menu to a different owner (Patrick, 2026-10-05: a camp menu "was entered under a scout
 * named Todd. This was incorrect"). The new owner's menu count is respected; nothing else on the menu
 * changes, and updated_at is left alone (an open Plan tab keeps its version). False when the menu is gone.
 */
export async function setMenuOwnerWith(sb: SupabaseClient, actor: AuditActor, id: string, newOwnerId: number): Promise<boolean | typeof MENU_LIMIT> {
  const { data: cur, error } = await sb.from('mm_menus').select('name, owner_person_id').eq('id', id).maybeSingle();
  if (error) throw new Error(`load menu: ${error.message}`);
  if (!cur) return false;
  if (cur.owner_person_id === newOwnerId) return true;
  if (await atMenuLimit(sb, newOwnerId)) return MENU_LIMIT;
  const { error: uErr } = await sb.from('mm_menus').update({ owner_person_id: newOwnerId }).eq('id', id);
  if (uErr) throw new Error(`set owner: ${uErr.message}`);
  const names = await ownerCreditNamesWith(sb, [cur.owner_person_id as number, newOwnerId]);
  await audit(sb, actor, 'reassign', id, `moved menu "${cur.name as string}" from ${names.get(cur.owner_person_id as number) ?? 'someone'} to ${names.get(newOwnerId) ?? 'someone'}`);
  return true;
}

/** The patrol a menu is for ("Screaming Eagles"), set by a leader; blank clears it. Bumps updated_at like any plan edit. */
export async function setMenuPatrolWith(sb: SupabaseClient, actor: AuditActor, id: string, patrol: string): Promise<boolean> {
  const clean = patrol.trim().slice(0, 40);
  const { data, error } = await sb
    .from('mm_menus')
    .update({ patrol: clean || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('name');
  if (error) throw new Error(`set patrol: ${error.message}`);
  if (!data?.length) return false;
  await audit(sb, actor, 'update', id, clean ? `set the patrol on menu "${data[0].name as string}" to ${clean}` : `cleared the patrol on menu "${data[0].name as string}"`);
  return true;
}

/** setMenuPatrolWith, but a name must be on the patrol list (the Plan tab's list) unless blank. */
export async function setMenuPatrolListedWith(sb: SupabaseClient, actor: AuditActor, id: string, patrol: string): Promise<boolean | 'not-listed'> {
  const clean = patrol.trim();
  if (clean && !(await loadPatrolNamesWith(sb)).includes(clean)) return 'not-listed';
  return setMenuPatrolWith(sb, actor, id, clean);
}

/** Move every menu naming `from` to `to` (which must be on the list), one setMenuPatrolWith each. Returns how many moved. */
export async function movePatrolMenusWith(sb: SupabaseClient, actor: AuditActor, from: string, to: string): Promise<number | 'not-listed'> {
  const target = to.trim();
  if (!target || !(await loadPatrolNamesWith(sb)).includes(target)) return 'not-listed';
  const rows = await fetchAllRows<{ id: string }>((a, b) => sb.from('mm_menus').select('id').eq('patrol', from).order('id').range(a, b));
  let moved = 0;
  for (const r of rows) if (await setMenuPatrolWith(sb, actor, r.id, target)) moved += 1;
  return moved;
}

/** True when the owner's menu was deleted. */
export async function deleteMenuWith(sb: SupabaseClient, actor: AuditActor, id: string, ownerId: number | null = actor.personId): Promise<boolean> {
  const { data, error } = await sb
    .from('mm_menus')
    .delete()
    .eq('id', id)
    .eq('owner_person_id', ownerId)
    .select('name');
  if (error) throw new Error(`delete menu: ${error.message}`);
  if (!data?.length) return false;
  await audit(sb, actor, 'delete', id, `deleted menu "${data[0].name as string}"${asLeaderNote(actor, ownerId)}`);
  await dropOrphanTypedIns(sb, { ...actor, personId: ownerId });
  return true;
}

/**
 * Share with the troop (`on`) or Stop sharing — the owner only. Re-sharing
 * resets shared_at (the shelf's clock). Never touches updated_at: an open Plan
 * tab keeps its version token. False when the menu isn't the actor's.
 */
export async function setMenuSharedWith(sb: SupabaseClient, actor: AuditActor, id: string, on: boolean, ownerId: number | null = actor.personId): Promise<boolean> {
  const { data, error } = await sb
    .from('mm_menus')
    .update({ shared_at: on ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('owner_person_id', ownerId)
    .select('name, meals, shopping, actuals');
  if (error) throw new Error(`share menu: ${error.message}`);
  if (!data?.length) return false;
  const name = data[0].name as string;
  if (on) await revealTypedIns(sb, { ...actor, personId: ownerId }, typedInIdsIn([data[0].meals, data[0].shopping, data[0].actuals]));
  await audit(sb, actor, on ? 'share' : 'unshare', id, (on ? `shared menu "${name}" with the troop` : `stopped sharing menu "${name}"`) + asLeaderNote(actor, ownerId));
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

  const clean = sanitizeMenu({ ...src.menu, actuals: {} }, catalog);
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

export type AddTypedInResult = { status: 'added'; id: string } | { status: 'ingredient_cap' | 'duplicate_ingredient' | 'invalid' };

/**
 * A typed-in ingredient from a menu meal (release C): a real x- ingredient +
 * package owned by the session scout, through the same validator and 10-cap as
 * recipe typed-ins (mm_add_menu_ingredient). The menu's next save names it in
 * a recipeEdits `add` op; the 1-day orphan grace covers the gap. The caller
 * passes an already-sanitized NewIngredient (sanitizeNewIngredients).
 */
export async function addMenuIngredientWith(sb: SupabaseClient, actor: AuditActor, n: NewIngredient): Promise<AddTypedInResult> {
  if (actor.personId == null) return { status: 'invalid' };
  const { data, error } = await sb.rpc('mm_add_menu_ingredient', { p_person: actor.personId, p_new: typedInPayload(n) });
  if (error) {
    if (error.message.includes('MM_INGREDIENT_CAP')) return { status: 'ingredient_cap' };
    if (error.message.includes('MM_DUPLICATE_INGREDIENT')) return { status: 'duplicate_ingredient' };
    if (error.message.includes('MM_BAD_')) return { status: 'invalid' };
    throw new Error(`add menu ingredient: ${error.message}`);
  }
  return { status: 'added', id: data as string };
}

/** Sharing a menu reveals the owner's typed-ins it uses (Patrick, 2026-10-03: like a shared recipe, Decision 14). Never un-revealed. */
async function revealTypedIns(sb: SupabaseClient, actor: AuditActor, ids: string[]) {
  if (ids.length === 0 || actor.personId == null) return;
  const { error } = await sb
    .from('mm_ingredients')
    .update({ shared_at: new Date().toISOString() })
    .in('id', ids)
    .eq('added_by_person_id', actor.personId)
    .is('shared_at', null);
  if (error) throw new Error(`reveal typed-ins: ${error.message}`);
}

/** The scout's private typed-ins nothing uses any more (no recipe, no menu, older than a day) — they would hold the cap. */
async function dropOrphanTypedIns(sb: SupabaseClient, actor: AuditActor) {
  if (actor.personId == null) return;
  const { error } = await sb.rpc('mm_drop_orphan_typed_ins', { p_person: actor.personId });
  if (error) throw new Error(`drop orphan typed-ins: ${error.message}`);
}

/** Every menu linked to an outing, oldest first — for the outing's own page (its crew sees them all). */
export async function listOutingMenusWith(sb: SupabaseClient, outingId: number): Promise<StoredMenu[]> {
  const { data, error } = await sb.from('mm_menus').select(COLUMNS).eq('calendar_entry_id', outingId).order('created_at').order('id').limit(40);
  if (error) throw new Error(`outing menus: ${error.message}`);
  return ((data ?? []) as unknown as MenuRow[]).map(toStored);
}

/** Every menu linked to an outing (any owner), oldest first — the leader tools' Purchases. Paginated. */
export async function listLinkedMenusWith(sb: SupabaseClient): Promise<StoredMenu[]> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    sb.from('mm_menus').select(COLUMNS).not('calendar_entry_id', 'is', null).order('created_at').order('id').range(from, to)
  );
  return (rows as unknown as MenuRow[]).map(toStored);
}
