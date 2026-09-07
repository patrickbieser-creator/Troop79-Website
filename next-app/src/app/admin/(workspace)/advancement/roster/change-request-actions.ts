'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { recordAudit, type AuditDetail } from '@/lib/audit';
import { fmtDate } from '@/lib/format-date';
import {
  editableFieldsFor,
  fieldLabel,
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

/** A field's value as the record page's History shows it (Phase 4). */
function shown(value: unknown): string {
  if (value == null || value === '') return '—';
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDate(s) : s;
}

/** Whose record this request edits — a people.id, so the person's History
 *  finds the approve/reject rows (they are keyed on the request id). */
async function subjectPersonId(
  supabase: ReturnType<typeof createAdminClient>,
  row: ChangeRequestRow
): Promise<number | null> {
  if (row.entity_type === 'scout') {
    const { data } = await supabase.from('scouts').select('person_id').eq('id', row.entity_id).maybeSingle();
    return (data as { person_id: number | null } | null)?.person_id ?? null;
  }
  return /^\d+$/.test(row.entity_id) ? Number(row.entity_id) : null;
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

  // Read before write: the audit row's details carry each field's from→to
  // (the summary names fields only, D-257).
  const before: Record<string, unknown> = {};

  if (entityType === 'adult' && Object.keys(allowed).length > 0) {
    const { data: was } = await supabase
      .from('people')
      .select(Object.keys(allowed).join(', '))
      .eq('id', Number(row.entity_id))
      .maybeSingle();
    Object.assign(before, (was ?? {}) as Record<string, unknown>);
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
      const { data: was } = await supabase
        .from('scouts')
        .select(Object.keys(scoutPatch).join(', '))
        .eq('id', row.entity_id)
        .maybeSingle();
      Object.assign(before, (was ?? {}) as Record<string, unknown>);
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
      const { data: was } = await supabase
        .from('people')
        .select(Object.keys(personPatch).join(', '))
        .eq('id', personId)
        .maybeSingle();
      // Keyed back by the request's field name, so the diff below lines up.
      for (const [field, column] of Object.entries(SCOUT_FIELD_PEOPLE_COLUMN)) {
        if (column && !(field in personPatch) && column in personPatch) {
          before[field] = ((was ?? {}) as Record<string, unknown>)[column];
        }
      }
      for (const field of Object.keys(personPatch)) {
        if (!(field in before)) before[field] = ((was ?? {}) as Record<string, unknown>)[field];
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

  const details: AuditDetail[] = Object.entries(allowed).map(([field, value]) => ({
    field: fieldLabel(entityType, field),
    from: shown(before[field]),
    to: shown(value)
  }));
  if (details.length === 0) {
    // A notice ('adult_added') applies nothing — acknowledging it is the change.
    details.push({ field: 'Family notice', from: 'waiting for review', to: 'acknowledged' });
  }
  const subject = await subjectPersonId(supabase, row);
  await recordAudit({
    area: 'roster',
    action: 'approve',
    entityType: 'change_request',
    entityId: id,
    subjects: subject == null ? undefined : [subject],
    summary: `Approved ${entityType} change request #${id} (entity ${row.entity_id}): ${
      Object.keys(allowed).join(', ') || 'no fields'
    }`,
    details
  });

  revalidatePath('/admin/advancement/roster');
  revalidatePath('/admin/advancement/lookups');
  revalidatePath('/advancement');
  return { ok: true };
}

export async function rejectChangeRequest(id: number, reason: string): Promise<Result> {
  const session = await requireCapability('roster.manage');
  const supabase = createAdminClient();
  const { data: request } = await supabase.from('change_requests').select('*').eq('id', id).maybeSingle();
  const row = (request as ChangeRequestRow | null) ?? null;
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

  const subject = row ? await subjectPersonId(supabase, row) : null;
  const proposed = row ? Object.keys(row.proposed_changes).map((f) => fieldLabel(row.entity_type as ChangeEntityType, f)) : [];
  await recordAudit({
    area: 'roster',
    action: 'reject',
    entityType: 'change_request',
    entityId: id,
    subjects: subject == null ? undefined : [subject],
    summary: `Rejected change request #${id}${reason.trim() ? `: ${reason.trim()}` : ''}`,
    details: [
      { field: `Request #${id}`, from: proposed.length ? `pending (${proposed.join(', ')})` : 'pending', to: 'rejected' },
      { field: 'Reason', from: '—', to: reason.trim() || '—' }
    ]
  });

  revalidatePath('/admin/advancement/roster');
  return { ok: true };
}
