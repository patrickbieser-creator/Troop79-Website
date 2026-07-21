/**
 * Shared shape for the family self-service change-request flow
 * (Plans/Scout-Self-Service-Demographics.md) — used by both the public
 * /profile submit form and the admin Scout editor's review panel, so the
 * field list and labels can't drift between the two sides of one diff.
 */

export const EDITABLE_SCOUT_FIELDS = [
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'phone',
  'email',
  'school',
  'graduation_year',
  'swim_class',
  'birthdate',
  'things_we_should_know'
] as const;

export type EditableScoutField = (typeof EDITABLE_SCOUT_FIELDS)[number];

export const FIELD_LABEL: Record<EditableScoutField, string> = {
  address_line1: 'Address Line 1',
  address_line2: 'Address Line 2',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  phone: 'Phone',
  email: 'Email',
  school: 'School',
  graduation_year: 'Grade',
  swim_class: 'Swim Classification',
  birthdate: 'Birthdate',
  things_we_should_know: 'Things We Should Know'
};

/** `graduation_year` is the one numeric field (scouts.graduation_year is an
 *  int) — everything else is text. Kept as the real type all the way through
 *  (not stringified) so a diff against the live row compares like with like. */
export type FieldValue = string | number | null;

export interface ChangeRequestRow {
  id: number;
  entity_type: string;
  entity_id: string;
  submitted_by_person_id: number | null;
  submitted_at: string;
  proposed_changes: Partial<Record<EditableScoutField, FieldValue>>;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

function isEditableField(key: string): key is EditableScoutField {
  return (EDITABLE_SCOUT_FIELDS as readonly string[]).includes(key);
}

/** Parses a raw form-field string into the field's real stored type. A
 *  malformed graduation_year (a raw POST bypassing the <select>, not
 *  reachable through the UI) falls back to null rather than storing NaN,
 *  which would otherwise serialize silently to null over the wire anyway —
 *  failing the same way, but explicitly. */
export function parseFieldValue(field: EditableScoutField, raw: string): FieldValue {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (field === 'graduation_year') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
}

/** Only the fields that actually differ from the scout's current values —
 *  what gets stored in proposed_changes, and what the admin diff shows. */
export function diffScoutFields(
  current: Partial<Record<EditableScoutField, FieldValue>>,
  proposed: Partial<Record<EditableScoutField, FieldValue>>
): Partial<Record<EditableScoutField, FieldValue>> {
  const changed: Partial<Record<EditableScoutField, FieldValue>> = {};
  for (const [key, value] of Object.entries(proposed)) {
    if (!isEditableField(key)) continue;
    if ((current[key] ?? null) !== (value ?? null)) changed[key] = value;
  }
  return changed;
}
