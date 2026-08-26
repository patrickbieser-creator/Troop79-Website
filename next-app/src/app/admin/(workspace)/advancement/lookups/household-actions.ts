'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Household management.
 *
 * Households were previously only reachable through a person — you could rename
 * one only by opening somebody who already belonged to it, and could not see
 * the empty ones at all. That is how production ended up with two "Stollenwerk"
 * households, two "Haslam" and two "Pasquesi", one of each holding nobody, with
 * no screen that would show you.
 *
 * Membership is still edited on the person, which is the right place: a
 * household is a thing people belong to, not a container you fill. This manages
 * the households themselves.
 */

const PATHS = ['/admin/advancement/lookups', '/admin/advancement/roster'];

interface Result {
  ok: boolean;
  error?: string;
}

function revalidate() {
  for (const p of PATHS) revalidatePath(p);
}

export async function createHousehold(label: string): Promise<Result> {
  await requireCapability('roster.manage');
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: 'Give the household a name.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('households').insert({ label: trimmed });
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/**
 * Labels are deliberately NOT unique. Two Johnson families genuinely share a
 * surname, and refusing the second would be wrong — so the answer to telling
 * them apart is naming them usefully ("Johnson (Elm St)") and showing who is in
 * each, not constraining what they may be called.
 */
export async function renameHousehold(id: number, label: string): Promise<Result> {
  await requireCapability('roster.manage');
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: 'A household needs a name.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('households')
    .update({ label: trimmed, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}

/**
 * Delete a household, refusing while anything still points at it.
 *
 * household_members is the one join that matters now: `scouts.household_id`
 * was retired (Plans/Retire-Roster-Contact-Columns.md) — every scout that
 * legacy column ever pointed at already has a household_members row of its
 * own (backfilled 20260720130000), so that membership check alone covers
 * scouts and adults both. signup_entries.household_id records which family
 * submitted a signup and must never lose that.
 */
export async function deleteHousehold(id: number): Promise<Result> {
  await requireCapability('roster.manage');
  const supabase = createAdminClient();

  const [memberRes, signupRes] = await Promise.all([
    supabase.from('household_members').select('person_id').eq('household_id', id).limit(1),
    supabase.from('signup_entries').select('id').eq('household_id', id).limit(1)
  ]);

  const blockers: string[] = [];
  if (memberRes.data?.length) blockers.push('people in it');
  if (signupRes.data?.length) blockers.push('an event signup recorded against it');

  if (blockers.length > 0) {
    return {
      ok: false,
      error:
        `Cannot delete — this household has ${blockers.join(', ')}. ` +
        `Move them out first, on each person's record.`
    };
  }

  const { error } = await supabase.from('households').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true };
}
