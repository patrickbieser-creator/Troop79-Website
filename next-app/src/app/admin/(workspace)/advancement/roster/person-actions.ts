'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Person-level edits behind the Roster's Leaders and Adults tabs.
 *
 * WHICH TAB SOMEONE APPEARS ON IS NOT EDITABLE, and there is deliberately no
 * action here that sets it. Leaders and Adults are a projection of whether a
 * person currently holds a troop role, so someone moves between them by
 * gaining or ending a role — nothing else. That is why `addRole`/`endRole`
 * exist and `setTab` does not.
 *
 * Relationships and household membership are edited independently and are
 * untouched by role changes. A scout who ages out becomes an adult and keeps
 * their siblings and their household; a leader who stops helping out becomes
 * an adult and keeps everything. Persistence across those transitions is the
 * entire reason role and relationship are separate tables.
 */

const PATHS = ['/admin/advancement/roster', '/admin/advancement/roster-import'];

interface Result {
  ok: boolean;
  error?: string;
}

function revalidate() {
  for (const p of PATHS) revalidatePath(p);
}

/** Roles a leader may grant. 'youth_member' is absent on purpose — that one is
 *  a consequence of being a scout, not something to hand out. */
export type GrantableRole =
  | 'adult_leader'
  | 'committee_member'
  | 'chartered_org_rep'
  | 'merit_badge_counselor'
  | 'external_contact';

export async function addRole(personId: number, role: GrantableRole): Promise<Result> {
  await requireRole(['leader']);

  const supabase = createAdminClient();
  // A person may have held this role before and ended it; the partial unique
  // index only guards CURRENT holdings, so re-granting is an insert, not an
  // update, and the old ended row stays as history.
  const { data: existing } = await supabase
    .from('person_roles')
    .select('id')
    .eq('person_id', personId)
    .eq('role', role)
    .is('end_date', null)
    .maybeSingle();
  if (existing) return { ok: false, error: 'They already hold that role.' };

  const { error } = await supabase
    .from('person_roles')
    .insert({ person_id: personId, role, start_date: new Date().toISOString().slice(0, 10) });
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/** Ends a role rather than deleting it — "stopped helping out in 2026" is a
 *  fact worth keeping, and it is what moves someone back to the Adults tab. */
export async function endRole(roleId: number): Promise<Result> {
  await requireRole(['leader']);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('person_roles')
    .update({ end_date: new Date().toISOString().slice(0, 10) })
    .eq('id', roleId)
    .is('end_date', null);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/** Deletes an ended role outright, for one recorded in error. */
export async function deleteRole(roleId: number): Promise<Result> {
  await requireRole(['leader']);

  const supabase = createAdminClient();
  const { error } = await supabase.from('person_roles').delete().eq('id', roleId);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/**
 * Move a person into a household, or out of every household.
 *
 * A person belongs to at most one household here. Two-household children are a
 * real case the model can eventually express, but nothing in the app reads a
 * second membership yet, and offering it before anything honours it would
 * record a fact the signup flow would silently ignore.
 */
export async function setHousehold(personId: number, householdId: number | null): Promise<Result> {
  await requireRole(['leader']);

  const supabase = createAdminClient();
  const { error: delErr } = await supabase
    .from('household_members')
    .delete()
    .eq('person_id', personId);
  if (delErr) return { ok: false, error: delErr.message };

  if (householdId !== null) {
    const { error } = await supabase
      .from('household_members')
      .insert({ household_id: householdId, person_id: personId });
    if (error) return { ok: false, error: error.message };
  }

  revalidate();
  return { ok: true };
}

/**
 * Record a relationship.
 *
 * 'child_of' is an input phrasing only, stored as the parent's parent_of edge
 * with the two people swapped, so one fact has exactly one representation and
 * entering it from either person lands on the same row.
 */
export type RelationshipInput =
  | 'parent_of'
  | 'child_of'
  | 'guardian_of'
  | 'sibling_of'
  | 'emergency_contact_for';

export async function addRelationship(
  personId: number,
  relatedPersonId: number,
  type: RelationshipInput,
  isGuardian: boolean
): Promise<Result> {
  await requireRole(['leader']);
  if (personId === relatedPersonId) {
    return { ok: false, error: 'A person cannot relate to themselves.' };
  }

  const stored =
    type === 'child_of'
      ? { person_id: relatedPersonId, related_person_id: personId, type: 'parent_of' as const }
      : { person_id: personId, related_person_id: relatedPersonId, type };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('relationships')
    .upsert(
      { ...stored, is_guardian: isGuardian },
      { onConflict: 'person_id,related_person_id,type' }
    );
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

export async function removeRelationship(relationshipId: number): Promise<Result> {
  await requireRole(['leader']);

  const supabase = createAdminClient();
  const { error } = await supabase.from('relationships').delete().eq('id', relationshipId);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/** Type-ahead across everyone on record, for relationship entry. */
export async function searchPeople(
  q: string
): Promise<{ id: number; display_name: string; primary_email: string | null }[]> {
  await requireRole(['leader']);
  const term = q.trim();
  if (term.length < 2) return [];

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('people')
    .select('id, display_name, primary_email')
    .is('merged_into_person_id', null)
    .ilike('display_name', `%${term}%`)
    .order('display_name')
    .limit(15);
  return data ?? [];
}
