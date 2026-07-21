'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { FAMILY_COOKIE, signFamilySession, verifyFamilySession } from '@/lib/family-session';
import {
  PROFILE_HOUSEHOLD_COOKIE,
  signProfileHouseholdSession,
  verifyProfileHouseholdSession
} from '@/lib/profile-household-session';
import { secretMatches } from '@/lib/signed-cookie';
import { loadHouseholdByKey } from '@/lib/households';
import {
  diffScoutFields,
  parseFieldValue,
  EDITABLE_SCOUT_FIELDS,
  FIELD_LABEL,
  type EditableScoutField,
  type FieldValue
} from '@/lib/change-requests';
import { sendEmail, renderEmail } from '@/lib/email';

const PROFILE_PATH = '/profile';
const TROOP_EMAIL = 'bsatroop79bg@gmail.com';

/** Same shared-troop-password gate as Event Signup (lib/family-session.ts) —
 *  a separate action rather than importing events/[id]/actions.ts so Profile
 *  doesn't couple to that route's internals; the logic itself is a few lines. */
export async function profileGateAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');

  if (!process.env.FAMILY_PASSWORD) redirect(`${PROFILE_PATH}?gate=not-configured`);
  if (!password) redirect(`${PROFILE_PATH}?gate=missing`);
  if (!secretMatches(password, process.env.FAMILY_PASSWORD)) {
    redirect(`${PROFILE_PATH}?gate=bad-password`);
  }

  const token = await signFamilySession({ role: 'family', iat: Date.now() });
  const jar = await cookies();
  jar.set(FAMILY_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FAMILY_COOKIE.maxAgeSeconds
  });

  redirect(PROFILE_PATH);
}

/** Binds this browser to a household — the second cookie layered on top of
 *  the family gate (lib/profile-household-session.ts). */
export async function pickHouseholdAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const family = await verifyFamilySession(jar.get(FAMILY_COOKIE.name)?.value);
  if (!family) redirect(`${PROFILE_PATH}?gate=missing`);

  const householdKey = String(formData.get('householdKey') ?? '');
  const household = await loadHouseholdByKey(householdKey);
  if (!household) redirect(`${PROFILE_PATH}?err=${encodeURIComponent('Household not found.')}`);

  const token = await signProfileHouseholdSession({
    householdKey: household.key,
    displayName: household.label,
    iat: Date.now()
  });
  jar.set(PROFILE_HOUSEHOLD_COOKIE.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PROFILE_HOUSEHOLD_COOKIE.maxAgeSeconds
  });

  redirect(PROFILE_PATH);
}

/** Clears BOTH cookies — the explicit ask is "logout and re-enter the
 *  password for a different family," not just re-picking a household under
 *  the same family session. */
export async function profileSignOutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(FAMILY_COOKIE.name);
  jar.delete(PROFILE_HOUSEHOLD_COOKIE.name);
  redirect(`${PROFILE_PATH}?signedout=1`);
}

/**
 * Submit (or overwrite) a proposed demographic update for one scout.
 *
 * Nothing here touches the live `scouts` row — it lands as a 'pending'
 * change_requests row and only applies once a leader approves it from the
 * Scout editor (Plans/Scout-Self-Service-Demographics.md).
 */
export async function submitChangeRequestAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const family = await verifyFamilySession(jar.get(FAMILY_COOKIE.name)?.value);
  const household = await verifyProfileHouseholdSession(jar.get(PROFILE_HOUSEHOLD_COOKIE.name)?.value);
  if (!family || !household) redirect(`${PROFILE_PATH}?gate=missing`);

  const scoutId = String(formData.get('scoutId') ?? '');
  const back = `${PROFILE_PATH}?scout=${encodeURIComponent(scoutId)}`;

  // Resolve the party server-side rather than trusting the posted scoutId —
  // it must belong to the household this browser is bound to (same reasoning
  // as cancelSignupAction in events/[id]/actions.ts).
  const party = await loadHouseholdByKey(household.householdKey);
  if (!party || !party.scouts.some((s) => s.id === scoutId)) {
    redirect(`${PROFILE_PATH}?err=${encodeURIComponent('That scout is not in your household.')}`);
  }

  const supabase = createAdminClient();
  const { data: scoutRow, error: scoutErr } = await supabase
    .from('scouts')
    .select(EDITABLE_SCOUT_FIELDS.join(', '))
    .eq('id', scoutId)
    .single();
  if (scoutErr || !scoutRow) {
    redirect(`${back}&err=${encodeURIComponent('Could not load this scout. Please try again.')}`);
  }

  const proposed: Partial<Record<EditableScoutField, FieldValue>> = {};
  for (const field of EDITABLE_SCOUT_FIELDS) {
    const raw = formData.get(field);
    if (raw !== null) proposed[field] = parseFieldValue(field, String(raw));
  }
  const changed = diffScoutFields(
    scoutRow as unknown as Partial<Record<EditableScoutField, FieldValue>>,
    proposed
  );
  if (Object.keys(changed).length === 0) {
    redirect(`${back}&nochange=1`);
  }

  // Overwrite, not queue — a scout has at most one pending request (DB-backed
  // by change_requests_one_pending_per_entity). Find-then-update/insert rather
  // than a Postgres UPSERT so the person_id + timestamp are refreshed either way.
  const { data: existingPending } = await supabase
    .from('change_requests')
    .select('id')
    .eq('entity_type', 'scout')
    .eq('entity_id', scoutId)
    .eq('status', 'pending')
    .maybeSingle();

  // submitted_by_person_id is always null: the household-bound cookie
  // (lib/profile-household-session.ts) identifies a HOUSEHOLD, not a person —
  // deliberately, same trust model as D-027 (FAMILY_PASSWORD doesn't bind a
  // session to an individual). The FK to people exists for a future per-scout
  // magic-link phase (Phase 4, D-005) that would actually have a person_id to
  // put here; until then this column stays null rather than guessing one.
  const writeError = existingPending
    ? (
        await supabase
          .from('change_requests')
          .update({
            submitted_by_person_id: null,
            submitted_at: new Date().toISOString(),
            proposed_changes: changed
          })
          .eq('id', existingPending.id)
      ).error
    : (
        await supabase.from('change_requests').insert({
          entity_type: 'scout',
          entity_id: scoutId,
          submitted_by_person_id: null,
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
  // are reviewed in the Scout editor's diff panel, behind the leader gate.
  const { html, text } = renderEmail({
    heading: `Profile update — ${party.label}`,
    intro: `${party.label} submitted a demographic update for ${scoutId} through the website. Review it in the Scout editor before it takes effect.`,
    bullets: Object.keys(changed).map((field) => FIELD_LABEL[field as EditableScoutField] ?? field)
  });
  await sendEmail({
    to: [TROOP_EMAIL],
    subject: `Profile update pending review — ${party.label}`,
    html,
    text,
    confirm: true
  });

  revalidatePath(PROFILE_PATH);
  redirect(`${back}&submitted=1`);
}
