'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/require-role';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Roster Import review write paths.
 *
 * THE RULE THIS FILE ENFORCES: a suggestion is a proposal until a leader
 * accepts it. Nothing in the matcher, and nothing on page load, writes to
 * people / scouts / leaders / scout_parents. Every mutation below is the
 * direct result of an explicit click.
 *
 * Field values are applied per-field from what the reviewer chose. The source
 * file is known to contain stale values, so there is no "newer wins" default
 * anywhere in here — a conflict that was never decided is left alone.
 */

const PATH = '/admin/advancement/roster-import';

interface Result {
  ok: boolean;
  error?: string;
}

/** Fields a reviewer may push from an import row onto a person. */
const APPLIABLE = new Set([
  'display_name',
  'primary_email',
  'primary_phone',
  'bsa_member_id',
  'birthdate',
  'gender'
]);

/** What the reviewer may choose in the UI. 'child_of' is an input phrasing
 *  only — it is normalised to a parent_of edge before storage, so the four
 *  canonical types in the database constraint are unchanged. */
export type RelationshipInput =
  | 'parent_of'
  | 'child_of'
  | 'guardian_of'
  | 'sibling_of'
  | 'emergency_contact_for';

interface FieldChange {
  field: string;
  csv_value: string;
  db_value: string;
  kind: 'fill' | 'conflict' | 'same';
}

/**
 * Accept a suggestion: link the source row to the person and apply whichever
 * field values the reviewer chose to take from the CSV.
 *
 * `chosenFields` lists ONLY the fields to overwrite with the CSV value.
 * Anything omitted keeps its stored value — including conflicts, which is the
 * safe direction when a reviewer skims past one.
 */
export async function acceptSuggestion(
  suggestionId: number,
  chosenFields: string[],
  note?: string
): Promise<Result> {
  const session = await requireRole(['leader']);

  const supabase = createAdminClient();

  // One transaction in Postgres, not two round-trips. Patching `people` and
  // recording the decision must both happen or neither: a failure between them
  // used to leave a person record already changed while the UI reported failure
  // and the row still read as pending.
  const { error } = await supabase.rpc('accept_merge_suggestion', {
    p_suggestion_id: suggestionId,
    p_fields: chosenFields.filter((f) => APPLIABLE.has(f)),
    p_decided_by: session.leader,
    p_note: note ?? null
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function rejectSuggestion(suggestionId: number, note?: string): Promise<Result> {
  const session = await requireRole(['leader']);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('merge_suggestions')
    .update({
      status: 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: session.leader,
      decision_note: note || null
    })
    .eq('id', suggestionId)
    .eq('status', 'pending');
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Point a source row at a person the matcher did not propose.
 *
 * Required because the matcher errs toward "new person" by design, and cannot
 * see its own false negatives: the roster's "Summer Curtis" is stored as
 * "Summer Kimble" — a surname change no exact rule links. Without this, the
 * only available action would be to create a second record for a person who is
 * already in the system, which is the exact outcome this whole effort exists
 * to prevent.
 */
export async function retargetRow(importRowId: number, personId: number): Promise<Result> {
  const session = await requireRole(['leader']);

  const supabase = createAdminClient();

  const { data: row, error: rowErr } = await supabase
    .from('import_rows')
    .select('id, display_name, email, phone, bsa_member_id, birthdate, gender')
    .eq('id', importRowId)
    .single();
  if (rowErr || !row) return { ok: false, error: 'Import row not found.' };

  const { data: person, error: pErr } = await supabase
    .from('people')
    .select('id, display_name, primary_email, primary_phone, bsa_member_id, birthdate, gender')
    .eq('id', personId)
    .single();
  if (pErr || !person) return { ok: false, error: 'Person not found.' };

  const pairs: [string, string, string][] = [
    ['display_name', row.display_name ?? '', person.display_name ?? ''],
    ['primary_email', row.email ?? '', person.primary_email ?? ''],
    ['primary_phone', row.phone ?? '', person.primary_phone ?? ''],
    ['bsa_member_id', row.bsa_member_id ?? '', person.bsa_member_id ?? ''],
    ['birthdate', row.birthdate ?? '', person.birthdate ?? ''],
    ['gender', row.gender ?? '', person.gender ?? '']
  ];
  const field_changes: FieldChange[] = pairs
    .filter(([, csv]) => csv.trim() !== '')
    .map(([field, csv, db]) => ({
      field,
      csv_value: csv,
      db_value: db,
      kind: !db.trim()
        ? 'fill'
        : csv.trim().toLowerCase() === db.trim().toLowerCase()
          ? 'same'
          : 'conflict'
    }));

  // Park any pending machine suggestions for this row; the reviewer has spoken.
  await supabase
    .from('merge_suggestions')
    .update({ status: 'superseded' })
    .eq('import_row_id', importRowId)
    .eq('status', 'pending');

  const { error: insErr } = await supabase.from('merge_suggestions').upsert(
    {
      import_row_id: importRowId,
      person_id: personId,
      confidence: 'manual',
      evidence: { matched_on: 'manual', chosen_by: session.leader },
      field_changes,
      status: 'pending'
    },
    { onConflict: 'import_row_id,person_id' }
  );
  if (insErr) return { ok: false, error: `Retargeting: ${insErr.message}` };

  revalidatePath(PATH);
  return { ok: true };
}

/** Create a brand-new person from a source row, and accept that as its resolution. */
export async function createPersonFromRow(importRowId: number): Promise<Result> {
  const session = await requireRole(['leader']);

  const supabase = createAdminClient();

  const { data: row, error: rowErr } = await supabase
    .from('import_rows')
    .select('id, first_name, last_name, display_name, email, phone, bsa_member_id, birthdate, gender')
    .eq('id', importRowId)
    .single();
  if (rowErr || !row) return { ok: false, error: 'Import row not found.' };

  const { data: person, error: insErr } = await supabase
    .from('people')
    .insert({
      first_name: row.first_name,
      last_name: row.last_name,
      display_name: row.display_name,
      primary_email: row.email,
      primary_phone: row.phone,
      bsa_member_id: row.bsa_member_id,
      birthdate: row.birthdate,
      gender: row.gender
    })
    .select('id')
    .single();
  if (insErr || !person) return { ok: false, error: `Creating person: ${insErr?.message}` };

  await supabase
    .from('merge_suggestions')
    .update({ status: 'superseded' })
    .eq('import_row_id', importRowId)
    .eq('status', 'pending');

  const { error: accErr } = await supabase.from('merge_suggestions').insert({
    import_row_id: importRowId,
    person_id: person.id,
    confidence: 'manual',
    evidence: { created_new: true, chosen_by: session.leader },
    field_changes: [],
    status: 'accepted',
    decided_at: new Date().toISOString(),
    decided_by: session.leader
  });
  if (accErr) return { ok: false, error: `Recording decision: ${accErr.message}` };

  revalidatePath(PATH);
  return { ok: true };
}

/** Type-ahead for retargeting and for relationship entry. */
export async function searchPeople(
  q: string
): Promise<{ id: number; display_name: string; primary_email: string | null }[]> {
  await requireRole(['leader']);
  const term = q.trim();
  if (term.length < 2) return [];

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('people')
    .select('id, display_name, primary_email')
    .is('merged_into_person_id', null)
    .ilike('display_name', `%${term}%`)
    .order('display_name')
    .limit(15);
  return data ?? [];
}

/**
 * Record a relationship by hand.
 *
 * The source's Relationship column is never parsed — 56 phrasings pointing in
 * two directions ("Mom of X" on adult rows, "Dad Patrick, Mom Jamie Lynn" on
 * scout rows). It is displayed verbatim next to this control so the reviewer
 * reads the sentence and states the edge themselves.
 */
export async function addRelationship(
  personId: number,
  relatedPersonId: number,
  type: RelationshipInput,
  isGuardian: boolean,
  sourceLabel?: string
): Promise<Result> {
  await requireRole(['leader']);
  if (personId === relatedPersonId) return { ok: false, error: 'A person cannot relate to themselves.' };

  // "Child of" is stored as the parent's parent_of edge with the two people
  // swapped, NOT as a type of its own. One fact must have exactly one
  // representation: if both spellings were storable, "Ben child_of Dan" and
  // "Dan parent_of Ben" would be two rows saying the same thing, and every
  // query would have to check both — the unique index would stop neither.
  // Entering it from either end therefore lands on the same row, and the
  // upsert below makes a duplicate entry a no-op.
  const stored =
    type === 'child_of'
      ? { person_id: relatedPersonId, related_person_id: personId, type: 'parent_of' as const }
      : { person_id: personId, related_person_id: relatedPersonId, type };

  const supabase = createAdminClient();
  const { error } = await supabase.from('relationships').upsert(
    {
      ...stored,
      is_guardian: isGuardian,
      source_label: sourceLabel || null
    },
    { onConflict: 'person_id,related_person_id,type' }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/** Undo a relationship recorded by mistake. Deletes the edge only — neither
 *  person is touched. */
export async function removeRelationship(relationshipId: number): Promise<Result> {
  await requireRole(['leader']);

  const supabase = createAdminClient();
  const { error } = await supabase.from('relationships').delete().eq('id', relationshipId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
