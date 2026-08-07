'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';
import { EDITABLE_SCOUT_FIELDS, type ChangeRequestRow, type EditableScoutField } from '@/lib/change-requests';

/**
 * Leader-side review for family-submitted change requests
 * (Plans/Scout-Self-Service-Demographics.md). Nothing a family submits from
 * /profile touches the live `scouts` row until approveChangeRequest runs it.
 */

interface Result {
  ok: boolean;
  error?: string;
}

export type ChangeRequestWithSubmitter = ChangeRequestRow & { submittedByName: string | null };

export async function getPendingChangeRequest(scoutId: string): Promise<ChangeRequestWithSubmitter | null> {
  await requireRole(['leader']);
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('change_requests')
    .select('*')
    .eq('entity_type', 'scout')
    .eq('entity_id', scoutId)
    .eq('status', 'pending')
    .maybeSingle();
  const row = (data as ChangeRequestRow | null) ?? null;
  if (!row) return null;

  // submitted_by_person_id is only populated for a verified Tier 2 submitter
  // (Plans/Family-Identity-Auth.md Phase 2) — null for anything submitted
  // before that shipped, which the panel shows as "someone signed in via the
  // shared troop password" rather than a name it doesn't have.
  let submittedByName: string | null = null;
  if (row.submitted_by_person_id != null) {
    const { data: person } = await supabase
      .from('people')
      .select('display_name')
      .eq('id', row.submitted_by_person_id)
      .maybeSingle();
    submittedByName = (person as { display_name: string } | null)?.display_name ?? null;
  }
  return { ...row, submittedByName };
}

export async function approveChangeRequest(id: number): Promise<Result> {
  const session = await requireRole(['leader']);
  const supabase = createAdminClient();

  const { data: request, error: fetchErr } = await supabase
    .from('change_requests')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .single();
  if (fetchErr || !request) {
    return { ok: false, error: fetchErr?.message ?? 'Request not found or already reviewed.' };
  }
  const row = request as ChangeRequestRow;

  if (row.entity_type === 'scout') {
    // Re-filter through the allowlist here, at the privileged apply step —
    // not just trusting that the write side (submitChangeRequestAction)
    // already allowlisted it. proposed_changes is jsonb read back from the
    // DB; this is the code that actually mutates scouts with service-role
    // privileges, so it shouldn't blindly trust a key set it didn't produce
    // (qa-lead review, 2026-07-21).
    const allowed: Partial<Record<EditableScoutField, unknown>> = {};
    for (const field of EDITABLE_SCOUT_FIELDS) {
      if (field in row.proposed_changes) allowed[field] = row.proposed_changes[field];
    }
    const { error: updErr } = await supabase.from('scouts').update(allowed).eq('id', row.entity_id);
    if (updErr) return { ok: false, error: updErr.message };
  }

  const { error } = await supabase
    .from('change_requests')
    .update({ status: 'approved', reviewed_by: session.leader, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/advancement/roster');
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/advancement');
  return { ok: true };
}

export async function rejectChangeRequest(id: number, reason: string): Promise<Result> {
  const session = await requireRole(['leader']);
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('change_requests')
    .update({
      status: 'rejected',
      reviewed_by: session.leader,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason.trim() || null
    })
    .eq('id', id)
    .eq('status', 'pending');
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/advancement/roster');
  return { ok: true };
}
