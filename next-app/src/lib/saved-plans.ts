/**
 * Saved meeting plans (Patrick, 2026-10-29; migration 20261231500000_saved_meeting_plans), server-only, service role.
 * The caller gates (the planning team's seed right). A save captures the meeting's criteria as This week holds them
 * (lib/this-week-db loadMeetingFocus + loadNightBadges); a load REPLACES a meeting's focus, planner-added requirements
 * and night badges in one transaction (meeting_load_saved_plan), skipping and naming anything no longer in the catalog.
 * Shapes and the list's rules: lib/saved-plans-shared.
 *
 * Saved plans are the planning team's together: any seed holder may rename, re-date or delete any of them (a hard
 * delete, no ownership check; qa-lead agreed). Write-side limits: SAVED_PLAN_CAP plans, criteria under 64 KB (also a
 * table check), and only key shapes the planner itself makes (validCriteria).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadMeetingFocus, loadNightBadges } from '@/lib/this-week-db';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { boardName } from '@/lib/meeting-board-shared';
import { SAVED_PLAN_CAP, validCriteria, type SavedCriteria, type SavedPlan } from '@/lib/saved-plans-shared';

export async function captureCriteria(sb: SupabaseClient, entryId: number): Promise<SavedCriteria> {
  const [focus, badges] = await Promise.all([loadMeetingFocus(sb, entryId), loadNightBadges(sb, entryId)]);
  return {
    focus: focus.focus.map((f) => ({ setId: f.setId, title: f.title, items: [...f.members] })),
    singles: [...focus.seededSingles],
    badges
  };
}

type Row = { id: number; name: string; plan_date: string; criteria: SavedCriteria; updated_at: string; people: { display_name: string } | { display_name: string }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function listSavedPlans(sb: SupabaseClient): Promise<SavedPlan[]> {
  const rows = await fetchAllRows<Row>((from, to) =>
    sb.from('meeting_saved_plans').select('id, name, plan_date, criteria, updated_at, people:created_by_person_id(display_name)').order('id').range(from, to)
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    planDate: r.plan_date,
    criteria: { focus: r.criteria.focus ?? [], singles: r.criteria.singles ?? [], badges: r.criteria.badges ?? [] },
    updatedAt: r.updated_at,
    createdBy: one(r.people) ? boardName(one(r.people)!.display_name) : null
  }));
}

export type SavedWrite<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const FAILED = 'Couldn’t save that. Try again.';
const GONE = 'That plan is gone.';

export async function insertSavedPlan(sb: SupabaseClient, input: { entryId: number; name: string; planDate: string; actorPersonId: number }): Promise<SavedWrite<{ id: number }>> {
  const criteria = await captureCriteria(sb, input.entryId);
  if (!criteria.focus.length && !criteria.singles.length && !criteria.badges.length) return { ok: false, error: 'This meeting has nothing planned to save yet.' };
  if (!validCriteria(criteria)) return { ok: false, error: 'This plan is too big to save, or holds something that can’t be saved.' };
  const { count, error: ce } = await sb.from('meeting_saved_plans').select('id', { count: 'exact', head: true });
  if (ce) return { ok: false, error: FAILED };
  if ((count ?? 0) >= SAVED_PLAN_CAP) return { ok: false, error: `There are ${SAVED_PLAN_CAP} saved plans already. Delete one you no longer need first.` };
  const { data, error } = await sb
    .from('meeting_saved_plans')
    .insert({ name: input.name, plan_date: input.planDate, criteria, created_by_person_id: input.actorPersonId })
    .select('id')
    .single();
  return error ? { ok: false, error: FAILED } : { ok: true, id: (data as { id: number }).id };
}

export async function updateSavedPlan(sb: SupabaseClient, id: number, input: { name: string; planDate: string }): Promise<SavedWrite> {
  const { data, error } = await sb.from('meeting_saved_plans').update({ name: input.name, plan_date: input.planDate, updated_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) return { ok: false, error: FAILED };
  return (data ?? []).length ? { ok: true } : { ok: false, error: GONE };
}

export async function deleteSavedPlan(sb: SupabaseClient, id: number): Promise<SavedWrite> {
  const { data, error } = await sb.from('meeting_saved_plans').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: FAILED };
  return (data ?? []).length ? { ok: true } : { ok: false, error: GONE };
}

/** The RPC's own messages are written for people; anything else is not shown raw. */
const KNOWN = /^(That saved plan|That meeting|That set|Tick at least|Give the set|Keep a set|That isn’t a requirement)/;

/** Loads the plan; `skipped` names what no longer resolves ('merit badge cooking', 'focus set Knots', a requirement key). */
export async function loadSavedPlan(sb: SupabaseClient, entryId: number, planId: number, actorPersonId: number): Promise<SavedWrite<{ skipped: string[] }>> {
  const { data, error } = await sb.rpc('meeting_load_saved_plan', { p_entry: entryId, p_plan: planId, p_actor: actorPersonId });
  if (error) return { ok: false, error: /^That saved plan no longer exists/.test(error.message) ? GONE : KNOWN.test(error.message) ? error.message : 'Couldn’t load that plan. Nothing changed. Try again.' };
  return { ok: true, skipped: (data ?? []) as string[] };
}
