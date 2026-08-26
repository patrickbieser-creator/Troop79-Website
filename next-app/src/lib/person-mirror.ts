import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Keep the people spine in step with the roster forms.
 *
 * `scouts` and `leaders` still carry their own demographic columns (email,
 * phone, address, birthdate…) from before the spine existed; the spine was
 * bootstrapped from them once (20260720100000) and nothing synced after. The
 * scout/leader Edit forms kept writing their own table while sign-in, the
 * household pickers and every identity path read `people.*` — so a leader
 * changing a scout's email in the roster changed nothing the sign-in screen
 * could see (found live 2026-08-26).
 *
 * Until the duplicate columns are retired (see the people-model audit), every
 * roster save calls this with the fields it just wrote. `people` is the truth
 * the app reads; the roster columns are the form's cache of it. Only the keys
 * present in `fields` are written — an absent key leaves the person's value
 * alone, an explicit null clears it.
 */
export interface RosterMirrorFields {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
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

const COLUMN: Record<keyof RosterMirrorFields, string> = {
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'primary_email',
  phone: 'primary_phone',
  address_line1: 'address_line1',
  address_line2: 'address_line2',
  city: 'city',
  state: 'state',
  zip: 'zip',
  birthdate: 'birthdate',
  gender: 'gender',
  bsa_member_id: 'bsa_member_id',
  health_form_date: 'health_form_date',
  things_we_should_know: 'things_we_should_know',
  ypt_completed: 'ypt_completed'
};

export async function mirrorRosterFieldsToPerson(
  supabase: SupabaseClient,
  personId: number | null | undefined,
  fields: RosterMirrorFields
): Promise<void> {
  if (!personId) return;
  const patch: Record<string, string | null> = {};
  for (const key of Object.keys(fields) as (keyof RosterMirrorFields)[]) {
    const v = fields[key];
    if (v === undefined) continue;
    const trimmed = typeof v === 'string' ? v.trim() : v;
    patch[COLUMN[key]] = trimmed === '' ? null : key === 'email' && trimmed ? trimmed.toLowerCase() : trimmed;
  }
  if (fields.first_name !== undefined || fields.last_name !== undefined) {
    const first = fields.first_name?.trim() ?? null;
    const last = fields.last_name?.trim() ?? null;
    if (first && last) patch.display_name = `${first} ${last}`;
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('people').update(patch).eq('id', personId);
  if (error) throw new Error(`people mirror failed: ${error.message}`);
}
