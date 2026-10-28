/**
 * Publish snapshot, server side (Plans/Meeting-Planner-III.md, Decision 5): the latest snapshot of a meeting, the
 * payload hash, and how many families a publish would email. Service-role client; callers gate.
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canonical, changedScouts, type SnapshotPayload } from '@/lib/plan-snapshot';

export function payloadHash(p: SnapshotPayload): string {
  return createHash('sha256').update(canonical(p)).digest('hex');
}

export interface LatestSnapshot {
  n: number;
  payload: SnapshotPayload;
  hash: string;
  publishedAt: string;
}

export async function loadLatestSnapshot(sb: SupabaseClient, entryId: number): Promise<LatestSnapshot | null> {
  const { data, error } = await sb
    .from('meeting_plan_snapshots')
    .select('n, payload, payload_hash, published_at')
    .eq('calendar_entry_id', entryId)
    .order('n', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const r = data as { n: number; payload: SnapshotPayload; payload_hash: string; published_at: string } | null;
  return r ? { n: r.n, payload: r.payload, hash: r.payload_hash, publishedAt: r.published_at } : null;
}

/** Households these scouts belong to: the "families" a publish emails. */
export async function countFamilies(sb: SupabaseClient, scoutPersonIds: readonly number[]): Promise<number> {
  if (!scoutPersonIds.length) return 0;
  const { data, error } = await sb.from('household_members').select('household_id').in('person_id', [...scoutPersonIds]);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { household_id: number }[]).map((r) => r.household_id)).size;
}

/** The publish bar's state for the page. */
export async function loadSnapshotState(sb: SupabaseClient, entryId: number, now: SnapshotPayload, scouts: readonly number[]) {
  const latest = await loadLatestSnapshot(sb, entryId);
  const hash = payloadHash(now);
  const changed = latest ? latest.hash !== hash : true;
  const [families, allFamilies] = await Promise.all([countFamilies(sb, latest && changed ? changedScouts(latest.payload, now, scouts) : latest ? [] : scouts), countFamilies(sb, scouts)]);
  return { n: latest?.n ?? null, publishedAt: latest?.publishedAt ?? null, changed: latest ? changed : false, families, allFamilies };
}
