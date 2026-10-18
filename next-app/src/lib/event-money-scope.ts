import type { SupabaseClient } from '@supabase/supabase-js';
import { moneyScopeFor } from '@/lib/buckets';

/** Server side of moneyScopeFor: look up the entry's bucket; callers apply `filter` with `.or(...)`. */
export async function moneyScope(supabase: SupabaseClient, calendarEntryId: number): Promise<{ filter: string; bucketId: number | null }> {
  const { data } = await supabase.from('calendar_entries').select('bucket_id').eq('id', calendarEntryId).maybeSingle();
  const raw = (data as { bucket_id: number | null } | null)?.bucket_id ?? null;
  const bucketId = raw != null ? Number(raw) : null;
  return { filter: moneyScopeFor(calendarEntryId, bucketId), bucketId };
}
