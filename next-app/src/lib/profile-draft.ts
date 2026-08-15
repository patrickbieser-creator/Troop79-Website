/**
 * The form-state half of the family self-service flow — what a /profile editor
 * SHOWS, as distinct from what the record holds.
 *
 * WHY THIS EXISTS. The editors used to seed every field from the live record
 * alone, so the moment a family submitted an update the form snapped back to
 * the old values: the proposal survived only as a one-line "awaiting review"
 * banner naming which fields had changed, never what they had changed to. A
 * parent working through a household — and switching between members while
 * they do it — lost sight of their own typing the instant they submitted, could
 * not proofread it, and could not copy a corrected address from one member's
 * form into another's. Reported by Patrick 2026-08-15.
 *
 * THE MODEL. A field has three values, not two:
 *
 *   live       what the record says today (only a leader's approval moves it)
 *   effective  live, overlaid with any pending proposal — what the form shows
 *   draft      what is in the input right now, as a string
 *
 * `effective` is the baseline everything is measured against. A draft equal to
 * it means there is nothing new to submit (the pending proposal already says
 * so), which is what disables the submit button. A draft that differs is an
 * unsubmitted edit. Withdrawing the pending request drops the overlay and the
 * form falls back to `live` on the next load.
 *
 * Everything here is pure and runs on both sides of the wire: the client uses
 * it to decide what to show and whether submit is live, the server re-derives
 * the real diff against the live row in actions.ts. The client's opinion is
 * never trusted — `diffFields` at the submit step is still the only thing that
 * decides what lands in `proposed_changes`.
 */

import {
  diffFields,
  parseFieldValue,
  type ChangeRequestRow,
  type FieldValue
} from './change-requests';

/** One member's form state: every editable field, as the string in its input. */
export type DraftValues = Record<string, string>;

/**
 * A record's stored value as an input string. `null` becomes '' (an empty
 * input), and `graduation_year` — the one number in either field set — is
 * stringified so a draft round-trips back through `parseFieldValue` to the
 * same type the diff compares against.
 */
export function displayValue(value: FieldValue | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * What the form should show: the live record with any pending proposal laid
 * over it. Only allowlisted fields are read from `proposed_changes` — the row
 * is jsonb read back from the database, and this feeds an input the family can
 * resubmit, so a stray key must not become a field.
 */
export function effectiveValues(
  fields: readonly string[],
  live: Record<string, FieldValue>,
  pending: ChangeRequestRow | null
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const field of fields) {
    const proposed = pending?.proposed_changes ?? {};
    out[field] = field in proposed ? proposed[field] : (live[field] ?? null);
  }
  return out;
}

/** Stored values → the strings their inputs hold. */
export function draftFromValues(
  fields: readonly string[],
  values: Record<string, FieldValue>
): DraftValues {
  const out: DraftValues = {};
  for (const field of fields) out[field] = displayValue(values[field]);
  return out;
}

/**
 * The fields whose draft differs from `against`, parsed the same way the
 * server will parse them — so "  Dana  " against "Dana" is not a change and
 * clearing a field to whitespace reads as null on both sides. Empty means
 * there is nothing to submit.
 */
export function draftDelta(
  fields: readonly string[],
  draft: DraftValues,
  against: Record<string, FieldValue>
): Record<string, FieldValue> {
  const proposed: Record<string, FieldValue> = {};
  for (const field of fields) {
    proposed[field] = parseFieldValue(field, draft[field] ?? '');
  }
  return diffFields(against, proposed, fields);
}

/**
 * Which fields a pending request actually proposes to change — the ones the
 * form marks as awaiting review, and the ones whose live value is worth
 * showing underneath so the family can see what the record still says.
 */
export function pendingFields(pending: ChangeRequestRow | null): Set<string> {
  return new Set(Object.keys(pending?.proposed_changes ?? {}));
}
