import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The one writer for a human's contact/demographic facts on `people`
 * (Plans/Retire-Roster-Contact-Columns.md). `scouts` and `leaders` used to
 * carry their own copies of these fields, edited by two different forms that
 * drifted from what sign-in, the printed roster and the identity spine
 * actually read (found live 2026-08-26 — a scout's email changed in the
 * roster never reached sign-in). Every editor — the scout form, the adult
 * editor — now calls this one function so there is exactly one place that
 * writes these facts, however many screens propose them.
 *
 * Only the keys present in `fields` are written — an absent key leaves the
 * person's stored value alone, an explicit `null` clears it. Callers pass
 * already-normalised values (trimmed, '' turned to null, email lower-cased);
 * this function does not re-normalise, so two editors with different
 * normalisation rules can't silently disagree on what "empty" means.
 */
export interface PersonDemographicsFields {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  primary_email?: string | null;
  primary_phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  bsa_member_id?: string | null;
  health_form_date?: string | null;
  things_we_should_know?: string | null;
  ypt_completed?: string | null;
}

export interface WriteResult {
  error: string | null;
}

export async function writePersonDemographics(
  supabase: SupabaseClient,
  personId: number,
  fields: PersonDemographicsFields
): Promise<WriteResult> {
  const patch: Record<string, unknown> = { ...fields };
  if (Object.keys(patch).length === 0) return { error: null };
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase.from('people').update(patch).eq('id', personId);
  return { error: error?.message ?? null };
}
