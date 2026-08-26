'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { requireHouseholdIdentity } from '@/lib/family-access';
import { loadHouseholdByKey, storedHouseholdId, type Household } from '@/lib/households';
import {
  diffFields,
  parseFieldValue,
  fieldLabel,
  isWithdrawable,
  EDITABLE_SCOUT_FIELDS,
  EDITABLE_PERSON_FIELDS,
  type ChangeEntityType,
  type FieldValue
} from '@/lib/change-requests';
import { sendEmail, renderEmail, troopEmail } from '@/lib/email';
import { addPersonEmail, setPrimaryEmail, removePersonEmail, type PersonEmailLabel } from '@/lib/person-emails';

const PROFILE_PATH = '/profile';

/**
 * Family self-service for a whole household, not just its scouts.
 *
 * Everything here requires Tier 2 (Plans/Family-Identity-Auth.md Phase 2) —
 * /profile has no self-asserted household picker; requireHouseholdIdentity()
 * throws for anything short of a verified adult session, and the household a
 * submission may target is resolved from THAT session's householdKey, never a
 * form field a visitor could set for themselves.
 *
 * Demographic edits — scout or adult — land as a 'pending' change_requests row
 * and only reach the live record when a leader approves them from the Roster.
 * ADDING an adult is the exception: it writes immediately, because there is
 * nothing to review yet (a name and an email), the RPC links rather than
 * duplicates when the email is already on record, and a leader can correct or
 * deactivate the person afterwards like any other roster row.
 */

/** Query-param key for the member being edited, so a redirect returns to them. */
function memberParam(entityType: ChangeEntityType, entityId: string): string {
  return entityType === 'adult' ? `person:${entityId}` : `scout:${entityId}`;
}

/**
 * Drop one entity's queued proposal, if it has one. Returns whether anything
 * was actually removed, so a caller can tell a withdrawal from a no-op.
 *
 * DELETED, not marked rejected. 'rejected' is a leader's verdict and carries a
 * rejection_reason the Roster shows; a family taking its own update back is not
 * that. This table keeps no history either way — a second submission already
 * overwrites the first in place — so a deleted row is consistent with how the
 * queue has always behaved.
 */
async function deletePendingRequest(
  supabase: ReturnType<typeof createAdminClient>,
  entityType: ChangeEntityType,
  entityId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('change_requests')
    .delete()
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('status', 'pending')
    .select('id');
  return ((data as { id: number }[] | null) ?? []).length > 0;
}

/**
 * Load, diff, and queue one entity's proposed changes. Shared by the scout and
 * adult paths so the overwrite rule, the allowlist and the notification can't
 * drift apart — the only differences are which table holds the current values
 * and which field list is legal.
 */
async function queueChangeRequest(opts: {
  entityType: ChangeEntityType;
  entityId: string;
  table: 'scouts' | 'people';
  /** Column the entity id matches on — `scouts.id` is text, `people.id` int. */
  idValue: string | number;
  fields: readonly string[];
  formData: FormData;
  party: Household;
  session: { personId: number | null; displayName: string };
  subjectLabel: string;
}): Promise<never> {
  const { entityType, entityId, table, idValue, fields, formData, party, session } = opts;
  const back = `${PROFILE_PATH}?member=${encodeURIComponent(memberParam(entityType, entityId))}`;
  const supabase = createAdminClient();

  const { data: currentRow, error: readErr } = await supabase
    .from(table)
    .select(fields.join(', '))
    .eq('id', idValue)
    .single();
  if (readErr || !currentRow) {
    redirect(`${back}&err=${encodeURIComponent('Could not load this record. Please try again.')}`);
  }

  const proposed: Record<string, FieldValue> = {};
  for (const field of fields) {
    const raw = formData.get(field);
    if (raw !== null) proposed[field] = parseFieldValue(field, String(raw));
  }
  const changed = diffFields(
    currentRow as unknown as Record<string, FieldValue>,
    proposed,
    fields
  );
  if (Object.keys(changed).length === 0) {
    // The form matches the live record exactly. That is ordinarily a no-op —
    // but if something was queued, the family has just edited its own proposal
    // back to what the record already says, which is a withdrawal however it
    // arrived. Leaving the old row would be worse than either outcome: the
    // form would show no changes while the queue still held some.
    const removed = await deletePendingRequest(supabase, entityType, entityId);
    if (removed) {
      revalidatePath(PROFILE_PATH);
      redirect(`${back}&withdrawn=1`);
    }
    redirect(`${back}&nochange=1`);
  }

  // Overwrite, not queue — an entity has at most one pending request (DB-backed
  // by change_requests_one_pending_per_entity). Find-then-update/insert rather
  // than a Postgres UPSERT so the person_id + timestamp are refreshed either way.
  const { data: existingPending } = await supabase
    .from('change_requests')
    .select('id')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('status', 'pending')
    .maybeSingle();

  const writeError = existingPending
    ? (
        await supabase
          .from('change_requests')
          .update({
            submitted_by_person_id: session.personId,
            submitted_at: new Date().toISOString(),
            proposed_changes: changed
          })
          .eq('id', (existingPending as { id: number }).id)
      ).error
    : (
        await supabase.from('change_requests').insert({
          entity_type: entityType,
          entity_id: entityId,
          submitted_by_person_id: session.personId,
          proposed_changes: changed,
          status: 'pending'
        })
      ).error;

  if (writeError) {
    redirect(`${back}&err=${encodeURIComponent('Could not save your update. Please try again.')}`);
  }

  // Single fixed troop-owned recipient, not family-facing mass mail — the
  // "nothing sends automatically" rule in lib/email.ts guards against
  // accidentally notifying many families, which doesn't apply to this one
  // internal address. Unconfigured email is already a no-op (see sendEmail).
  //
  // Deliberately lists WHICH fields changed, not their values — email is a
  // weaker security boundary than the DB (forwarded, less access-controlled),
  // and one of the possible fields is medical/allergy text. The actual values
  // are reviewed in the Roster's diff panel, behind the leader gate.
  const { html, text } = renderEmail({
    heading: `Profile update — ${party.label}`,
    intro: `${session.displayName} (${party.label} household) submitted a demographic update for ${opts.subjectLabel} through the website. Review it in the Roster before it takes effect.`,
    bullets: Object.keys(changed).map((field) => fieldLabel(entityType, field))
  });
  await sendEmail({
    to: [troopEmail()],
    subject: `Profile update pending review — ${party.label}`,
    html,
    text,
    confirm: true
  });

  revalidatePath(PROFILE_PATH);
  redirect(`${back}&submitted=1`);
}

/** The verified session plus the household it may act on. */
async function requireParty() {
  let session;
  try {
    session = await requireHouseholdIdentity();
  } catch {
    redirect(`${PROFILE_PATH}?err=${encodeURIComponent('Please sign in again.')}`);
  }
  // Resolve the party server-side from the VERIFIED session's household key —
  // never a form field or self-asserted cookie (same reasoning as
  // cancelSignupAction in events/[id]/actions.ts, on a stronger footing here:
  // this household came from a challenge/code redemption, not a self-pick).
  const party = await loadHouseholdByKey(session.householdKey);
  if (!party) {
    redirect(`${PROFILE_PATH}?err=${encodeURIComponent('Could not find your household.')}`);
  }
  return { session, party };
}

/** Submit (or overwrite) a proposed demographic update for one scout. */
export async function submitChangeRequestAction(formData: FormData): Promise<void> {
  const { session, party } = await requireParty();
  const scoutId = String(formData.get('scoutId') ?? '');

  const scout = party.scouts.find((s) => s.id === scoutId);
  if (!scout) {
    redirect(`${PROFILE_PATH}?err=${encodeURIComponent('That scout is not in your household.')}`);
  }

  await queueChangeRequest({
    entityType: 'scout',
    entityId: scoutId,
    table: 'scouts',
    idValue: scoutId,
    fields: EDITABLE_SCOUT_FIELDS,
    formData,
    party,
    session,
    subjectLabel: scout.displayName
  });
}

/**
 * Submit (or overwrite) a proposed demographic update for one ADULT of the
 * household. Membership is checked against party.adults for the same reason
 * the scout path checks party.scouts: the person id arrives in a form field,
 * and the household is the only thing the session actually vouches for.
 */
export async function submitPersonChangeRequestAction(formData: FormData): Promise<void> {
  const { session, party } = await requireParty();
  const personId = Number(formData.get('personId'));

  const adult = Number.isFinite(personId)
    ? party.adults.find((a) => a.personId === personId)
    : undefined;
  if (!adult) {
    redirect(`${PROFILE_PATH}?err=${encodeURIComponent('That person is not in your household.')}`);
  }

  await queueChangeRequest({
    entityType: 'adult',
    entityId: String(personId),
    table: 'people',
    idValue: personId,
    fields: EDITABLE_PERSON_FIELDS,
    formData,
    party,
    session,
    subjectLabel: adult.name
  });
}

/**
 * Take a queued update back out of the review queue.
 *
 * The counterpart to a form that now SHOWS what is pending rather than
 * describing it: once a family can read its own proposal, it needs a way to
 * say "never mind" that isn't editing every field back by hand. Nothing has
 * been applied at this point — withdrawing leaves the live record exactly as
 * it was, which is the whole reason this is safe to expose without review.
 *
 * The type allowlist is WITHDRAWABLE_ENTITY_TYPES — notably NOT 'adult_added',
 * which is a notice rather than a proposal. See its note in lib/change-requests.
 */
export async function withdrawChangeRequestAction(formData: FormData): Promise<void> {
  const { session, party } = await requireParty();
  const entityType = String(formData.get('entityType') ?? '');
  const entityId = String(formData.get('entityId') ?? '');

  if (!isWithdrawable(entityType)) {
    redirect(`${PROFILE_PATH}?err=${encodeURIComponent('That update cannot be withdrawn here.')}`);
  }

  // Same household boundary the submit paths enforce, for the same reason: the
  // id is a form field and the session only vouches for the household.
  const subject =
    entityType === 'scout'
      ? party.scouts.find((s) => s.id === entityId)?.displayName
      : party.adults.find((a) => a.personId === Number(entityId))?.name;
  if (!subject) {
    redirect(
      `${PROFILE_PATH}?err=${encodeURIComponent('That person is not in your household.')}`
    );
  }

  const back = `${PROFILE_PATH}?member=${encodeURIComponent(memberParam(entityType, entityId))}`;
  const supabase = createAdminClient();
  const removed = await deletePendingRequest(supabase, entityType, entityId);
  if (!removed) {
    redirect(`${back}&err=${encodeURIComponent('There was no pending update to remove.')}`);
  }

  // A leader was emailed when this was submitted and may be holding that
  // message — tell them it's gone rather than letting them go looking for a
  // row the Roster no longer shows.
  const { html, text } = renderEmail({
    heading: `Profile update withdrawn — ${party.label}`,
    intro: `${session.displayName} (${party.label} household) withdrew the pending demographic update for ${subject}. Nothing was applied and there is no longer anything to review.`
  });
  await sendEmail({
    to: [troopEmail()],
    subject: `Profile update withdrawn — ${party.label}`,
    html,
    text,
    confirm: true
  });

  revalidatePath(PROFILE_PATH);
  redirect(`${back}&withdrawn=1`);
}

/**
 * Add an adult to the household — a second parent, a guardian, a grandparent
 * who does pickup. Writes immediately (see the file header).
 *
 * `add_parent_to_household` is the same RPC the event signup flow uses to add
 * an adult on the fly, so a person added here is a real, linkable record with
 * a household membership and a parent_of relationship — not a name stored on
 * one row. It requires a STORED household with at least one scout, which is
 * the shape every family reaching this form has; the page hides the form for
 * the others rather than failing here.
 */
export async function addHouseholdMemberAction(formData: FormData): Promise<void> {
  const { session, party } = await requireParty();
  const back = PROFILE_PATH;

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const relationship = String(formData.get('relationship') ?? '').trim();

  if (!name) {
    redirect(`${back}?err=${encodeURIComponent('A name is required to add someone.')}`);
  }

  const householdId = storedHouseholdId(party.key);
  // A scout is no longer required. add_parent_to_household only ever needed
  // one to fill scout_parents.scout_id, and that table is gone (D-066) — so a
  // household whose scouts have all aged out can add an adult like any other.
  if (householdId == null) {
    redirect(
      `${back}?err=${encodeURIComponent(
        'This household cannot add members from here yet — please ask a leader.'
      )}`
    );
  }

  const supabase = createAdminClient();
  const { data: newPersonId, error } = await supabase.rpc('add_parent_to_household', {
    p_household_id: householdId,
    p_name: name,
    p_email: email || null,
    p_phone: phone || null,
    p_relationship: relationship || null
  });
  if (error) {
    redirect(`${back}?err=${encodeURIComponent(`Could not add ${name}: ${error.message}`)}`);
  }

  // Leave a NOTICE on the dashboard, not just an email.
  //
  // This path writes the person immediately, so unlike a demographic edit
  // there is no pending row to make it visible — and an email alone means a
  // family can put someone on the roster with nobody noticing. The notice is
  // acknowledged (not approved) by a leader from the person's own editor.
  //
  // Best-effort: the member IS added and the family should not be told
  // otherwise because a notification failed. A missing notice degrades to the
  // email that already went out.
  //
  // The RPC returns people.id directly since D-066. It used to return
  // scout_parents.id, which cost a second SELECT here just to trade one id for
  // the other.
  if (newPersonId != null) {
    await supabase.from('change_requests').insert({
      entity_type: 'adult_added',
      entity_id: String(newPersonId as number),
      submitted_by_person_id: session.personId,
      proposed_changes: {
        name,
        relationship: relationship || null,
        primary_email: email || null,
        primary_phone: phone || null
      },
      status: 'pending'
    });
  }

  const { html, text } = renderEmail({
    heading: `Household member added — ${party.label}`,
    intro: `${session.displayName} added ${name} to the ${party.label} household through the website. They are on the roster now — review them in the Roster if that looks wrong.`,
    bullets: [name, relationship || 'no relationship given', email || 'no email given']
  });
  await sendEmail({
    to: [troopEmail()],
    subject: `Household member added — ${party.label}`,
    html,
    text,
    confirm: true
  });

  revalidatePath(PROFILE_PATH);
  redirect(`${back}?added=${encodeURIComponent(name)}`);
}

/*
 * ── Email addresses (Plans/Retire-Roster-Contact-Columns.md Phase 2) ───────
 *
 * A verified adult manages their OWN addresses — add, promote, remove. All
 * three write immediately, like addHouseholdMemberAction above: unlike a
 * demographic edit, there is no leader review step for "which of my own
 * inboxes should the site use", and lib/person-emails.ts already refuses the
 * two cases that would leave the person unreachable (the last address, the
 * primary without a replacement chosen first).
 *
 * OWNERSHIP IS THE SESSION, NOT A FORM FIELD. Every one of these three reads
 * `session.personId` from requireHouseholdIdentity() and NEVER a personId out
 * of its own formData — the household membership check the demographic-edit
 * actions above run (`party.adults.find(...)`) would still only prove "some
 * adult in my household", which is not the same claim as "this is MY own
 * address" (a family added on /profile is one household of several adults,
 * and one adult managing a housemate's inbox is exactly the case this must
 * not allow). See tests/profile-email-actions.test.ts's source-property test,
 * which asserts this by reading these three functions' own source.
 */

function emailBack(personId: number): string {
  return `${PROFILE_PATH}?member=${encodeURIComponent(memberParam('adult', String(personId)))}`;
}

export async function addAdultEmailAction(formData: FormData): Promise<void> {
  const { session } = await requireParty();
  const back = emailBack(session.personId);

  const email = String(formData.get('email') ?? '').trim();
  const label = (String(formData.get('label') ?? 'home').trim() || 'home') as PersonEmailLabel;
  if (!email) redirect(`${back}&err=${encodeURIComponent('Enter an email address.')}`);

  try {
    await addPersonEmail(createAdminClient(), session.personId, email, label);
  } catch (e) {
    redirect(
      `${back}&err=${encodeURIComponent(e instanceof Error ? e.message : 'Could not add that address.')}`
    );
  }

  revalidatePath(PROFILE_PATH);
  redirect(`${back}&emailSaved=1`);
}

export async function setAdultPrimaryEmailAction(formData: FormData): Promise<void> {
  const { session } = await requireParty();
  const back = emailBack(session.personId);

  const emailId = Number(formData.get('emailId'));
  if (!Number.isInteger(emailId)) redirect(`${back}&err=${encodeURIComponent('Something went wrong.')}`);

  try {
    await setPrimaryEmail(createAdminClient(), session.personId, emailId);
  } catch (e) {
    redirect(
      `${back}&err=${encodeURIComponent(e instanceof Error ? e.message : 'Could not update the primary address.')}`
    );
  }

  revalidatePath(PROFILE_PATH);
  redirect(`${back}&emailSaved=1`);
}

export async function removeAdultEmailAction(formData: FormData): Promise<void> {
  const { session } = await requireParty();
  const back = emailBack(session.personId);

  const emailId = Number(formData.get('emailId'));
  if (!Number.isInteger(emailId)) redirect(`${back}&err=${encodeURIComponent('Something went wrong.')}`);

  try {
    await removePersonEmail(createAdminClient(), session.personId, emailId);
  } catch (e) {
    redirect(
      `${back}&err=${encodeURIComponent(e instanceof Error ? e.message : 'Could not remove that address.')}`
    );
  }

  revalidatePath(PROFILE_PATH);
  redirect(`${back}&emailSaved=1`);
}
