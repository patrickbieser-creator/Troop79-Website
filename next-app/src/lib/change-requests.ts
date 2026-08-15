/**
 * Shared shape for the family self-service change-request flow
 * (Plans/Scout-Self-Service-Demographics.md) — used by both the public
 * /profile submit form and the admin review panels, so the field list and
 * labels can't drift between the two sides of one diff.
 *
 * TWO ENTITY TYPES. `change_requests` was built with a generic
 * (entity_type, entity_id) key on purpose, and this is the second type
 * cashing that in: /profile now edits the ADULTS of a household as well as
 * its scouts. A scout's editable fields live on `scouts`, an adult's on the
 * `people` spine, so the two field sets are genuinely different — everything
 * below is keyed by entity type rather than assuming the scout shape.
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

/**
 * An adult's editable demographics live on the `people` spine, not on a
 * role table — `scout_parents.email` and `leaders.email` are legacy pointers
 * that a person may or may not hold, while every adult has exactly one
 * `people` row.
 *
 * `birthdate` IS here (Patrick, 2026-08-14): an adult's birthday is ordinary
 * family-maintained information, and the troop needs it for the adults who
 * attend campouts. `bsa_member_id` is deliberately NOT — that number comes
 * from Scouting America rather than from the family, and a well-meaning
 * correction to it would break the Scoutbook export. Also excluded:
 * display_name (derived from first/last by the roster tools), notes, and
 * `active`, which is a leader's call.
 */
export const EDITABLE_PERSON_FIELDS = [
  'first_name',
  'last_name',
  'birthdate',
  'primary_email',
  'primary_phone',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip'
] as const;

export type EditablePersonField = (typeof EDITABLE_PERSON_FIELDS)[number];

export const PERSON_FIELD_LABEL: Record<EditablePersonField, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  birthdate: 'Birthdate',
  primary_email: 'Email',
  primary_phone: 'Phone',
  address_line1: 'Address Line 1',
  address_line2: 'Address Line 2',
  city: 'City',
  state: 'State',
  zip: 'ZIP'
};

/** The `change_requests.entity_type` values this app writes and reviews. */
export type ChangeEntityType = 'scout' | 'adult';

/** Field allowlist for an entity type. The privileged apply step re-filters
 *  through this, so it must be the same list the submit side used. */
export function editableFieldsFor(entityType: ChangeEntityType): readonly string[] {
  return entityType === 'adult' ? EDITABLE_PERSON_FIELDS : EDITABLE_SCOUT_FIELDS;
}

export function fieldLabel(entityType: ChangeEntityType, field: string): string {
  const map: Record<string, string> =
    entityType === 'adult' ? PERSON_FIELD_LABEL : FIELD_LABEL;
  return map[field] ?? field;
}

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
  /** Keys belong to the field set for `entity_type` — scout or adult. */
  proposed_changes: Record<string, FieldValue>;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

/** The only field stored as a number rather than text. */
const NUMERIC_FIELDS = new Set<string>(['graduation_year']);

/** Parses a raw form-field string into the field's real stored type. A
 *  malformed graduation_year (a raw POST bypassing the <select>, not
 *  reachable through the UI) falls back to null rather than storing NaN,
 *  which would otherwise serialize silently to null over the wire anyway —
 *  failing the same way, but explicitly. */
export function parseFieldValue(field: string, raw: string): FieldValue {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
}

/** Only the fields that actually differ from the entity's current values —
 *  what gets stored in proposed_changes, and what the admin diff shows.
 *  `allowed` is the entity type's field list, so a key the submit form never
 *  offered can't ride along into proposed_changes. */
export function diffFields(
  current: Record<string, FieldValue>,
  proposed: Record<string, FieldValue>,
  allowed: readonly string[]
): Record<string, FieldValue> {
  const allowedSet = new Set(allowed);
  const changed: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(proposed)) {
    if (!allowedSet.has(key)) continue;
    if ((current[key] ?? null) !== (value ?? null)) changed[key] = value;
  }
  return changed;
}
