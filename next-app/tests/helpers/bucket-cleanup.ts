import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Since buckets (Plans/Buckets-Lookup.md), inserting a ledger row with a new label creates a bucket (the sync
 * trigger). Tests that write labels clean those up with this: only buckets created after `before` was taken
 * AND now empty (no rows, no calendar entry) are deleted — never a bucket the local production mirror had,
 * and never one another test file is still using. Test-owned ids only (db-test-fixture hygiene).
 */
export async function bucketIdsNow(admin: SupabaseClient): Promise<Set<number>> {
  const { data } = await admin.from('buckets').select('id');
  return new Set(((data ?? []) as { id: number }[]).map((b) => Number(b.id)));
}

export async function deleteNewEmptyBuckets(admin: SupabaseClient, before: ReadonlySet<number>): Promise<void> {
  const { data } = await admin.from('buckets').select('id');
  const fresh = ((data ?? []) as { id: number }[]).map((b) => Number(b.id)).filter((id) => !before.has(id));
  for (const id of fresh) {
    const [{ count: rows }, { count: entries }] = await Promise.all([
      admin.from('financial_transactions').select('id', { count: 'exact', head: true }).eq('bucket_id', id),
      admin.from('calendar_entries').select('id', { count: 'exact', head: true }).eq('bucket_id', id)
    ]);
    if ((rows ?? 0) === 0 && (entries ?? 0) === 0) await admin.from('buckets').delete().eq('id', id);
  }
}
