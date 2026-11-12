import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Signed-Off By choices for Fast Entry and Audits: every code that is not
 * retired (Plans/Sign-Off-Initials.md), people and sources alike, by code.
 * Display lookups that name OLD entries read every row instead.
 */
export async function loadSignOffChoices(supabase: SupabaseClient): Promise<{ code: string; name: string }[]> {
  const { data } = await supabase.from('leaders').select('code, name').is('retired_at', null).order('code');
  return (data ?? []) as { code: string; name: string }[];
}
