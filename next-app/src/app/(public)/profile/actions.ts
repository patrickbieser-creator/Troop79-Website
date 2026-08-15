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
  EDITABLE_SCOUT_FIELDS,
  EDITABLE_PERSON_FIELDS,
  type ChangeEntityType,
  type FieldValue
} from '@/lib/change-requests';
import { sendEmail, renderEmail, troopEmail } from '@/lib/email';

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
  if (householdId == null || party.scouts.length === 0) {
    redirect(
      `${back}?err=${encodeURIComponent(
        'This household cannot add members from here yet — please ask a leader.'
      )}`
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.rpc('add_parent_to_household', {
    p_household_id: householdId,
    p_name: name,
    p_email: email || null,
    p_phone: phone || null,
    p_relationship: relationship || null
  });
  if (error) {
    redirect(`${back}?err=${encodeURIComponent(`Could not add ${name}: ${error.message}`)}`);
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
