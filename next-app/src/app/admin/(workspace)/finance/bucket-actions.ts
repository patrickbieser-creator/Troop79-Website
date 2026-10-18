'use server';

/**
 * Buckets — the managed money themes (Plans/Buckets-Lookup.md, Release 1). Rows and calendar entries point
 * at a bucket by id; until Release 2 the database keeps activity_label in step (sync trigger), so every
 * label reader keeps working. Pure picker helpers: lib/buckets.ts.
 */

import { revalidatePath } from 'next/cache';
import { requireAnyOf, requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { bucketKey, type Bucket } from '@/lib/buckets';

type Result = { ok: boolean; error?: string };

function revalidateBuckets() {
  revalidatePath('/admin/finance');
  revalidatePath('/admin/finance/report');
}

/** Every bucket for a picker, with whether an event points at it and when it was last used. */
export async function listBucketsAction(): Promise<Bucket[]> {
  await requireAnyOf(['finance.manage', 'finance.view', 'calendar.write']);
  const { data, error } = await createAdminClient().rpc('bucket_list');
  if (error) throw new Error(`listBucketsAction failed: ${error.message}`);
  return ((data ?? []) as { id: number; name: string; is_event: boolean; last_used: string | null }[]).map((r) => ({
    id: Number(r.id),
    name: r.name,
    isEvent: r.is_event,
    lastUsed: r.last_used
  }));
}

/** The second confirmation of "+ New bucket…" lands here. Same gate as recording event money. */
export async function createBucketAction(name: string): Promise<Result & { bucket?: Bucket }> {
  const actor = await requireAnyOf(['finance.manage', 'calendar.write']);
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, error: 'A bucket needs a name.' };
  const { data, error } = await createAdminClient()
    .from('buckets')
    .insert({ name: clean, created_by_person_id: actor.personId })
    .select('id, name')
    .single();
  if (error) {
    return { ok: false, error: error.code === '23505' ? `A bucket named "${clean}" already exists — pick it instead.` : error.message };
  }
  revalidateBuckets();
  return { ok: true, bucket: { id: Number(data.id), name: data.name as string, isEvent: false, lastUsed: null } };
}

export interface RenameBucketPreview {
  affectedCount: number;
  /** Set when the new name already belongs to another bucket — applying merges into it. */
  mergesInto: { id: number; name: string } | null;
}

async function bucketNamed(supabase: ReturnType<typeof createAdminClient>, name: string, notId: number) {
  const { data } = await supabase.rpc('bucket_list');
  const hit = ((data ?? []) as { id: number; name: string }[]).find((b) => Number(b.id) !== notId && bucketKey(b.name) === bucketKey(name));
  return hit ? { id: Number(hit.id), name: hit.name } : null;
}

export async function previewRenameBucketAction(bucketId: number, newName: string): Promise<RenameBucketPreview> {
  await requireCapability('finance.manage');
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from('financial_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('bucket_id', bucketId);
  if (error) throw new Error(`previewRenameBucketAction failed: ${error.message}`);
  return { affectedCount: count ?? 0, mergesInto: newName.trim() ? await bucketNamed(supabase, newName, bucketId) : null };
}

/** Rename a bucket (its rows follow — buckets_relabel_rows), or merge it into the bucket that already has
 *  the new name (merge_buckets: rows and calendar entries move, the source is deleted, one transaction). */
export async function renameBucketAction(bucketId: number, newName: string): Promise<Result & { affectedCount?: number; merged?: boolean }> {
  await requireCapability('finance.manage');
  const clean = newName.trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, error: 'Both a bucket and a new name are required.' };
  const supabase = createAdminClient();
  const { data: current } = await supabase.from('buckets').select('name').eq('id', bucketId).maybeSingle();
  if (!current) return { ok: false, error: 'Bucket not found.' };
  if ((current as { name: string }).name === clean) return { ok: false, error: 'That is already its name.' };

  const target = await bucketNamed(supabase, clean, bucketId);
  if (target) {
    const { data, error } = await supabase.rpc('merge_buckets', { p_from: bucketId, p_into: target.id });
    if (error) return { ok: false, error: error.message };
    revalidateBuckets();
    return { ok: true, affectedCount: Number(data ?? 0), merged: true };
  }
  const { count } = await supabase.from('financial_transactions').select('id', { count: 'exact', head: true }).eq('bucket_id', bucketId);
  const { error } = await supabase.from('buckets').update({ name: clean }).eq('id', bucketId);
  if (error) return { ok: false, error: error.message };
  revalidateBuckets();
  return { ok: true, affectedCount: count ?? 0, merged: false };
}

/** Put an event in a bucket — from its Money tab, takes effect at once. The event's own linked rows (its
 *  fees, an expense recorded against it) move into the bucket too: they are this event's money. Clearing
 *  the bucket leaves every row where it is. */
export async function setEventBucketAction(calendarEntryId: number, bucketId: number | null): Promise<Result & { moved?: number }> {
  await requireAnyOf(['calendar.write', 'finance.manage']);
  const supabase = createAdminClient();
  const { error } = await supabase.from('calendar_entries').update({ bucket_id: bucketId }).eq('id', calendarEntryId);
  if (error) return { ok: false, error: error.message };
  let moved = 0;
  if (bucketId != null) {
    const { data, error: moveError } = await supabase
      .from('financial_transactions')
      .update({ bucket_id: bucketId })
      .eq('calendar_entry_id', calendarEntryId)
      .or(`bucket_id.is.null,bucket_id.neq.${bucketId}`)
      .select('id');
    if (moveError) return { ok: false, error: moveError.message };
    moved = data?.length ?? 0;
  }
  revalidateBuckets();
  revalidatePath('/admin/rosters', 'layout');
  return { ok: true, moved };
}
