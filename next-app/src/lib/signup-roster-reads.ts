import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * One signup's slot claims and answers — scoped through the slot / entry
 * join so the read is bounded by the event, not by everything the troop has
 * ever signed up for. Shared by the admin Signup Roster and the Snapshot,
 * which both used to select the whole table and would have printed a roster
 * with rows missing once it passed PostgREST's 1,000-row cap
 * (Plans/Performance-Review-2026-08-27.md #4; tests/signup-roster-reads.test.ts).
 */

export interface SignupClaimRow {
  slot_id: number;
  signup_entry_id: number;
  comment: string | null;
}

export interface SignupAnswerRow {
  signup_entry_id: number;
  question_id: number;
  value: string | null;
}

export async function loadSignupClaims(supabase: SupabaseClient, signupId: number): Promise<SignupClaimRow[]> {
  const { data, error } = await supabase
    .from('signup_slot_claims')
    .select('slot_id, signup_entry_id, comment, signup_slots!inner(event_signup_id)')
    .eq('signup_slots.event_signup_id', signupId);
  if (error) throw new Error(`signup_slot_claims read failed: ${error.message}`);
  return ((data ?? []) as unknown as (SignupClaimRow & { signup_slots: unknown })[]).map(
    ({ slot_id, signup_entry_id, comment }) => ({ slot_id, signup_entry_id, comment })
  );
}

export async function loadSignupAnswers(supabase: SupabaseClient, signupId: number): Promise<SignupAnswerRow[]> {
  const { data, error } = await supabase
    .from('signup_answers')
    .select('signup_entry_id, question_id, value, signup_entries!inner(event_signup_id)')
    .eq('signup_entries.event_signup_id', signupId);
  if (error) throw new Error(`signup_answers read failed: ${error.message}`);
  return ((data ?? []) as unknown as (SignupAnswerRow & { signup_entries: unknown })[]).map(
    ({ signup_entry_id, question_id, value }) => ({ signup_entry_id, question_id, value })
  );
}
