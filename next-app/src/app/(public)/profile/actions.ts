'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { requireHouseholdIdentity } from '@/lib/family-access';
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

/**
 * Submit (or overwrite) a proposed demographic update for one scout.
 *
 * Requires Tier 2 (Plans/Family-Identity-Auth.md Phase 2) — /profile no
 * longer has a self-asserted household picker; requireHouseholdIdentity()
 * throws for anything short of a verified adult session, and the household
 * a submission can target is resolved from THAT session's householdKey, not
 * a form field or cookie a visitor could pick for themselves.
 *
 * Nothing here touches the live `scouts` row — it lands as a 'pending'
 * change_requests row and only applies once a leader approves it from the
 * Scout editor (Plans/Scout-Self-Service-Demographics.md).
 */
export async function submitChangeRequestAction(formData: FormData): Promise<void> {
  let session;
  try {
    session = await requireHouseholdIdentity();
  } catch {
    redirect(`${PROFILE_PATH}?err=${encodeURIComponent('Please sign in again.')}`);
    return;
  }

  const scoutId = String(formData.get('scoutId') ?? '');
  const back = `${PROFILE_PATH}?scout=${encodeURIComponent(scoutId)}`;

  // Resolve the party server-side from the VERIFIED session's household key —
  // never a form field or self-asserted cookie (same reasoning as
  // cancelSignupAction in events/[id]/actions.ts, now on a stronger footing:
  // this household came from a challenge/code redemption, not a self-pick).
  const party = await loadHouseholdByKey(session.householdKey);
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

  // submitted_by_person_id is now populated (Plans/Family-Identity-Auth.md
  // Phase 2) — session.personId comes from a verified challenge redemption,
  // not a guess. The admin review panel shows this name.
  const writeError = existingPending
    ? (
        await supabase
          .from('change_requests')
          .update({
            submitted_by_person_id: session.personId,
            submitted_at: new Date().toISOString(),
            proposed_changes: changed
          })
          .eq('id', existingPending.id)
      ).error
    : (
        await supabase.from('change_requests').insert({
          entity_type: 'scout',
          entity_id: scoutId,
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
  // are reviewed in the Scout editor's diff panel, behind the leader gate.
  const { html, text } = renderEmail({
    heading: `Profile update — ${party.label}`,
    intro: `${session.displayName} (${party.label} household) submitted a demographic update for ${scoutId} through the website. Review it in the Scout editor before it takes effect.`,
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
