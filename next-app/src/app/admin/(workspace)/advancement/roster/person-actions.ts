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

/**
 * Everything the editor shows for one person, re-read after a change.
 *
 * The editor used to rely on revalidatePath + router.refresh() feeding fresh
 * props back down. The writes landed — 12 relationships reached the database
 * during the session that reported this — but the open dialog kept rendering
 * the props it was given, so every save looked like it had done nothing. Worse
 * than a visible failure: the reviewer re-enters what is already recorded.
 *
 * So a mutation now returns the person's actual state and the editor renders
 * that, instead of inferring success from the absence of an error.
 */
export interface PersonDetail {
  householdId: number | null;
  roles: { id: number; role: string; start_date: string | null; end_date: string | null }[];
  relationships: {
    id: number;
    outgoing: boolean;
    type: string;
    isGuardian: boolean;
    otherName: string;
  }[];
}

export async function getPersonDetail(personId: number): Promise<PersonDetail> {
  await requireRole(['leader']);
  const supabase = createAdminClient();

  const [{ data: member }, { data: roles }, { data: rels }] = await Promise.all([
    supabase.from('household_members').select('household_id').eq('person_id', personId).maybeSingle(),
    supabase
      .from('person_roles')
      .select('id, role, start_date, end_date')
      .eq('person_id', personId)
      .order('end_date', { nullsFirst: true }),
    supabase
      .from('relationships')
      .select(
        'id, person_id, related_person_id, type, is_guardian,' +
          'person:people!relationships_person_id_fkey(display_name),' +
          'related:people!relationships_related_person_id_fkey(display_name)'
      )
      .or(`person_id.eq.${personId},related_person_id.eq.${personId}`)
  ]);

  type RawRel = {
    id: number;
    person_id: number;
    related_person_id: number;
    type: string;
    is_guardian: boolean;
    person: { display_name: string } | null;
    related: { display_name: string } | null;
  };

  return {
    householdId: member?.household_id ?? null,
    roles: roles ?? [],
    relationships: ((rels ?? []) as unknown as RawRel[]).map((r) => {
      const outgoing = r.person_id === personId;
      return {
        id: r.id,
        outgoing,
        type: r.type,
        isGuardian: r.is_guardian,
        otherName: (outgoing ? r.related?.display_name : r.person?.display_name) ?? 'someone'
      };
    })
  };
}

/**
 * Mark an adult active or inactive.
 *
 * Separate from role on purpose. Ending a role moves someone from Leaders to
 * Adults — they are still around, still a parent, still offered at signup.
 * Inactive says they have left the troop's orbit: no longer offered, but still
 * on record, because they are attached to ledger history, past events and
 * other people's relationships. Deleting them was never an option.
 */
export async function setPersonActive(
  personId: number,
  active: boolean,
  reason?: string
): Promise<Result> {
  await requireRole(['leader']);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('people')
    .update({
      active,
      inactive_reason: active ? null : (reason?.trim() || null),
      updated_at: new Date().toISOString()
    })
    .eq('id', personId);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/**
 * The adults attached to one scout, for the scout editor.
 *
 * Replaces the free-text Parents / Guardians block, which stored a name, a
 * relationship word and contact details straight onto scout_parents — one row
 * per child, so a parent of two scouts existed twice with no link between the
 * copies. That is the shape that produced the duplicate-person bugs. A parent
 * is now a person, related to the scout, and their contact details live once
 * on that person.
 */
export interface ScoutRelation {
  relationshipId: number;
  personId: number;
  name: string;
  type: string;
  isGuardian: boolean;
  email: string | null;
  phone: string | null;
  active: boolean;
}

export async function getScoutRelations(scoutPersonId: number): Promise<ScoutRelation[]> {
  await requireRole(['leader']);
  const supabase = createAdminClient();

  const { data } = await supabase
    .from('relationships')
    .select(
      'id, person_id, type, is_guardian,' +
        'person:people!relationships_person_id_fkey(id, display_name, primary_email, primary_phone, active)'
    )
    .eq('related_person_id', scoutPersonId)
    .in('type', ['parent_of', 'guardian_of', 'emergency_contact_for']);

  type Raw = {
    id: number;
    person_id: number;
    type: string;
    is_guardian: boolean;
    person: {
      id: number;
      display_name: string;
      primary_email: string | null;
      primary_phone: string | null;
      active: boolean;
    } | null;
  };

  return ((data ?? []) as unknown as Raw[])
    .filter((r) => r.person)
    .map((r) => ({
      relationshipId: r.id,
      personId: r.person_id,
      name: r.person!.display_name,
      type: r.type,
      isGuardian: r.is_guardian,
      email: r.person!.primary_email,
      phone: r.person!.primary_phone,
      active: r.person!.active
    }));
}

/** Link an adult already on record to a scout. */
export async function linkAdultToScout(
  adultPersonId: number,
  scoutPersonId: number,
  type: 'parent_of' | 'guardian_of' | 'emergency_contact_for',
  isGuardian: boolean
): Promise<Result> {
  return addRelationship(adultPersonId, scoutPersonId, type, isGuardian);
}

/**
 * Create an adult who is not on record yet and attach them to a scout, in one
 * step. Without this, adding a parent means leaving the scout, creating them on
 * the Adults tab, and coming back — which is precisely the kind of detour that
 * gets skipped, leaving the scout with no contact on file.
 */
export async function createAdultForScout(
  scoutPersonId: number,
  name: string,
  email: string,
  phone: string,
  type: 'parent_of' | 'guardian_of' | 'emergency_contact_for',
  isGuardian: boolean
): Promise<Result & { personId?: number }> {
  await requireRole(['leader']);
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'A name is required.' };

  const supabase = createAdminClient();

  // An exact email match almost certainly means this person is already on
  // record — linking beats creating a second copy of them.
  if (email.trim()) {
    const { data: existing } = await supabase
      .from('people')
      .select('id')
      .is('merged_into_person_id', null)
      .ilike('primary_email', email.trim())
      .limit(1)
      .maybeSingle();
    if (existing) {
      const res = await addRelationship(existing.id, scoutPersonId, type, isGuardian);
      return res.ok ? { ok: true, personId: existing.id } : res;
    }
  }

  const space = trimmed.lastIndexOf(' ');
  const { data: created, error } = await supabase
    .from('people')
    .insert({
      display_name: trimmed,
      first_name: space > 0 ? trimmed.slice(0, space) : trimmed,
      last_name: space > 0 ? trimmed.slice(space + 1) : null,
      primary_email: email.trim() || null,
      primary_phone: phone.trim() || null
    })
    .select('id')
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? 'Could not create the adult.' };

  const res = await addRelationship(created.id, scoutPersonId, type, isGuardian);
  return res.ok ? { ok: true, personId: created.id } : res;
}
