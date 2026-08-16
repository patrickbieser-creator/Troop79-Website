'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import {
  expandBundle,
  isCapability,
  wouldOrphanCapability,
  CAPABILITY_LABEL,
  type Capability
} from '@/lib/capabilities';

/**
 * Access & Permissions mutations
 * (Plans/Unified-Identity-And-Capabilities.md Phase A, guard tightened in C).
 *
 * GUARD: requireCapability('roster.manage') — the last surface converted, on
 * purpose. It is the tool that hands out every other grant, so it should not
 * change hands until the rest of the admin is settled.
 *
 * Stated plainly: roster.manage lets its holder grant themselves anything
 * else. That is a real escalation path, but a small one — roster.manage
 * already exposes every family's address, birthdate, and medical-adjacent
 * notes, which is the most sensitive thing in the system, so the escalation
 * buys access to strictly less than the holder already has. If that stops
 * being acceptable, add an `access.manage` capability rather than relying on
 * nobody noticing.
 *
 * The last-holder guard below is what keeps this screen from locking itself
 * out now that it gates on a capability it can also revoke.
 */

function revalidateAccess() {
  revalidatePath('/admin/access');
}

function parsePersonId(formData: FormData): number {
  const raw = Number(formData.get('personId'));
  if (!Number.isInteger(raw) || raw <= 0) throw new Error('A valid person is required.');
  return raw;
}

/** Validate against the vocabulary rather than trusting the posted string —
 *  the DB check constraint would catch it anyway, but a 500 from a constraint
 *  violation is a worse error message than a refusal. */
function parseCapability(formData: FormData): Capability {
  const raw = String(formData.get('capability') ?? '');
  if (!isCapability(raw)) throw new Error(`Unknown capability: ${raw}`);
  return raw;
}

export async function grantCapabilityAction(formData: FormData): Promise<void> {
  const actor = await requireCapability('roster.manage');
  const personId = parsePersonId(formData);
  const capability = parseCapability(formData);
  const grantedBy = actor.personId;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('person_capabilities')
    .upsert({ person_id: personId, capability, granted_by: grantedBy }, { onConflict: 'person_id,capability' });
  if (error) throw new Error(`Could not grant ${capability}: ${error.message}`);
  revalidateAccess();
}

/**
 * Refuse to remove the LAST holder of a capability.
 *
 * Without this, one click on your own row can make a capability unheld by
 * anyone — and for the grants screen's own gate (roster.manage, from Phase B)
 * that is an unrecoverable lockout: nobody can reach this page to put it
 * back. Applies to every capability, not just roster.manage, because
 * "advancement.write is held by nobody" is a silent, confusing outage even
 * when it isn't a lockout.
 *
 * Deliberately a last-holder check rather than a don't-demote-yourself check:
 * two admins demoting each other in either order is the same dead end, and a
 * self-only guard would miss it.
 */
async function refuseIfLastHolder(
  supabase: ReturnType<typeof createAdminClient>,
  personId: number,
  capability: Capability
): Promise<void> {
  const { data, error } = await supabase
    .from('person_capabilities')
    .select('person_id')
    .eq('capability', capability);
  if (error) throw new Error(`Could not check ${capability} holders: ${error.message}`);

  const holders = ((data ?? []) as { person_id: number }[]).map((h) => h.person_id);
  if (wouldOrphanCapability(holders, personId)) {
    throw new Error(
      `${CAPABILITY_LABEL[capability]} would be held by nobody. Grant it to someone else first.`
    );
  }
}

export async function revokeCapabilityAction(formData: FormData): Promise<void> {
  await requireCapability('roster.manage');
  const personId = parsePersonId(formData);
  const capability = parseCapability(formData);

  const supabase = createAdminClient();
  await refuseIfLastHolder(supabase, personId, capability);
  const { error } = await supabase
    .from('person_capabilities')
    .delete()
    .eq('person_id', personId)
    .eq('capability', capability);
  if (error) throw new Error(`Could not revoke ${capability}: ${error.message}`);
  revalidateAccess();
}

/**
 * Apply a bundle. Writes FLAT rows and stores no reference to the bundle
 * itself — see the BUNDLES comment in lib/capabilities.ts. Additive by
 * design: applying a bundle never removes a grant the person already has,
 * because "apply Advancement Chair" should not silently strip someone's
 * news.write.
 */
export async function applyBundleAction(formData: FormData): Promise<void> {
  const actor = await requireCapability('roster.manage');
  const personId = parsePersonId(formData);
  const bundleKey = String(formData.get('bundle') ?? '');
  const capabilities = expandBundle(bundleKey);
  if (capabilities.length === 0) throw new Error(`Unknown bundle: ${bundleKey}`);
  const grantedBy = actor.personId;

  const supabase = createAdminClient();
  const { error } = await supabase.from('person_capabilities').upsert(
    capabilities.map((capability) => ({ person_id: personId, capability, granted_by: grantedBy })),
    { onConflict: 'person_id,capability' }
  );
  if (error) throw new Error(`Could not apply ${bundleKey}: ${error.message}`);
  revalidateAccess();
}

export async function revokeAllCapabilitiesAction(formData: FormData): Promise<void> {
  await requireCapability('roster.manage');
  const personId = parsePersonId(formData);

  const supabase = createAdminClient();
  // Same last-holder rule as a single revoke — "Clear grants" is the faster
  // way to cause the identical lockout, so it cannot be the looser path.
  const { data } = await supabase.from('person_capabilities').select('capability').eq('person_id', personId);
  for (const row of (data ?? []) as { capability: string }[]) {
    if (isCapability(row.capability)) await refuseIfLastHolder(supabase, personId, row.capability);
  }

  const { error } = await supabase.from('person_capabilities').delete().eq('person_id', personId);
  if (error) throw new Error(`Could not clear grants: ${error.message}`);
  revalidateAccess();
}

/**
 * Revoke every session this person holds by bumping people.session_epoch —
 * the practical answer to a lost phone, which the shared password cannot give
 * today. Takes effect on their next privileged action, with no sign-out
 * required: loadPersonAuthz() compares the live epoch against the one in
 * their cookie.
 */
export async function revokeSessionsAction(formData: FormData): Promise<void> {
  await requireCapability('roster.manage');
  const personId = parsePersonId(formData);

  const supabase = createAdminClient();
  const { data, error: readErr } = await supabase
    .from('people')
    .select('session_epoch')
    .eq('id', personId)
    .maybeSingle();
  if (readErr || !data) throw new Error(`Could not read that person: ${readErr?.message ?? 'not found'}`);

  const next = ((data as { session_epoch: number }).session_epoch ?? 0) + 1;
  const { error } = await supabase.from('people').update({ session_epoch: next }).eq('id', personId);
  if (error) throw new Error(`Could not revoke sessions: ${error.message}`);
  revalidateAccess();
}
