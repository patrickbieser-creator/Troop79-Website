'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { EDITABLE_PERSON_FIELDS, type FieldValue } from '@/lib/change-requests';

/**
 * Demographics a LEADER may edit directly from the Roster, vs.
 * EDITABLE_PERSON_FIELDS (the narrower set a FAMILY may propose from
 * /profile). Leaders get four more:
 *   - bsa_member_id — EDITABLE_PERSON_FIELDS excludes it because a family
 *     correction could drift from what Scouting America issued; a leader
 *     typing it is the same trust level as the roster import that already
 *     writes it directly.
 *   - ypt_completed, health_form_date, things_we_should_know — lived on the
 *     legacy `leaders` table and were editable through the old Lookups
 *     "Adults and Instructors" card until the Roster moved to the
 *     person-spine model; that card's replacement never grew a demographics
 *     section, so these went silently unmanageable. Migrated onto `people`
 *     (`20260817120000_people_ypt_health_notes.sql`, backfilled from
 *     `leaders`) and restored here (Patrick's report, 2026-08-17).
 */
export const LEADER_PERSON_FIELDS = [
  ...EDITABLE_PERSON_FIELDS,
  'bsa_member_id',
  'ypt_completed',
  'health_form_date',
  'things_we_should_know'
] as const;

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

/**
 * Create an adult from the Roster — the counterpart to createScout, and the
 * answer to "a committee member joined; where do I put them?"
 *
 * Until now an adult could only ENTER the system sideways: through the roster
 * import, or as a parent added on the fly during an event signup. There was no
 * front door, so a merit badge counselor with no scout in the troop could not
 * be added at all.
 *
 * A person with no role lands on the Adults tab; granting a role at creation
 * puts them on Leaders. Both are projections of `person_roles`, so neither is
 * set directly — the same rule the rest of this file follows.
 *
 * Email is the de-duplication key, as it is everywhere else in the people
 * spine. A collision REPORTS rather than linking silently: this is a leader
 * deliberately creating a record, and "that email already belongs to Dana
 * Ruiz" is the answer they need — unlike add_parent_to_household, where a
 * family typing a known email means "this is that person".
 */
export async function createPerson(formData: FormData): Promise<Result & { personId?: number }> {
  await requireCapability('roster.manage');

  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  if (!firstName || !lastName) {
    return { ok: false, error: 'First name and last name are required.' };
  }

  const email = String(formData.get('primary_email') ?? '').trim().toLowerCase() || null;
  const phone = String(formData.get('primary_phone') ?? '').trim() || null;
  const roleRaw = String(formData.get('role') ?? '').trim();
  const householdRaw = String(formData.get('household_id') ?? '').trim();

  const VALID_ROLES = new Set<string>([
    'adult_leader',
    'committee_member',
    'chartered_org_rep',
    'merit_badge_counselor',
    'external_contact'
  ]);
  if (roleRaw && !VALID_ROLES.has(roleRaw)) {
    return { ok: false, error: `Invalid role: ${roleRaw}` };
  }

  const supabase = createAdminClient();

  if (email) {
    const { data: clash } = await supabase
      .from('people')
      .select('id, display_name')
      .is('merged_into_person_id', null)
      .ilike('primary_email', email)
      .maybeSingle();
    if (clash) {
      const found = clash as { id: number; display_name: string };
      return {
        ok: false,
        error: `${found.display_name} already uses ${email}. Open their record instead of creating a second one.`
      };
    }
  }

  const { data: created, error } = await supabase
    .from('people')
    .insert({
      first_name: firstName,
      last_name: lastName,
      display_name: `${firstName} ${lastName}`,
      primary_email: email,
      primary_phone: phone,
      address_line1: String(formData.get('address_line1') ?? '').trim() || null,
      address_line2: String(formData.get('address_line2') ?? '').trim() || null,
      city: String(formData.get('city') ?? '').trim() || null,
      state: String(formData.get('state') ?? '').trim() || null,
      zip: String(formData.get('zip') ?? '').trim() || null,
      active: true
    })
    .select('id')
    .single();
  if (error || !created) {
    return { ok: false, error: error?.message ?? 'Could not create the person.' };
  }
  const personId = (created as { id: number }).id;

  // Role and household are best-effort follow-ups: the person now exists and
  // is findable, so a failure here names itself rather than discarding the
  // record and making the leader retype everything.
  if (roleRaw) {
    const { error: roleErr } = await supabase
      .from('person_roles')
      .insert({ person_id: personId, role: roleRaw, start_date: new Date().toISOString().slice(0, 10) });
    if (roleErr) {
      revalidatePath('/admin/advancement/roster');
      return { ok: false, error: `Created, but the role did not stick: ${roleErr.message}`, personId };
    }
  }

  if (householdRaw) {
    const { error: hhErr } = await supabase
      .from('household_members')
      .insert({ household_id: Number(householdRaw), person_id: personId });
    if (hhErr) {
      revalidatePath('/admin/advancement/roster');
      return { ok: false, error: `Created, but the household did not stick: ${hhErr.message}`, personId };
    }
  }

  revalidatePath('/admin/advancement/roster');
  revalidatePath('/admin/advancement/lookups');
  return { ok: true, personId };
}

export async function addRole(personId: number, role: GrantableRole): Promise<Result> {
  await requireCapability('roster.manage');

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
  await requireCapability('roster.manage');

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
  await requireCapability('roster.manage');

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
  await requireCapability('roster.manage');

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
  await requireCapability('roster.manage');
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
  await requireCapability('roster.manage');

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
  await requireCapability('roster.manage');
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
  /** Live status, so the editor never renders a stale copy from the row it was
   *  opened from — the row may have left the tab entirely by then. */
  active: boolean;
  inactiveReason: string | null;
  tab: string;
  householdId: number | null;
  roles: { id: number; role: string; start_date: string | null; end_date: string | null }[];
  relationships: {
    id: number;
    outgoing: boolean;
    type: string;
    isGuardian: boolean;
    otherName: string;
  }[];
  /** The person's current demographics (LEADER_PERSON_FIELDS — the leader
   *  superset of what a family may propose from /profile). Seeds the
   *  editor's own Demographics form AND feeds the Pending Update diff
   *  against a family's proposed change. */
  fields: Record<string, FieldValue>;
}

export async function getPersonDetail(personId: number): Promise<PersonDetail> {
  await requireCapability('roster.manage');
  const supabase = createAdminClient();

  const [{ data: person }, { data: member }, { data: roles }, { data: rels }, { data: fieldRow }] = await Promise.all([
    supabase.from('person_directory').select('active, person_inactive_reason, tab').eq('person_id', personId).maybeSingle(),
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
      .or(`person_id.eq.${personId},related_person_id.eq.${personId}`),
    supabase
      .from('people')
      .select(LEADER_PERSON_FIELDS.join(', '))
      .eq('id', personId)
      .maybeSingle()
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
    active: person?.active ?? true,
    inactiveReason: person?.person_inactive_reason ?? null,
    tab: person?.tab ?? 'adult',
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
    }),
    fields: (fieldRow ?? {}) as unknown as Record<string, FieldValue>
  };
}

/**
 * A leader's direct edit of an adult's demographics — writes `people`
 * immediately, unlike the family self-service flow (which lands in
 * `change_requests` for review). A leader editing from the Roster IS the
 * review; there is nobody else to approve it.
 *
 * Same required-fields and email-collision rules as createPerson(), since
 * this is the same row shape post-creation. `neq('id', personId)` on the
 * collision check is the one difference — the person's own email must not
 * collide with itself.
 */
export async function updatePersonDemographics(personId: number, formData: FormData): Promise<Result> {
  await requireCapability('roster.manage');

  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  if (!firstName || !lastName) {
    return { ok: false, error: 'First name and last name are required.' };
  }

  const supabase = createAdminClient();
  const email = String(formData.get('primary_email') ?? '').trim().toLowerCase() || null;

  if (email) {
    const { data: clash } = await supabase
      .from('people')
      .select('id, display_name')
      .is('merged_into_person_id', null)
      .neq('id', personId)
      .ilike('primary_email', email)
      .maybeSingle();
    if (clash) {
      const found = clash as { id: number; display_name: string };
      return {
        ok: false,
        error: `${found.display_name} already uses ${email}. Merge these records instead of duplicating the address.`
      };
    }
  }

  const text = (key: string) => String(formData.get(key) ?? '').trim() || null;

  const { error } = await supabase
    .from('people')
    .update({
      first_name: firstName,
      last_name: lastName,
      display_name: `${firstName} ${lastName}`,
      birthdate: text('birthdate'),
      primary_email: email,
      primary_phone: text('primary_phone'),
      address_line1: text('address_line1'),
      address_line2: text('address_line2'),
      city: text('city'),
      state: text('state'),
      zip: text('zip'),
      bsa_member_id: text('bsa_member_id'),
      ypt_completed: text('ypt_completed'),
      health_form_date: text('health_form_date'),
      things_we_should_know: text('things_we_should_know')
    })
    .eq('id', personId);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
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
  await requireCapability('roster.manage');

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
  await requireCapability('roster.manage');
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
  await requireCapability('roster.manage');
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

/**
 * Merge one person into another, chosen by hand.
 *
 * person_merge_candidates only proposes pairs an exact rule can spot — same
 * name, or a nickname that is a prefix of the formal name. A duplicate recorded
 * under a different name entirely ("Kate Brown" / "Katherine Bruen") is
 * invisible to it and always will be, so a leader who spots one needs a way to
 * say so directly.
 *
 * Preferred over deleting the duplicate: merge_people moves every link — scout,
 * leader and parent rows, household, roles, relationships, pending import
 * suggestions — onto the survivor and fills its blanks from the loser, then
 * retains the loser flagged rather than destroying it. Deleting and
 * re-entering by hand loses whichever of those the eye misses.
 */
export async function mergePersonInto(loserId: number, survivorId: number): Promise<Result> {
  const session = await requireCapability('roster.manage');
  if (loserId === survivorId) return { ok: false, error: 'Pick two different people.' };

  const supabase = createAdminClient();
  const { error } = await supabase.rpc('merge_people', {
    p_survivor: survivorId,
    p_loser: loserId,
    p_decided_by: session.label
  });
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/**
 * Delete a person outright.
 *
 * REFUSES while a record that MEANS something still points at them, because
 * those foreign keys hide the damage rather than prevent it: scouts.person_id
 * and leaders.person_id are ON DELETE SET NULL, so deleting a person attached
 * to a scout silently blanks that scout's link — and person_directory is built
 * from `people`, so the scout would vanish from the Roster with no error
 * anywhere. signup_entries.person_id is RESTRICT and would at least fail
 * loudly, but a raw constraint message is not an explanation.
 *
 * REWRITTEN 2026-08-15, after a leader hit a dead end this could not talk its
 * way out of. Two faults, both from the guard's list having drifted away from
 * the database's:
 *
 *   1. It blocked on a `scout_parents` row and told the leader to "unlink
 *      those records first" — but no screen in the admin could unlink one. The
 *      scout editor's unlink writes `relationships`, a different table. The
 *      person was undeletable by any route the UI offered. That table is gone
 *      now (D-066) and the check with it.
 *   2. It checked four things while SIX foreign keys could actually block, so
 *      a person holding only login tokens sailed past the guard and died on a
 *      raw Postgres constraint error instead.
 *
 * The list below is now split by what the reference MEANS, which is the thing
 * the guard was always trying to express:
 *
 *   blocking   a real record that would be orphaned — a human has to decide.
 *   worthless  rows that exist only to serve the person and mean nothing once
 *              they are gone. Deleted here rather than reported, because
 *              "cannot delete: they have a login code" is not a decision
 *              anyone can act on.
 *
 * Anything blocking should be MERGED, which moves the links rather than
 * orphaning them.
 */
export async function deletePerson(personId: number): Promise<Result> {
  await requireCapability('roster.manage');
  const supabase = createAdminClient();

  const [scoutRes, leaderRes, signupRes, enteredRes, libraryRes] = await Promise.all([
    supabase.from('scouts').select('id').eq('person_id', personId).limit(1),
    supabase.from('leaders').select('code').eq('person_id', personId).limit(1),
    supabase.from('signup_entries').select('id').eq('person_id', personId).limit(1),
    // Both NO ACTION, both previously unchecked — these are the ones that used
    // to surface as a database error rather than a sentence.
    supabase.from('signup_entries').select('id').eq('entered_by_person_id', personId).limit(1),
    supabase.from('library_resources').select('id').eq('submitted_person_id', personId).limit(1)
  ]);

  const blockers: string[] = [];
  if (scoutRes.data?.length) blockers.push(`a scout record (${scoutRes.data[0].id})`);
  if (leaderRes.data?.length) blockers.push(`a leader record (${leaderRes.data[0].code})`);
  if (signupRes.data?.length) blockers.push('an event signup');
  if (enteredRes.data?.length) blockers.push('an event signup they entered for someone else');
  if (libraryRes.data?.length) blockers.push('a resource they submitted to the library');

  if (blockers.length > 0) {
    return {
      ok: false,
      error:
        `Cannot delete — this person still holds ${blockers.join(', ')}. ` +
        `Deleting would leave that record pointing at nobody. Merge them into the person they ` +
        `duplicate instead, which moves everything across.`
    };
  }

  // Worthless without the person, and all NO ACTION — so they must go first or
  // the delete below fails on a constraint. A pending change request is
  // included deliberately: `change_requests.entity_id` is a generic text key
  // with no foreign key at all, so a notice about someone deleted would
  // otherwise sit on the leader dashboard forever, pointing at nobody.
  await supabase.from('login_tokens').delete().eq('person_id', personId);
  await supabase
    .from('change_requests')
    .delete()
    .in('entity_type', ['adult', 'adult_added'])
    .eq('entity_id', String(personId));
  await supabase.from('change_requests').delete().eq('submitted_by_person_id', personId);

  // Household membership, roles, relationships and import suggestions all
  // cascade; none of them mean anything without the person.
  const { error } = await supabase.from('people').delete().eq('id', personId);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/**
 * Create a household and move this person into it.
 *
 * Missing until now, and its absence was doing real damage. The household
 * picker offered only households that already existed, so a second family
 * sharing a surname had nowhere to go: both Stollenwerk families ended up in
 * one household, and Adriana Haslam was assigned to a same-named household that
 * held none of her children. A leader could see the problem and had no way to
 * fix it.
 */
export async function createHouseholdForPerson(
  personId: number,
  label: string
): Promise<Result & { householdId?: number }> {
  await requireCapability('roster.manage');
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: 'Give the household a name.' };

  const supabase = createAdminClient();
  const { data: created, error } = await supabase
    .from('households')
    .insert({ label: trimmed })
    .select('id')
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? 'Could not create it.' };

  const res = await setHousehold(personId, created.id);
  return res.ok ? { ok: true, householdId: created.id } : res;
}

/**
 * Rename a household.
 *
 * Labels are seeded from surnames, so two unrelated families — or two branches
 * of one, which the troop has — read identically in every picker. Renaming one
 * to "Stollenwerk (Joe & Mindy)" is the only thing that makes them tellable
 * apart at a glance. Deliberately not forced to be unique: two Johnson families
 * genuinely share a name, and rejecting that would be wrong.
 */
export async function renameHousehold(householdId: number, label: string): Promise<Result> {
  await requireCapability('roster.manage');
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: 'A household needs a name.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('households')
    .update({ label: trimmed, updated_at: new Date().toISOString() })
    .eq('id', householdId);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}
