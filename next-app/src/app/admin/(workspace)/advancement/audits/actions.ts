'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LEADER_COOKIE, verifySession } from '@/lib/leader-session';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * The Audits section's one write path, shared by every check: backfilling
 * requirement rows a leader confirms were actually completed but never
 * logged. Same ensureLeader()/createAdminClient() gate as every other
 * advancement actions file.
 */

interface Result {
  ok: boolean;
  error?: string;
  inserted: number;
}

interface MissingItem {
  code: string; // full ledger code, e.g. "tenderfoot-4a.3" or "second-class-1a"
  label: string;
}

async function ensureLeader() {
  const jar = await cookies();
  const session = await verifySession(jar.get(LEADER_COOKIE.name)?.value);
  if (!session) throw new Error('Not authenticated');
  return session;
}

export async function fillMissingRankRequirements(formData: FormData): Promise<Result> {
  let session;
  try {
    session = await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated', inserted: 0 };
  }

  const scoutId = String(formData.get('scout_id') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim();
  const by = String(formData.get('by') ?? '').trim();
  const itemsJson = String(formData.get('items') ?? '[]');

  if (!scoutId) return { ok: false, error: 'Missing scout', inserted: 0 };
  if (!date) return { ok: false, error: 'Date is required', inserted: 0 };
  if (!by) return { ok: false, error: 'Signed-Off By is required', inserted: 0 };

  let items: MissingItem[];
  try {
    items = JSON.parse(itemsJson) as MissingItem[];
  } catch {
    return { ok: false, error: 'Items payload was malformed', inserted: 0 };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Select at least one requirement to fill in', inserted: 0 };
  }

  const supabase = createAdminClient();
  const rows = items.map((it) => ({
    scout_id: scoutId,
    date,
    kind: 'rank_requirement' as const,
    code: it.code,
    label: it.label,
    by,
    entered_by: session.leader,
    entered_at: new Date().toISOString()
  }));

  const { error } = await supabase.from('ledger_entries').insert(rows);
  if (error) return { ok: false, error: error.message, inserted: 0 };

  revalidatePath('/admin/advancement/audits');
  revalidatePath('/admin/advancement/dashboard');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  revalidatePath(`/scouts/${scoutId}`);

  return { ok: true, inserted: rows.length };
}

interface ResolveResult {
  ok: boolean;
  error?: string;
  deleted: number;
}

/**
 * Duplicate-records fix: soft-deletes every row in a duplicate group except
 * the one the leader picked to keep — same audit trail (deleted_at/by/reason)
 * as a manual Universal Ledger delete, just applied to N-1 rows at once.
 */
export async function resolveDuplicateLedgerEntries(formData: FormData): Promise<ResolveResult> {
  let session;
  try {
    session = await ensureLeader();
  } catch {
    return { ok: false, error: 'Not authenticated', deleted: 0 };
  }

  const keepId = Number(formData.get('keep_id'));
  const scoutId = String(formData.get('scout_id') ?? '').trim();
  const deleteIdsJson = String(formData.get('delete_ids') ?? '[]');
  if (!Number.isFinite(keepId) || keepId <= 0) {
    return { ok: false, error: 'Invalid record to keep', deleted: 0 };
  }

  let deleteIds: number[];
  try {
    deleteIds = JSON.parse(deleteIdsJson) as number[];
  } catch {
    return { ok: false, error: 'Malformed request', deleted: 0 };
  }
  if (!Array.isArray(deleteIds) || deleteIds.length === 0) {
    return { ok: false, error: 'Nothing to delete', deleted: 0 };
  }

  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from('ledger_entries')
    .update(
      {
        deleted_at: new Date().toISOString(),
        deleted_by: session.leader,
        deleted_reason: `Duplicate — kept #${keepId} via Audits`
      },
      { count: 'exact' }
    )
    .in('id', deleteIds);
  if (error) return { ok: false, error: error.message, deleted: 0 };

  revalidatePath('/admin/advancement/audits');
  revalidatePath('/admin/advancement/dashboard');
  revalidatePath('/admin/advancement/ledger');
  revalidatePath('/admin/advancement/fast-entry');
  if (scoutId) revalidatePath(`/scouts/${scoutId}`);

  return { ok: true, deleted: count ?? deleteIds.length };
}
