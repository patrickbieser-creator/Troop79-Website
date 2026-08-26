'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import {
  editableFieldsFor,
  SCOUT_FIELD_TABLE,
  SCOUT_FIELD_PEOPLE_COLUMN,
  type ChangeEntityType,
  type ChangeRequestRow,
  type EditableScoutField,
  type FieldValue
} from '@/lib/change-requests';

/**
 * Leader-side review for family-submitted change requests
 * (Plans/Scout-Self-Service-Demographics.md). Nothing a family submits from
 * /profile touches the live record until approveChangeRequest runs it.
 *
 * Two entity types now: 'adult' applies straight to the `people` spine;
 * 'scout' splits across `scouts` (school/grade/swim class) and the scout's
 * linked person row (everything else) — SCOUT_FIELD_TABLE
 * (Plans/Retire-Roster-Contact-Columns.md) says which field goes where.
 */

interface Result {
  ok: boolean;
  error?: string;
}

export type ChangeRequestWithSubmitter = ChangeRequestRow & { submittedByName: string | null };

export async function getPendingChangeRequest(
  entityId: string,
  entityType: ChangeEntityType = 'scout'
): Promise<ChangeRequestWithSubmitter | null> {
  await requireCapability('roster.manage');
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('change_requests')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
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
  const session = await requireCapability('roster.manage');
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
  const entityType = row.entity_type as ChangeEntityType;

  // Re-filter through the allowlist here, at the privileged apply step — not
  // just trusting that the write side already allowlisted it. proposed_changes
  // is jsonb read back from the DB; this is the code that actually mutates the
  // record with service-role privileges, so it shouldn't blindly trust a key
  // set it didn't produce (qa-lead review, 2026-07-21).
  const allowed: Record<string, FieldValue> = {};
  for (const field of editableFieldsFor(entityType)) {
    if (field in row.proposed_changes) allowed[field] = row.proposed_changes[field];
  }

  if (entityType === 'adult' && Object.keys(allowed).length > 0) {
    // people.id is an int — cast so PostgREST filters on the column's real
    // type rather than a stringified id.
    const { error: updErr } = await supabase.from('people').update(allowed).eq('id', Number(row.entity_id));
    if (updErr) return { ok: false, error: updErr.message };
  }

  if (entityType === 'scout' && Object.keys(allowed).length > 0) {
    const scoutPatch: Record<string, FieldValue> = {};
    const personPatch: Record<string, FieldValue> = {};
    for (const [field, value] of Object.entries(allowed)) {
      const f = field as EditableScoutField;
      if (SCOUT_FIELD_TABLE[f] === 'scouts') scoutPatch[field] = value;
      else personPatch[SCOUT_FIELD_PEOPLE_COLUMN[f] ?? field] = value;
    }
    if (Object.keys(scoutPatch).length > 0) {
      const { error: updErr } = await supabase.from('scouts').update(scoutPatch).eq('id', row.entity_id);
      if (updErr) return { ok: false, error: updErr.message };
    }
    if (Object.keys(personPatch).length > 0) {
      const { data: scoutRow, error: scoutErr } = await supabase
        .from('scouts')
        .select('person_id')
        .eq('id', row.entity_id)
        .maybeSingle();
      if (scoutErr) return { ok: false, error: scoutErr.message };
      const personId = (scoutRow as { person_id: number | null } | null)?.person_id ?? null;
      if (personId == null) {
        return { ok: false, error: 'This scout has no linked person record — cannot apply contact changes.' };
      }
      const { error: updErr } = await supabase.from('people').update(personPatch).eq('id', personId);
      if (updErr) return { ok: false, error: updErr.message };
    }
  }

  const { error } = await supabase
    .from('change_requests')
    .update({ status: 'approved', reviewed_by: session.label, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/advancement/roster');
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/advancement');
  return { ok: true };
}

export async function rejectChangeRequest(id: number, reason: string): Promise<Result> {
  const session = await requireCapability('roster.manage');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('change_requests')
    .update({
      status: 'rejected',
      reviewed_by: session.label,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason.trim() || null
    })
    .eq('id', id)
    .eq('status', 'pending');
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/advancement/roster');
  return { ok: true };
}
