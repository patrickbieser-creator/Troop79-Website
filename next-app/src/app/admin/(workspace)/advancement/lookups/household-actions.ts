'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
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
  await requireRole(['leader']);
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
  await requireRole(['leader']);
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
 * scouts.household_id is the one that matters: it is a legacy column the signup
 * flow still reads, and it is ON DELETE SET NULL, so removing a household out
 * from under a scout would silently blank their household rather than fail.
 * signup_entries.household_id records which family submitted a signup and must
 * never lose that.
 */
export async function deleteHousehold(id: number): Promise<Result> {
  await requireRole(['leader']);
  const supabase = createAdminClient();

  const [memberRes, scoutRes, signupRes] = await Promise.all([
    supabase.from('household_members').select('person_id').eq('household_id', id).limit(1),
    supabase.from('scouts').select('id').eq('household_id', id).limit(1),
    supabase.from('signup_entries').select('id').eq('household_id', id).limit(1)
  ]);

  const blockers: string[] = [];
  if (memberRes.data?.length) blockers.push('people in it');
  if (scoutRes.data?.length) blockers.push(`a scout still assigned to it (${scoutRes.data[0].id})`);
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
